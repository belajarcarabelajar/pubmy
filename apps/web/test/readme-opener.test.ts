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

  // The earlier sentence says the wipe comes 3 minutes after the EPUB is ready; the new one must read as an exception to it, not a rival.
  test("it says an opened EPUB follows the same 3 minute rule", () => {
    expect(privacyLine).toContain("An EPUB you open follows the same 3 minute rule");
  });

  test("it says the countdown of an opened EPUB stops while its reader is open and starts again at close, as its last sentence", () => {
    expect(
      privacyLine.endsWith("An EPUB you open follows the same 3 minute rule, except that its countdown stops while its reader is open and starts again when you close it."),
    ).toBe(true);
  });

  test("it no longer says an opened EPUB is wiped 3 minutes after you close it", () => {
    expect(privacyLine).not.toContain("wiped 3 minutes after you close it");
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
