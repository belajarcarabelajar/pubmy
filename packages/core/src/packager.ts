import { strToU8, zipSync, type Zippable } from "fflate";
import { kindleFix, stripControls } from "./kindle-fixes.ts";
import type { Book, TocEntry } from "./types.ts";

const esc = (s: string) => stripControls(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string) => esc(s).replace(/"/g, "&quot;");

const xhtmlDoc = (lang: string, title: string, head: string, body: string, extraNs = "") =>
  `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml"${extraNs} lang="${escAttr(lang)}" xml:lang="${escAttr(lang)}">` +
  `<head><title>${esc(title)}</title>${head}</head><body>${body}</body></html>`;

function tocOf(book: Book): TocEntry[] {
  return book.toc.length ? book.toc : book.chapters.map((c) => ({ title: c.title, href: c.href }));
}

function navList(items: TocEntry[]): string {
  return `<ol>${items
    .map((it) => `<li><a href="${escAttr(it.href)}">${esc(it.title.trim() || "Untitled")}</a>${it.children?.length ? navList(it.children) : ""}</li>`)
    .join("")}</ol>`;
}

function ncx(book: Book, uid: string, toc: TocEntry[]): string {
  let order = 0;
  let depth = 0;
  const points = (items: TocEntry[], level: number): string =>
    items
      .map((it) => {
        depth = Math.max(depth, level);
        const n = ++order;
        return `<navPoint id="np${n}" playOrder="${n}"><navLabel><text>${esc(it.title.trim() || "Untitled")}</text></navLabel>` +
          `<content src="${escAttr(it.href)}"/>${it.children?.length ? points(it.children, level + 1) : ""}</navPoint>`;
      })
      .join("");
  const map = points(toc, 1);
  return `<?xml version="1.0" encoding="utf-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head>` +
    `<meta name="dtb:uid" content="${escAttr(uid)}"/><meta name="dtb:depth" content="${depth}"/>` +
    `<meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head>` +
    `<docTitle><text>${esc(book.meta.title)}</text></docTitle><navMap>${map}</navMap></ncx>`;
}

function opf(book: Book, uid: string): string {
  const { meta } = book;
  const modified = (meta.modified ?? new Date().toISOString()).replace(/\.\d+Z$/, "Z");
  const coverIdx = meta.cover ? book.assets.findIndex((a) => a.href === meta.cover) : -1;
  const items = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    ...book.chapters.map((c, i) => `<item id="c${i + 1}" href="${escAttr(c.href)}" media-type="application/xhtml+xml"${/<svg[\s>]/.test(c.body) ? ` properties="svg"` : ""}/>`),
    ...book.assets.map((a, i) =>
      `<item id="a${i + 1}" href="${escAttr(a.href)}" media-type="${escAttr(a.mediaType)}"${i === coverIdx ? ` properties="cover-image"` : ""}/>`),
  ];
  const fixed = book.layout === "fixed"
    ? `<meta property="rendition:layout">pre-paginated</meta><meta property="rendition:spread">landscape</meta>`
    : "";
  const ppd = book.direction === "rtl" ? ` page-progression-direction="rtl"` : "";
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"${fixed ? ` prefix="rendition: http://www.idpf.org/vocab/rendition/#"` : ""}>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">${esc(uid)}</dc:identifier>
    <dc:title>${esc(meta.title)}</dc:title>
    <dc:language>${esc(meta.language)}</dc:language>
    ${meta.creators.map((c) => `<dc:creator>${esc(c)}</dc:creator>`).join("")}
    <meta property="dcterms:modified">${esc(modified)}</meta>${fixed}${coverIdx >= 0 ? `<meta name="cover" content="a${coverIdx + 1}"/>` : ""}
  </metadata>
  <manifest>
    ${items.join("\n    ")}
  </manifest>
  <spine toc="ncx"${ppd}>${book.chapters.map((_, i) => `<itemref idref="c${i + 1}"/>`).join("")}</spine>
</package>`;
}

// Fixed layout: the page size is the width/height attributes of the first <img> in the body.
function viewportMeta(body: string): string {
  const img = body.match(/<img\b[^>]*>/i)?.[0] ?? "";
  const w = img.match(/\swidth="(\d+)"/)?.[1];
  const h = img.match(/\sheight="(\d+)"/)?.[1];
  return w && h ? `<meta name="viewport" content="width=${w}, height=${h}"/>` : "";
}

const CONTAINER =`<?xml version="1.0"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">` +
  `<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;

/** Writes an EPUB 3 (OCF zip) from a Book model, with the Kindle fixes applied to every chapter. */
export function pack(book: Book): Uint8Array {
  const uid = book.meta.identifier ?? `urn:uuid:${crypto.randomUUID()}`;
  const lang = book.meta.language;
  const toc = tocOf(book);
  const nav = xhtmlDoc(lang, book.meta.title, "", `<nav epub:type="toc" id="toc"><h1>Contents</h1>${navList(toc)}</nav>`,
    ` xmlns:epub="http://www.idpf.org/2007/ops"`);
  // The OCF rule: mimetype is the first entry and stored, so insertion order matters here.
  const files: Zippable = {
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(CONTAINER),
    "OEBPS/content.opf": strToU8(opf(book, uid)),
    "OEBPS/nav.xhtml": strToU8(nav),
    "OEBPS/toc.ncx": strToU8(ncx(book, uid, toc)),
  };
  for (const c of book.chapters) {
    const head = book.layout === "fixed" ? viewportMeta(c.body) : "";
    files[`OEBPS/${c.href}`] = strToU8(xhtmlDoc(lang, c.title, head, kindleFix(c.body)));
  }
  for (const a of book.assets) files[`OEBPS/${a.href}`] = a.data;
  return zipSync(files);
}
