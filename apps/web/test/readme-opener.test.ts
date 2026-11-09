import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readme = readFileSync(join(import.meta.dir, "..", "..", "..", "README.md"), "utf8");
const lines = readme.split("\n");
const websiteLine = lines.find((l) => l.startsWith("- **Website** at")) ?? "";
// The bullet under "## Privacy", not the feature list above it.
const privacyStart = lines.findIndex((l) => l.startsWith("## Privacy"));
const privacyLine = lines.slice(privacyStart + 1).find((l) => l.startsWith("- **Website:**")) ?? "";

describe("README website line and the opener", () => {
  test("it keeps the pinned limits and the preview", () => {
    expect(websiteLine).toContain("up to 10 files (50 MB each)");
    expect(websiteLine).toContain("preview each EPUB");
  });

  test("it says a dropped EPUB is not converted and opens in the reader, as its last sentence", () => {
    expect(websiteLine.endsWith("A file you drop that is already an EPUB (.epub) is not converted: it opens in the reader so you can read it.")).toBe(true);
  });
});

describe("README privacy bullet and the opener", () => {
  test("it is found under Privacy", () => {
    expect(privacyStart).toBeGreaterThan(0);
    expect(privacyLine).toContain("conversion runs inside your own browser");
  });

  test("it keeps the existing wipe sentence", () => {
    expect(privacyLine).toContain("wiped 3 minutes after it is ready");
  });

  test("it says an opened EPUB is kept while its reader is open and wiped 3 minutes after it is closed, as its last sentence", () => {
    expect(privacyLine.endsWith("An EPUB you open is kept in memory while its reader is open and wiped 3 minutes after you close it.")).toBe(true);
  });
});

describe("README wording on these lines", () => {
  test("neither line has an em dash", () => {
    const emDash = String.fromCharCode(0x2014);
    expect(websiteLine).not.toContain(emDash);
    expect(privacyLine).not.toContain(emDash);
  });

  // What a book's own scripts can do is measured in the browser first; until then the README says nothing about it.
  test("neither line says anything about scripts", () => {
    expect(websiteLine).not.toMatch(/script/i);
    expect(privacyLine).not.toMatch(/script/i);
  });
});
