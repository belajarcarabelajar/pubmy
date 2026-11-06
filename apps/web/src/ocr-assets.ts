import { realpathSync } from "node:fs";
import { join } from "node:path";

export interface OcrFile {
  /** Package that ships the file; tesseract.js-core is reached through tesseract.js. */
  pkg: "tesseract.js" | "tesseract.js-core" | "@tesseract.js-data/ind" | "@tesseract.js-data/eng";
  file: string;
  /** Path inside dist. */
  to: string;
}

// The loader runs tesseract with OEM 1 (LSTM only), so only the -lstm cores and best_int data are fetched.
export const OCR_FILES: OcrFile[] = [
  { pkg: "tesseract.js", file: "dist/worker.min.js", to: "tesseract/worker.min.js" },
  ...["relaxedsimd-lstm", "simd-lstm", "lstm"].map((v): OcrFile => ({ pkg: "tesseract.js-core", file: `tesseract-core-${v}.wasm.js`, to: `tesseract/tesseract-core-${v}.wasm.js` })),
  ...(["ind", "eng"] as const).map((l): OcrFile => ({ pkg: `@tesseract.js-data/${l}`, file: `4.0.0_best_int/${l}.traineddata.gz`, to: `tesseract/lang/${l}.traineddata.gz` })),
];

/** Absolute source path. Build-time only (Node fs). */
export function ocrSource(f: OcrFile, webDir: string): string {
  if (f.pkg !== "tesseract.js-core") return join(webDir, "node_modules", f.pkg, f.file);
  // Bun's isolated install links tesseract.js-core next to the real tesseract.js directory, not under apps/web.
  return join(realpathSync(join(webDir, "node_modules", "tesseract.js")), "..", "tesseract.js-core", f.file);
}

export { ocrPaths } from "./ocr-paths.ts";
