// Pure logic for the P2 spike: reads PDB headers and repacks an opened foliate-js
// MOBI/KF8 book into EPUB 3 parts. Uses only standard DOM APIs, so it runs in a
// browser or under Bun with a DOM shim.
import { zipSync, strToU8 } from 'fflate'

const u16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1]
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0

export function readRecord0Header(bytes: Uint8Array) {
    const rec0 = u32(bytes, 78)
    return { encryption: u16(bytes, rec0 + 12), mobiVersion: u32(bytes, rec0 + 36) }
}

// Returns the EXTH 121 (KF8 boundary) value, or null when absent.
function findExthBoundary(bytes: Uint8Array): { valueOffset: number; value: number } | null {
    const rec0 = u32(bytes, 78)
    const exthFlag = u32(bytes, rec0 + 128)
    if (!(exthFlag & 0x40)) return null
    let p = rec0 + 16 + u32(bytes, rec0 + 20)
    if (String.fromCharCode(...bytes.subarray(p, p + 4)) !== 'EXTH') return null
    const count = u32(bytes, p + 8)
    p += 12
    for (let i = 0; i < count; i++) {
        const type = u32(bytes, p), len = u32(bytes, p + 4)
        if (type === 121) return { valueOffset: p + 8, value: u32(bytes, p + 8) }
        p += len
    }
    return null
}

export const kf8Boundary = (bytes: Uint8Array) => findExthBoundary(bytes)?.value ?? null

// Copy with EXTH 121 set to 0xffffffff, so a combo MOBI6+KF8 file opens as plain MOBI6.
export function withoutKF8Boundary(bytes: Uint8Array) {
    const copy = bytes.slice()
    const hit = findExthBoundary(copy)
    if (hit) new DataView(copy.buffer).setUint32(hit.valueOffset, 0xffffffff)
    return copy
}

