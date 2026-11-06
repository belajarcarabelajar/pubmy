// Generates the PDF fixtures used by packages/core/test/pdf-images.test.ts and pdf-rotated.test.ts.
// Dev only (pdf-lib, MIT). Run `bun fixtures/make-pdf-figures.ts [outDir]` (default fixtures/out/gen/).
// Images are written as raw Flate XObjects so their colour space and bit depth are exact.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  concatTransformationMatrix,
  degrees,
  drawObject,
  PDFDocument,
  type PDFPage,
  popGraphicsState,
  pushGraphicsState,
  StandardFonts,
} from "pdf-lib";

export const PAGE = { width: 612, height: 792 };

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface RawImage {
  width: number;
  height: number;
  colorSpace: "DeviceGray" | "DeviceRGB";
  bpc: 1 | 8;
  data: Uint8Array;
  alpha?: Uint8Array;
}

const fill = (n: number, f: (k: number) => number) => Uint8Array.from({ length: n }, (_, k) => f(k));

/** 8-bit gray figure, one component like the NIH sample figures. */
export const FIGURE = { width: 120, height: 80, pixels: fill(120 * 80, (k) => ((k % 120) * 2 + Math.floor(k / 120) * 3) % 256) };
export const FIGURE_BOX: Box = { x: 106, y: 380, w: 400, h: 400 * (80 / 120) };
export const CAPTION = "Figure 1. A generated gradient chart.";
/** 64 x 64 px RGB logo drawn 40 x 40 pt: big enough in pixels, decorative by its size on the page. */
export const LOGO_BOX: Box = { x: 40, y: 720, w: 40, h: 40 };

/** RGB with a soft mask, which pdf.js hands out as RGBA_32BPP. */
export const RGBA_IMAGE = {
  width: 48,
  height: 32,
  rgb: fill(48 * 32 * 3, (k) => {
    const x = Math.floor(k / 3) % 48;
    const y = Math.floor(k / 3 / 48);
    return [x * 5, y * 7, (x + y) * 3][k % 3] % 256;
  }),
  // by column: half transparent, opaque, fully transparent
  alpha: fill(48 * 32, (k) => [128, 255, 0][(k % 48) % 3]),
};
/** 1-bit DeviceGray checkerboard of 8 px squares (bit 1 = white), which pdf.js hands out as GRAYSCALE_1BPP. */
export const BITONAL = { width: 64, height: 48, white: (x: number, y: number) => ((x >> 3) + (y >> 3)) % 2 === 1 };
/** 2000 px wide RGB, left half red and right half blue, to be scaled down to 1600 px. */
export const WIDE = { width: 2000, height: 40 };
/** Drawn bottom first, so the expected top-to-bottom order is RGBA, bitonal, wide. */
export const KIND_BOXES = {
  rgba: { x: 100, y: 560, w: 192, h: 128 },
  bitonal: { x: 100, y: 330, w: 192, h: 144 },
  wide: { x: 56, y: 80, w: 500, h: 100 },
} satisfies Record<string, Box>;

/** The rotated table on page 2: title lines, a lower-triangular correlation matrix like Table 1 of the NIH sample, footnotes. */
export const TABLE = {
  captionLines: ["Table 1", "Correlations among generated scores"],
  rows: [
    ["", "1", "2", "3"],
    ["1. Anxiety", "1.00", "", ""],
    ["2. Mood", ".32***", "1.00", ""],
    ["3. Sleep", ".25", ".19*", "1.00"],
  ],
  notes: ["* p < .05", "*** p < .001"],
};
/** The side stamp printed three times down the left edge of every page, like "NIH-PA Author Manuscript". */
export const STAMP = "stamp:author-manuscript";

function drawImage(page: PDFPage, img: RawImage, box: Box): void {
  const ctx = page.doc.context;
  const dict: NonNullable<Parameters<typeof ctx.flateStream>[1]> = {
    Type: "XObject",
    Subtype: "Image",
    Width: img.width,
    Height: img.height,
    ColorSpace: img.colorSpace,
    BitsPerComponent: img.bpc,
  };
  if (img.alpha) {
    const smask = { Type: "XObject", Subtype: "Image", Width: img.width, Height: img.height, ColorSpace: "DeviceGray", BitsPerComponent: 8 };
    dict.SMask = ctx.register(ctx.flateStream(img.alpha, smask));
  }
  const name = page.node.newXObject("Im", ctx.register(ctx.flateStream(img.data, dict)));
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(box.w, 0, 0, box.h, box.x, box.y), drawObject(name), popGraphicsState());
}

