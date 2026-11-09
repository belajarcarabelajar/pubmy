import { expect, test } from "bun:test";
import type { TextItem } from "../src/pdf/layout.ts";
import { stripRunning } from "../src/pdf/running.ts";

// 600 x 800 pages: the 10 percent band is y > 720 and y < 80, the 15 percent zone is y > 680 and y < 120,
// and 5 percent of the height (the reach of the position rule past a detected block) is 40 pt.
// PDF y grows upward.
const it = (str: string, x: number, y: number, fontSize = 10): TextItem => ({ str, x, y, width: str.length * 5, fontSize });
const pageOf = (items: TextItem[]) => ({ items, width: 600, height: 800 });
const strs = (pages: { items: TextItem[] }[]) => pages.map((p) => p.items.map((i) => i.str));
const nine = [1, 2, 3, 4, 5, 6, 7, 8, 9];
/** A running head in the top band; its lowest row (y 725) puts the reach of the position rule at y >= 685. */
const head = () => [it("Annual Report", 200, 725)];

const headerTable = (n: number, total: number): TextItem[] => [
  it("USER MANUAL", 200, 780, 13),
  it("SATU Certificate", 200, 750),
  it("Mahasiswa", 120, 730),
  it("(DTD)", 80, 712),
  it("Halaman", 420, 712),
  it(`: ${n} dari ${total}`, 470, 712),
];

test("a header table whose last row sits below the 10 percent band goes on every page, page number included", () => {
  // The rows at 780, 750 and 730 are in the band; the last row, at 712, is 18 pt below the lowest of them.
  const pages = nine.map((n) => pageOf([...(n === 1 ? [] : headerTable(n, 9)), it(`Body ${n}`, 100, 400)]));
  expect(strs(stripRunning(pages))).toEqual(pages.map((_, k) => [`Body ${k + 1}`]));
});

test("a footer row below the 10 percent band at the bottom goes with the footer line the band rule removed", () => {
  // "Child Dev" at y 70 is in the bottom band; the row at y 100 is 30 pt above it, inside the 40 pt reach.
  const pages = [1, 2, 3, 4].map((n) =>
    pageOf([it("Child Dev", 177, 70, 8), it("Confidential", 80, 100), it(`Page ${n} of 4`, 450, 100), it(`Body ${n}`, 100, 400)]),
  );
  expect(strs(stripRunning(pages))).toEqual([["Body 1"], ["Body 2"], ["Body 3"], ["Body 4"]]);
});

test("a table at the foot with no running header or footer on the pages is left alone", () => {
  // Labels, numbers that change per page, and list items sit in the bottom zone at fixed positions,
  // but nothing in the bands repeats, so nothing is a template block.
  const pages = [0, 1, 2, 3, 4, 5].map((p) =>
    pageOf([
      it(`Body paragraph of page ${p}`, 72, 600),
      it("Total", 72, 100),
      it(String(100 + p * 7), 200, 100),
      it(String(5 + p), 300, 100),
      it("Tax", 72, 88),
      it(String(10 + p * 3), 200, 88),
      it(`${(p % 4) + 1}.`, 72, 112),
      it(`List entry text ${p}`, 90, 112),
    ]),
  );
  expect(strs(stripRunning(pages))).toEqual(strs(pages));
});

test("numbers that change per page stay below a running header; only the header goes", () => {
  // The head's lowest row is at y 738 (band); the cells sit 20 pt below it, outside the band, within reach.
  const pages = nine.map((n) =>
    pageOf([it("Annual Report", 200, 780), it("Quarterly Review", 200, 738), it(String(100 + n), 100, 718), it(String(n * 3), 300, 718), it(`Body ${n}`, 100, 400)]),
  );
  expect(strs(stripRunning(pages))).toEqual(nine.map((n) => [String(100 + n), String(n * 3), `Body ${n}`]));
});

test("a letter item that repeats past the reach of the header block stays", () => {
  // The head's lowest row is at y 770, so the reach stops at y 730. "Draft notice" at y 700 is inside the
  // 15 percent zone (y > 680) but 70 pt below the head, past the 40 pt reach.
  const pages = nine.map((n) => pageOf([it("Annual Report", 200, 790), it("Quarterly Review", 200, 770), it("Draft notice", 100, 700), it(`Body ${n}`, 100, 400)]));
  expect(strs(stripRunning(pages))).toEqual(nine.map((n) => ["Draft notice", `Body ${n}`]));
});

test("a bottom row stays when only the top has a running header", () => {
  const pages = nine.map((n) => pageOf([...head(), it("Confidential", 80, 100), it(`Body ${n}`, 100, 400)]));
  expect(strs(stripRunning(pages))).toEqual(nine.map((n) => ["Confidential", `Body ${n}`]));
});

test("a line repeated in the middle of every page stays", () => {
  const pages = [1, 2, 3, 4, 5].map((n) => pageOf([...head(), it("Halaman", 420, 400), it(`Body ${n}`, 100, 300)]));
  expect(strs(stripRunning(pages))).toEqual(pages.map((_, k) => ["Halaman", `Body ${k + 1}`]));
});

test("the same text at a different y on every page stays", () => {
  // 688 to 704 are all within the reach of the head at 725 (y >= 685), but each key has its own y.
  const pages = [0, 1, 2, 3, 4].map((n) => pageOf([...head(), it("Halaman", 420, 688 + n * 4), it(`Body ${n}`, 100, 400)]));
  expect(strs(stripRunning(pages))).toEqual(pages.map((_, k) => ["Halaman", `Body ${k}`]));
});

test("a repeat on fewer than the threshold of pages stays", () => {
  // 9 pages need 4: the row sits on 3 of them.
  const pages = nine.map((n) => pageOf([...head(), ...(n <= 3 ? [it("(DTD)", 80, 712)] : []), it(`Body ${n}`, 100, 400)]));
  expect(strs(stripRunning(pages)).slice(0, 4)).toEqual([["(DTD)", "Body 1"], ["(DTD)", "Body 2"], ["(DTD)", "Body 3"], ["Body 4"]]);
});

test("a page counts once per key, however often the item repeats on it", () => {
  // 9 pages need 4: the key appears 4 times in total but on 2 pages only.
  const pages = nine.map((n) => pageOf([...head(), ...(n <= 2 ? [it("(DTD)", 80, 712), it("(DTD)", 80, 712)] : []), it(`Body ${n}`, 100, 400)]));
  expect(strs(stripRunning(pages))[0]).toEqual(["(DTD)", "(DTD)", "Body 1"]);
});

test("a rotated item at the same position on every page stays", () => {
  const pages = [1, 2, 3, 4].map((n) => pageOf([...head(), { ...it("DRAFT", 40, 700), rotated: true }, it(`Body ${n}`, 100, 400)]));
  expect(strs(stripRunning(pages))).toEqual(pages.map((_, k) => ["DRAFT", `Body ${k + 1}`]));
});

test("a two-page document keeps the header table", () => {
  const pages = [1, 2].map((n) => pageOf([...headerTable(n, 2), it(`Body ${n}`, 100, 400)]));
  expect(strs(stripRunning(pages))).toEqual(strs(pages));
});
