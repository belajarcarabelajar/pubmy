import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";

// The page entry imports chunks that import more chunks. Without hints the browser finds one level per round trip:
// on 2026-11-14 a throttled first visit (400 ms latency) took about 1.6 s from the HTML to ready, past the 1.5 s
// reveal timer. The built page names every statically imported chunk up front, and nothing loaded on demand.
const web = join(import.meta.dir, "..");
const out = mkdtempSync(join(tmpdir(), "pubmy-modulepreload-"));
afterAll(() => rmSync(out, { recursive: true, force: true }));
const proc = Bun.spawnSync([process.execPath, join(web, "build.ts"), out], { stdout: "pipe", stderr: "pipe" });
if (proc.exitCode !== 0) console.error(proc.stderr.toString());
const html = readFileSync(join(out, "index.html"), "utf8");
const hinted = [...html.matchAll(/<link rel="modulepreload" href="\.\/([^"]+)">/g)].map((m) => m[1]!);

/** Static imports of one built file, read independently of build.ts: every import statement that is not import(). */
const importsOf = (file: string) =>
  [...readFileSync(join(out, file), "utf8").matchAll(/(?:^|;)import(?:[\w\s{},*$]*from)?\s*"([^"]+)"/g)].map((m) =>
    posix.normalize(posix.join(posix.dirname(file), m[1]!)),
  );
const closure = (entry: string) => {
  const seen = new Set<string>();
  const walk = (f: string) => importsOf(f).forEach((d) => !seen.has(d) && (seen.add(d), walk(d)));
  walk(entry);
  return seen;
};

describe("the built page preloads the chunks main.js needs", () => {
  test("the build exits 0", () => {
    expect(proc.exitCode).toBe(0);
  });

  test("main.js reaches chunks more than one level deep, so the hints matter", () => {
    const direct = new Set(importsOf("main.js"));
    expect([...closure("main.js")].some((f) => !direct.has(f))).toBe(true);
  });

  test("every chunk main.js imports statically, at any depth, has a modulepreload hint", () => {
    expect(new Set(hinted)).toEqual(closure("main.js"));
  });

  test("no chunk is hinted twice, and every hint names a built chunk", () => {
    expect(hinted.length).toBe(new Set(hinted).size);
    for (const f of hinted) expect(f.startsWith("chunks/")).toBe(true);
  });

  test("on-demand chunks (the reader, the converters run in the worker) get no hint", () => {
    for (const f of hinted) expect(f).not.toMatch(/reader|paginator|fixed-layout|pdfjs|worker/);
  });

  test("the hints sit right before the main.js script tag", () => {
    const tags = html.slice(html.indexOf('<link rel="modulepreload"'), html.indexOf('<script type="module" src="./main.js"></script>'));
    expect(tags.trim().split("\n")).toHaveLength(hinted.length);
  });
});
