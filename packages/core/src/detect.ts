import type { Format, Sniff } from "./types.ts";

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

function byMagic(b: Uint8Array): Format | null {
  if (ascii(b, 0, 4) === "PK\x03\x04") {
    return ascii(b, 30, 38) === "mimetype" && ascii(b, 38, 58) === "application/epub+zip" ? "epub" : "zip";
  }
  if (ascii(b, 0, 5) === "%PDF-") return "pdf";
  if (ascii(b, 60, 68) === "BOOKMOBI") return "mobi";
  if (ascii(b, 0, 5) === "{\\rtf") return "rtf";
  if (ascii(b, 0, 6) === "Rar!\x1a\x07") return "rar";
  return null;
}

const EXT: Record<string, Format> = {
  txt: "txt", text: "txt",
  md: "markdown", markdown: "markdown", mdown: "markdown",
  html: "html", htm: "html", xhtml: "html",
  epub: "epub", pdf: "pdf", mobi: "mobi", azw3: "mobi", rtf: "rtf",
};

/** Identifies the input format from magic bytes first, then the file extension. */
export function detect(bytes: Uint8Array, name: string): Sniff {
  const ext = /\.([^./\\]+)$/.exec(name)?.[1]?.toLowerCase() ?? "";
  const magic = byMagic(bytes);
  if (magic === "zip" && EXT[ext] === "epub") return { format: "epub", ext };
  if (magic) return { format: magic, ext };
  if (EXT[ext]) return { format: EXT[ext], ext };
  if (/^\s*<(!doctype html|html)[\s>]/i.test(ascii(bytes, 0, 256))) return { format: "html", ext };
  return { format: "unknown", ext };
}
