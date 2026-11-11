import type { Adapter, Asset, Book, Chapter, InputFile } from "../types.ts";

export interface RtfDoc {
  /** Block-level HTML: p, h1-h6, ul/li, with b, i, br and img inline. */
  html: string;
  title?: string;
  assets: Asset[];
}

// Bytes 0x80-0x9F differ between cp1252 and latin-1; the rest map to the same code point.
const CP1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];
const cp1252 = (b: number) => String.fromCharCode(b >= 0x80 && b < 0xa0 ? CP1252_HIGH[b - 0x80] : b);

const SKIP = new Set([
  "fonttbl", "colortbl", "stylesheet", "listtable", "listoverridetable", "listtext", "pntext", "pntxta", "pntxtb",
  "header", "headerl", "headerr", "headerf", "footer", "footerl", "footerr", "footerf", "footnote", "annotation",
  "fldinst", "nonshppict", "object", "themedata", "colorschememapping", "datastore", "latentstyles", "rsidtbl",
  "xmlnstbl", "generator", "filetbl", "revtbl", "pgdsctbl", "bkmkstart", "bkmkend", "xe", "tc",
]);
// Destinations that follow \* yet hold content we read.
const STAR_KEEP = new Set(["shppict"]);
const SYMBOLS: Record<string, string> = {
  emdash: "—", endash: "–", lquote: "‘", rquote: "’", ldblquote: "“", rdblquote: "”",
  bullet: "•", emspace: " ", enspace: " ", qmspace: " ",
};

