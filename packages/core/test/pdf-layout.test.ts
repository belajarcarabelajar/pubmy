import { beforeAll, describe, expect, test } from "bun:test";
import { strFromU8, unzipSync } from "fflate";
import { CALLOUT, HEADING, JOINED, makeLayoutPdf } from "../../../fixtures/make-pdf-layout.ts";
import { pdfAdapter } from "../src/adapters/pdf.ts";
import { convert, domFor, registerAdapter, type Ctx } from "../src/index.ts";
import { layoutPage, layoutPages, type TextItem } from "../src/pdf/layout.ts";

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

test("a heading wrapped onto a second line 1.67 times its size below stays one heading", () => {
  // nihms496502 page 2: 12 pt heading lines on a 20 pt pitch, then 10 pt body text
  const items = [
    it("Parental Harsh Verbal Discipline and Youth Conduct Problems and", 90, 295.6, 12, 381.4),
    it("Depressive Symptoms", 90, 275.6, 12, 128.7),
    it("Parental harsh verbal discipline has been linked with conduct problems in children and", 150, 255.6, 10, 347.2),
  ];
  expect(layoutPage(items, { ...page, bodySize: 10 })[0]).toEqual({
    kind: "heading",
    level: 2,
    text: "Parental Harsh Verbal Discipline and Youth Conduct Problems and Depressive Symptoms",
  });
});

test("three lines of a callout set above body size that read as prose stay one paragraph", () => {
  // OpenStax University Physics Vol 1 "Check" callout, mentee's physics book: 10.5 pt on 10 pt body
  const items = [
    it("CHECK Make sure that when you convert numbers smaller than", 50, 700, 10.5),
    it("one into scientific notation, the exponent is negative and", 50, 687, 10.5),
    it("that it counts the places the point moved to the right.", 50, 674, 10.5),
  ];
  expect(layoutPage(items, { ...page, bodySize: 10 })).toEqual([
    {
      kind: "para",
      text: "CHECK Make sure that when you convert numbers smaller than one into scientific notation, the exponent is negative and that it counts the places the point moved to the right.",
    },
  ]);
});

test("a callout line over twelve words does not cut the callout paragraph", () => {
  const items = [
    it("TAKING IT FURTHER During a calculation, avoid entering", 50, 700, 10.5),
    it("intermediate results by hand, because rounding them early adds an error that grows", 50, 687, 10.5),
    it("with every later step of the work.", 50, 674, 10.5),
  ];
  expect(layoutPage(items, { ...page, bodySize: 10 }).map((b) => b.kind)).toEqual(["para"]);
});

test("a title wrapped onto three lines in title case stays one heading", () => {
  const items = [
    it("Parental Harsh Verbal Discipline and", 90, 315.6, 12),
    it("Youth Conduct Problems and", 90, 295.6, 12),
    it("Depressive Symptoms", 90, 275.6, 12),
    it("Parental harsh verbal discipline has been linked with conduct problems in children and", 150, 255.6, 10, 347.2),
  ];
  expect(layoutPage(items, { ...page, bodySize: 10 })[0]).toEqual({
    kind: "heading",
    level: 2,
    text: "Parental Harsh Verbal Discipline and Youth Conduct Problems and Depressive Symptoms",
  });
});

test("a title wrapped onto three lines in sentence case at 18 pt stays one heading", () => {
  // the callout rule is for text a little above body size, not for titles
  const items = [
    it("Deep learning for the physical sciences, a review of", 60, 700, 18),
    it("methods, data and the questions that remain open in", 60, 678, 18),
    it("the study of matter", 60, 656, 18),
    it("Machine learning has changed how data from experiments are read and how models are built.", 60, 620, 10, 420),
  ];
  expect(layoutPage(items, { ...page, bodySize: 10 })[0]?.kind).toBe("heading");
});

test("a hyphen before a function word at the line end is kept", () => {
  expect(texts([it("effects within-", 50, 700), it("and between-group effects.", 50, 688)])).toEqual(["effects within- and between-group effects."]);
});

test("a hyphen before a capitalised word across a page break is kept", () => {
  // arXiv 2302.13971 references also hold "mod- Joel", where the line order broke; gluing those would invent words
  expect(twoPages("in the references of Self-", "Consistency improves chain of thought.")[0]).toContain("Self-");
});

test("two headings of one size more than two lines apart stay apart", () => {
  const items = [it("Method", 50, 700, 12), it("Participants", 50, 670, 12), it("Body text line.", 50, 650)];
  expect(layoutPage(items, { ...page, bodySize: 10 }).map((b) => b.text)).toEqual(["Method", "Participants", "Body text line."]);
});

test("a body size passed in for the whole document marks a page of larger text as headings", () => {
  const blocks = layoutPage([it("Chapter Two", 50, 700, 11)], { ...page, bodySize: 10 });
  expect(blocks).toEqual([{ kind: "heading", level: 2, text: "Chapter Two" }]);
});

