import { beforeAll, expect, test } from "bun:test";
import { PDFDocument } from "pdf-lib";
import { getDocumentProxy, getResolvedPDFJS } from "unpdf";
import { BAR, DIAGRAM, LOOKALIKE_FONT, MATH_PAGES, makeMathPdf, RADICAL, TALL } from "../../../fixtures/make-pdf-math.ts";
import { findMathAreas, type MathAreas, type MathTextItem, realFontNames } from "../src/pdf/math.ts";

interface Analysed {
  items: MathTextItem[];
  fonts: Record<string, string>;
  areas: MathAreas;
}
const pages = new Map<number, Analysed>();

beforeAll(async () => {
  const { OPS } = await getResolvedPDFJS();
  // fontExtraProperties keeps the font's real name in commonObjs, filled by getOperatorList
  const doc = await getDocumentProxy(await makeMathPdf(), { fontExtraProperties: true } as Parameters<typeof getDocumentProxy>[1]);
  for (const n of Object.values(MATH_PAGES)) {
    const page = await doc.getPage(n);
    const ops = await page.getOperatorList();
    const items = (await page.getTextContent()).items as MathTextItem[];
    const fonts = realFontNames(page.commonObjs, items);
    pages.set(n, { items, fonts, areas: findMathAreas({ page: n, view: page.view, items, fonts, ops, OPS: OPS as Record<string, number> }) });
  }
});

const on = (n: number) => pages.get(n) as Analysed;
/** Indexes of the items whose text is exactly `s` (trimmed), in page order. */
const idx = (n: number, s: string) => on(n).items.flatMap((i, k) => (i.str?.trim() === s ? [k] : []));
const one = (n: number, s: string) => {
  const found = idx(n, s);
  if (found.length !== 1) throw new Error(`expected one item "${s}" on page ${n}, got ${found.length}`);
  return found[0];
};
const sorted = (a: number[]) => [...a].sort((x, y) => x - y);

test("the real font name of each text item's font is read from commonObjs", () => {
  const { items, fonts } = on(MATH_PAGES.lookalike);
  expect(fonts[items[one(MATH_PAGES.lookalike, "3")].fontName as string]).toBe(LOOKALIKE_FONT);
});

test("a displayed fraction becomes one display area with its host, bar, numerator, denominator and number", () => {
  const n = MATH_PAGES.display;
  const area = on(n).areas.display.find((a) => a.itemIndexes.includes(one(n, "a + b")));
  expect(area).toBeDefined();
  expect(sorted(area?.itemIndexes ?? [])).toEqual(sorted(["v =", "a + b", "2c", "(1)"].map((s) => one(n, s))));
  expect(area?.box.page).toBe(n);
  expect(area?.box.x0).toBeLessThanOrEqual(BAR.x0);
  expect(area?.box.x1).toBeGreaterThanOrEqual(BAR.x1);
});

test("a prose word after a displayed equation stays text", () => {
  const n = MATH_PAGES.display;
  const area = on(n).areas.display.find((a) => a.itemIndexes.includes(one(n, "F = ma,")));
  expect(area).toBeDefined();
  expect(area?.itemIndexes).not.toContain(one(n, "and"));
});

test("x squared inside prose stays text, with the 2 reported as a superscript", () => {
  const { areas } = on(MATH_PAGES.inline);
  expect(areas.inline).toEqual([]);
  expect(areas.display).toEqual([]);
  expect(areas.scripts).toContainEqual({ index: one(MATH_PAGES.inline, "2"), pos: "sup" });
});

test("a problem number set a little high is neither math nor a superscript", () => {
  const { areas } = on(MATH_PAGES.inline);
  const k = one(MATH_PAGES.inline, "25.");
  expect(areas.scripts.map((s) => s.index)).not.toContain(k);
  expect([...areas.inline, ...areas.display].flatMap((a) => a.itemIndexes)).not.toContain(k);
});

test("brackets from a lookalike math font are cropped as one inline area", () => {
  const n = MATH_PAGES.lookalike;
  expect(on(n).areas.inline.map((a) => sorted(a.itemIndexes))).toEqual([sorted(["3", "a, b", "4"].map((s) => one(n, s)))]);
});

