// Generates the PDF fixtures used by packages/core/test/pdf.test.ts. Dev only (pdf-lib, MIT).
// Run `bun fixtures/make-pdf.ts [outDir]` to write them to <outDir> (default fixtures/out/gen/).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { degrees, PDFDocument, PDFName, PDFNull, PDFString, StandardFonts } from "pdf-lib";

const BODY = 10;
const HEAD = BODY + 1;
const LEAD = 12;

const LEFT_INTRO = [
  "Readers keep books in many file formats and",
  "want all of them on one small screen. This",
  "page is a generated sample with two columns,",
  "three section headings, and a stamp that runs",
  "up the left margin like the arXiv side label.",
];
const LEFT_METHOD = ["We place every line by hand so the expected", "reading order is known before the test runs."];
const RIGHT_RESULTS = [
  "The left column is read before the right one,",
  "the title comes first, and the rotated stamp",
  "never appears in the text of the book. Each",
  "heading is one point larger than the body.",
];

export interface TwoColumnOptions {
  /** Top-level PDF outline (bookmark) titles, all pointing at page 1. */
  outline?: string[];
  /** Prints the NIH author-manuscript banner "NIH Public Access" at 22 pt above the 18 pt title. */
  masthead?: boolean;
}

/** One 600 x 800 page: full-width title, "1 Introduction" and "2 Method" left, "3 Results" right, rotated stamp. */
export async function makeTwoColumnPdf(opts: TwoColumnOptions = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Generated Two Column Sample");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([600, 800]);
  const title = "A Generated Two Column Paper";
  page.drawText(title, { x: (600 - bold.widthOfTextAtSize(title, 18)) / 2, y: 750, size: 18, font: bold });
  if (opts.masthead) page.drawText("NIH Public Access", { x: 50, y: 774, size: 22, font: bold });
  const column = (x: number, top: number, parts: (string | string[])[]) => {
    let y = top;
    for (const p of parts) {
      if (typeof p === "string") {
        page.drawText(p, { x, y, size: HEAD, font: bold });
        y -= LEAD + 4;
      } else {
        for (const line of p) {
          page.drawText(line, { x, y, size: BODY, font });
          y -= LEAD;
        }
        y -= 6;
      }
    }
  };
  column(50, 700, ["1 Introduction", LEFT_INTRO, "2 Method", LEFT_METHOD]);
  column(320, 700, ["3 Results", RIGHT_RESULTS]);
  page.drawText("stamp:generated-sample-v1", { x: 25, y: 250, size: 20, font, rotate: degrees(90) });
  if (opts.outline?.length) addOutline(pdf, page.ref, opts.outline);
  return pdf.save();
}

function addOutline(pdf: PDFDocument, pageRef: ReturnType<PDFDocument["getPage"]>["ref"], titles: string[]): void {
  const ctx = pdf.context;
  const root = ctx.nextRef();
  const refs = titles.map(() => ctx.nextRef());
  titles.forEach((t, k) => {
    const item = ctx.obj({ Title: PDFString.of(t), Parent: root, Dest: [pageRef, PDFName.of("XYZ"), PDFNull, PDFNull, PDFNull] });
    if (k > 0) item.set(PDFName.of("Prev"), refs[k - 1]);
    if (k < refs.length - 1) item.set(PDFName.of("Next"), refs[k + 1]);
    ctx.assign(refs[k], item);
  });
  ctx.assign(root, ctx.obj({ Type: "Outlines", First: refs[0], Last: refs[refs.length - 1], Count: refs.length }));
  pdf.catalog.set(PDFName.of("Outlines"), root);
}

/** Footer of makeRunningHeadPdf: at the foot of pages 2-4 and at the top of page 1. */
export const RUNNING_FOOTER = "Sample Journal. Author manuscript; available in PMC 2015 May 01.";

/**
 * Four 600 x 800 pages shaped like the NIH author manuscript nihms496502: a running header
 * ("Doe and Roe", "Page N") on pages 2-4, a running footer that page 1 prints at the top in a
 * heading size, a paragraph cut mid-sentence by the page break with a footnote under it, and a
 * 12 pt heading wrapped onto two lines on a 20 pt pitch.
 */
