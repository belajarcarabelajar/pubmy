import MarkdownIt from "markdown-it";
import { toXhtml } from "../dom.ts";
import type { Adapter, Book, Chapter, Ctx, InputFile } from "../types.ts";

// windows-1252 code points for bytes 0x80..0x9f; the rest of the range equals Latin-1.
const CP1252 = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];

/** UTF-8 when the bytes are valid UTF-8, windows-1252 otherwise. */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b >= 0x80 && b < 0xa0 ? CP1252[b - 0x80] : b);
    return s;
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const md = new MarkdownIt({ html: true, xhtmlOut: true });

function txtToHtml(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${p.split("\n").map(esc).join("<br>")}</p>`)
    .join("\n");
}

const WRAPPERS = new Set(["div", "section", "article", "main", "header"]);
const isH1 = (n: Node) => n.nodeType === 1 && (n as Element).localName.toLowerCase() === "h1";

// Unwraps container elements that hold an h1, so h1s nested in a wrapper still split chapters.
function flatten(nodes: Node[]): Node[] {
  return nodes.flatMap((n) =>
    n.nodeType === 1 && WRAPPERS.has((n as Element).localName.toLowerCase()) && (n as Element).querySelector("h1")
      ? flatten(Array.from(n.childNodes))
      : [n]);
}

const hasContent = (nodes: Node[]) => nodes.some((n) => n.nodeType === 1 || (n.nodeValue ?? "").trim() !== "");
const textOf = (n: Node | null | undefined) => (n?.textContent ?? "").replace(/\s+/g, " ").trim();

function splitChapters(nodes: Node[], fallbackTitle: string): Chapter[] {
  const groups: { title: string; nodes: Node[] }[] = [];
  let current: { title: string; nodes: Node[] } = { title: fallbackTitle, nodes: [] };
  for (const n of flatten(nodes)) {
    if (isH1(n)) {
      if (hasContent(current.nodes)) groups.push(current);
      current = { title: textOf(n) || fallbackTitle, nodes: [] };
    }
    current.nodes.push(n);
  }
  if (hasContent(current.nodes) || groups.length === 0) groups.push(current);
  return groups.map((g, i) => ({
    href: `ch${String(i + 1).padStart(3, "0")}.xhtml`,
    title: g.title,
    body: g.nodes.map(toXhtml).join("") || "<p></p>",
  }));
}

function toBook(html: string, file: InputFile, ctx: Ctx, wrap: boolean): Book {
  const doc = ctx.dom.parseHTML(wrap ? `<!DOCTYPE html><html><head></head><body>${html}</body></html>` : html);
  const root: Node = doc.body?.childNodes.length ? doc.body : (doc.documentElement ?? doc);
  const baseName = file.name.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "") || "Untitled";
  const title = textOf(doc.querySelector("title")) || textOf(doc.querySelector("h1")) || baseName;
  const language = doc.documentElement?.getAttribute("lang")?.trim() || "id";
  return {
    meta: { title, creators: [], language },
    chapters: splitChapters(Array.from(root.childNodes), title),
    assets: [],
    toc: [],
    layout: "reflow",
    direction: "ltr",
  };
}

export const textAdapter: Adapter = {
  id: "text",
  accepts: (s) => s.format === "txt" || s.format === "markdown" || s.format === "html",
  async read(file, ctx) {
    const text = decodeText(file.bytes);
    if (/\.(md|markdown|mdown)$/i.test(file.name)) return toBook(md.render(text), file, ctx, true);
    if (/\.(txt|text)$/i.test(file.name)) return toBook(txtToHtml(text), file, ctx, true);
    return toBook(text, file, ctx, false);
  },
};
