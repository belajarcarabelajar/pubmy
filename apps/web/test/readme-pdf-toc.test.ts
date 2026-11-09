import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readme = readFileSync(join(import.meta.dir, "..", "..", "..", "README.md"), "utf8");
const pdfRows = readme.split("\n").filter((l) => l.startsWith("| PDF with text |"));
const pdfRow = pdfRows[0] ?? "";

describe("README PDF row", () => {
  test("there is exactly one PDF with text row", () => {
    expect(pdfRows).toHaveLength(1);
  });

  test("it keeps saying running headers, footers and page numbers are removed", () => {
    expect(pdfRow).toContain("Running headers, footers and page numbers are removed");
  });

  test("it says an unnumbered smaller heading is listed under its chapter in the table of contents", () => {
    expect(pdfRow).toContain("is listed under it in the table of contents");
  });

  test("it has no em dash and no en dash", () => {
    expect(pdfRow).not.toContain("\u2014");
    expect(pdfRow).not.toContain("\u2013");
  });
});
