// Turns a foliate-js KF8 book (AZW3, or the KF8 half of a combo file) into the Book model:
// sections become chapters, kindle:embed and kindle:flow resources become assets, and
// kindle:pos links and the NCX become file#id references.
import type { Asset, Book, Chapter, TocEntry } from "../../types.ts";

export interface FoliateTocItem {
  label?: string;
  href?: string;
  subitems?: FoliateTocItem[];
}

/** The members of a foliate-js `KF8` object this module uses. */
export interface Kf8Book {
  /** Only KF8 books carry it; used to tell them from MOBI6 books. */
  transformTarget: EventTarget;
  sections: { createDocument?: () => Promise<Document> }[];
  toc?: FoliateTocItem[];
  dir?: string;
  rendition?: { layout?: string };
  metadata?: { title?: string; author?: string[]; language?: string | string[] };
  mobi: {
    loadResource(index: number): Promise<ArrayBuffer | Uint8Array>;
    headers: { exth?: { coverOffset?: number; thumbnailOffset?: number } };
  };
  loadFlow(index: number): Promise<ArrayBuffer | Uint8Array>;
  resolveHref(href: string): Promise<{ index: number; anchor(doc: Document): Element | null } | null>;
}

const ascii = (b: Uint8Array, n: number) => String.fromCharCode(...b.subarray(0, n));