async function addStampedPage(pdf: PDFDocument): Promise<PDFPage> {
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([PAGE.width, PAGE.height]);
  // reads top to bottom (-90 degrees), baseline 22.8 pt from the left edge, as in the sample
  for (const y of [700, 480, 260]) page.drawText(STAMP, { x: 22.8, y, size: 12, font, rotate: degrees(-90) });
  return page;
}

/** Page 1: body text, a gray raster figure with its caption and a small logo. Page 2: a table printed rotated 90 degrees. */
export async function makeFiguresPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const p1 = await addStampedPage(pdf);
  p1.drawText("Generated Figures Sample", { x: 200, y: 760, size: 16, font });
  ["The figure below is a generated gradient. It is", "drawn from raw gray pixels so the test can read", "them back and compare every value."].forEach((line, k) =>
    p1.drawText(line, { x: 106, y: 700 - k * 14, size: 11, font }),
  );
  drawImage(p1, { width: FIGURE.width, height: FIGURE.height, colorSpace: "DeviceGray", bpc: 8, data: FIGURE.pixels }, FIGURE_BOX);
  p1.drawText(CAPTION, { x: 106, y: 360, size: 10, font });
  drawImage(p1, { width: 64, height: 64, colorSpace: "DeviceRGB", bpc: 8, data: fill(64 * 64 * 3, (k) => (k % 3 === 0 ? 200 : 40)) }, LOGO_BOX);

  const p2 = await addStampedPage(pdf);
  p2.drawText("Generated Figures Sample Page 2", { x: 200, y: 760, size: 10, font });
  p2.drawText("Generated running footer", { x: 240, y: 30, size: 10, font });
  // +90 degrees: each line is vertical, lines advance to the right, text runs up the page
  const line = (text: string, x: number, y: number) => p2.drawText(text, { x, y, size: 10, font, rotate: degrees(90) });
  TABLE.captionLines.forEach((t, k) => line(t, 110 + k * 14, 150));
  const columns = [150, 300, 380, 460];
  TABLE.rows.forEach((row, r) =>
    row.forEach((cell, c) => {
      // significance stars are a run of their own right after the number, as in the NIH sample
      const [, value, stars] = /^(.*?)(\*+)$/.exec(cell) ?? [cell, cell, ""];
      if (value) line(value, 150 + r * 20, columns[c]);
      if (stars) line(stars, 150 + r * 20, columns[c] + font.widthOfTextAtSize(value, 10));
    }),
  );
  TABLE.notes.forEach((t, k) => line(t, 240 + k * 14, 150));
  return pdf.save();
}

/** One page with an RGBA, a 1-bit and an over-wide image, drawn bottom first. */
export async function makeImageKindsPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE.width, PAGE.height]);
  const wide = fill(WIDE.width * WIDE.height * 3, (k) => {
    const left = Math.floor(k / 3) % WIDE.width < WIDE.width / 2;
    return (k % 3 === 0 && left) || (k % 3 === 2 && !left) ? 255 : 0;
  });
  drawImage(page, { width: WIDE.width, height: WIDE.height, colorSpace: "DeviceRGB", bpc: 8, data: wide }, KIND_BOXES.wide);
  const stride = Math.ceil(BITONAL.width / 8);
  const bits = new Uint8Array(stride * BITONAL.height);
  for (let y = 0; y < BITONAL.height; y++)
    for (let x = 0; x < BITONAL.width; x++) if (BITONAL.white(x, y)) bits[y * stride + (x >> 3)] |= 0x80 >> (x & 7);
  drawImage(page, { width: BITONAL.width, height: BITONAL.height, colorSpace: "DeviceGray", bpc: 1, data: bits }, KIND_BOXES.bitonal);
  drawImage(
    page,
    { width: RGBA_IMAGE.width, height: RGBA_IMAGE.height, colorSpace: "DeviceRGB", bpc: 8, data: RGBA_IMAGE.rgb, alpha: RGBA_IMAGE.alpha },
    KIND_BOXES.rgba,
  );
  return pdf.save();
}

if (import.meta.main) {
  // Usage: bun fixtures/make-pdf-figures.ts [outDir]  (default fixtures/out/gen/)
  const dir = process.argv[2] ?? join(import.meta.dir, "out", "gen");
  mkdirSync(dir, { recursive: true });
  await Bun.write(join(dir, "figures.pdf"), await makeFiguresPdf());
  await Bun.write(join(dir, "image-kinds.pdf"), await makeImageKindsPdf());
}