export function sniffMediaType(b: Uint8Array): string | null {
    if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg'
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif'
    return null
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif' }
// HTML elements obsolete in HTML5 that MOBI6 markup still uses; epubcheck rejects them (RSC-005).
const OBSOLETE: Record<string, string> = { font: 'span', center: 'div', big: 'span', tt: 'code', strike: 's', blink: 'span', basefont: 'span' }
const VOID = new Set(['area', 'br', 'col', 'hr', 'img', 'wbr'])
const KEEP_ATTRS = new Set(['id', 'class', 'href', 'src', 'alt', 'title', 'lang', 'dir', 'colspan', 'rowspan', 'style'])
const DROP_ELEMENTS = new Set(['script', 'guide', 'reference', 'head', 'style', 'link', 'meta', 'title'])
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escAttr = (s: string) => esc(s).replace(/"/g, '&quot;')

export type Report = { droppedAttrs: Record<string, number>; unwrapped: Record<string, number>; brokenLinks: number; brokenSamples: string[]; images: number; css: number; textIn: number; textOut: number }
const SKIP_TEXT = new Set(['head', 'script', 'style', 'title', 'guide'])
const countText = (n: any): number => n.nodeType === 3 ? (n.nodeValue ?? '').trim().length
    : n.nodeType === 1 && !SKIP_TEXT.has(String(n.localName ?? '').toLowerCase())
        ? Array.from(n.childNodes as ArrayLike<any>).reduce((s: number, c: any) => s + countText(c), 0) : 0
const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1 }

function toXHTML(node: any, r: Report): string {
    if (node.nodeType === 3) { r.textOut += (node.nodeValue ?? '').trim().length; return esc(node.nodeValue ?? '') }
    if (node.nodeType !== 1) return ''
    const tag = String(node.localName ?? node.tagName).toLowerCase()
    const kids = () => Array.from(node.childNodes as ArrayLike<any>).map(n => toXHTML(n, r)).join('')
    if (DROP_ELEMENTS.has(tag)) return ''
    if (tag.includes(':') || tag === 'html' || tag === 'body') { if (tag.includes(':')) bump(r.unwrapped, tag); return kids() }
    const out = OBSOLETE[tag] ? (bump(r.unwrapped, tag), OBSOLETE[tag]) : tag
    let attrs = ''
    for (const a of Array.from(node.attributes as ArrayLike<any>)) {
        const name = String(a.name).toLowerCase()
        if (!KEEP_ATTRS.has(name)) { bump(r.droppedAttrs, name); continue }
        if (name === 'href' && !a.value) continue
        attrs += ` ${name}="${escAttr(a.value)}"`
    }
    if (out === 'img' && !node.hasAttribute('alt')) attrs += ' alt=""'
    if (VOID.has(out)) return `<${out}${attrs}/>`
    return `<${out}${attrs}>${kids()}</${out}>`
}

export type Part = { path: string; data: Uint8Array; mediaType: string; id: string; props?: string }
type TocItem = { label: string; href: string; subitems?: TocItem[] }

// `book` is the object returned by foliate-js `new MOBI({unzlib}).open(file)`.
export async function repackToEpub(book: any) {
    const isKF8 = 'transformTarget' in book
    const report: Report = { droppedAttrs: {}, unwrapped: {}, brokenLinks: 0, brokenSamples: [], images: 0, css: 0, textIn: 0, textOut: 0 }
    const parts: Part[] = []
    const resKeys = new Map<string, string>()
    const decoder = new TextDecoder()

    const addImage = async (key: string, load: () => Promise<ArrayBuffer | Uint8Array>) => {
        if (resKeys.has(key)) return resKeys.get(key)!
        const bytes = new Uint8Array(await load())
        const type = sniffMediaType(bytes)
        if (!type) return null
        const n = ++report.images
        const path = `img${String(n).padStart(4, '0')}.${EXT[type]}`
        parts.push({ path, data: bytes, mediaType: type, id: `img${n}` })
        resKeys.set(key, path)
        return path
    }
    const embedId = (s: string) => parseInt(s.match(/kindle:embed:(\w+)/)![1], 32)
    const replaceCssEmbeds = async (css: string) => {
        for (const m of [...css.matchAll(/kindle:embed:\w+(\?mime=[\w/+.-]+)?/g)]) {
            const p = await addImage(m[0], () => book.mobi.loadResource(embedId(m[0]) - 1))
            css = css.replace(m[0], p ?? '')
        }
        return css
    }

    const sections: { index: number; doc: any }[] = []
    for (const [index, s] of book.sections.entries()) {
        if (!s.createDocument) continue
        sections.push({ index, doc: await s.createDocument() })
    }
    const docOf = (i: number) => sections.find(s => s.index === i)?.doc
    const fileOf = (i: number) => `s${String(i).padStart(4, '0')}.xhtml`
    let autoId = 0

    const resolve = async (href: string): Promise<string | null> => {
        try {
            if (isKF8) {
                const res = await book.resolveHref(href)
                if (!res) return null
                const target = docOf(res.index)
                let el = null
                try { el = target && res.anchor(target) } catch {}
                if (!el) return fileOf(res.index)
                if (!el.getAttribute('id')) el.setAttribute('id', `pm${++autoId}`)
                return `${fileOf(res.index)}#${el.getAttribute('id')}`
            }
            const [index, id] = book.splitTOCHref(href)
            if (index < 0) return null
            return docOf(index)?.getElementById(id) ? `${fileOf(index)}#${id}` : fileOf(index)
        } catch { return null }
    }

    const cssLinksPerSection = new Map<number, string[]>()
    for (const { index, doc } of sections) {
        const cssPaths: string[] = []
        for (const link of Array.from(doc.querySelectorAll('link') as ArrayLike<any>)) {
            const href = link.getAttribute('href') ?? ''
            const m = href.match(/kindle:flow:(\w+)/)
            if (!m || !/css/.test(href)) continue
            const key = `flow:${m[1]}`
            if (!resKeys.has(key)) {
                const css = await replaceCssEmbeds(decoder.decode(await book.loadFlow(parseInt(m[1], 32))))
                const n = ++report.css
                const path = `style${n}.css`
                parts.push({ path, data: strToU8(css), mediaType: 'text/css', id: `css${n}` })
                resKeys.set(key, path)
            }
            cssPaths.push(resKeys.get(key)!)
        }
        cssLinksPerSection.set(index, cssPaths)
        for (const img of Array.from(doc.querySelectorAll('img') as ArrayLike<any>)) {
            const src = img.getAttribute('src') ?? '', rec = img.getAttribute('recindex')
            const path = src.startsWith('kindle:embed')
                ? await addImage(src, () => book.mobi.loadResource(embedId(src) - 1))
                : rec ? await addImage(`rec:${rec}`, () => book.mobi.loadResource(Number(rec) - 1)) : null
            if (path) img.setAttribute('src', path)
            else { img.removeAttribute('src'); report.brokenLinks++; report.brokenSamples.push(`img:${src || rec}`) }
        }
        for (const a of Array.from(doc.querySelectorAll('a') as ArrayLike<any>)) {
            const href = a.getAttribute('href') ?? ''
            const filepos = a.getAttribute('filepos')
            const internal = filepos ? `filepos:${filepos}` : href.startsWith('kindle:pos') ? href : null
            if (!internal) continue
            const target = await resolve(internal)
            if (target) a.setAttribute('href', target)
            else { a.removeAttribute('href'); report.brokenLinks++; report.brokenSamples.push(internal) }
        }
    }

    const meta = book.metadata ?? {}
    const title = meta.title || 'Untitled'
    for (const { index, doc } of sections) {
        const css = (cssLinksPerSection.get(index) ?? []).map(p => `<link rel="stylesheet" type="text/css" href="${p}"/>`).join('')
        // linkedom's text/html parser leaves a body-less fragment under #document with an
        // empty doc.body, so walk every top-level node instead of doc.body.
        const top = Array.from(doc.childNodes as ArrayLike<any>)
        for (const n of top) report.textIn += countText(n)
        const body = top.map(n => toXHTML(n, report)).join('')
        const xhtml = `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${esc(title)}</title>${css}</head><body>${body}</body></html>`
        parts.push({ path: fileOf(index), data: strToU8(xhtml), mediaType: 'application/xhtml+xml', id: `s${index}` })
    }

    const cover = await book.getCover?.()
    if (cover) {
        const bytes = new Uint8Array(await cover.arrayBuffer())
        const type = sniffMediaType(bytes)
        if (type) parts.push({ path: `cover.${EXT[type]}`, data: bytes, mediaType: type, id: 'cover', props: 'cover-image' })
    }

    const tocIn: TocItem[] = book.toc?.length ? book.toc
        : sections.map(s => ({ label: `Section ${s.index + 1}`, href: '' }))
    const navItems = async (items: TocItem[]): Promise<string> => {
        let out = ''
        for (const it of items) {
            const target = it.href ? await resolve(it.href) : null
            const sub = it.subitems?.length ? `<ol>${await navItems(it.subitems)}</ol>` : ''
            const label = esc(it.label?.trim() || 'Untitled')
            out += `<li>${target ? `<a href="${escAttr(target)}">${label}</a>` : `<span>${label}</span>`}${sub}</li>`
        }
        return out
    }
    let navList = await navItems(tocIn)
    // A nav li with a span and no sub-list is invalid; fall back to section links.
    if (!navList.includes('<a ')) navList = sections.map(s => `<li><a href="${fileOf(s.index)}">Section ${s.index + 1}</a></li>`).join('')
    const nav = `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${esc(title)}</title></head><body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${navList}</ol></nav></body></html>`
    parts.push({ path: 'nav.xhtml', data: strToU8(nav), mediaType: 'application/xhtml+xml', id: 'nav', props: 'nav' })

    // EXTH 524 language arrives as an array; the MOBI header locale as a string.
    const lang = String([meta.language].flat()[0] || 'en').split(/[_-]/)[0]
    const authors: string[] = meta.author ?? []
    const spine = sections.map(s => `<itemref idref="s${s.index}"/>`).join('')
    const manifest = parts.map(p => `<item id="${p.id}" href="${p.path}" media-type="${p.mediaType}"${p.props ? ` properties="${p.props}"` : ''}/>`).join('\n    ')
    const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:pubmy:mobi:${escAttr(String(meta.identifier ?? '0'))}</dc:identifier>
    <dc:title>${esc(title)}</dc:title>
    <dc:language>${esc(lang)}</dc:language>
    ${authors.map(a => `<dc:creator>${esc(a)}</dc:creator>`).join('')}
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
  </metadata>
  <manifest>
    ${manifest}
  </manifest>
  <spine>${spine}</spine>
</package>`
    const container = `<?xml version="1.0"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`

    const files: Record<string, any> = {
        mimetype: [strToU8('application/epub+zip'), { level: 0 }],
        'META-INF/container.xml': strToU8(container),
        'OEBPS/content.opf': strToU8(opf),
    }
    for (const p of parts) files[`OEBPS/${p.path}`] = p.data
    return { epub: zipSync(files), report, meta: { title, authors, lang, isKF8, sections: sections.length, tocTop: book.toc?.length ?? 0 } }
}
