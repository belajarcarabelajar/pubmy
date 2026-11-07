// Generates the PDF used by packages/core/test/pdf-layout.test.ts: a textbook callout box set
// slightly above body size (OpenStax University Physics "Check Your Understanding") and a word
// hyphenated across a page break (arXiv 2302.13971 "Car- bonell"). Dev only (pdf-lib, MIT).
// Run `bun fixtures/make-pdf-layout.ts [outDir]` to write layout.pdf for a look (default fixtures/out/gen/).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

const BODY = 10;
const LEADING = 13;
/** 5 percent above body size: over the 1.03 heading ratio, as in the mentee's physics book. */
const CALLOUT_SIZE = 10.5;

export const HEADING = "Scientific Notation";
const CALLOUT_LINES = [
  "CHECK Make sure that when you convert numbers smaller than",
  "one into scientific notation, the exponent is negative and",
  "that it counts the places the decimal point moved to the right.",
];
export const CALLOUT = CALLOUT_LINES.join(" ");
const BEFORE = [
  "Very large and very small numbers appear all through physics, and writing them out",
  "in full makes them hard to read and easy to copy wrongly from one line to the next.",
  "Scientific notation writes each of them as a number between one and ten multiplied",
  "by a power of ten, which keeps the significant figures in plain view at all times.",
];
const AFTER = [
  "The same idea lets you compare the size of an atom with the size of a galaxy in a",
  "single glance, since only the exponents need to be set side by side and compared.",
  "Much of this way of writing goes back to the founding work of Car-",
];
const NEXT_PAGE = [
  "bonell and others, who wrote the measures down in a form that every reader could",
  "check by hand, and the habit has stayed with the field ever since that early time.",
];
/** The paragraph cut by the page break, joined again. */
export const JOINED = "the founding work of Carbonell and others";

/** Two 600 x 800 pages: heading, body, a three-line callout box, body cut by the page break mid-word. */
export async function makeLayoutPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const roman = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const lines = (page: ReturnType<typeof pdf.addPage>, text: string[], top: number, x = 72, size = BODY) =>
    text.forEach((l, k) => page.drawText(l, { x, y: top - k * LEADING, size, font: roman }));

  const one = pdf.addPage([600, 800]);
  one.drawText(HEADING, { x: 72, y: 720, size: 14, font: bold });
  lines(one, BEFORE, 690);
  one.drawRectangle({ x: 66, y: 560, width: 468, height: 52, color: rgb(0.9, 0.95, 1) });
  lines(one, CALLOUT_LINES, 595, 76, CALLOUT_SIZE);
  lines(one, AFTER, 535);
  const two = pdf.addPage([600, 800]);
  lines(two, NEXT_PAGE, 720);
  return pdf.save();
}

if (import.meta.main) {
  const out = process.argv[2] ?? join(import.meta.dir, "out", "gen");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "layout.pdf"), await makeLayoutPdf());
  console.log(`wrote ${join(out, "layout.pdf")}`);
}
