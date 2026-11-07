// Generates the PDF used by packages/core/test/pdf-math.test.ts, one scenario per page. Dev only
// (pdf-lib, MIT). Run `bun fixtures/make-pdf-math.ts [outDir]` to write math.pdf for a look
// (default fixtures/out/gen/). Pieces that must stay separate pdf.js text items use different
// fonts, because pdf.js merges neighbouring runs of one font into a single item.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beginText, endText, moveText, PDFDocument, type PDFFont, PDFHexString, PDFName, type PDFPage, setFontAndSize, showText, StandardFonts } from "pdf-lib";
import { FIGURE_BOX, makeFiguresPdf } from "./make-pdf-figures.ts";

/** 1-based page of each scenario. */
export const MATH_PAGES = { display: 1, inline: 2, lookalike: 3, diagram: 4, imageLines: 5, prose: 6, accents: 7, tall: 8, radical: 9, privateUse: 10 } as const;
/** Page 8: baselines of the tall inline formula's line and of the prose lines right above and below it. */
export const TALL = { above: 663, line: 650, below: 637 } as const;
/** Page 9: TeX hangs the radical sign from its bar, so "√" sits 9.8 pt above its operand's baseline. */
export const RADICAL = { x: 250, line: 640, lift: 9.8 } as const;
export const BAR = { x0: 280, x1: 312, y: 603.5 };
export const DIAGRAM = { x0: 150, y0: 420, x1: 350, y1: 560 };
/** The custom math font: its "3" and "4" print as brackets on paper but extract as digits. */
export const LOOKALIKE_FONT = "MathematicalPi-One";

const BODY = 10;
const LEADING = 13;
const PROSE = [
  "Physical quantities are measured in units that people agree on, so that a length taken",
  "in one laboratory means the same thing in another one far away, and results can be",
  "compared without any doubt about what was measured or how it was recorded by hand.",
];

interface Fonts {
  roman: PDFFont;
  italic: PDFFont;
  bold: PDFFont;
  symbol: PDFFont;
}
interface Piece {
  s: string;
  font: PDFFont | "lookalike";
  size?: number;
  dy?: number;
}

function prose(page: PDFPage, f: Fonts, top: number, lines = PROSE): void {
  lines.forEach((l, k) => page.drawText(l, { x: 72, y: top - k * LEADING, size: BODY, font: f.roman }));
}

/** Draws pieces left to right on one baseline; returns the x where each piece starts. */
function run(page: PDFPage, pieces: Piece[], x: number, y: number): number[] {
  const starts: number[] = [];
  for (const p of pieces) {
    const size = p.size ?? BODY;
    starts.push(x);
    if (p.font === "lookalike") {
      const hex = [...p.s].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
      page.pushOperators(beginText(), setFontAndSize("MP1", size), moveText(x, y + (p.dy ?? 0)), showText(PDFHexString.of(hex)), endText());
      x += p.s.length * size * 0.5;
    } else {
      page.drawText(p.s, { x, y: y + (p.dy ?? 0), size, font: p.font });
      x += p.font.widthOfTextAtSize(p.s, size);
    }
  }
  return starts;
}

/** Text set in this font extracts as U+E002, U+E000, U+E001 for "A", "B", "C" (a ToUnicode CMap). */
export const PRIVATE_USE_TEXT = "ABC";

/** A font whose ToUnicode maps A, B, C to private-use code points, as some publisher fonts do. */
function privateUseFont(doc: PDFDocument, page: PDFPage): void {
  const cmap = [
    "/CIDInit /ProcSet findresource begin 12 dict begin begincmap",
    "/CMapName /PubmyPUA def /CMapType 2 def",
    "1 begincodespacerange <00> <FF> endcodespacerange",
    "3 beginbfchar <41> <E002> <42> <E000> <43> <E001> endbfchar",
    "endcmap CMapName currentdict /CMap defineresource pop end end",
  ].join("\n");
  const toUnicode = doc.context.register(doc.context.stream(cmap));
  const font = doc.context.register(
    doc.context.obj({ Type: "Font", Subtype: "Type1", BaseFont: "Helvetica", Encoding: "WinAnsiEncoding", ToUnicode: toUnicode }),
  );
  page.node.setFontDictionary(PDFName.of("PU1"), font);
}

