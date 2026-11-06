// Comics (CBZ = zip, CBR = rar) to a fixed-layout book: one image-only page per image,
// in natural filename order. CBZ is read with fflate, CBR with libarchive.js (WASM).
import { PubmyError } from "../errors.ts";
import type { Adapter, Asset, Book, Chapter } from "../types.ts";
import { checkCaps, DEFAULT_LIMITS, isUnsafePath, type Limits, unzipCapped } from "../zip-caps.ts";

export { checkCaps, DEFAULT_LIMITS, type Limits };

export interface Entry {
  path: string;
  data: Uint8Array;
}

interface LibArchive {
  getFilesArray(): Promise<{ file: { name: string; size: number }; path: string }[]>;
  extractFiles(): Promise<unknown>;
  close?(): Promise<void>;
}
export interface LibarchiveModule {
  Archive: { open(file: File): Promise<LibArchive> };
}
/**
 * Loads libarchive.js. Always injected: Bun/Node pass loadNodeLibarchive (libarchive-node.ts), the web app
 * passes a loader for the browser build served beside its worker.
 */
export type LibarchiveLoader = () => Promise<LibarchiveModule>;

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
/** Natural filename order: p2 before p10, case-insensitive. */
export const naturalCompare = (a: string, b: string): number => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);

function readZip(bytes: Uint8Array, limits: Limits): Entry[] {
  return Object.entries(unzipCapped(bytes, limits)).map(([path, data]) => ({ path, data }));
}

const isFile = (v: unknown): v is Blob => typeof (v as Blob | null)?.arrayBuffer === "function";

// extractFiles() returns nested plain objects for folders and File objects for files.
async function flatten(tree: unknown, prefix: string, out: Entry[]): Promise<void> {
  for (const [name, v] of Object.entries(tree as Record<string, unknown>)) {
    if (isFile(v)) out.push({ path: prefix + name, data: new Uint8Array(await v.arrayBuffer()) });
    else if (v && typeof v === "object") await flatten(v, `${prefix}${name}/`, out);
  }
}

async function readRar(bytes: Uint8Array, limits: Limits, load: LibarchiveLoader | undefined): Promise<Entry[]> {
  if (!load) throw new Error("readArchive needs a libarchive loader for RAR");
  const { Archive } = await load();
  const archive = await Archive.open(new File([bytes as Uint8Array<ArrayBuffer>], "archive.rar"));
  try {
    checkCaps((await archive.getFilesArray()).map((e) => ({ size: e.file.size })), limits);
    const out: Entry[] = [];
    await flatten(await archive.extractFiles(), "", out);
    return out.filter((e) => !isUnsafePath(e.path));
  } finally {
    await archive.close?.();
  }
}

/** File entries of a zip or rar archive, natural-sorted, with `..` paths dropped and the caps enforced. */
export async function readArchive(bytes: Uint8Array, format: "zip" | "rar", limits: Limits = DEFAULT_LIMITS,
  load?: LibarchiveLoader): Promise<Entry[]> {
  const entries = format === "zip" ? readZip(bytes, limits) : await readRar(bytes, limits, load);
  // The declared sizes can lie; check what was really extracted too.
  checkCaps(entries.map((e) => ({ size: e.data.length })), limits);
  return entries.sort((a, b) => naturalCompare(a.path, b.path));
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

type ImageType = "png" | "jpeg" | "gif" | "webp";
function imageType(b: Uint8Array): ImageType | null {
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 4) === "PNG") return "png";
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 10 && ascii(b, 0, 4) === "GIF8") return "gif";
  if (b.length >= 30 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "webp";
  return null;
}

function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 <= b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) { i += 2; continue; }
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { width: u16be(b, i + 7), height: u16be(b, i + 5) };
    i += 2 + u16be(b, i + 2);
  }
  return null;
}

function webpSize(b: Uint8Array): { width: number; height: number } | null {
  const kind = ascii(b, 12, 16);
  if (kind === "VP8X") return { width: 1 + u24le(b, 24), height: 1 + u24le(b, 27) };
  if (kind === "VP8 ") return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  if (kind === "VP8L") return { width: 1 + (b[21] | ((b[22] & 0x3f) << 8)), height: 1 + ((b[22] >> 6) | (b[23] << 2) | ((b[24] & 0xf) << 10)) };
  return null;
}

/** Pixel size read from the image header (PNG, JPEG, GIF, WebP), null when the bytes are not one of those. */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const size = (() => {
    switch (imageType(b)) {
      case "png": return { width: new DataView(b.buffer, b.byteOffset).getUint32(16), height: new DataView(b.buffer, b.byteOffset).getUint32(20) };
      case "jpeg": return jpegSize(b);
      case "gif": return { width: u16le(b, 6), height: u16le(b, 8) };
      case "webp": return webpSize(b);
      default: return null;
    }
  })();
  return size && size.width > 0 && size.height > 0 ? size : null;
}

const EXT: Record<ImageType, string> = { png: "png", jpeg: "jpg", gif: "gif", webp: "webp" };

export interface ComicsOptions {
  direction?: "ltr" | "rtl";
  limits?: Limits;
  loadLibarchive: LibarchiveLoader;
}

export function createComicsAdapter(opts: ComicsOptions): Adapter {
  return {
    id: "comics",
    accepts: (s) => (s.format === "zip" && s.ext === "cbz") || (s.format as string) === "cbz" || s.format === "rar",
    async read(file) {
      const isRar = ascii(file.bytes, 0, 4) === "Rar!";
      const entries = await readArchive(file.bytes, isRar ? "rar" : "zip", opts.limits, opts.loadLibarchive);
      const assets: Asset[] = [];
      const chapters: Chapter[] = [];
      for (const e of entries) {
        const type = imageType(e.data);
        const size = type && imageSize(e.data);
        if (!type || !size) continue;
        const n = assets.length + 1;
        const id = `p${String(n).padStart(4, "0")}`;
        const href = `img/${id}.${EXT[type]}`;
        assets.push({ href, mediaType: `image/${type}`, data: e.data });
        chapters.push({
          href: `${id}.xhtml`,
          title: `Page ${n}`,
          body: `<div><img src="${href}" alt="Page ${n}" width="${size.width}" height="${size.height}" ` +
            `style="position:absolute;left:0;top:0;width:100%;height:100%"/></div>`,
        });
      }
      if (!assets.length) throw new PubmyError("UNSUPPORTED", "no-images");
      const title = file.name.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "") || "Untitled";
      const book: Book = {
        meta: { title, creators: [], language: "id", cover: assets[0].href },
        chapters,
        assets,
        toc: [],
        layout: "fixed",
        direction: opts.direction ?? "ltr",
      };
      return book;
    },
  };
}