// OpenStax University Physics Vol 1 pages 46-61: body 9.5 pt, problems and math letters 10 pt serif,
// section headings 10 pt sans ("1.1 The Scope and Scale of Physics"), integral signs 14 pt, fences 25 pt.
const kinds = (items: TextItem[], bodySize: number) => layoutPage(items, { ...page, bodySize }).map((b) => b.kind);

test("a body line holding one large integral sign stays body text", () => {
  const items = [it("dimensions of (c)", 50, 700, 10, 80), it("∫", 131, 700, 14.09, 6), it("vdt, (d) and (e) da/dt?", 138, 700, 10)];
  expect(kinds(items, 10)).toEqual(["para"]);
});

test("a line a little above body size that reads as running text is a paragraph", () => {
  expect(kinds([it("(c) 17 ns; (d) 577 μs.", 50, 700, 10)], 9.5)).toEqual(["para"]);
});

test("a line a little above body size that starts in lower case is a paragraph", () => {
  expect(kinds([it("the an are dimensionless constants for all", 50, 700, 10)], 9.5)).toEqual(["para"]);
});

test("a figure caption a little above body size is a paragraph", () => {
  expect(kinds([it("Figure 2.4 A displacement D of magnitude 6 km is drawn", 50, 700, 10)], 9.5)).toEqual(["para"]);
});

test("a vector arrow before a figure caption does not make it a heading", () => {
  expect(kinds([it("→", 40, 700, 10, 5), it("Figure 2.4 A displacement D of magnitude 6 km is drawn", 50, 700, 10)], 9.5)).toEqual(["para"]);
});

test("a line of only vector arrows and an equation number is never a heading", () => {
  expect(kinds([it("→ → → → (2.4)", 50, 700, 12)], 10)).toEqual(["para"]);
});

test("an equation line is never a heading", () => {
  expect(kinds([it("B = α A (2.1)", 50, 700, 12)], 10)).toEqual(["para"]);
});

test("a question heading a little above body size stays a heading", () => {
  // sentence case and a question mark, as in "1.1 What is physics?": a heading, not a problem line
  expect(kinds([it("What is a tensor?", 50, 700, 10)], 9.5)).toEqual(["heading"]);
  expect(kinds([it("1.1 What is physics?", 50, 700, 10)], 9.5)).toEqual(["heading"]);
});

test("a lettered problem that ends in a question a little above body size is a paragraph", () => {
  expect(kinds([it("(b) What is the area of the square?", 50, 700, 10)], 9.5)).toEqual(["para"]);
});

test("a section heading a little above body size stays a heading", () => {
  expect(kinds([it("1.1 The Scope and Scale of Physics", 50, 700, 10)], 9.5)).toEqual(["heading"]);
});

// A page of the whole document for layoutPages; figures sit at `top` points down from the top edge.
const pageText = (items: TextItem[], figures: { top: number; html: string }[] = []) => ({ ...page, items, figures });
const doc = { bodySize: 10, titleSize: Infinity };

test("a figure lands among the page's blocks by its position on the page", () => {
  const blocks = layoutPages(
    [pageText([it("Text above the figure.", 50, 700), it("Text below the figure.", 50, 300)], [{ top: 200, html: "<figure>F</figure>" }])],
    doc,
  );
  expect(blocks.map((b) => [b.kind, b.text])).toEqual([
    ["para", "Text above the figure."],
    ["html", "<figure>F</figure>"],
    ["para", "Text below the figure."],
  ]);
});

test("a paragraph cut by a page break joins across a figure at the top of the next page", () => {
  const blocks = layoutPages(
    [
      pageText([it("Problem behavior in youth (Gutman,", 50, 100)]),
      pageText([it("Sameroff, & Cole, 2003).", 50, 500)], [{ top: 60, html: "<figure>F</figure>" }]),
    ],
    doc,
  );
  expect(blocks.map((b) => [b.kind, b.text])).toEqual([
    ["para", "Problem behavior in youth (Gutman, Sameroff, & Cole, 2003)."],
    ["html", "<figure>F</figure>"],
  ]);
});

test("a page whose text is replaced by a table keeps the table as one block", () => {
  const blocks = layoutPages([pageText([], [{ top: 0, html: "<table><tbody><tr><td>1</td></tr></tbody></table>" }])], doc);
  expect(blocks).toEqual([{ kind: "html", text: "<table><tbody><tr><td>1</td></tr></tbody></table>", page: 1 }]);
});

