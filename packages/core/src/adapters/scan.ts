import { extractImages, getDocumentProxy, inspectPages } from "unpdf";
import type { Chapter, Ctx, Ocr } from "../types.ts";

/** Per-page facts from unpdf inspectPages. */
export interface PageInfo {
  textLength: number;
  imageCoverage: number;
}

/** A page is a scan when it has no text layer and an image covers at least 90 % of it. */
export const isScannedPage = (p: PageInfo): boolean => p.textLength === 0 && p.imageCoverage >= 0.9;

// pdf.js may transfer (detach) the buffer it is given, so every call gets its own copy.
const copy = (b: Uint8Array) => b.slice();

/** 1-based numbers of the pages that need OCR. */
export async function scannedPageNumbers(pdf: Uint8Array): Promise<number[]> {
  const r = await inspectPages(copy(pdf));
  return r.pages.flatMap((p, i) => (isScannedPage(p) ? [i + 1] : []));
}

export interface ScanResult {
  chapters: Chapter[];
  pages: number;
  /** Tesseract confidence 0-100 averaged over pages; NaN when the engine gives none. */
  meanConfidence: number;
}

/** OCRs the given 1-based pages, one chapter per page, in the order given; the worker is terminated afterwards. */
export async function ocrScan(pdf: Uint8Array, pageNumbers: number[], ctx: Ctx): Promise<ScanResult> {
  if (pageNumbers.length === 0) return { chapters: [], pages: 0, meanConfidence: Number.NaN };
  // verbosity 0: pdf.js warnings stay out of the CLI output
  const doc = await getDocumentProxy(copy(pdf), { verbosity: 0 });
  const chapters: Chapter[] = [];
  const confidences: number[] = [];
  try {
    const ocr: Ocr = await ctx.loadOcr();
    try {
      for (const n of pageNumbers) {
        ctx.signal.throwIfAborted();
        const png = await pageImage(doc, n);
        let text = "";
        if (png) {
          const r = await ocr.recognize(png, ctx.signal);
          text = r.text;
          confidences.push(r.confidence);
        }
        chapters.push({ href: `scan-${String(n).padStart(3, "0")}.xhtml`, title: `Page ${n}`, body: toBody(text) });
      }
    } finally {
      await ocr.terminate();
    }
  } finally {
    // pdf.js holds the parsed document until destroy(); a batch would keep every one of them
    await doc.loadingTask.destroy().catch(() => {});
  }
  const meanConfidence = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : Number.NaN;
  return { chapters, pages: chapters.length, meanConfidence };
}

type Doc = Awaited<ReturnType<typeof getDocumentProxy>>;

// The largest embedded image is the scan itself; rendering would need a canvas at runtime in Bun.
async function pageImage(doc: Doc, n: number): Promise<Uint8Array | undefined> {
  const imgs = await extractImages(doc, n, { format: "png" });
  let best: (typeof imgs)[number] | undefined;
  for (const im of imgs) if (!best || im.width * im.height > best.width * best.height) best = im;
  return best?.data;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Tesseract separates paragraphs with a blank line; lines inside one are joined. */
export function toBody(text: string): string {
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return paras.map((p) => `<p>${esc(p)}</p>`).join("\n");
}
