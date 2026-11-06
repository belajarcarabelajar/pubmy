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

const DOM_GLOBALS = ["DOMParser", "XMLSerializer", "document", "CSS"] as const;
let scopes = 0;
let saved: { key: string; value: unknown; own: PropertyDescriptor | undefined }[] = [];

/**
 * Runs fn with the globals foliate-js mobi.js expects (see installDomGlobals), then puts back the
 * previous values, or removes the ones that were absent, also when fn throws. Libraries loaded
 * later pick browser or node from `typeof document`, so the linkedom globals must not outlive
 * the conversion. Overlapping scopes share one install that ends with the last scope.
 */
export async function withDomGlobals<T>(fn: () => T | Promise<T>): Promise<T> {
  if (scopes++ === 0) {
    const g = globalThis as Record<string, unknown>;
    saved = DOM_GLOBALS.map((key) => ({ key, value: g[key], own: Object.getOwnPropertyDescriptor(g, key) }));
    try {
      installDomGlobals();
    } catch (e) {
      restoreDomGlobals();
      throw e;
    }
  }
  try {
    return await fn();
  } finally {
    restoreDomGlobals();
  }
}

function restoreDomGlobals(): void {
  if (--scopes > 0) return;
  const g = globalThis as Record<string, unknown>;
  for (const { key, value, own } of saved) {
    if (g[key] === value) continue;
    if (own) Object.defineProperty(g, key, own);
    else delete g[key];
  }
  saved = [];
}

/**
 * Fills the browser globals foliate-js mobi.js expects (DOMParser, XMLSerializer, document,
 * CSS.escape, innerText, textarea.value) with linkedom when they are missing, as under Bun.
 * In a browser every native global exists and nothing is replaced. The globals stay installed;
 * conversions go through withDomGlobals instead.
 */
export function installDomGlobals(): void {
  const g = globalThis as Record<string, any>;
  if (!g.DOMParser) g.DOMParser = LinkedomParser;
  if (!g.XMLSerializer) g.XMLSerializer = class { serializeToString(n: { toString(): string }) { return n.toString(); } };
  if (!g.document) g.document = new LinkedomParser().parseFromString("<!DOCTYPE html><html><body></body></html>", "text/html");
  if (!g.CSS?.escape) g.CSS = { ...g.CSS, escape: (s: string) => s.replace(/([^\w-])/g, "\\$1") };
  const a = g.document.createElement("a");
  if (a.innerText === undefined) {
    Object.defineProperty(Object.getPrototypeOf(Object.getPrototypeOf(a)), "innerText", {
      get() { return this.textContent; },
      configurable: true,
    });
  }
  const t = g.document.createElement("textarea");
  t.innerHTML = "&amp;";
  if (t.value !== "&") {
    // linkedom keeps textarea content raw, so mobi.js metadata unescaping would keep "&amp;".
    Object.defineProperty(Object.getPrototypeOf(t), "value", {
      get() {
        const d = g.document.createElement("div");
        d.innerHTML = this.innerHTML;
        return d.textContent;
      },
      configurable: true,
    });
  }
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