type Dest = "text" | "skip" | "info" | "title" | "pict";
interface State {
  b: boolean;
  i: boolean;
  uc: number;
  /** Inside \v (hidden) or \deleted (tracked deletion) text, which a word processor does not show. */
  hidden: boolean;
  dest: Dest;
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function latin1(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return s;
}

export function readRtf(bytes: Uint8Array): RtfDoc {
  const s = latin1(bytes);
  const n = s.length;
  const blocks: string[] = [];
  const assets: Asset[] = [];
  let title = "";
  let st: State = { b: false, i: false, uc: 1, hidden: false, dest: "text" };
  const stack: State[] = [];
  let ucSkip = 0;
  let star = false;
  let buf = "";
  let open = { b: false, i: false };
  let outline = -1;
  let listItem = false;
  let inList = false;
  let pict: { type: string | null; hex: string } | null = null;

  const closeTags = () => {
    if (open.i) buf += "</i>";
    if (open.b) buf += "</b>";
    open = { b: false, i: false };
  };
  const syncFormat = () => {
    if (open.b === st.b && open.i === st.i) return;
    closeTags();
    if (st.b) buf += "<b>";
    if (st.i) buf += "<i>";
    open = { b: st.b, i: st.i };
  };
  const emitRaw = (markup: string) => {
    syncFormat();
    buf += markup;
  };
  const emitText = (t: string) => {
    if (ucSkip > 0) {
      ucSkip--;
      return;
    }
    if (st.dest === "title") title += t;
    else if (st.dest === "pict") pict!.hex += /[0-9a-f]/i.test(t) ? t : "";
    else if (st.dest === "text" && !st.hidden) emitRaw(esc(t));
  };
  const endPara = () => {
    closeTags();
    const content = buf.trim();
    buf = "";
    if (!content) return;
    if (listItem) {
      blocks.push(`${inList ? "" : "<ul>"}<li>${content}</li>`);
      inList = true;
      return;
    }
    if (inList) blocks[blocks.length - 1] += "</ul>";
    inList = false;
    const tag = outline >= 0 && outline < 6 ? `h${outline + 1}` : "p";
    blocks.push(`<${tag}>${content}</${tag}>`);
  };
  const finishPict = () => {
    const p = pict;
    pict = null;
    if (!p?.type || p.hex.length < 2) return;
    const data = new Uint8Array(p.hex.length >> 1);
    for (let k = 0; k < data.length; k++) data[k] = parseInt(p.hex.substr(k * 2, 2), 16);
    const ext = p.type === "image/png" ? "png" : "jpg";
    const href = `images/rtf-${assets.length + 1}.${ext}`;
    assets.push({ href, mediaType: p.type, data });
    emitRaw(`<img src="${href}" alt=""/>`);
  };

  const word = (w: string, param: number | undefined) => {
    const starred = star;
    star = false;
    if (w === "bin") {
      // A negative count would send the reader back to bytes it has already read, without end.
      if (param && param > 0) i = Math.min(n, i + param);
      return;
    }
    if (ucSkip > 0) {
      ucSkip--;
      return;
    }
    if (st.dest === "skip" || st.dest === "title") return;
    if (st.dest === "info") {
      if (w === "title") st.dest = "title";
      return;
    }
    if (st.dest === "pict") {
      if (w === "pngblip") pict!.type = "image/png";
      else if (w === "jpegblip") pict!.type = "image/jpeg";
      return;
    }
    if (SKIP.has(w) || (starred && !STAR_KEEP.has(w))) {
      st.dest = "skip";
      return;
    }
    const on = param === undefined || param !== 0;
    switch (w) {
      case "info": st.dest = "info"; break;
      case "pict": st.dest = "pict"; pict = { type: null, hex: "" }; break;
      case "par": case "sect": case "page": case "cell": case "row": endPara(); break;
      case "pard": outline = -1; listItem = false; break;
      case "outlinelevel": outline = param ?? -1; break;
      case "ls": listItem = true; break;
      case "plain": st.b = false; st.i = false; st.hidden = false; break;
      case "v": case "deleted": st.hidden = on; break;
      case "b": st.b = on; break;
      case "i": st.i = on; break;
      case "uc": st.uc = param ?? 1; break;
      case "u": {
        const code = param ?? 0;
        emitText(String.fromCharCode(code < 0 ? code + 65536 : code));
        ucSkip = st.uc;
        break;
      }
      case "line": emitRaw("<br/>"); break;
      case "tab": emitText("\t"); break;
      default: if (w in SYMBOLS) emitText(SYMBOLS[w]);
    }
  };

  let i = 0;
  while (i < n) {
    const c = s[i];
    if (c === "{") {
      stack.push({ ...st });
      ucSkip = 0;
      i++;
    } else if (c === "}") {
      if (st.dest === "pict" && stack[stack.length - 1]?.dest !== "pict") finishPict();
      st = stack.pop() ?? st;
      ucSkip = 0;
      i++;
    } else if (c === "\\") {
      const m = /^([a-zA-Z]+)(-?\d+)? ?/.exec(s.slice(i + 1, i + 64));
      if (m) {
        i += 1 + m[0].length;
        word(m[1], m[2] === undefined ? undefined : Number(m[2]));
        continue;
      }
      const sym = s[i + 1];
      i += 2;
      if (sym === "'") {
        const b = parseInt(s.substr(i, 2), 16);
        i += 2;
        if (!Number.isNaN(b)) emitText(cp1252(b));
      } else if (sym === "*") star = true;
      else if (sym === "\\" || sym === "{" || sym === "}") emitText(sym);
      else if (sym === "~") emitText(" ");
      else if (sym === "_") emitText("‑");
      else if (sym === "\n" || sym === "\r") {
        if (st.dest === "text") endPara();
      }
    } else {
      i++;
      if (c !== "\r" && c !== "\n") emitText(cp1252(c.charCodeAt(0)));
    }
  }
  endPara();
  if (inList) blocks[blocks.length - 1] += "</ul>";
  return { html: blocks.join("\n"), title: title.trim() || undefined, assets };
}

const plain = (markup: string) =>
  markup.replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();

/** Builds a Book from reader HTML whose top-level blocks are newline-joined, one chapter per h1. */
export function htmlBook(html: string, title: string | undefined, assets: Asset[], file: InputFile, language?: string): Book {
  const baseName = file.name.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "") || "Untitled";
  const firstH1 = /<h1>([\s\S]*?)<\/h1>/.exec(html);
  const bookTitle = title || (firstH1 ? plain(firstH1[1]) : "") || baseName;
  const parts = html.split(/\n(?=<h1>)/).filter((p) => p.trim());
  const chapters: Chapter[] = (parts.length ? parts : ["<p></p>"]).map((body, i) => {
    const h = /^<h1>([\s\S]*?)<\/h1>/.exec(body);
    return { href: `ch${String(i + 1).padStart(3, "0")}.xhtml`, title: (h && plain(h[1])) || bookTitle, body };
  });
  return {
    meta: { title: bookTitle, creators: [], language: language || "id" },
    chapters,
    assets,
    toc: [],
    layout: "reflow",
    direction: "ltr",
  };
}

export const rtfAdapter: Adapter = {
  id: "rtf",
  accepts: (s) => s.format === "rtf",
  async read(file) {
    const doc = readRtf(file.bytes);
    return htmlBook(doc.html, doc.title, doc.assets, file);
  },
};
