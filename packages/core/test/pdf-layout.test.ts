import { expect, test } from "bun:test";
import { layoutPage, type TextItem } from "../src/pdf/layout.ts";

// Hand-built pdf.js-like items on a 600 x 800 page. PDF y grows upward.
const it = (str: string, x: number, y: number, fontSize = 10, width = str.length * 5): TextItem => ({
  str,
  x,
  y,
  width,
  fontSize,
});
const page = { width: 600, height: 800 };
const texts = (items: TextItem[]) => layoutPage(items, page).map((b) => b.text);

test("reads a full-width title, then the left column, then the right column", () => {
  const items = [
    // right column first on purpose: content-stream order can be anything
    it("2 Method", 320, 740, 11),
    it("Right column text here", 320, 727),
    it("A Study of Things", 100, 780, 16, 400),
    it("1 Introduction", 50, 740, 11),
    it("Left line one of the intro", 50, 727),
    it("left line two.", 50, 715),
  ];
  expect(layoutPage(items, page)).toEqual([
    { kind: "heading", level: 1, text: "A Study of Things" },
    { kind: "heading", level: 2, text: "1 Introduction" },
    { kind: "para", text: "Left line one of the intro left line two." },
    { kind: "heading", level: 2, text: "2 Method" },
    { kind: "para", text: "Right column text here" },
  ]);
});

test("drops rotated items such as the arXiv side stamp", () => {
  const items = [it("body", 70, 500), { ...it("arXiv:2302.13971v1", 32, 500, 20, 346), rotated: true }];
  expect(texts(items)).toEqual(["body"]);
});

test("an indented line starts a new paragraph", () => {
  const items = [
    it("First para line one", 50, 700),
    it("first para line two.", 50, 688),
    it("Second para indented", 62, 676),
    it("second para more.", 50, 664),
  ];
  expect(texts(items)).toEqual(["First para line one first para line two.", "Second para indented second para more."]);
});

test("a word hyphenated at the line end is joined", () => {
  expect(texts([it("the founda-", 50, 700), it("tion holds", 50, 688)])).toEqual(["the foundation holds"]);
});

test("a line above body size with more than 12 words stays a paragraph", () => {
  const long = "one two three four five six seven eight nine ten eleven twelve thirteen";
  const items = [it(long, 50, 740, 12), ...Array.from({ length: 6 }, (_, k) => it(`Body text line number ${k}`, 50, 700 - k * 30))];
  expect(layoutPage(items, page)[0]).toEqual({ kind: "para", text: long });
});

test("a paragraph that runs from the left column into the right column stays one paragraph", () => {
  expect(texts([it("starts in the left", 50, 700), it("and ends on the right.", 320, 700)])).toEqual([
    "starts in the left and ends on the right.",
  ]);
});

test("short centred lines in the gutter do not hide the columns", () => {
  // arXiv 2302.13971 p1: "Meta AI" at x 277-317 covered the gutter.
  const items = [
    it("Hugo Touvron,", 130, 740, 12, 74),
    it("Thibaut Lavril", 210, 740, 12, 74),
    it("Xavier Martinet", 290, 740, 12, 74),
    it("Meta AI", 280, 720, 12, 40),
    ...Array.from({ length: 6 }, (_, k) => it(`Left ${k}`, 70, 700 - k * 12, 10, 218)),
    ...Array.from({ length: 6 }, (_, k) => it(`Right ${k}`, 306, 700 - k * 12, 10, 218)),
  ];
  expect(layoutPage(items, { width: 595, height: 842 }).map((b) => b.text)).toEqual([
    "Hugo Touvron, Thibaut Lavril Xavier Martinet",
    "Meta AI",
    "Left 0 Left 1 Left 2 Left 3 Left 4 Left 5",
    "Right 0 Right 1 Right 2 Right 3 Right 4 Right 5",
  ]);
});

test("a lone page number at the bottom of the page is dropped", () => {
  expect(texts([it("Body text.", 50, 700), it("7", 295, 20)])).toEqual(["Body text."]);
});

test("a body size passed in for the whole document marks a page of larger text as headings", () => {
  const blocks = layoutPage([it("Chapter Two", 50, 700, 11)], { ...page, bodySize: 10 });
  expect(blocks).toEqual([{ kind: "heading", level: 2, text: "Chapter Two" }]);
});
