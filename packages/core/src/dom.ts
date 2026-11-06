import { DOMParser as LinkedomParser } from "linkedom";
import type { DomAdapter } from "./types.ts";

/** Native DOMParser in the browser, linkedom under Bun. */
export function domFor(env: "browser" | "bun"): DomAdapter {
  if (env === "browser") {
    const p = new DOMParser();
    return { parseHTML: (m) => p.parseFromString(m, "text/html") };
  }
  const p = new LinkedomParser();
  return { parseHTML: (m) => p.parseFromString(m, "text/html") as unknown as Document };
}

// HTML elements obsolete in HTML5 that epubcheck rejects (RSC-005).
const OBSOLETE: Record<string, string> = { font: "span", center: "div", big: "span", tt: "code", strike: "s", blink: "span", basefont: "span" };
const VOID = new Set(["area", "br", "col", "hr", "img", "wbr"]);
const KEEP_ATTRS = new Set(["id", "class", "href", "src", "alt", "title", "lang", "dir", "colspan", "rowspan", "width", "height"]);
const DROP = new Set(["script", "noscript", "style", "head", "link", "meta", "title", "iframe", "object", "embed", "form", "input", "button", "select", "textarea"]);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string) => esc(s).replace(/"/g, "&quot;");

/**
 * Serialises a node as XHTML. Links to other files and images are not resolvable from a
 * single text input, so only external links survive and images become their alt text.
 */
export function toXhtml(node: Node): string {
  if (node.nodeType === 3) return esc(node.nodeValue ?? "");
  if (node.nodeType !== 1) return "";
  const el = node as Element;
  const tag = el.localName.toLowerCase();
  const kids = () => Array.from(el.childNodes).map(toXhtml).join("");
  if (DROP.has(tag)) return "";
  if (tag === "img") return esc(el.getAttribute("alt") ?? "");
  if (tag.includes(":") || tag === "html" || tag === "body") return kids();
  const out = OBSOLETE[tag] ?? tag;
  let attrs = "";
  for (const a of Array.from(el.attributes)) {
    const name = a.name.toLowerCase();
    if (!KEEP_ATTRS.has(name)) continue;
    if (name === "href" && !/^(https?:|mailto:)/i.test(a.value)) continue;
    attrs += ` ${name}="${escAttr(a.value)}"`;
  }
  if (VOID.has(out)) return `<${out}${attrs}/>`;
  return `<${out}${attrs}>${kids()}</${out}>`;
}
