import { beforeAll, describe, expect, test } from "bun:test";
import { strFromU8, unzipSync } from "fflate";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { makeScan, SCAN_PAGES } from "../../../fixtures/make-scan.ts";
import { pdfAdapter } from "../src/adapters/pdf.ts";
import { ocrScan, scannedPageNumbers } from "../src/adapters/scan.ts";
import { convert, domFor, pack, registerAdapter, type Book, type Ctx } from "../src/index.ts";
import { loadOcrBun } from "../src/ocr/load.ts";

const ctx: Ctx = {
  dom: domFor("bun"),
  loadOcr: () => loadOcrBun(),
  progress: () => {},
  signal: new AbortController().signal,
};

// Line breaks and spacing depend on layout, not on recognition quality.
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const textOf = (xhtml: string) =>
  (xhtml.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1] ?? "")
    .replace(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");

let scanPdf: Uint8Array;
beforeAll(async () => {
  scanPdf = await makeScan();
});

describe("scan detection", () => {
  test("image-only pages are reported as scanned", async () => {
    expect(await scannedPageNumbers(scanPdf)).toEqual([1, 2]);
  });

  test("a page with a text layer is not scanned", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([420, 595]).drawText("Halaman dengan teks digital.", { x: 40, y: 500, size: 12, font });
    expect(await scannedPageNumbers(await doc.save())).toEqual([]);
  });
});

describe("scan OCR (ind+eng)", () => {
  test(
    "OCR text of each scanned page reaches its EPUB chapter with CER under 2 %",
    async () => {
      const r = await ocrScan(scanPdf, [1, 2], ctx);
      console.log(`[scan] pages=${r.pages} meanConfidence=${r.meanConfidence.toFixed(1)}`);
      expect(r.pages).toBe(2);
      const book: Book = {
        meta: { title: "Pindaian", creators: ["pubmy"], language: "id" },
        chapters: r.chapters,
        assets: [],
        toc: [],
        layout: "reflow",
        direction: "ltr",
      };
      const files = unzipSync(pack(book));
      for (let i = 0; i < SCAN_PAGES.length; i++) {
        const entry = files[`OEBPS/${r.chapters[i].href}`];
        expect(entry).toBeDefined();
        const ref = norm(SCAN_PAGES[i]);
        const hyp = norm(textOf(strFromU8(entry)));
        const cer = levenshtein(ref, hyp) / ref.length;
        console.log(`[scan] page ${i + 1}: CER ${(cer * 100).toFixed(2)} % over ${ref.length} chars`);
        expect(cer).toBeLessThan(0.02);
      }
    },
    600_000,
  );
});

test(
  "convert() turns the fully scanned PDF into an EPUB and reports 2 OCR pages",
  async () => {
    const unregister = registerAdapter(pdfAdapter);
    try {
      const r = await convert({ name: "scan.pdf", bytes: scanPdf }, ctx);
      if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
      console.log(`[scan] convert notes=${JSON.stringify(r.notes)}`);
      expect(r.notes?.ocr?.pages).toBe(2);
      const text = Object.entries(unzipSync(r.epub))
        .filter(([p]) => p.endsWith(".xhtml") && !p.endsWith("nav.xhtml"))
        .map(([, b]) => textOf(strFromU8(b)))
        .join(" ");
      expect(norm(text)).toContain(norm(SCAN_PAGES[1].split("\n\n")[1]));
    } finally {
      unregister();
    }
  },
  600_000,
);
