import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const src = join(import.meta.dir, "../src");

// tesseract.js decides browser or node once, when it is first loaded, so this runs in a fresh process:
// in the shared test process an earlier file may already have loaded it.
describe("loadOcrBun", () => {
  test(
    "loads the worker after a MOBI conversion left the linkedom DOM globals installed",
    async () => {
      const script = [
        `import { installDomGlobals } from ${JSON.stringify(join(src, "dom.ts"))};`,
        `import { loadOcrBun } from ${JSON.stringify(join(src, "ocr/load.ts"))};`,
        "installDomGlobals();",
        "const ocr = await loadOcrBun();",
        "await ocr.terminate();",
        `console.log("ocr-ok", typeof globalThis.document);`,
      ].join("\n");
      const proc = Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" });
      const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      expect({ code, out: out.trim(), err }).toMatchObject({ code: 0, out: "ocr-ok object" });
    },
    120_000,
  );

  // An empty langPath must fail: falling back to the CDN would load the unverified download.
  test(
    "reads language data only from langPath and never fetches or caches it",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "pubmy-ocr-lang-"));
      try {
        await mkdir(join(dir, "lang"));
        await mkdir(join(dir, "cache"));
        const script = [
          `import { loadOcrBun } from ${JSON.stringify(join(src, "ocr/load.ts"))};`,
          `const dir = ${JSON.stringify(dir)};`,
          "try { const ocr = await loadOcrBun({ langPath: dir + '/lang', cachePath: dir + '/cache' }); await ocr.terminate(); console.log('loaded'); }",
          "catch (e) { console.log('failed', e.message); }",
        ].join("\n");
        const proc = Bun.spawn([process.execPath, "-e", script], { cwd: dir, stdout: "pipe", stderr: "pipe" });
        const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
        expect({ code, out: out.trim() }).toEqual({ code: 0, out: "failed ocr-unavailable" });
        expect([...(await readdir(join(dir, "cache"))), ...(await readdir(dir))].filter((n) => n.includes("traineddata"))).toEqual([]);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
