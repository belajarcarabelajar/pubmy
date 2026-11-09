import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The page ships its text in Indonesian for a desktop pointer; main.js then picks the visitor's language and the
// touch wording and rewrites the page about 200 ms after the first paint (measured on the live page). The content
// therefore stays hidden until main.js says it is ready; a CSS timer shows it anyway if the script never runs.
const web = join(import.meta.dir, "..");
const html = readFileSync(join(web, "index.html"), "utf8");
const main = readFileSync(join(web, "src", "main.ts"), "utf8");

// One real build for the file, run while it loads so no test timeout cuts it short.
const out = mkdtempSync(join(tmpdir(), "pubmy-first-paint-"));
afterAll(() => rmSync(out, { recursive: true, force: true }));
const proc = Bun.spawnSync([process.execPath, join(web, "build.ts"), out], { stdout: "pipe", stderr: "pipe" });
if (proc.exitCode !== 0) console.error(proc.stderr.toString());
const built = readFileSync(join(out, "index.html"), "utf8");
const files = readdirSync(out, { recursive: true, encoding: "utf8" }).filter((f) => statSync(join(out, f)).isFile());
const openingTag = (id: string) => new RegExp(`<\\w+[^>]*\\sid="${id}"[^>]*>`).exec(built)?.[0] ?? "";

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

// A reload showed one to four frames of unstyled content before the blank phase: the hide rule sat in style.css, so it
// could not cover anything painted before that file applied. In the built page the rule is part of index.html itself.
describe("the built page hides its content without waiting for a second file", () => {
  test("the build exits 0", () => {
    expect(proc.exitCode).toBe(0);
  });

  test("the hide rule and its timer are an inline style in the head", () => {
    const head = /<head>([\s\S]*?)<\/head>/.exec(built)?.[1] ?? "";
    expect(head).toMatch(/<style>[\s\S]*html:not\(\.ready\) main\{visibility:hidden;animation:reveal 0s 1\.5s forwards\}[\s\S]*<\/style>/);
    expect(head).toMatch(/<style>[\s\S]*@keyframes reveal\{to\{visibility:visible\}\}[\s\S]*<\/style>/);
  });

  test("no stylesheet link and no style.css ship", () => {
    expect(built).not.toMatch(/rel="stylesheet"/);
    expect(files).not.toContain("style.css");
  });
});

// If main.js never runs, the 1.5 s timer shows the static page. It must not look broken: the language button had no text.
describe("the static page is complete when the script never runs", () => {
  test("the language button ships its label in Indonesian", () => {
    expect(built).toMatch(/<button[^>]*\sid="lang"[^>]*>English<\/button>/);
  });

  test("every element labelled by data-i18n-label ships its aria-label in Indonesian", () => {
    const labelled = [...built.matchAll(/<\w+[^>]*\sdata-i18n-label="[^"]+"[^>]*>/g)].map((m) => m[0]);
    expect(labelled.length).toBe(6);
    for (const tag of labelled) expect(tag).toMatch(/\saria-label="[^"]+"/);
    const expected: Record<string, string> = {
      queue: "Antrean konversi",
      "pv-toc": "Daftar isi",
      "pv-fullscreen": "Layar penuh",
      "pv-close": "Tutup pratinjau",
      "pv-prev": "Halaman sebelumnya",
      "pv-next": "Halaman berikutnya",
    };
    for (const [id, label] of Object.entries(expected)) expect(openingTag(id)).toContain(`aria-label="${label}"`);
  });
});