test("a figure caption opening the next page never continues the last paragraph", () => {
  // nihms496502: the reference list ends without a period, and page 20 opens with "Figure 1."
  const blocks = layoutPages(
    [
      pageText([it("Wang MT. Developmental Psychology. 2011; 47:1251.10.1037/a0024318", 50, 100)]),
      pageText([it("Figure 1.", 50, 500), it("Cross-lagged associations between parents and adolescents.", 50, 488)], [{ top: 60, html: "<figure>F</figure>" }]),
    ],
    doc,
  );
  expect(blocks.map((b) => b.text)).toEqual([
    "Wang MT. Developmental Psychology. 2011; 47:1251.10.1037/a0024318",
    "<figure>F</figure>",
    "Figure 1. Cross-lagged associations between parents and adolescents.",
  ]);
});

// Page-break joins measured on arXiv 2302.13971 and nihms496502 (all 600 x 800, body 10 pt).
const twoPages = (end: string, start: string) =>
  layoutPages([pageText([it(end, 50, 100)]), pageText([it(start, 50, 700)])], doc).map((b) => b.text);

test("a table header row opening the next page does not continue a cut sentence", () => {
  expect(twoPages("To fully benefit from this optimization, we need to", "BoolQ PIQA SIQA HellaSwag WinoGrande ARC-e ARC-c OBQA")).toEqual([
    "To fully benefit from this optimization, we need to",
    "BoolQ PIQA SIQA HellaSwag WinoGrande ARC-e ARC-c OBQA",
  ]);
});

test("a reference entry opening the next page does not continue the entry before it", () => {
  const end = "Developmental Psychology. 2006; 42:1289-1298. [PubMed: 17087561]";
  const start = "Buss DM. Toward a psychology of person-environment correlation: the role of spouse selection.";
  expect(twoPages(end, start)).toEqual([end, start]);
});

test("a sentence cut before a capitalised word still joins when the next page reads as prose", () => {
  expect(twoPages("ethnicity (WHITE: 0 =", "African American, 1 = European American, 2 = other), parent education, and family income.")).toEqual([
    "ethnicity (WHITE: 0 = African American, 1 = European American, 2 = other), parent education, and family income.",
  ]);
});

test("a table header row after a cut sentence ending in a comma stays apart", () => {
  // arXiv 2302.13971 page 7 opens with the header of Table 9 after "...variance in performance,"
  expect(twoPages("Most notably, on SIQA, we observe a lot of variance in performance,", "Humanities STEM Social Sciences Other Average")).toEqual([
    "Most notably, on SIQA, we observe a lot of variance in performance,",
    "Humanities STEM Social Sciences Other Average",
  ]);
});

describe("pdf adapter: generated callout box and page-break hyphen", () => {
  let book = "";
  beforeAll(async () => {
    const unregister = registerAdapter(pdfAdapter);
    const ctx: Ctx = { dom: domFor("bun"), loadOcr: () => Promise.reject(new Error("no OCR")), progress: () => {}, signal: new AbortController().signal };
    const r = await convert({ name: "layout.pdf", bytes: await makeLayoutPdf() }, ctx);
    unregister();
    if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
    const files = unzipSync(r.epub);
    book = Object.entries(files)
      .filter(([p]) => p.endsWith(".xhtml") && !p.endsWith("nav.xhtml"))
      .map(([, b]) => strFromU8(b))
      .join("\n");
  });

  test("the callout box is one paragraph of body text", () => {
    expect(book).toContain(`<p>${CALLOUT}</p>`);
  });

  test("the section heading above the callout stays a heading", () => {
    expect(book).toMatch(new RegExp(`<h[12]>${HEADING}</h[12]>`));
  });

  test("a word hyphenated across the page break is joined", () => {
    expect(book).toContain(JOINED);
  });
});

test("a word hyphenated across a page break is joined without the hyphen", () => {
  // arXiv 2302.13971: "Car-" ends a page, "bonell" opens the next
  expect(twoPages("the founding work of Car-", "bonell and others.")).toEqual(["the founding work of Carbonell and others."]);
});

test("a word hyphenated where the left column hands over to the right is joined", () => {
  const items = [it("Results agree with the earlier work by Gold-", 50, 700, 10, 230), it("ing and others in every case.", 320, 736, 10, 230)];
  expect(texts(items)).toEqual(["Results agree with the earlier work by Golding and others in every case."]);
});

test("a name hyphenated before the letters of a function word is still joined", () => {
  // arXiv 2302.13971 references: "Con-" then "nor Leahy"
  expect(texts([it("Sid Black, Con-", 50, 700), it("nor Leahy, and others.", 50, 688)])).toEqual(["Sid Black, Connor Leahy, and others."]);
});

test("a formula marker word at a line break is never hyphen-joined", () => {
  // inline crops arrive as one private-use marker word, its id holding a hyphen (pdf/crops.ts)
  const marker = "p3-m1";
  expect(texts([it("the value of x-", 50, 700), it(`${marker} is small.`, 50, 688)])).toEqual([`the value of x- ${marker} is small.`]);
  expect(twoPages(`so the speed is ${marker}`, "and it stays so.")).toEqual([`so the speed is ${marker} and it stays so.`]);
});
