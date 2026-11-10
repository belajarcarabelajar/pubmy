// Guards of the PDF adapter that need no network: text and images share one page origin when the
// CropBox does not start at 0, and an oversized formula or diagram crop is never sent to the renderer.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { strFromU8, unzipSync } from "fflate";
import { concatTransformationMatrix, drawObject, PDFDocument, popGraphicsState, pushGraphicsState, StandardFonts, type PDFPage } from "pdf-lib";
import { getDocumentProxy } from "unpdf";
import { pdfAdapter } from "../src/adapters/pdf.ts";
import { convert, domFor, registerAdapter, type Ctx, type Result } from "../src/index.ts";
import type { PageBox, PdfRenderer } from "../src/types.ts";

const ctx: Ctx = {
  dom: domFor("bun"),
  loadOcr: () => Promise.reject(new Error("no OCR in pdf guard tests")),
  progress: () => {},
  signal: new AbortController().signal,
};

type Ok = Extract<Result, { ok: true }>;
function expectOk(r: Result): Ok {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
}
const bookText = (r: Ok) =>
  Object.entries(unzipSync(r.epub))
    .filter(([p]) => p.endsWith(".xhtml") && !p.endsWith("nav.xhtml"))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, b]) => strFromU8(b))
    .join("\n");

let unregister = () => {};
beforeAll(() => {
  unregister = registerAdapter(pdfAdapter);
});
afterAll(() => unregister());

const FOOTER = "Generated running footer";
const BELOW = "This sentence is printed below the figure.";
const BODY = ["Alpha opens the first generated page.", "Bravo continues on the second page.", "Charlie closes on the third page."];

/** A 120 x 80 gray gradient drawn 400 x 60 pt, its top edge 132 pt under the top of a 792 pt page. */
function drawFigure(pdf: PDFDocument, page: PDFPage, dy: number): void {
  const pixels = Uint8Array.from({ length: 120 * 80 }, (_v, k) => ((k % 120) * 2 + Math.floor(k / 120) * 3) % 256);
  const dict = { Type: "XObject", Subtype: "Image", Width: 120, Height: 80, ColorSpace: "DeviceGray", BitsPerComponent: 8 };
  const name = page.node.newXObject("Im", pdf.context.register(pdf.context.flateStream(pixels, dict)));
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(400, 0, 0, 60, 106, 600 + dy), drawObject(name), popGraphicsState());
}

/**
 * Three pages of 612 x 792 visible points with a running foot, page 1 with a figure and a sentence
 * 40 pt under it. With `dy` the same content sits `dy` higher and the CropBox starts at y = dy.
 */
async function makeCropBoxPdf(dy: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  BODY.forEach((line, k) => {
    const page = pdf.addPage([612, 792 + dy]);
    if (dy) page.setCropBox(0, dy, 612, 792);
    page.drawText(line, { x: 106, y: 700 + dy, size: 11, font });
    if (k === 0) {
      drawFigure(pdf, page, dy);
      page.drawText(BELOW, { x: 106, y: 560 + dy, size: 11, font });
    }
    page.drawText(`${FOOTER} ${k + 1}`, { x: 240, y: 30 + dy, size: 10, font });
  });
  return pdf.save();
}

describe("pdf adapter: a CropBox that does not start at 0", () => {
  let atZero = "";
  let shifted = "";
  beforeAll(async () => {
    atZero = bookText(expectOk(await convert({ name: "cropbox.pdf", bytes: await makeCropBoxPdf(0) }, ctx)));
    shifted = bookText(expectOk(await convert({ name: "cropbox.pdf", bytes: await makeCropBoxPdf(100) }, ctx)));
  });

  test("the fixture's page view starts at y = 100", async () => {
    const doc = await getDocumentProxy(await makeCropBoxPdf(100), { verbosity: 0 });
    expect((await doc.getPage(1)).view).toEqual([0, 100, 612, 892]);
  });

  test("control: with the CropBox at 0 the figure comes before the sentence under it and the running foot is dropped", () => {
    expect(atZero.indexOf("<figure>")).toBeGreaterThan(atZero.indexOf(BODY[0]));
    expect(atZero.indexOf(BELOW)).toBeGreaterThan(atZero.indexOf("<figure>"));
    expect(atZero).not.toContain(FOOTER);
  });

  test("the figure still comes before the sentence under it", () => {
    expect(shifted.indexOf("<figure>")).toBeGreaterThan(-1);
    expect(shifted.indexOf(BELOW)).toBeGreaterThan(shifted.indexOf("<figure>"));
  });

  test("the running foot is still dropped", () => {
    expect(shifted).not.toContain(FOOTER);
  });

  test("the book reads the same as with the CropBox at 0", () => {
    expect(shifted).toBe(atZero);
  });
});

/** Four nested ellipse outlines around (cx, cy), the widest `r` points in radius: one vector diagram. */
function drawRings(page: PDFPage, cx: number, cy: number, r: number): void {
  for (const k of [1, 0.9, 0.8, 0.7]) page.drawEllipse({ x: cx, y: cy, xScale: r * k, yScale: r * k, borderWidth: 1 });
}

describe("pdf adapter: the pixel cap on formula and diagram crops", () => {
  const boxes: PageBox[] = [];
  let text = "";
  beforeAll(async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    // page 1: a diagram of 5000 x 5000 pt, which is 20,833 px on a side at 300 dpi (434 million pixels)
    const big = pdf.addPage([6000, 6000]);
    big.drawText("A poster page with one very large drawing.", { x: 500, y: 5800, size: 12, font });
    drawRings(big, 3000, 3000, 2500);
    // page 2: a diagram of 120 x 120 pt, 500 px on a side
    const normal = pdf.addPage([612, 792]);
    normal.drawText("A letter page with one small drawing.", { x: 106, y: 720, size: 12, font });
    drawRings(normal, 300, 400, 60);
    const png = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
    const renderer: PdfRenderer = {
      renderBoxes: async (_pdf, asked) => {
        boxes.push(...asked);
        return asked.map(() => png);
      },
      close: async () => {},
    };
    text = bookText(expectOk(await convert({ name: "poster.pdf", bytes: await pdf.save() }, { ...ctx, loadRenderer: async () => renderer })));
  });

  test("control: a normal-size crop is rendered and placed as a picture", () => {
    const small = boxes.filter((b) => b.page === 2);
    expect(small.length).toBe(1);
    expect(small[0].x1 - small[0].x0).toBeLessThan(140);
    expect(text).toMatch(/<img src="img\/p2-m1\.png"/);
  });

  test("the renderer is not asked for a crop of 5000 x 5000 pt", () => {
    expect(boxes.filter((b) => b.page === 1)).toEqual([]);
    expect(text).not.toContain("img/p1-m");
  });
});
