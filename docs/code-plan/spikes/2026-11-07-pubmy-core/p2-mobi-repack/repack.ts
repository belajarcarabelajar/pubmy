// Q: Can foliate-js mobi.js parse DRM-free AZW3 (KF8) and MOBI6 under Bun, and can its sections/resources be repacked into an EPUB 3 that passes @likecoin/epubcheck-ts?
// Usage: bun repack.ts <file> [--force-mobi6] [--out out.epub] [--verbose]
import { DOMParser, parseHTML } from 'linkedom'
import { unzlibSync } from 'fflate'
import { EpubCheck } from '@likecoin/epubcheck-ts'
import { readRecord0Header, kf8Boundary, withoutKF8Boundary, repackToEpub } from './core.ts'

const shims: string[] = []
const g = globalThis as any
if (!g.DOMParser) { g.DOMParser = DOMParser; shims.push('DOMParser(linkedom)') }
if (!g.XMLSerializer) { g.XMLSerializer = class { serializeToString(n: any) { return n.toString() } }; shims.push('XMLSerializer(stub)') }
if (!g.document) { g.document = parseHTML('<!DOCTYPE html><html><body></body></html>').document; shims.push('document(linkedom)') }
if (!g.CSS?.escape) { g.CSS = { escape: (s: string) => s.replace(/([^\w-])/g, '\\$1') }; shims.push('CSS.escape') }
{
    // mobi.js reads <a>.innerText for MOBI6 TOC labels and <textarea>.value to unescape metadata.
    const a = g.document.createElement('a')
    if (a.innerText === undefined) {
        Object.defineProperty(Object.getPrototypeOf(Object.getPrototypeOf(a)), 'innerText', { get() { return this.textContent }, configurable: true })
        shims.push('HTMLElement.innerText')
    }
    const t = g.document.createElement('textarea'); t.innerHTML = '&amp;'
    if (t.value !== '&') {
        // linkedom keeps textarea content raw, so decode entities through a parsed <div>.
        Object.defineProperty(Object.getPrototypeOf(t), 'value', {
            get() { const d = g.document.createElement('div'); d.innerHTML = this.innerHTML; return d.textContent },
            configurable: true,
        })
        shims.push(t.value === '&' ? 'textarea.value' : `textarea.value STILL WRONG (${JSON.stringify(t.value)})`)
    }
}
const { MOBI } = await import('./vendor/mobi.js')

const args = process.argv.slice(2)
const file = args[0]
const outIdx = args.indexOf('--out')
let bytes = new Uint8Array(await Bun.file(file).arrayBuffer())
const hdr = readRecord0Header(bytes)
const boundary = kf8Boundary(bytes)
console.log(`file=${file}`)
console.log(`record0: palmdoc.encryption=${hdr.encryption} (0=none,1=old,2=Mobipocket DRM) mobiVersion=${hdr.mobiVersion} exth121.kf8Boundary=${boundary ?? 'absent'}${boundary !== null && boundary < 0xffffffff ? ' (combo MOBI6+KF8)' : ''}`)
if (args.includes('--force-mobi6')) { bytes = withoutKF8Boundary(bytes); console.log('forced MOBI6 path (EXTH 121 set to 0xffffffff in memory)') }
if (hdr.encryption !== 0) { console.log('DRM: encrypted, refusing'); process.exit(2) }

const book = await new MOBI({ unzlib: unzlibSync }).open(new Blob([bytes]))
console.log(`foliate: class=${book.constructor.name} palmdoc.encryption(as read by mobi.js)=${book.mobi.headers.palmdoc.encryption} shims=[${shims.join(', ')}]`)
const { epub, report, meta } = await repackToEpub(book)
console.log('meta', JSON.stringify(meta))
console.log('report', JSON.stringify(report))
const out = outIdx > 0 ? args[outIdx + 1] : `${file}.epub`
await Bun.write(out, epub)
const res = await EpubCheck.validate(epub)
const count = (s: string) => res.messages.filter((m: any) => m.severity === s).length
console.log(`epubcheck: valid=${res.valid} fatal=${count('fatal')} error=${res.errorCount} warning=${res.warningCount} usage=${count('usage')} info=${count('info')} out=${out}`)
const byId: Record<string, number> = {}
for (const m of res.messages) if (['fatal', 'error', 'warning'].includes(m.severity)) byId[`${m.severity}:${m.id}`] = (byId[`${m.severity}:${m.id}`] ?? 0) + 1
console.log('by id', JSON.stringify(byId))
if (args.includes('--verbose')) {
    const seen = new Set<string>()
    for (const m of res.messages) {
        if (!['fatal', 'error', 'warning'].includes(m.severity) || seen.has(m.id)) continue
        seen.add(m.id)
        console.log(`  ${m.severity} ${m.id}: ${String(m.message).slice(0, 220)} @ ${m.location?.path}:${m.location?.line}`)
    }
}
process.exit(res.valid ? 0 : 1)
