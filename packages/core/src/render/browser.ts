// PdfRenderer for the website: pdf.js (through unpdf) draws into OffscreenCanvas inside the
// conversion Web Worker. unpdf's pdf.js build runs its own worker side in this thread, so rendering
// starts no second worker.
import { getDocumentProxy } from "unpdf";
import { opaquePng } from "../pdf/png.ts";
import type { PageBox, PdfRenderer } from "../types.ts";

type Doc = Awaited<ReturnType<typeof getDocumentProxy>>;
type CanvasAndContext = { canvas: OffscreenCanvas | null; context: OffscreenCanvasRenderingContext2D | null };

// pdf.js asks this factory for scratch canvases (soft masks, patterns, groups); its default one
// calls document.createElement, which a worker does not have.
class OffscreenCanvasFactory {
  create(width: number, height: number): CanvasAndContext {
    if (width <= 0 || height <= 0) throw new Error("Invalid canvas size");
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, context: canvas.getContext("2d", { willReadFrequently: true }) };
  }
  reset(cc: CanvasAndContext, width: number, height: number): void {
    if (!cc.canvas) throw new Error("Canvas is not specified");
    cc.canvas.width = width;
    cc.canvas.height = height;
  }
  destroy(cc: CanvasAndContext): void {
    if (cc.canvas) cc.canvas.width = cc.canvas.height = 0;
    cc.canvas = null;
    cc.context = null;
  }
}

// The default filter factory builds SVG filters in the document and would throw in a worker;
// answering "none" skips those effects (transfer functions, high contrast), as pdf.js does in Node.
class NoFilterFactory {
  addFilter = () => "none";
  addHCMFilter = () => "none";
  addAlphaFilter = () => "none";
  addLuminosityFilter = () => "none";
  addKnockoutFilter = () => "none";
  addHighlightHCMFilter = () => "none";
  addSelectionHCMFilter = () => "none";
  addSelectionFilter = () => "none";
  createSelectionStyle = () => null;
  destroy = () => {};
}

const OPTIONS = {
  CanvasFactory: OffscreenCanvasFactory,
  FilterFactory: NoFilterFactory,
  // A worker has no document.fonts, so FontFace loading cannot work; glyphs are drawn as paths.
  disableFontFace: true,
  // With useSystemFonts pdf.js would try to load a local FontFace for unembedded fonts.
  useSystemFonts: false,
  // The site CSP has no 'unsafe-eval'.
  isEvalSupported: false,
};

async function renderBox(doc: Doc, b: PageBox, dpi: number): Promise<Uint8Array> {
  const page = await doc.getPage(b.page);
  const scale = dpi / 72;
  const full = page.getViewport({ scale });
  const [ax, ay] = full.convertToViewportPoint(b.x0, b.y0) as [number, number];
  const [bx, by] = full.convertToViewportPoint(b.x1, b.y1) as [number, number];
  const w = Math.max(1, Math.round(Math.abs(bx - ax)));
  const h = Math.max(1, Math.round(Math.abs(by - ay)));
  const viewport = page.getViewport({ scale, offsetX: -Math.min(ax, bx), offsetY: -Math.min(ay, by) });
  const canvas = new OffscreenCanvas(w, h);
  await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport }).promise;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  // The shared encoder flattens onto white (Kindle drops transparency) and writes gray or RGB like
  // the CLI; the canvas's own PNG would keep an alpha channel.
  const png = opaquePng(w, h, ctx.getImageData(0, 0, w, h).data);
  page.cleanup();
  return png;
}

/** The website renderer; null where the runtime has no OffscreenCanvas. */
export async function loadRendererBrowser(): Promise<PdfRenderer | null> {
  if (typeof OffscreenCanvas === "undefined") return null;
  return {
    async renderBoxes(pdf, boxes, dpi, signal) {
      let doc: Doc;
      try {
        // pdf.js detaches the buffer it is given, so it gets a copy.
        doc = await getDocumentProxy(pdf.slice(), OPTIONS);
      } catch {
        return boxes.map(() => null);
      }
      try {
        const out: (Uint8Array | null)[] = [];
        for (const box of boxes) {
          signal?.throwIfAborted();
          out.push(await renderBox(doc, box, dpi).catch(() => null));
        }
        return out;
      } finally {
        await doc.loadingTask.destroy().catch(() => {});
      }
    },
    async close() {},
  };
}
