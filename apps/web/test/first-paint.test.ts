import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The page ships its text in Indonesian for a desktop pointer; main.js then picks the visitor's language and the
// touch wording and rewrites the page about 200 ms after the first paint (measured on the live page). The content
// therefore stays hidden until main.js says it is ready; a CSS timer shows it anyway if the script never runs.
const web = join(import.meta.dir, "..");
const html = readFileSync(join(web, "index.html"), "utf8");
const main = readFileSync(join(web, "src", "main.ts"), "utf8");

describe("first paint shows the final text once", () => {
  test("main stays hidden until the page is marked ready, and a timer shows it if the script fails", () => {
    expect(html).toMatch(/html:not\(\.ready\) main\{visibility:hidden;animation:reveal 0s 1\.5s forwards\}/);
    expect(html).toMatch(/@keyframes reveal\{to\{visibility:visible\}\}/);
  });

  test("main.ts marks the page ready right after the first applyLang, so language and touch text are already in place", () => {
    expect(main).toMatch(/^applyLang\(\);\ndocument\.documentElement\.classList\.add\("ready"\);$/m);
  });

  test("the touch wording is chosen before that applyLang call", () => {
    expect(main.indexOf('$("drop-hint").dataset.i18n')).toBeGreaterThan(0);
    expect(main.indexOf('$("drop-hint").dataset.i18n')).toBeLessThan(main.search(/^applyLang\(\);$/m));
  });
});
