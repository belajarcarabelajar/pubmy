// Output rules that keep Send to Kindle from rejecting a book (e999). They work on
// markup strings because the packager runs without a DOM.

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const TAG = /<(\/?)([a-zA-Z][\w:.-]*)((?:\s+[^\s=\/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']+))?)*)\s*(\/?)>/g;
const ATTR = /([^\s=\/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>"']+))?/g;
const COMMENT = /<!--([\s\S]*?)-->/g;

const escAttr = (s: string) => s.replace(/&(?!#?\w+;)/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

export function stripControls(s: string): string {
  return s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B-\u001F]/g, "");
}

// XML forbids "--" inside a comment and a comment ending in "-".
function fixComment(inner: string): string {
  let c = inner.replace(/-(?=-)/g, "- ");
  if (c.endsWith("-")) c += " ";
  if (c.startsWith("-") || c.startsWith(">")) c = " " + c;
  return `<!--${c}-->`;
}

function fixTag(_m: string, close: string, name: string, attrs: string): string {
  const tag = name.toLowerCase();
  if (close) return VOID.has(tag) ? "" : `</${name}>`;
  let out = "";
  for (const [, rawName, rawValue] of attrs.matchAll(ATTR)) {
    const attr = rawName.toLowerCase();
    if (attr.startsWith("on")) continue;
    const value = rawValue === undefined ? attr : rawValue.replace(/^(["'])([\s\S]*)\1$/, "$2");
    out += ` ${rawName}="${escAttr(value)}"`;
  }
  return VOID.has(tag) ? `<${name}${out}/>` : `<${name}${out}>`;
}

function fixMarkup(s: string): string {
  return s.replace(TAG, fixTag).replace(/&(?![a-zA-Z][a-zA-Z0-9]*;|#\d+;|#x[0-9a-fA-F]+;)/g, "&amp;");
}

/** Applies every Kindle fix to an XHTML body fragment. */
export function kindleFix(markup: string): string {
  const s = stripControls(markup).replace(/<script\b[^>]*\/>|<script\b[\s\S]*?<\/script\s*>/gi, "");
  let out = "";
  let last = 0;
  for (const m of s.matchAll(COMMENT)) {
    out += fixMarkup(s.slice(last, m.index)) + fixComment(m[1]);
    last = m.index + m[0].length;
  }
  return out + fixMarkup(s.slice(last));
}
