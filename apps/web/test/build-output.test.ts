import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BUILD = join(import.meta.dir, "..", "build.ts");
const out = mkdtempSync(join(tmpdir(), "pubmy-build-"));
afterAll(() => rmSync(out, { recursive: true, force: true }));

// One real build for the whole file, run while the file loads so no test timeout cuts it short.
const proc = Bun.spawnSync([process.execPath, BUILD, out], { stdout: "pipe", stderr: "pipe" });
if (proc.exitCode !== 0) console.error(proc.stderr.toString());
const files = readdirSync(out, { recursive: true, encoding: "utf8" }).filter((f) => statSync(join(out, f)).isFile());

describe("web build output", () => {
  test("the build exits 0 into the given directory", () => {
    expect(proc.exitCode).toBe(0);
    expect(files).toContain("worker.js");
  });

  test("no built file names the Node build of libarchive.js", () => {
    const hits = files.filter((f) => readFileSync(join(out, f)).includes("libarchive-node.mjs"));
    expect(hits).toEqual([]);
  });

  // Markers of the CLI renderer (render/bun.ts): its Skia download and native-library override.
  test("no built file carries the CLI's Skia canvas loader", () => {
    const markers = ["registry.npmjs.org/@napi-rs", "NAPI_RS_NATIVE_LIBRARY_PATH", "render-bun"];
    const hits = files.filter((f) => markers.some((m) => readFileSync(join(out, f)).includes(m)));
    expect(hits).toEqual([]);
  });

  test("libarchive.js, its worker and its wasm ship side by side under libarchive/", () => {
    for (const f of ["libarchive.js", "worker-bundle.js", "libarchive.wasm"]) expect(files).toContain(`libarchive/${f}`);
  });

  test("the worker code loads that same-origin copy", () => {
    const js = files.filter((f) => f.endsWith(".js") && !f.startsWith("libarchive/"));
    expect(js.some((f) => readFileSync(join(out, f), "utf8").includes("libarchive/libarchive.js"))).toBe(true);
  });

  test("the preview reader ships the custom elements of both foliate renderers", () => {
    const js = files.filter((f) => f.endsWith(".js"));
    for (const tag of ["foliate-paginator", "foliate-fxl"]) expect(js.filter((f) => readFileSync(join(out, f), "utf8").includes(tag))).not.toEqual([]);
  });

  test("the reader lives only in chunks loaded on demand, not in the page entry", () => {
    const hits = files.filter((f) => f.endsWith(".js") && readFileSync(join(out, f), "utf8").includes("foliate-paginator"));
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.filter((f) => !f.startsWith("chunks/"))).toEqual([]);
  });

  test("foliate-js ships with its MIT licence", () => {
    expect(files).toContain("licenses/foliate-js.txt");
  });

  // _headers caches chunks/* for a year as immutable, which is only safe when a changed chunk gets a new name.
  test("every chunk name carries a content hash", () => {
    const chunks = files.filter((f) => f.startsWith("chunks/"));
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.filter((f) => !/-[a-z0-9]{8}\.js$/.test(f))).toEqual([]);
  });

  test("the core chunks a first file loads carry none of the DOCX, MOBI, ODT or RTF code", () => {
    const text = (f: string) => readFileSync(join(out, f), "utf8");
    const dynamic = (f: string) => [...text(f).matchAll(/import\("\.\/([^"]+)"\)/g)].map((m) => join(f, "..", m[1]));
    const statics = (f: string) => [...text(f).matchAll(/import(?:[^"'()]*?from)?\s*"\.\/([^"]+)"/g)].map((m) => join(f, "..", m[1]));
    // The worker's dynamic import that holds convert() (its "already-epub" refusal) is the core.
    const core = dynamic("worker.js").find((f) => text(f).includes("already-epub"));
    expect(core).toBeDefined();
    const loaded = new Set<string>();
    const walk = (f: string) => {
      if (loaded.has(f)) return;
      loaded.add(f);
      for (const g of statics(f)) walk(g);
    };
    walk(core!);
    // One marker per format, each found only in that adapter's code: Word XML, MOBI huffman tables, ODT and RTF syntax.
    const markers = ["wordprocessingml", "huffcdic", "text:tracked-changes", "fonttbl"];
    const js = files.filter((f) => f.endsWith(".js"));
    for (const m of markers) {
      expect(js.filter((f) => text(f).includes(m))).not.toEqual([]);
      expect([...loaded].filter((f) => text(f).includes(m))).toEqual([]);
    }
  });

  // The page's text used to arrive with main.js, which moved the drop zone down once it did (CLS 0.046).
  test("the page ships with its Indonesian text already in place", () => {
    const html = readFileSync(join(out, "index.html"), "utf8");
    const empty = [...html.matchAll(/<(\w+)[^>]*\sdata-i18n="([^"]+)"[^>]*><\/\1>/g)].map((m) => m[2]);
    expect(empty).toEqual([]);
    expect(html).toContain("Semua diproses di browser kamu. Tidak ada file yang diunggah.");
  });
});
