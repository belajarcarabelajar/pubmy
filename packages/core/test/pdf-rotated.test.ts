import { beforeAll, expect, test } from "bun:test";
import { getDocumentProxy } from "unpdf";
import { makeFiguresPdf, TABLE } from "../../../fixtures/make-pdf-figures.ts";
import { pack } from "../src/packager.ts";
import { rotatedTable, tableHtml } from "../src/pdf/rotated.ts";
import { validate } from "../src/validate.ts";

let pages: { items: unknown[]; view: number[] }[] = [];
beforeAll(async () => {
  const doc = await getDocumentProxy(await makeFiguresPdf());
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    pages.push({ items: (await page.getTextContent()).items, view: page.view });
  }
});
const gridOf = (n: number) => rotatedTable(pages[n - 1].items, pages[n - 1].view);
// +90 degrees at 7.5 pt, as pdf.js reports the table items of the NIH sample
const up = (str: string, x: number, y: number, width: number) => ({ str, transform: [0, 7.5, -7.5, 0, x, y], width });
const LETTER = [0, 0, 612, 792];

test("flags the page whose table is printed rotated 90 degrees", () => {
  expect(gridOf(2)).not.toBeNull();
});

test("does not flag a normal page that carries the side stamp", () => {
  expect(gridOf(1)).toBeNull();
});

test("does not flag a page whose only text is the side stamp", () => {
  // the stamp as pdf.js reports it on every page of the NIH sample: -90 degrees, 22.8 pt from the left edge
  const stamp = [707.1, 493.7, 280.3].map((y) => ({ str: "NIH-PA Author Manuscript", transform: [0, -12, 12, 0, 22.8, y], width: 141.4 }));
  expect(rotatedTable(stamp, LETTER)).toBeNull();
});

test("reads the Table N title lines above the grid as the caption, not as cells", () => {
  expect(gridOf(2)?.caption).toBe(TABLE.captionLines.join(" "));
});

test("keeps empty cells so the columns of a lower-triangular matrix stay aligned", () => {
  expect(gridOf(2)?.rows).toEqual(TABLE.rows);
});

test("keeps the footnote lines below the grid as notes, not as rows", () => {
  expect(gridOf(2)?.notes).toEqual(TABLE.notes);
});

test("joins a raised significance star with the number it follows", () => {
  // NIH sample page 22, row 2: ".32" and "***" are separate runs 2.5 pt apart across the baseline
  const items = [
    up("1", 120.2, 209.3, 3.8),
    up("2", 120.2, 240.4, 3.8),
    up("1. Maternal HVD: age 13", 135.1, 119, 76.4),
    up("1.00", 135.1, 209.3, 13.1),
    up("2. Paternal HVD: age 13", 149.1, 119, 73.9),
    up(".32", 151.5, 209.3, 9.4),
    up("***", 149, 218.6, 11.3),
    up("1.00", 149.1, 240.4, 13.1),
  ];
  expect(rotatedTable(items, LETTER)?.rows[2]).toEqual(["2. Paternal HVD: age 13", ".32***", "1.00"]);
});

test("a page holding only rotated footnote lines yields them as notes and no rows", () => {
  // NIH sample page 23: the footnotes of Table 1, each star raised 5 pt above its line
  const items = [
    up("*", 43.5, 697.8, 3.8),
    up("p", 48.5, 701.5, 3.8),
    up("< .05", 48.5, 707.1, 15.5),
    up("**", 62.5, 697.8, 7.5),
    up("p", 67.5, 705.3, 3.8),
    up("< .01", 67.5, 710.9, 15.5),
  ];
  expect(rotatedTable(items, LETTER)).toEqual({ rows: [], notes: ["*p < .05", "**p < .01"] });
});

test("tableHtml writes the caption, the header row in thead, empty cells and the notes as paragraphs", () => {
  expect(tableHtml({ caption: "Table 1 Scores", rows: [["", "1", "2"], ["1. A", "1.00", ""], ["2. B", ".32***", "1.00"]], notes: ["* p < .05"] })).toBe(
    "<table><caption>Table 1 Scores</caption>" +
      "<thead><tr><th></th><th>1</th><th>2</th></tr></thead>" +
      "<tbody><tr><td>1. A</td><td>1.00</td><td></td></tr><tr><td>2. B</td><td>.32***</td><td>1.00</td></tr></tbody></table>" +
      "<p>* p &lt; .05</p>",
  );
});

test("tableHtml leaves out thead when the first row does not look like a header", () => {
  expect(tableHtml({ rows: [["1.00", "2.00"], ["3.00", "4.00"]] })).toBe(
    "<table><tbody><tr><td>1.00</td><td>2.00</td></tr><tr><td>3.00</td><td>4.00</td></tr></tbody></table>",
  );
});

test("the table HTML of the rotated page passes the packager and epubcheck", async () => {
  const grid = gridOf(2);
  expect(grid?.rows.length).toBeGreaterThan(0);
  const epub = pack({
    meta: { title: "Rotated table", creators: [], language: "en", identifier: "urn:uuid:00000000-0000-4000-8000-000000000001" },
    chapters: [{ href: "ch001.xhtml", title: "Table", body: tableHtml(grid ?? { rows: [] }) }],
    assets: [],
    toc: [],
    layout: "reflow",
    direction: "ltr",
  });
  const check = await validate(epub);
  expect({ errors: check.errors, messages: check.messages }).toMatchObject({ errors: 0 });
});

test("joins a row label wrapped onto a second line with its row", () => {
  // NIH sample page 22: "9. Maternal warmth: age" / "13" in the label column, the values on the first line
  const items = [
    up("1", 120.2, 209.3, 3.8),
    up("2", 120.2, 240.4, 3.8),
    up("8. Depression: age 14", 135.1, 119, 70.2),
    up(".25***", 135.1, 209.3, 20.6),
    up("1.00", 135.1, 240.4, 13.1),
    up("9. Maternal warmth: age", 149.1, 119, 78.4),
    up("-.06", 149.1, 209.3, 13.1),
    up(".04", 149.1, 240.4, 9.4),
    up("13", 158.1, 119, 7.5),
    up("10. Paternal warmth: age", 172.1, 119, 82.1),
    up("-.04", 172.1, 209.3, 13.1),
    up("-.05", 172.1, 240.4, 13.1),
  ];
  expect(rotatedTable(items, LETTER)?.rows.map((r) => r[0])).toEqual(["", "8. Depression: age 14", "9. Maternal warmth: age 13", "10. Paternal warmth: age"]);
});
