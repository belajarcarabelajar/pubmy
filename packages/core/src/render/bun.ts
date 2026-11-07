// PdfRenderer for Bun: pdf.js (through unpdf) drawing on @napi-rs/canvas, which is fetched into the
// cache on first use instead of being bundled (render/fetch-canvas.ts).
import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { getDocumentProxy, renderPageAsImage } from "unpdf";
import { opaquePng } from "../pdf/png.ts";
import type { PageBox, PdfRenderer } from "../types.ts";

export { opaquePng };
import { type CanvasFiles, type CanvasPlatform, canvasPlatform, defaultCanvasCache, detectLibc, ensureCanvas, isCanvasPlatform } from "./fetch-canvas.ts";

type CanvasModule = typeof import("@napi-rs/canvas");
type Doc = Awaited<ReturnType<typeof getDocumentProxy>>;

export interface LoadRendererOptions {
  /** Cache root; the canvas lives in <cacheDir>/<platform>. Default ~/.cache/pubmy/canvas/1.1.0. */
  cacheDir?: string;
  fetch?: typeof fetch;
  /** A platform package name such as "linux-x64-musl"; default: this machine. */
  platform?: string;
  /** Called after the first download; default prints one line on stderr. */
  onDownload?: (info: { bytes: number; dest: string }) => void;
  /** Time allowed for the first download; default 180 s. Past it the renderer is null, as when offline. */
  downloadTimeoutMs?: number;
  /** Overrides the pinned tarball hashes (tests). */
  pins?: Readonly<Record<string, string>>;
}

export function hostCanvasPlatform(): CanvasPlatform | null {
  return canvasPlatform(process.platform, process.arch, process.platform === "linux" ? detectLibc() : undefined);
}

function printDownload({ bytes, dest }: { bytes: number; dest: string }): void {
  process.stderr.write(`pubmy: downloaded the formula renderer (${(bytes / 1e6).toFixed(1)} MB) to ${dest}\n`);
}

/** A valid one-page PDF, 1 x 1 point, built with a correct xref so pdf.js loads it without warnings. */
function tinyPdf(): Uint8Array {
  const objs = ["<</Type/Catalog/Pages 2 0 R>>", "<</Type/Pages/Kids[3 0 R]/Count 1>>", "<</Type/Page/Parent 2 0 R/MediaBox[0 0 1 1]>>"];
  let s = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(s.length);
    s += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = s.length;
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) s += `${String(o).padStart(10, "0")} 00000 n \n`;
  s += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(s);
}

/**
 * Bun/Node renderer, or null when no canvas can be had: unsupported platform, offline before the first
 * download, a hash mismatch, or a library that will not load. Never throws for those.
 */
export async function loadRendererBun(opts: LoadRendererOptions = {}): Promise<PdfRenderer | null> {
  const key = opts.platform ?? hostCanvasPlatform();
  if (!key || !isCanvasPlatform(key)) return null;
  const cacheDir = join(opts.cacheDir ?? (await defaultCanvasCache()), key);
  // Written when a fresh, verified download will not load on this machine (for example a glibc older than
  // the library needs): a second download would not fix that, so later runs skip the 15 MB fetch. The user
  // clears it by deleting the cache folder (~/.cache/pubmy/canvas/1.1.0/<platform> by default).
  const marker = join(cacheDir, UNLOADABLE);
  if (existsSync(marker)) return null;
  const report = opts.onDownload ?? printDownload;
  let fresh = false;
  const get = () => {
    fresh = false;
    const onDownload = (info: { bytes: number; dest: string }) => {
      fresh = true;
      report(info);
    };
    return ensureCanvas({ key, cacheDir, fetch: opts.fetch, pins: opts.pins, downloadTimeoutMs: opts.downloadTimeoutMs, onDownload });
  };
  let files = await get();
  if (!files) return null;
  if (await loads(files)) return bunRenderer();
  if (!fresh) {
    // A cached copy that will not load (truncated, damaged on disk) is fetched once more.
    await rm(cacheDir, { recursive: true, force: true });
    files = await get();
    if (!files) return null;
    if (await loads(files)) return bunRenderer();
  }
  await writeFile(marker, "This canvas library will not load here. Delete this folder to try a download again.\n").catch(() => {});
  return null;
}

const UNLOADABLE = "unloadable";

async function loads(files: CanvasFiles): Promise<boolean> {
  try {
    // The wrapper's js-binding.js loads this file instead of looking for a platform package in node_modules.
    process.env.NAPI_RS_NATIVE_LIBRARY_PATH = files.nodeFile;
    const index = join(files.mainDir, "index.js");
    const canvas = createRequire(index)(index) as CanvasModule;
    // unpdf installs the canvas module for pdf.js's canvas factory only inside renderPageAsImage.
    await renderPageAsImage(tinyPdf(), 1, { canvasImport: async () => canvas, scale: 1 });
    return true;
  } catch {
    return false;
  }
}

interface CanvasAndContext {
  canvas: { width: number; height: number };
  context: { fillStyle: string; fillRect(x: number, y: number, w: number, h: number): void; getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } };
}

function bunRenderer(): PdfRenderer {
  const open = new Set<Doc>();
  let closed = false;
  return {
    async renderBoxes(pdf, boxes, dpi, signal) {
      if (closed) return boxes.map(() => null);
      let doc: Doc;
      try {
        // pdf.js transfers the buffer it is given to its worker, so it gets a copy.
        doc = await getDocumentProxy(pdf.slice());
      } catch {
        return boxes.map(() => null);
      }
      open.add(doc);
      try {
        const out: (Uint8Array | null)[] = [];
        for (const box of boxes) {
          signal?.throwIfAborted();
          out.push(await renderBox(doc, box, dpi).catch(() => null));
        }
        return out;
      } finally {
        open.delete(doc);
        await doc.loadingTask.destroy().catch(() => {});
      }
    },
    async close() {
      closed = true;
      await Promise.all([...open].map((d) => d.loadingTask.destroy()));
      open.clear();
    },
  };
}

async function renderBox(doc: Doc, box: PageBox, dpi: number): Promise<Uint8Array | null> {
  const page = await doc.getPage(box.page);
  try {
    const scale = dpi / 72;
    const base = page.getViewport({ scale });
    const [a, b] = base.convertToViewportPoint(box.x0, box.y0) as [number, number];
    const [c, d] = base.convertToViewportPoint(box.x1, box.y1) as [number, number];
    const w = Math.round(Math.abs(c - a));
    const h = Math.round(Math.abs(d - b));
    if (!(w >= 1 && h >= 1)) return null;
    // Shifting the viewport by the box's top-left corner makes a canvas the size of the box hold just the crop.
    const viewport = page.getViewport({ scale, offsetX: -Math.min(a, c), offsetY: -Math.min(b, d) });
    const factory = doc.canvasFactory as { create(w: number, h: number): CanvasAndContext; destroy(c: CanvasAndContext): void };
    const cc = factory.create(w, h);
    try {
      cc.context.fillStyle = "#ffffff";
      cc.context.fillRect(0, 0, w, h);
      await page.render({ canvas: cc.canvas as unknown as HTMLCanvasElement, viewport }).promise;
      return opaquePng(w, h, cc.context.getImageData(0, 0, w, h).data);
    } finally {
      factory.destroy(cc);
    }
  } finally {
    page.cleanup();
  }
}