export async function makeRunningHeadPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages = [1, 2, 3, 4].map(() => pdf.addPage([600, 800]));
  // the first line starts at x, the lines after it at the left margin
  const lines = (n: number, x: number, top: number, text: string[], size = BODY, pitch = 14, f = font) =>
    text.forEach((s, k) => pages[n - 1].drawText(s, { x: k === 0 ? x : 72, y: top - k * pitch, size, font: f }));
  pages[0].drawText(RUNNING_FOOTER, { x: 72, y: 760, size: HEAD, font });
  for (const n of [2, 3, 4]) {
    pages[n - 1].drawText("Doe and Roe", { x: 72, y: 770, size: 8, font });
    pages[n - 1].drawText(`Page ${n}`, { x: 500, y: 770, size: 8, font });
    pages[n - 1].drawText(RUNNING_FOOTER, { x: 150, y: 40, size: 8, font });
  }
  lines(1, 72, 700, ["A Generated Paper With Running Heads"], 18, 0, bold);
  lines(1, 72, 660, ["Introduction"], HEAD, 0, bold);
  lines(1, 90, 640, ["The first paragraph sits under the heading and", "ends its last sentence on this line."]);
  lines(1, 90, 300, ["The second paragraph runs to the foot of the", "page, where the measure it names was used in", "earlier work (Gutman,"]);
  lines(1, 72, 100, ["Correspondence to A. Doe, a.doe@example.org."], 8);
  lines(2, 72, 700, ["Sameroff, & Cole, 2003) and later studies used it in", "the same way."]);
  lines(2, 72, 650, ["Parental Discipline and Youth Conduct Problems and", "Depressive Symptoms"], 12, 20, bold);
  lines(2, 72, 610, ["Each section of this sample ends its last sentence", "at the foot of the page."]);
  lines(3, 72, 700, ["Next page opens a new paragraph in upper case."]);
  lines(3, 72, 660, ["Method"], HEAD, 0, bold);
  lines(3, 72, 640, ["Every page is drawn with pdf-lib."]);
  lines(4, 72, 700, ["Results"], HEAD, 0, bold);
  lines(4, 72, 680, ["The running lines are gone from the book."]);
  return pdf.save();
}

// 1 x 1 grey PNG.
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

/** One page with a full-page image and no text layer, like a scan. */
export async function makeImageOnlyPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const img = await pdf.embedPng(PNG);
  pdf.addPage([600, 800]).drawImage(img, { x: 0, y: 0, width: 600, height: 800 });
  return pdf.save();
}

/**
 * Hand-written PDF with a Standard security handler (RC4 40-bit) whose /U entry matches
 * no password, so it cannot be opened without one. pdf-lib cannot encrypt.
 */
export function makeEncryptedPdf(): Uint8Array {
  const hex = (n: number, seed: number) => Array.from({ length: n }, (_, k) => ((k * 37 + seed) % 256).toString(16).padStart(2, "0")).join("");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>",
    `<< /Filter /Standard /V 1 /R 2 /O <${hex(32, 11)}> /U <${hex(32, 97)}> /P -4 >>`,
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, k) => {
    offsets.push(out.length);
    out += `${k + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Encrypt 4 0 R /ID [<${hex(16, 5)}> <${hex(16, 5)}>] >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

if (import.meta.main) {
  // Usage: bun fixtures/make-pdf.ts [outDir]  (default fixtures/out/gen/)
  const dir = process.argv[2] ?? join(import.meta.dir, "out", "gen");
  mkdirSync(dir, { recursive: true });
  await Bun.write(join(dir, "two-column.pdf"), await makeTwoColumnPdf());
  await Bun.write(join(dir, "two-column-outline.pdf"), await makeTwoColumnPdf({ outline: ["Introduction", "Method", "Results"] }));
  await Bun.write(join(dir, "running-head.pdf"), await makeRunningHeadPdf());
  await Bun.write(join(dir, "image-only.pdf"), await makeImageOnlyPdf());
  await Bun.write(join(dir, "encrypted.pdf"), makeEncryptedPdf());
}