test("lines and a curve with their labels become one vector diagram", () => {
  const n = MATH_PAGES.diagram;
  const { diagrams } = on(n).areas;
  expect(diagrams.length).toBe(1);
  expect(sorted(diagrams[0].itemIndexes)).toEqual(sorted([one(n, "F"), one(n, "x")]));
  const { box } = diagrams[0];
  expect(box.x0).toBeLessThanOrEqual(DIAGRAM.x0);
  expect(box.y0).toBeLessThanOrEqual(DIAGRAM.y0);
  expect(box.x1).toBeGreaterThanOrEqual(DIAGRAM.x1);
  expect(box.y1).toBeGreaterThanOrEqual(DIAGRAM.y1);
});

test("lines drawn over a raster figure are not a second, vector diagram", () => {
  expect(on(MATH_PAGES.imageLines).areas.diagrams).toEqual([]);
});

test("a prose page with a heading, a frame and a short sum gives no area and no script", () => {
  expect(on(MATH_PAGES.prose).areas).toEqual({ display: [], inline: [], diagrams: [], scripts: [] });
});

test("vector arrows above letters belong to their display equation", () => {
  const n = MATH_PAGES.accents;
  const [first, second] = idx(n, "→");
  const area = on(n).areas.display.find((a) => a.itemIndexes.includes(one(n, "(2.1)")));
  expect(area?.itemIndexes).toEqual(expect.arrayContaining([first, second, one(n, "A"), one(n, "B")]));
});

test("a vector arrow above a letter in prose is cropped with its letter", () => {
  const n = MATH_PAGES.accents;
  const arrow = idx(n, "→")[2];
  expect(on(n).areas.inline.map((a) => sorted(a.itemIndexes))).toEqual([sorted([arrow, one(n, "D")])]);
});

const tallArea = () => on(MATH_PAGES.tall).areas.inline.find((a) => a.itemIndexes.includes(idx(MATH_PAGES.tall, "3")[0]));

test("an inline area with tall glyphs stops above the next line's letters", () => {
  // Times capitals and ascenders of the 10 pt line below reach about 7 pt above its baseline
  expect(tallArea()?.box.y0).toBeGreaterThanOrEqual(TALL.below + 7);
});

test("an inline area with tall glyphs stops below the previous line's descenders", () => {
  // descenders of the 10 pt line above reach about 2 pt below its baseline
  expect(tallArea()?.box.y1).toBeLessThanOrEqual(TALL.above - 2);
});

test("a radical hung above its operand's baseline becomes one area with the operand and its subscript", () => {
  const n = MATH_PAGES.radical;
  const { inline } = on(n).areas;
  expect(inline.map((a) => sorted(a.itemIndexes))).toEqual([sorted([one(n, "√"), one(n, "d"), one(n, "model")])]);
});

test("a radical's area does not reach into the prose of the line above", () => {
  const n = MATH_PAGES.radical;
  const area = on(n).areas.inline.find((a) => a.itemIndexes.includes(one(n, "√")));
  expect(area?.box.x0).toBeGreaterThanOrEqual(RADICAL.x - 2);
  expect(area?.itemIndexes).not.toContain(one(n, "v"));
});

/** Time findMathAreas takes on a page of `rows` x 200 short diagonal ticks, 2.8 pt apart so none touch. */
async function strokesTime(rows: number): Promise<number> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < 200; c++) page.drawLine({ start: { x: 20 + c * 2.8, y: 100 + r * 5.6 }, end: { x: 20.6 + c * 2.8, y: 100.6 + r * 5.6 }, thickness: 0.2 });
  const { OPS } = await getResolvedPDFJS();
  const doc = await getDocumentProxy(await pdf.save(), { fontExtraProperties: true } as Parameters<typeof getDocumentProxy>[1]);
  const p1 = await doc.getPage(1);
  const ops = await p1.getOperatorList();
  const t0 = performance.now();
  findMathAreas({ page: 1, view: p1.view, items: [], fonts: {}, ops, OPS: OPS as Record<string, number> });
  return performance.now() - t0;
}

test("a page of 20,000 separate strokes (a scatter plot or a map) costs about 4 times a page of 5,000, not 16", async () => {
  // a ratio, not a time limit, so a busy test machine does not fail it; pairing every stroke with
  // every other one costs 16 times as much for 4 times the strokes
  // the fastest of three runs at each size, so one GC pause or a busy core does not decide the ratio
  const fastest = async (rows: number) => Math.min(await strokesTime(rows), await strokesTime(rows), await strokesTime(rows));
  const small = await fastest(25);
  const big = await fastest(100);
  expect(big / small).toBeLessThan(9);
}, 180_000);
