import { expect, test } from "bun:test";
import type { TextItem } from "../src/pdf/layout.ts";
import { stripRunning } from "../src/pdf/running.ts";

// 600 x 800 pages: the top and bottom bands are y > 720 and y < 80. PDF y grows upward.
const it = (str: string, x: number, y: number, fontSize = 10): TextItem => ({ str, x, y, width: str.length * 5, fontSize });
const pageOf = (items: TextItem[]) => ({ items, width: 600, height: 800 });
const strs = (pages: { items: TextItem[] }[]) => pages.map((p) => p.items.map((i) => i.str));

test("a header that repeats at the top of most pages goes though its page number changes", () => {
  const pages = [8, 9, 10, 11].map((n) => pageOf([it("Wang and Kenny", 78, 747, 8), it(`Page ${n}`, 500, 747, 8), it(`Body ${n}`, 150, 600)]));
  expect(strs(stripRunning(pages))).toEqual([["Body 8"], ["Body 9"], ["Body 10"], ["Body 11"]]);
});

test("a footer line printed at the top of page 1 goes too", () => {
  const foot = "Child Dev. Author manuscript; available in PMC 2015 May 01.";
  const pages = [1, 2, 3].map((n) => pageOf([it(foot, 177, n === 1 ? 723 : 70, n === 1 ? 11 : 8), it(`Body ${n}`, 150, 600)]));
  expect(strs(stripRunning(pages))).toEqual([["Body 1"], ["Body 2"], ["Body 3"]]);
});

test("a two-page document keeps a line repeated at the top of both pages", () => {
  const pages = [1, 2].map((n) => pageOf([it("Wang and Kenny", 78, 747), it(`Body ${n}`, 150, 600)]));
  expect(strs(stripRunning(pages))).toEqual([
    ["Wang and Kenny", "Body 1"],
    ["Wang and Kenny", "Body 2"],
  ]);
});

test("the running text stays where it appears in the middle of a page", () => {
  const pages = [1, 2, 3].map((n) => pageOf([it("Child Dev", 177, 70, 8), it(`Body ${n}`, 150, 600)]));
  pages[1].items.push(it("Child Dev", 150, 400));
  expect(strs(stripRunning(pages))[1]).toEqual(["Body 2", "Child Dev"]);
});
