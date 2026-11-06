// MOBI6 (pre-KF8 Mobipocket) to the Book model. MOBI6 has no CSS: layout lives in
// HTML 3 presentational attributes, which become inline styles here because the
// packager writes chapter heads without stylesheet links.
import type { Asset, Book, Ctx, TocEntry } from "../../types.ts";

export interface Mobi6Links {
  /** Target href for a `filepos` value, or null when it points nowhere. */
  filepos(fp: string): string | null;
  /** Asset href for an image's recindex (or src), or null to drop the image. */
  image(key: string): string | null;
}

interface FoliateSection {
  createDocument?: () => Promise<Document>;
}
interface FoliateTocItem {
  label?: string;
  href?: string;
  subitems?: FoliateTocItem[];
}
/** The subset of foliate-js `MOBI6` (from `new MOBI({ unzlib }).open(blob)`) read here. */
export interface FoliateMobi6Book {
  sections: FoliateSection[];
  toc?: FoliateTocItem[];
  metadata?: { title?: string; author?: string[]; language?: string | string[]; identifier?: string };
  getCover?: () => Promise<Blob | null | undefined>;
  splitTOCHref(href: string): [number, string];
  mobi: { loadResource(index: number): Promise<ArrayBuffer | Uint8Array> };
}

// HTML elements obsolete in HTML5 that MOBI6 markup still uses; epubcheck rejects them (RSC-005).
const OBSOLETE: Record<string, string> = { font: "span", center: "div", big: "span", tt: "code", strike: "s", blink: "span", basefont: "span" };
const VOID = new Set(["area", "br", "col", "hr", "img", "wbr"]);
const KEEP = new Set(["id", "class", "href", "alt", "title", "lang", "dir", "colspan", "rowspan"]);
const DROP = new Set(["script", "noscript", "guide", "reference", "head", "style", "link", "meta", "title", "iframe", "object", "embed", "form", "input", "button", "select", "textarea"]);
// Elements whose width/height are box sizes; on text blocks Mobipocket reads them as
// first-line indent and space above, the mapping calibre's MOBI6 reader also uses.
const SIZED = new Set(["img", "table", "td", "th", "tr", "col", "hr"]);
const ALIGN = new Set(["left", "right", "center", "justify"]);
// <font size> 1..7 as ratios of the CSS keywords x-small..xxx-large to medium (16px base).
const FONT_EM = [0.625, 0.8125, 1, 1.125, 1.5, 2, 3];
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string) => esc(s).replace(/"/g, "&quot;");

function cssLength(v: string): string | null {
  const t = v.trim().toLowerCase();
  if (/^-?\d+(\.\d+)?$/.test(t)) return `${t}px`;
  return /^-?\d+(\.\d+)?(%|em|ex|px|pt|pc|in|cm|mm|rem)$/.test(t) ? t : null;
}

function fontEm(v: string): string | null {
  const m = /^\s*([+-]?)(\d+)/.exec(v);
  if (!m) return null;
  const n = Number(m[2]);
  const level = m[1] === "+" ? 3 + n : m[1] === "-" ? 3 - n : n;
  return `${FONT_EM[Math.min(7, Math.max(1, level)) - 1]}em`;
}

const noLinks: Mobi6Links = { filepos: () => null, image: () => null };

// What XHTML allows directly inside table structure. foliate inserts filepos anchors at byte
// offsets, which can land between rows, and linkedom does not foster-parent them out.
const TABLE_CHILDREN: Record<string, Set<string>> = {
  table: new Set(["caption", "colgroup", "thead", "tbody", "tfoot", "tr"]),
  thead: new Set(["tr"]),
  tbody: new Set(["tr"]),
  tfoot: new Set(["tr"]),
  tr: new Set(["td", "th"]),
};

/** `stray` collects markup misplaced in table structure until the next cell takes it. */
function serializeNode(node: Node, links: Mobi6Links, stray?: string[]): string {
  if (node.nodeType === 3) return esc(node.nodeValue ?? "");
  if (node.nodeType !== 1) return "";
  const el = node as Element;
  const tag = el.localName.toLowerCase();
  let after = "";
  const kids = () => {
    const allowed = TABLE_CHILDREN[tag];
    if (!allowed) {
      const pre = (tag === "td" || tag === "th") && stray ? stray.splice(0).join("") : "";
      return pre + Array.from(el.childNodes, (n) => serializeNode(n, links)).join("");
    }
    const own = tag === "table" ? [] : (stray ?? []);
    let s = "";
    for (const n of Array.from(el.childNodes)) {
      const name = n.nodeType === 1 ? (n as Element).localName.toLowerCase() : "";
      if (allowed.has(name)) s += serializeNode(n, links, own);
      else if (n.nodeType === 3 && !(n.nodeValue ?? "").trim()) s += esc(n.nodeValue ?? "");
      else own.push(serializeNode(n, links));
    }
    // Leftovers with no later cell go right after the table, so their ids stay in the file.
    if (tag === "table") after = own.join("");
    return s;
  };
  if (DROP.has(tag)) return "";
  if (tag.includes(":") || tag === "html" || tag === "body") return kids();
  const out = OBSOLETE[tag] ?? tag;
  const styles: string[] = [];
  let attrs = "";
  if (tag === "img") {
    const src = links.image(el.getAttribute("recindex") ?? el.getAttribute("src") ?? "");
    if (!src) return esc(el.getAttribute("alt") ?? "");
    attrs += ` src="${escAttr(src)}"`;
  }
  if (tag === "center") styles.push("text-align: center");
  for (const a of Array.from(el.attributes)) {
    const name = a.name.toLowerCase();
    const v = a.value;
    if (name === "style") styles.unshift(v.trim().replace(/;$/, ""));
    else if (name === "align" && ALIGN.has(v.trim().toLowerCase())) styles.push(`text-align: ${v.trim().toLowerCase()}`);
    else if (name === "size" && tag === "font") {
      const em = fontEm(v);
      if (em) styles.push(`font-size: ${em}`);
    } else if (name === "width" || name === "height") {
      const len = cssLength(v);
      if (!len) continue;
      if (SIZED.has(tag)) styles.push(`${name}: ${len}`);
      else styles.push(name === "width" ? `text-indent: ${len}` : `margin-top: ${len}`);
    } else if (name === "filepos" && tag === "a") {
      const href = links.filepos(v);
      if (href) attrs += ` href="${escAttr(href)}"`;
    } else if (name === "href") {
      if (!el.hasAttribute("filepos") && /^(https?:|mailto:)/i.test(v)) attrs += ` href="${escAttr(v)}"`;
    } else if (KEEP.has(name)) attrs += ` ${name}="${escAttr(v)}"`;
  }
  if (out === "img" && !el.hasAttribute("alt")) attrs += ` alt=""`;
  const style = styles.filter(Boolean).join("; ");
  if (style) attrs += ` style="${escAttr(style)}"`;
  if (VOID.has(out)) return `<${out}${attrs}/>`;
  const inner = kids();
  return `<${out}${attrs}>${inner}</${out}>${after}`;
}

/**
 * Serialises a MOBI6 section as an XHTML body fragment. linkedom's text/html parser leaves a
 * body-less fragment under #document with an empty doc.body, so every top-level node is walked.
 */
export function serializeMobi6(doc: Document, links: Partial<Mobi6Links> = {}): string {
  const l = { ...noLinks, ...links };
  return Array.from(doc.childNodes, (n) => serializeNode(n, l)).join("");
}

export function mobi6HtmlToXhtml(markup: string, ctx: Pick<Ctx, "dom">, links?: Partial<Mobi6Links>): string {
  return serializeMobi6(ctx.dom.parseHTML(markup), links);
}

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif" };
function sniffImage(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  return null;
}

const fileOf = (i: number) => `ch${String(i + 1).padStart(4, "0")}.xhtml`;

/** Builds the Book from an opened foliate MOBI6 book. */
export async function readMobi6(book: FoliateMobi6Book, ctx: Pick<Ctx, "progress" | "signal">): Promise<Book> {
  const docs: (Document | null)[] = [];
  for (const s of book.sections) {
    ctx.signal.throwIfAborted();
    docs.push(s.createDocument ? await s.createDocument() : null);
    ctx.progress((docs.length / book.sections.length) * 0.5);
  }

  const filepos = (fp: string): string | null => {
    try {
      const [index, id] = book.splitTOCHref(`filepos:${fp}`);
      const doc = docs[index];
      if (!doc) return null;
      return doc.getElementById(id) ? `${fileOf(index)}#${id}` : fileOf(index);
    } catch {
      return null;
    }
  };

  const assets: Asset[] = [];
  const addImage = (data: Uint8Array, name: string): string | null => {
    const type = sniffImage(data);
    if (!type) return null;
    const href = `images/${name}.${EXT[type]}`;
    assets.push({ href, mediaType: type, data });
    return href;
  };
  const images = new Map<string, string | null>();
  for (const doc of docs) {
    for (const img of Array.from(doc?.querySelectorAll("img[recindex]") ?? [])) {
      const rec = img.getAttribute("recindex") ?? "";
      if (images.has(rec)) continue;
      let href: string | null = null;
      try {
        href = addImage(new Uint8Array(await book.mobi.loadResource(Number(rec) - 1)), `img${rec.padStart(4, "0")}`);
      } catch {
        href = null;
      }
      images.set(rec, href);
    }
  }

  const chapters = [];
  for (const [i, doc] of docs.entries()) {
    if (!doc) continue;
    ctx.signal.throwIfAborted();
    const title = doc.querySelector("h1, h2, h3")?.textContent?.trim() || `Section ${i + 1}`;
    chapters.push({ href: fileOf(i), title, body: serializeMobi6(doc, { filepos, image: (k) => images.get(k) ?? null }) });
    ctx.progress(0.5 + ((i + 1) / docs.length) * 0.5);
  }

  const tocOf = (items: FoliateTocItem[] = []): TocEntry[] =>
    items.flatMap((it) => {
      const children = tocOf(it.subitems);
      const fp = /^filepos:(\d+)/.exec(it.href ?? "")?.[1];
      const href = fp ? filepos(fp) : null;
      if (!href) return children;
      return [{ title: it.label?.trim() || "Untitled", href, ...(children.length ? { children } : {}) }];
    });

  const m = book.metadata ?? {};
  let cover: string | undefined;
  const blob = await book.getCover?.().catch(() => null);
  if (blob) cover = addImage(new Uint8Array(await blob.arrayBuffer()), "cover") ?? undefined;

  return {
    meta: {
      title: m.title?.trim() || "Untitled",
      creators: (m.author ?? []).map(String).filter(Boolean),
      // EXTH 524 language arrives as an array, the MOBI header locale as a string.
      language: String([m.language].flat()[0] || "en").split(/[_-]/)[0] || "en",
      identifier: m.identifier ? `urn:pubmy:mobi:${m.identifier}` : undefined,
      cover,
    },
    chapters,
    assets,
    toc: tocOf(book.toc),
    layout: "reflow",
    direction: "ltr",
  };
}

/** Reads a combo MOBI6+KF8 file through its KF8 part, falling back to MOBI6 when KF8 fails. */
export async function preferKf8(
  kf8: (() => Promise<Book>) | null,
  mobi6: () => Promise<Book>,
): Promise<{ book: Book; warnings: string[] }> {
  if (!kf8) return { book: await mobi6(), warnings: [] };
  try {
    return { book: await kf8(), warnings: [] };
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return { book: await mobi6(), warnings: [`The KF8 part could not be read (${why}); converted the older MOBI6 part instead.`] };
  }
}

const u32 = (b: Uint8Array, o: number) => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;

// EXTH record 121 holds the record index where the KF8 part of a combo file starts.
function findKf8Boundary(bytes: Uint8Array): { valueOffset: number; value: number } | null {
  if (bytes.length < 82) return null;
  const rec0 = u32(bytes, 78);
  if (rec0 + 132 > bytes.length || !(u32(bytes, rec0 + 128) & 0x40)) return null;
  let p = rec0 + 16 + u32(bytes, rec0 + 20);
  if (p + 12 > bytes.length || String.fromCharCode(...bytes.subarray(p, p + 4)) !== "EXTH") return null;
  const count = u32(bytes, p + 8);
  p += 12;
  for (let i = 0; i < count && p + 12 <= bytes.length; i++) {
    const type = u32(bytes, p);
    const len = u32(bytes, p + 4);
    if (type === 121) return { valueOffset: p + 8, value: u32(bytes, p + 8) };
    if (len < 8) return null;
    p += len;
  }
  return null;
}

/** True when the file is a combo MOBI6+KF8 file (EXTH 121 names a real record). */
export function isCombo(bytes: Uint8Array): boolean {
  const hit = findKf8Boundary(bytes);
  return hit !== null && hit.value !== 0xffffffff;
}

/** Copy with EXTH 121 set to 0xffffffff, so foliate opens a combo file as plain MOBI6. */
export function withoutKf8Boundary(bytes: Uint8Array): Uint8Array {
  const copy = bytes.slice();
  const hit = findKf8Boundary(copy);
  if (hit) new DataView(copy.buffer, copy.byteOffset).setUint32(hit.valueOffset, 0xffffffff);
  return copy;
}
