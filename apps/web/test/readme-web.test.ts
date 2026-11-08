import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { t } from "../src/i18n.ts";

const readme = readFileSync(join(import.meta.dir, "..", "..", "..", "README.md"), "utf8");
const websiteLine = readme.split("\n").find((l) => l.startsWith("- **Website** at")) ?? "";

describe("README website line", () => {
  test("it is found", () => {
    expect(websiteLine).toContain("pubmy.belajarcarabelajar.com");
  });

  test("it says all files can be downloaded together as a ZIP", () => {
    expect(websiteLine).toMatch(/\bZIP\b/);
  });

  test("it names the button the way the page does", () => {
    expect(websiteLine).toContain(t("download-all", "en"));
  });

  test("it keeps the existing limits and the preview", () => {
    expect(websiteLine).toContain("up to 10 files (50 MB each)");
    expect(websiteLine).toContain("preview each EPUB");
  });

  test("it has no em dash", () => {
    expect(websiteLine).not.toContain("—");
  });
});
