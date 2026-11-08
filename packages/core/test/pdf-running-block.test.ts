import { expect, test } from "bun:test";
import type { TextItem } from "../src/pdf/layout.ts";
import { stripRunning } from "../src/pdf/running.ts";

// 600 x 800 pages: the 10 percent band is y > 720 and y < 80, the 15 percent zone is y > 680 and y < 120.
// PDF y grows upward. A header table whose last row sits at y 712 is below the band but inside the zone.
const it = (str: string, x: number, y: number, fontSize = 10): TextItem => ({ str, x, y, width: str.length * 5, fontSize });
const pageOf = (items: TextItem[]) => ({ items, width: 600, height: 800 });
const strs = (pages: { items: TextItem[] }[]) => pages.map((p) => p.items.map((i) => i.str));

const headerTable = (n: number, total: number): TextItem[] => [
  it("USER MANUAL", 200, 780, 13),
  it("SATU Certificate", 200, 750),
  it("Mahasiswa", 120, 730),
  it("(DTD)", 80, 712),
  it("Halaman", 420, 712),
  it(`: ${n} dari ${total}`, 470, 712),
];

test("a header table whose last row sits below the 10 percent band goes on every page, page number included", () => {
  const pages = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => pageOf([...(n === 1 ? [] : headerTable(n, 9)), it(`Body ${n}`, 100, 400)]));
  expect(strs(stripRunning(pages))).toEqual(pages.map((_, k) => [`Body ${k + 1}`]));
});

test("a footer block below the 10 percent band at the bottom goes the same way", () => {
  const pages = [1, 2, 3, 4].map((n) => pageOf([it("Confidential", 80, 100), it(`Page ${n} of 4`, 450, 100), it(`Body ${n}`, 100, 400)]));
  expect(strs(stripRunning(pages))).toEqual([["Body 1"], ["Body 2"], ["Body 3"], ["Body 4"]]);
});

test("a line repeated in the middle of every page stays", () => {
  const pages = [1, 2, 3, 4, 5].map((n) => pageOf([it("Halaman", 420, 400), it(`Body ${n}`, 100, 300)]));
  expect(strs(stripRunning(pages))).toEqual(pages.map((_, k) => ["Halaman", `Body ${k + 1}`]));
});

test("the same text at a different y on every page stays", () => {
  const pages = [0, 1, 2, 3, 4].map((n) => pageOf([it("Halaman", 420, 688 + n * 4), it(`Body ${n}`, 100, 400)]));
  expect(strs(stripRunning(pages))).toEqual(pages.map((_, k) => ["Halaman", `Body ${k}`]));
});

test("a repeat on fewer than the threshold of pages stays", () => {
  // 9 pages need 4: the row sits on 3 of them.
  const pages = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => pageOf([...(n <= 3 ? [it("(DTD)", 80, 712)] : []), it(`Body ${n}`, 100, 400)]));
  expect(strs(stripRunning(pages)).slice(0, 4)).toEqual([["(DTD)", "Body 1"], ["(DTD)", "Body 2"], ["(DTD)", "Body 3"], ["Body 4"]]);
});

test("a page counts once per key, however often the item repeats on it", () => {
  // 9 pages need 4: the key appears 4 times in total but on 2 pages only.
  const pages = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => pageOf([...(n <= 2 ? [it("(DTD)", 80, 712), it("(DTD)", 80, 712)] : []), it(`Body ${n}`, 100, 400)]));
  expect(strs(stripRunning(pages))[0]).toEqual(["(DTD)", "(DTD)", "Body 1"]);
});

test("a rotated item at the same position on every page stays", () => {
  const pages = [1, 2, 3, 4].map((n) => pageOf([{ ...it("DRAFT", 40, 700), rotated: true }, it(`Body ${n}`, 100, 400)]));
  expect(strs(stripRunning(pages))).toEqual(pages.map((_, k) => ["DRAFT", `Body ${k + 1}`]));
});

test("a two-page document keeps the header table", () => {
  const pages = [1, 2].map((n) => pageOf([...headerTable(n, 2), it(`Body ${n}`, 100, 400)]));
  expect(strs(stripRunning(pages))).toEqual(strs(pages));
});