/** A non-embedded symbolic Type 1 font under a math font's name, like MathematicalPi in old physics books. */
function lookalikeFont(doc: PDFDocument, page: PDFPage): void {
  const descriptor = doc.context.register(
    doc.context.obj({
      Type: "FontDescriptor",
      FontName: LOOKALIKE_FONT,
      Flags: 4,
      FontBBox: [0, -200, 1000, 900],
      ItalicAngle: 0,
      Ascent: 800,
      Descent: -200,
      CapHeight: 700,
      StemV: 80,
    }),
  );
  const font = doc.context.register(
    doc.context.obj({
      Type: "Font",
      Subtype: "Type1",
      BaseFont: LOOKALIKE_FONT,
      FirstChar: 32,
      LastChar: 126,
      Widths: Array.from({ length: 95 }, () => 500),
      FontDescriptor: descriptor,
    }),
  );
  page.node.setFontDictionary(PDFName.of("MP1"), font);
}

export async function makeMathPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const f: Fonts = {
    roman: await doc.embedFont(StandardFonts.TimesRoman),
    italic: await doc.embedFont(StandardFonts.TimesRomanItalic),
    bold: await doc.embedFont(StandardFonts.TimesRomanBold),
    symbol: await doc.embedFont(StandardFonts.Symbol),
  };
  const size: [number, number] = [612, 792];

  // 1: a displayed fraction with its bar and equation number, then a display with a prose tail
  let page = doc.addPage(size);
  prose(page, f, 720);
  run(page, [{ s: "v =", font: f.italic }], 250, 600);
  run(page, [{ s: "a + b", font: f.roman }], 284, 607);
  page.drawLine({ start: { x: BAR.x0, y: BAR.y }, end: { x: BAR.x1, y: BAR.y }, thickness: 0.5 });
  run(page, [{ s: "2c", font: f.roman }], 291, 593);
  run(page, [{ s: "(1)", font: f.roman }], 520, 600);
  prose(page, f, 560);
  run(page, [{ s: "F = ma,", font: f.italic }, { s: " and", font: f.roman }], 250, 480);
  prose(page, f, 440);

  // 2: x squared inside prose, then a numbered problem whose number sits a little high
  page = doc.addPage(size);
  prose(page, f, 720);
  run(page, [
    { s: "The area of the square grows as ", font: f.roman },
    { s: "x", font: f.italic },
    { s: "2", font: f.roman, size: 7, dy: 3.5 },
    { s: " when each side gets longer by the same amount.", font: f.roman },
  ], 72, 670);
  prose(page, f, 657);
  run(page, [{ s: "25.", font: f.bold, dy: 2.5 }], 72, 600);
  run(page, [{ s: "Find the speed of the car after ten seconds of steady travel on the road.", font: f.roman }], 90, 600);
  run(page, [{ s: "Use the values given in the table above and show every step of the work.", font: f.roman }], 90, 587);

  // 3: brackets set in a custom math font whose glyphs extract as the digits 3 and 4
  page = doc.addPage(size);
  lookalikeFont(doc, page);
  prose(page, f, 720);
  run(page, [
    { s: "Every point of the closed interval ", font: f.roman },
    { s: "3", font: "lookalike" },
    { s: "a, b", font: f.italic },
    { s: "4", font: "lookalike" },
    { s: " lies between its two end points.", font: f.roman },
  ], 72, 650);
  prose(page, f, 637);

  // 4: a vector diagram of straight, diagonal and curved paths with two labels
  page = doc.addPage(size);
  prose(page, f, 720);
  const { x0, y0, x1, y1 } = DIAGRAM;
  page.drawLine({ start: { x: x0, y: y0 }, end: { x: x1, y: y0 }, thickness: 1 });
  page.drawLine({ start: { x: x0, y: y0 }, end: { x: x0, y: y1 }, thickness: 1 });
  page.drawLine({ start: { x: x0, y: y0 }, end: { x: 300, y: 540 }, thickness: 1 });
  page.drawLine({ start: { x: 300, y: 540 }, end: { x: 340, y: 470 }, thickness: 1 });
  page.drawSvgPath("M 0 0 C 40 80 120 -40 180 40", { x: 160, y: 480, borderWidth: 1 });
  run(page, [{ s: "F", font: f.italic }], 305, 545);
  run(page, [{ s: "x", font: f.italic }], 340, 425);
  prose(page, f, 380);

  // 5: a raster figure with arrows drawn over it; images.ts owns it, so it is no vector diagram
  const [figurePage] = await doc.copyPages(await PDFDocument.load(await makeFiguresPdf()), [0]);
  page = doc.addPage(figurePage);
  const b = FIGURE_BOX;
  // one connected zig-zag, so the strokes alone would pass as a diagram (4 paths, all diagonal)
  for (const [sx, sy, ex, ey] of [[0.1, 0.1, 0.3, 0.6], [0.3, 0.6, 0.5, 0.2], [0.5, 0.2, 0.7, 0.7], [0.7, 0.7, 0.9, 0.3]])
    page.drawLine({ start: { x: b.x + sx * b.w, y: b.y + sy * b.h }, end: { x: b.x + ex * b.w, y: b.y + ey * b.h }, thickness: 1 });

  // 6: prose only, with a heading, a framed note and a paragraph that ends in a short sum
  page = doc.addPage(size);
  page.drawText("Units and Measurement", { x: 72, y: 730, size: 16, font: f.bold });
  prose(page, f, 700);
  prose(page, f, 650);
  page.drawRectangle({ x: 66, y: 560, width: 470, height: 50, borderWidth: 1 });
  prose(page, f, 595, PROSE.slice(0, 2));
  prose(page, f, 530);
  run(page, [{ s: "and the speed is v = 5 m/s.", font: f.roman }], 72, 530 - 3 * LEADING);

  // 7: vector arrows above letters, as separate items, in a display and inside prose
  page = doc.addPage(size);
  prose(page, f, 720);
  run(page, [{ s: "A", font: f.italic }, { s: " = 2", font: f.roman }], 260, 600);
  run(page, [{ s: "B", font: f.italic }], 290, 600);
  run(page, [{ s: "→", font: f.symbol }], 259, 609);
  run(page, [{ s: "→", font: f.symbol }], 289, 609);
  run(page, [{ s: "(2.1)", font: f.roman }], 520, 600);
  prose(page, f, 560);
  const at = run(page, [
    { s: "The displacement ", font: f.roman },
    { s: "D", font: f.italic },
    { s: " points from the start to the end of the whole trip.", font: f.roman },
  ], 72, 500);
  run(page, [{ s: "→", font: f.symbol }], at[1], 509);
  prose(page, f, 487);

  // 8: an inline formula with 24 pt fence glyphs (like |A| in OpenStax) on a 13 pt leading
  page = doc.addPage(size);
  lookalikeFont(doc, page);
  prose(page, f, TALL.above + 2 * LEADING);
  run(page, [
    { s: "The length of the vector ", font: f.roman },
    { s: "3", font: "lookalike", size: 24 },
    { s: "A", font: f.italic },
    { s: "4", font: "lookalike", size: 24 },
    { s: " does not depend on its direction at all.", font: f.roman },
  ], 72, TALL.line);
  prose(page, f, TALL.below);

  // 9: a radical as LaTeX sets it (arXiv 1706.03762 p. 4-5): the sign hangs from the bar above the
  // operand's baseline, next to prose on the line above; the operand carries a text-font subscript
  page = doc.addPage(size);
  prose(page, f, 720);
  run(page, [
    { s: "Keys come with a size, and values of a dimension ", font: f.roman },
    { s: "ν", font: f.symbol },
    { s: "v", font: f.italic, size: 7, dy: -1.5 },
    { s: " that fits the rest.", font: f.roman },
  ], 72, RADICAL.line + LEADING);
  const r = RADICAL;
  const signW = f.symbol.widthOfTextAtSize("√", BODY);
  run(page, [{ s: "Divide each by", font: f.roman }], 72, r.line);
  run(page, [{ s: "√", font: f.symbol }], r.x, r.line + r.lift);
  const op = run(page, [{ s: "d", font: f.italic }, { s: "model", font: f.roman, size: 7, dy: -1.5 }], r.x + signW, r.line);
  page.drawLine({ start: { x: r.x + signW, y: r.line + r.lift + 0.2 * BODY }, end: { x: op[1] + f.roman.widthOfTextAtSize("model", 7), y: r.line + r.lift + 0.2 * BODY }, thickness: 0.4 });
  run(page, [{ s: " and apply a softmax to the scores of the whole line.", font: f.roman }], op[1] + f.roman.widthOfTextAtSize("model", 7) + 1, r.line);
  prose(page, f, r.line - LEADING);

  // 10: a font whose text extracts as the private-use characters pubmy uses for its own markers
  page = doc.addPage(size);
  privateUseFont(doc, page);
  prose(page, f, 720);
  run(page, [{ s: "Private use marks", font: f.roman }], 72, 650);
  page.pushOperators(beginText(), setFontAndSize("PU1", BODY), moveText(160, 650), showText(PDFHexString.of("414243")), endText());
  run(page, [{ s: "stay out of the markup of the page.", font: f.roman }], 185, 650);
  prose(page, f, 637);

  return doc.save();
}

if (import.meta.main) {
  const out = process.argv[2] ?? "fixtures/out/gen";
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "math.pdf"), await makeMathPdf());
  console.log(`wrote ${join(out, "math.pdf")}`);
}
