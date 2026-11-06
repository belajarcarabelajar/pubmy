import { expect, test } from "bun:test";
import { headings, readingOrder, type Item } from "./layout";

// Synthetic A4-ish page, 600 wide. PDF y grows upward.
const it = (str: string, x: number, y: number, fontSize = 10, width = str.length * 5): Item => ({
  str,
  x,
  y,
  width,
  fontSize,
});

const page: Item[] = [
  // right column items listed first on purpose (content-stream order can be anything)
  it("R1 right top", 320, 700),
  it("R2 right next", 320, 688),
  it("L1 left top", 50, 700),
  it("L2 left next", 50, 688),
  it("Big Title Spanning Both Columns", 100, 780, 16, 400),
  it("1 Introduction", 50, 676, 13),
  it("L3 left after heading", 50, 664),
];

test("reading order: full-width title, then left column top-down, then right column", () => {
  const lines = readingOrder(page, 600).map((l) => l.text);
  expect(lines).toEqual([
    "Big Title Spanning Both Columns",
    "L1 left top",
    "L2 left next",
    "1 Introduction",
    "L3 left after heading",
    "R1 right top",
    "R2 right next",
  ]);
});

test("headings: lines whose font size exceeds body median by 20 percent", () => {
  const lines = readingOrder(page, 600);
  expect(headings(lines).map((l) => l.text)).toEqual(["Big Title Spanning Both Columns", "1 Introduction"]);
});

test("short centred lines sitting in the gutter (affiliation, author fragments) do not hide the columns", () => {
  // Found on arXiv 2302.13971 p1: "Meta AI" at x 277-317 covered the gutter, so every column line merged.
  const lines = readingOrder(
    [
      it("Hugo Touvron,", 130, 740, 12, 74),
      it("Thibaut Lavril", 210, 740, 12, 74),
      it("Xavier Martinet", 290, 740, 12, 74),
      it("Meta AI", 280, 720, 12, 40),
      ...Array.from({ length: 6 }, (_, k) => it(`left ${k}`, 70, 700 - k * 12, 10, 218)),
      ...Array.from({ length: 6 }, (_, k) => it(`right ${k}`, 306, 700 - k * 12, 10, 218)),
    ],
    595,
  ).map((l) => l.text);
  expect(lines.slice(0, 4)).toEqual(["Hugo Touvron, Thibaut Lavril Xavier Martinet", "Meta AI", "left 0", "left 1"]);
  expect(lines.slice(8)).toEqual(["right 0", "right 1", "right 2", "right 3", "right 4", "right 5"]);
});

test("rotated items (arXiv side stamp) are dropped", () => {
  const lines = readingOrder([it("body", 70, 500), { ...it("arXiv:2302.13971v1", 32, 500, 20, 346), rotated: true }], 595);
  expect(lines.map((l) => l.text)).toEqual(["body"]);
});

test("items on one baseline join into one line, with a space only at a real gap", () => {
  const lines = readingOrder([it("foun", 50, 500, 10, 20), it("da-", 70, 500, 10, 15), it("tion", 100, 500, 10, 20)], 600);
  expect(lines.map((l) => l.text)).toEqual(["founda- tion"]);
});
