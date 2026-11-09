import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// reader.ts imports foliate-js, which needs a browser, so these checks read it as text. Each one is anchored
// on the listener itself, so deleting it turns the check red; the real-browser run proves the behaviour.
const reader = readFileSync(join(import.meta.dir, "..", "src", "reader.ts"), "utf8");

/** A listener on the book's loader from `transform?.addEventListener("<type>"` to its closing `});` line; "" when absent. */
function listener(type: string): string {
  const start = reader.indexOf(`transform?.addEventListener("${type}"`);
  if (start < 0) return "";
  const end = reader.indexOf("\n  });", start);
  return end < 0 ? "" : reader.slice(start, end + "\n  });".length);
}

const opened = reader.indexOf("renderer.open(book);");
const refuse = listener("load");
const inject = listener("data");

describe("the reader keeps a book's scripts from running", () => {
  test("the loader of the book is the target of both listeners", () => {
    expect(reader).toMatch(/const transform = \(book as [^)]*\)\.transformTarget;/);
  });

  test("a load event for a script is refused", () => {
    expect(refuse).toContain("detail.isScript");
    expect(refuse).toMatch(/if \(detail\.isScript\) detail\.allow = false;/);
  });

  test("a load event is refused only for scripts: nothing else sets allow", () => {
    expect(reader.match(/\.allow = /g) ?? []).toHaveLength(1);
  });

  test("every page of the book gets the policy: the data event passes strings to blockBookScripts", () => {
    expect(reader).toMatch(/^import \{[^}]*\bblockBookScripts\b[^}]*\} from "\.\/book-csp\.ts";$/m);
    expect(inject).toContain("blockBookScripts(");
    expect(inject).toMatch(/detail\.data = Promise\.resolve\(detail\.data\)\.then\(/);
    expect(inject).toContain('typeof d === "string"');
  });

  // epub.js loadItem (the `parents.every(p => p !== href)` test in shouldReplace): a page that a frame loads while that
  // same page is being read is not rewritten but handed over as a Blob of its raw bytes, scripts and all.
  test("a page that arrives as a Blob is read as text and gets the policy too", () => {
    expect(inject).toContain("d instanceof Blob");
    expect(inject).toContain("blockBookScripts(await d.text(), detail.type)");
  });

  test("only pages are touched, and the type is left as it came", () => {
    expect(reader).toMatch(/^import \{[^}]*\bisBookMarkup\b[^}]*\} from "\.\/book-csp\.ts";$/m);
    expect(inject).toContain("isBookMarkup(detail.type)");
    expect(inject).not.toContain("detail.type =");
  });

  test("both listeners are registered before the renderer opens the book", () => {
    expect(opened).toBeGreaterThan(0);
    expect(refuse).not.toBe("");
    expect(inject).not.toBe("");
    expect(reader.indexOf(refuse)).toBeLessThan(opened);
    expect(reader.indexOf(inject)).toBeLessThan(opened);
  });

  test("renderer.open(book) is called once, so the order above covers the only call", () => {
    expect(reader.match(/renderer\.open\(book\)/g)).toHaveLength(1);
  });
});
