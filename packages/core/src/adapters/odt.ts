import { strFromU8 } from "fflate";
import type { Adapter, Asset } from "../types.ts";
import { escText as esc, decode, escAttr } from "../xml.ts";
import { unzipBounded } from "../zip-caps.ts";
import { htmlBook } from "./rtf.ts";

export interface OdtDoc {
  /** Block-level XHTML joined by newlines: h1-h6, p, ul/li, table, img, footnotes at the end. */
  html: string;
  title?: string;
  language?: string;
  assets: Asset[];
}

interface El {
  name: string;
  attrs: Record<string, string>;
  children: (El | string)[];
}

/** A minimal XML tree builder; ODF content.xml is always well-formed, so no recovery is attempted. */
function parseXml(src: string): El {
  const root: El = { name: "#root", attrs: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (const m of src.matchAll(re)) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.children.push(m[1]);
    else if (m[3]) {
      if (m[2]) {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const attrs: Record<string, string> = {};
      for (const a of (m[4] ?? "").matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decode(a[2] ?? a[3]);
      const el: El = { name: m[3], attrs, children: [] };
      top.children.push(el);
      if (!m[5]) stack.push(el);
    } else if (m[6] !== undefined) top.children.push(decode(m[6]));
  }
  return root;
}

function find(el: El, name: string): El | undefined {
  for (const c of el.children) {
    if (typeof c === "string") continue;
    if (c.name === name) return c;
    const hit = find(c, name);
    if (hit) return hit;
  }
}
const textOf = (el: El): string => el.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("");

const SKIP = new Set([
  "office:annotation", "office:annotation-end", "office:forms", "text:sequence-decls", "text:variable-decls",
  "text:user-field-decls", "text:tracked-changes", "text:soft-page-break", "text:bookmark", "text:bookmark-start",
  "text:bookmark-end", "text:table-of-content", "text:alphabetical-index", "svg:title", "svg:desc",
  "table:table-column", "table:table-columns", "table:covered-table-cell",
]);
const IMAGE_TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp",
};

// text:c is attacker-controlled and one element can ask for billions of spaces; no honest run is this long.
const MAX_SPACES = 1000;

export function readOdt(bytes: Uint8Array): OdtDoc {
  const zip = unzipBounded(bytes);
  if (!zip["content.xml"]) throw new Error("ODT has no content.xml");
  const body = find(parseXml(strFromU8(zip["content.xml"])), "office:text");
  const assets: Asset[] = [];
  const byPath = new Map<string, string>();
  const notes: string[] = [];

  const image = (el: El, alt: string): string => {
    const path = (el.attrs["xlink:href"] ?? "").replace(/^\.\//, "");
    const type = IMAGE_TYPES[/\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? ""];
    if (!type || !zip[path]) return "";
    let href = byPath.get(path);
    if (!href) {
      href = `images/odt-${assets.length + 1}-${path.replace(/^.*\//, "").replace(/[^\w.-]/g, "_")}`;
      byPath.set(path, href);
      assets.push({ href, mediaType: type, data: zip[path] });
    }
    return `<img src="${escAttr(href)}" alt="${escAttr(alt)}"/>`;
  };

  const inner = (el: El): string => el.children.map(render).join("");
  const render = (n: El | string): string => {
    if (typeof n === "string") return esc(n.replace(/[\t\r\n ]+/g, " "));
    if (SKIP.has(n.name)) return "";
    const a = n.attrs;
    switch (n.name) {
      case "text:h": {
        const level = Math.min(Math.max(Number(a["text:outline-level"]) || 1, 1), 6);
        const c = inner(n).trim();
        return c ? `<h${level}>${c}</h${level}>` : "";
      }
      case "text:p": {
        const c = inner(n).trim();
        return c ? `<p>${c}</p>` : "";
      }
      case "text:s": return " ".repeat(Math.min(Math.max(Number(a["text:c"]) || 1, 1), MAX_SPACES));
      case "text:tab": return "\t";
      case "text:line-break": return "<br/>";
      case "text:a": {
        const href = a["xlink:href"] ?? "";
        return /^(https?:|mailto:)/i.test(href) ? `<a href="${escAttr(href)}">${inner(n)}</a>` : inner(n);
      }
      case "text:list": return `<ul>${inner(n)}</ul>`;
      case "text:list-item": case "text:list-header": return `<li>${inner(n)}</li>`;
      case "table:table": return `<table>${inner(n)}</table>`;
      case "table:table-row": return `<tr>${inner(n)}</tr>`;
      case "table:table-cell": {
        const span = Number(a["table:number-columns-spanned"]) || 1;
        return `<td${span > 1 ? ` colspan="${span}"` : ""}>${inner(n)}</td>`;
      }
      case "draw:frame": {
        const title = n.children.find((c): c is El => typeof c !== "string" && c.name === "svg:title");
        const alt = title ? textOf(title).trim() : "";
        return n.children
          .map((c) => (typeof c === "string" ? "" : c.name === "draw:image" ? image(c, alt) : render(c)))
          .join("");
      }
      case "text:note": {
        const cit = n.children.find((c): c is El => typeof c !== "string" && c.name === "text:note-citation");
        const nb = n.children.find((c): c is El => typeof c !== "string" && c.name === "text:note-body");
        const mark = esc(cit ? textOf(cit).trim() : String(notes.length + 1));
        notes.push(`<div class="footnote"><sup>${mark}</sup>${nb ? inner(nb) : ""}</div>`);
        return `<sup>${mark}</sup>`;
      }
      default: return inner(n);
    }
  };

  const blocks = body ? body.children.map(render).filter((b) => b.trim()) : [];
  const meta = zip["meta.xml"] ? strFromU8(zip["meta.xml"]) : "";
  const metaText = (tag: string) => {
    const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(meta);
    return m ? decode(m[1]).trim() || undefined : undefined;
  };
  return {
    html: [...blocks, ...notes].join("\n"),
    title: metaText("dc:title"),
    language: metaText("dc:language"),
    assets,
  };
}

export const odtAdapter: Adapter = {
  id: "odt",
  accepts: (s) => s.format === "odt",
  async read(file) {
    const doc = readOdt(file.bytes);
    return htmlBook(doc.html, doc.title, doc.assets, file, doc.language);
  },
};
