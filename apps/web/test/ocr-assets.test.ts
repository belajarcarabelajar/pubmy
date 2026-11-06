import { describe, expect, test } from "bun:test";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { OCR_FILES, ocrPaths, ocrSource } from "../src/ocr-assets.ts";

const WEB = join(import.meta.dir, "..");
const MAX_ASSET = 25 * 1024 * 1024;
const targets = new Set(OCR_FILES.map((f) => f.to));

describe("ocrPaths", () => {
  const p = ocrPaths("https://pubmy.example/worker.js");

  test("all three paths are absolute and same-origin, as the blob-spawned tesseract worker needs", () => {
    for (const v of [p.workerPath, p.corePath, p.langPath]) expect(new URL(v).origin).toBe("https://pubmy.example");
  });

  test("the worker script is a copied file", () => {
    expect(targets).toContain(new URL(p.workerPath).pathname.slice(1));
  });

  test("every LSTM core variant tesseract.js may pick from corePath is copied", () => {
    // getCore.js with lstmOnly (OEM 1): relaxed SIMD, then SIMD, then plain.
    for (const v of ["relaxedsimd-lstm", "simd-lstm", "lstm"]) {
      expect(targets).toContain(new URL(`${p.corePath.replace(/\/$/, "")}/tesseract-core-${v}.wasm.js`).pathname.slice(1));
    }
  });

  test("ind and eng gzip traineddata sit where langPath points", () => {
    for (const lang of ["ind", "eng"]) expect(targets).toContain(new URL(`${p.langPath}/${lang}.traineddata.gz`).pathname.slice(1));
  });
});

describe("OCR_FILES", () => {
  test("lists the worker, three core variants and two languages", () => {
    expect(OCR_FILES.length).toBe(6);
  });

  test("every source exists under apps/web/node_modules and is under 25 MiB", () => {
    for (const f of OCR_FILES) {
      const src = ocrSource(f, WEB);
      expect(existsSync(src)).toBe(true);
      expect(statSync(src).size).toBeLessThan(MAX_ASSET);
    }
  });

  test("language data is the LSTM best_int set", () => {
    for (const f of OCR_FILES.filter((x) => x.to.endsWith(".traineddata.gz"))) expect(f.file).toContain("4.0.0_best_int/");
  });
});
