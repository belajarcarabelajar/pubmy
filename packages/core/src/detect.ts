import type { Format, Sniff } from "./types.ts";

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u32 = (b: Uint8Array, at: number) => (u16(b, at) | (u16(b, at + 2) << 16)) >>> 0;

/** Content of a stored "mimetype" first entry, as EPUB and ODF require; "" otherwise. */
function zipMimetype(b: Uint8Array): string {
  const nameLen = u16(b, 26);
  if (ascii(b, 30, 30 + nameLen) !== "mimetype" || u16(b, 8) !== 0) return "";
  const start = 30 + nameLen + u16(b, 28);
  return ascii(b, start, start + Math.min(u32(b, 18), 100)).trim();
}

/** Entry names from the central directory; [] when it cannot be found. */
function zipNames(b: Uint8Array): string[] {
  for (let eocd = b.length - 22; eocd >= Math.max(0, b.length - 22 - 0xffff); eocd--) {
    if (u32(b, eocd) !== 0x06054b50) continue;
    const names: string[] = [];
    let at = u32(b, eocd + 16);
    for (let k = u16(b, eocd + 10); k > 0 && at + 46 <= b.length && u32(b, at) === 0x02014b50; k--) {
      const n = u16(b, at + 28);
      names.push(new TextDecoder().decode(b.subarray(at + 46, at + 46 + n)));
      at += 46 + n + u16(b, at + 30) + u16(b, at + 32);
    }
    return names;
  }
  return [];
}

const IMAGE = /\.(jpe?g|png|gif|webp|avif|bmp)$/i;

function zipKind(b: Uint8Array): Format {
  const mime = zipMimetype(b);
  if (mime === "application/epub+zip") return "epub";
  if (mime.startsWith("application/vnd.oasis.opendocument.text")) return "odt";
  const names = zipNames(b);
  if (names.includes("[Content_Types].xml") && names.some((n) => n.startsWith("word/"))) return "docx";
  // Comic archives often carry ComicInfo.xml and OS litter beside the pages.
  const files = names.filter(
    (n) => !n.endsWith("/") && !n.startsWith("__MACOSX/") && !/(^|\/)\./.test(n) && !/(^|\/)comicinfo\.xml$/i.test(n),
  );
  if (files.length > 0 && files.every((n) => IMAGE.test(n))) return "cbz";
  return "zip";
}

function byMagic(b: Uint8Array): Format | null {
  if (ascii(b, 0, 4) === "PK\x03\x04") return zipKind(b);
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
const ZIP_EXT: Record<string, Format> = { epub: "epub", odt: "odt", docx: "docx", cbz: "cbz" };

/** Identifies the input format from magic bytes first, then the file extension. */
export function detect(bytes: Uint8Array, name: string): Sniff {
  const ext = /\.([^./\\]+)$/.exec(name)?.[1]?.toLowerCase() ?? "";
  const magic = byMagic(bytes);
  // A zip whose contents name no subtype still trusts a zip-based extension.
  if (magic === "zip" && ZIP_EXT[ext]) return { format: ZIP_EXT[ext], ext };
  if (magic) return { format: magic, ext };
  if (EXT[ext]) return { format: EXT[ext], ext };
  if (/^\s*<(!doctype html|html)[\s>]/i.test(ascii(bytes, 0, 256))) return { format: "html", ext };
  return { format: "unknown", ext };
}
