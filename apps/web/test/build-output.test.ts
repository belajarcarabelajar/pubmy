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

  test("libarchive.js, its worker and its wasm ship side by side under libarchive/", () => {
    for (const f of ["libarchive.js", "worker-bundle.js", "libarchive.wasm"]) expect(files).toContain(`libarchive/${f}`);
  });

  test("the worker code loads that same-origin copy", () => {
    const js = files.filter((f) => f.endsWith(".js") && !f.startsWith("libarchive/"));
    expect(js.some((f) => readFileSync(join(out, f), "utf8").includes("libarchive/libarchive.js"))).toBe(true);
  });
});