export function sniffMediaType(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (ascii(b, 4) === "\x89PNG") return "image/png";
  if (ascii(b, 3) === "GIF") return "image/gif";
  if (ascii(b, 4) === "OTTO") return "font/otf";
  if (ascii(b, 4) === "\x00\x01\x00\x00" || ascii(b, 4) === "true") return "font/ttf";
  if (ascii(b, 4) === "wOFF") return "font/woff";
  return null;
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "font/otf": "otf", "font/ttf": "ttf", "font/woff": "woff",
};
// HTML elements obsolete in HTML5 that MOBI markup still uses; epubcheck rejects them (RSC-005).
const OBSOLETE: Record<string, string> = { font: "span", center: "div", big: "span", tt: "code", strike: "s", blink: "span", basefont: "span" };
const VOID = new Set(["area", "br", "col", "hr", "img", "wbr", "link"]);
const KEEP_ATTRS = new Set(["id", "class", "href", "src", "alt", "title", "lang", "dir", "colspan", "rowspan", "style", "rel", "type"]);
const DROP = new Set(["script", "guide", "reference", "head", "style", "meta", "title", "link", "iframe", "object", "embed", "form", "input"]);
const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
// An HTML-mode parse lower-cases SVG attribute names; these are the ones wrappers use.
const SVG_CASE: Record<string, string> = { viewbox: "viewBox", preserveaspectratio: "preserveAspectRatio" };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string) => esc(s).replace(/"/g, "&quot;");
const isLocal = (href: string) => /^s\d{4}\.xhtml(#.*)?$/.test(href);
const isExternal = (href: string) => /^(https?:|mailto:)/i.test(href);
// The name addResource gives a kindle:embed resource; the only src a chapter may carry.
const isResource = (src: string) => /^res\d{4,}\.(jpg|png|gif|otf|ttf|woff)$/.test(src);
// SVG elements whose href opens on a tap; on any other element (image, use) an http(s) href would be fetched on render.
const SVG_LINK = new Set(["a"]);
const svgHrefOk = (el: string, href: string) =>
  href.startsWith("#") || isResource(href) || isLocal(href) || (SVG_LINK.has(el) && /^https?:/i.test(href));

function svgToXhtml(node: Node, root: boolean): string {
  if (node.nodeType === 3) return esc(node.nodeValue ?? "");
  if (node.nodeType !== 1) return "";
  const el = node as Element;
  const name = el.localName.replace(/^svg:/, "");
  if (name === "script" || name === "foreignObject") return "";
  let attrs = root ? ` xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}"` : "";
  for (const a of Array.from(el.attributes)) {
    const n = SVG_CASE[a.name] ?? a.name;
    if (/^on/i.test(n) || n === "xmlns" || n.startsWith("xmlns:")) continue;
    if (n.includes(":") && n !== "xlink:href" && n !== "xml:lang") continue;
    if ((n === "href" || n === "xlink:href") && !svgHrefOk(name, a.value)) continue;
    attrs += ` ${n}="${escAttr(a.value)}"`;
  }
  return `<${name}${attrs}>${Array.from(el.childNodes).map((c) => svgToXhtml(c, false)).join("")}</${name}>`;
}

/**
 * Serialises a MOBI or KF8 DOM node as an XHTML body fragment. `swap` replaces a node by
 * another one (an <img> of an SVG flow by the parsed <svg>).
 */
export function nodeToXhtml(node: Node, swap: Map<Node, Node> = new Map()): string {
  const swapped = swap.get(node);
  if (swapped) return svgToXhtml(swapped, true);
  if (node.nodeType === 3) return esc(node.nodeValue ?? "");
  if (node.nodeType !== 1) return "";
  const el = node as Element;
  const tag = el.localName.toLowerCase();
  if (tag === "svg" || tag === "svg:svg") return svgToXhtml(el, true);
  const kids = () => Array.from(el.childNodes).map((n) => nodeToXhtml(n, swap)).join("");
  if (DROP.has(tag)) return "";
  if (tag.includes(":") || tag === "html" || tag === "body") return kids();
  const out = OBSOLETE[tag] ?? tag;
  // An img without a book resource has nothing to show, and one without src is invalid XHTML.
  if (out === "img" && !isResource(el.getAttribute("src") ?? "")) return "";
  let attrs = "";
  for (const a of Array.from(el.attributes)) {
    const name = a.name.toLowerCase();
    if (!KEEP_ATTRS.has(name)) continue;
    if (name === "href" && !(isLocal(a.value) || isExternal(a.value))) continue;
    if (name === "src" && !isResource(a.value)) continue;
    attrs += ` ${name}="${escAttr(a.value)}"`;
  }
  if (out === "img" && !el.hasAttribute("alt")) attrs += ` alt=""`;
  if (VOID.has(out)) return `<${out}${attrs}/>`;
  return `<${out}${attrs}>${kids()}</${out}>`;
}

const fileOf = (i: number) => `s${String(i).padStart(4, "0")}.xhtml`;
const textOf = (n: Element | null | undefined) => (n?.textContent ?? "").replace(/\s+/g, " ").trim();
const elements = (doc: Document, selector: string) => Array.from(doc.querySelectorAll(selector));

export async function kf8ToBook(book: Kf8Book): Promise<Book> {
  const assets: Asset[] = [];
  const byResource = new Map<number, string | null>();
  const byFlow = new Map<number, string>();
  const decoder = new TextDecoder();

  const addResource = async (index: number): Promise<string | null> => {
    if (byResource.has(index)) return byResource.get(index) ?? null;
    let path: string | null = null;
    try {
      const data = new Uint8Array(await book.mobi.loadResource(index));
      const mediaType = sniffMediaType(data);
      if (mediaType) {
        path = `res${String(index).padStart(4, "0")}.${EXT[mediaType]}`;
        assets.push({ href: path, mediaType, data });
      }
    } catch {
      path = null;
    }
    byResource.set(index, path);
    return path;
  };
  const replaceEmbeds = async (text: string) => {
    let out = "";
    let last = 0;
    for (const m of text.matchAll(/kindle:embed:(\w+)(\?mime=[\w/+.-]+)?/g)) {
      out += text.slice(last, m.index) + ((await addResource(parseInt(m[1], 32) - 1)) ?? "");
      last = (m.index ?? 0) + m[0].length;
    }
    return out + text.slice(last);
  };
  const flowText = async (id: number) => replaceEmbeds(decoder.decode(await book.loadFlow(id)));
  const flowId = (url: string) => parseInt(/kindle:flow:(\w+)/.exec(url)?.[1] ?? "", 32);

  const sections: { index: number; doc: Document }[] = [];
  for (const [index, s] of book.sections.entries()) {
    if (s.createDocument) sections.push({ index, doc: await s.createDocument() });
  }
  const docOf = (i: number) => sections.find((s) => s.index === i)?.doc;
  let autoId = 0;
  const resolve = async (href: string): Promise<string | null> => {
    try {
      const res = await book.resolveHref(href);
      if (!res || !docOf(res.index)) return null;
      let el: Element | null = null;
      try {
        el = res.anchor(docOf(res.index) as Document);
      } catch {
        el = null;
      }
      if (!el || el.localName.toLowerCase() === "body") return fileOf(res.index);
      if (!el.getAttribute("id")) el.setAttribute("id", `pm${++autoId}`);
      return `${fileOf(res.index)}#${el.getAttribute("id")}`;
    } catch {
      return null;
    }
  };

  const swap = new Map<Node, Node>();
  const cssOf = new Map<number, string[]>();
  for (const { index, doc } of sections) {
    const css: string[] = [];
    for (const link of elements(doc, "link")) {
      const href = link.getAttribute("href") ?? "";
      if (!/kindle:flow:\w+/.test(href) || !/css/.test(href)) continue;
      const id = flowId(href);
      if (!byFlow.has(id)) {
        const path = `style${byFlow.size + 1}.css`;
        assets.push({ href: path, mediaType: "text/css", data: new TextEncoder().encode(await flowText(id)) });
        byFlow.set(id, path);
      }
      css.push(byFlow.get(id) as string);
    }
    cssOf.set(index, css);
    for (const el of elements(doc, "*")) {
      for (const attr of ["src", "xlink:href", "href"]) {
        const v = el.getAttribute(attr);
        if (v?.startsWith("kindle:embed:")) el.setAttribute(attr, (await replaceEmbeds(v)) || "");
      }
    }
    for (const img of elements(doc, "img")) {
      const src = img.getAttribute("src") ?? "";
      if (!src.startsWith("kindle:flow:") || !/svg/.test(src)) continue;
      const svg = new DOMParser().parseFromString(await flowText(flowId(src)), "image/svg+xml").documentElement;
      if (svg && svg.localName.replace(/^svg:/, "") === "svg") swap.set(img, svg);
    }
    for (const a of elements(doc, "a")) {
      const href = a.getAttribute("href") ?? "";
      if (!href.startsWith("kindle:pos")) continue;
      const target = await resolve(href);
      if (target) a.setAttribute("href", target);
      else a.removeAttribute("href");
    }
  }

  const tocEntries = async (items: FoliateTocItem[]): Promise<TocEntry[]> => {
    const out: TocEntry[] = [];
    for (const it of items) {
      const target = it.href ? await resolve(it.href) : null;
      const children = it.subitems?.length ? await tocEntries(it.subitems) : [];
      const href = target ?? children[0]?.href;
      if (!href) continue;
      out.push({ title: it.label?.trim() || "Untitled", href, ...(children.length ? { children } : {}) });
    }
    return out;
  };
  const toc = await tocEntries(book.toc ?? []);

  const meta = book.metadata ?? {};
  const title = meta.title?.trim() || "Untitled";
  const chapters: Chapter[] = sections.map(({ index, doc }) => {
    const root: Node = doc.body?.childNodes.length ? doc.body : doc;
    const links = (cssOf.get(index) ?? []).map((p) => `<link rel="stylesheet" type="text/css" href="${p}"/>`).join("");
    return {
      href: fileOf(index),
      title: textOf(doc.querySelector("h1, h2, h3")) || title,
      body: links + Array.from(root.childNodes).map((n) => nodeToXhtml(n, swap)).join("") || "<p></p>",
    };
  });

  const exth = book.mobi.headers.exth ?? {};
  const coverIndex = [exth.coverOffset, exth.thumbnailOffset].find((o) => o !== undefined && o < 0xffffffff);
  const cover = coverIndex === undefined ? null : await addResource(coverIndex);
  // EXTH 524 language arrives as an array, the MOBI header locale as a string.
  const language = String([meta.language].flat()[0] || "en").split(/[_-]/)[0].toLowerCase();
  return {
    meta: { title, creators: meta.author ?? [], language, ...(cover ? { cover } : {}) },
    chapters,
    assets,
    toc,
    layout: book.rendition?.layout === "pre-paginated" ? "fixed" : "reflow",
    direction: book.dir === "rtl" ? "rtl" : "ltr",
  };
}
