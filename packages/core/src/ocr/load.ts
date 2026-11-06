import { PubmyError } from "../errors.ts";
import type { Ocr } from "../types.ts";

const LANGS = "ind+eng";

type Worker = Awaited<ReturnType<typeof import("tesseract.js").createWorker>>;
type ImageInput = Parameters<Worker["recognize"]>[0];

function wrap(worker: Worker, toInput: (png: Uint8Array) => ImageInput): Ocr {
  return {
    recognize: async (image, signal) => {
      signal?.throwIfAborted();
      const { data } = await worker.recognize(toInput(image));
      signal?.throwIfAborted();
      return { text: data.text, confidence: data.confidence };
    },
    terminate: async () => {
      await worker.terminate();
    },
  };
}

type Tesseract = typeof import("tesseract.js");

/**
 * tesseract.js picks browser or node once, when it is first loaded, from `typeof document`. The linkedom
 * document that installDomGlobals leaves for mobi.js would send it down the browser path, which reads
 * `window.location`, so under Bun the global is hidden while the module loads.
 */
async function importForNode(): Promise<Tesseract> {
  const g = globalThis as { document?: unknown };
  const doc = g.document;
  if (doc === undefined) return import("tesseract.js");
  delete g.document;
  try {
    return await import("tesseract.js");
  } finally {
    g.document = doc;
  }
}

async function start(options: Record<string, string>, load: () => Promise<Tesseract> = () => import("tesseract.js")): Promise<Worker> {
  try {
    const { createWorker } = await load();
    return await createWorker(LANGS, 1, options);
  } catch {
    throw new PubmyError("READ_FAILED", "ocr-unavailable");
  }
}

/** Default Bun cache: ~/.cache/pubmy/tesseract (traineddata, about 7 MB, fetched once). */
export async function defaultCachePath(): Promise<string> {
  const { homedir } = await import("node:os");
  return `${homedir()}/.cache/pubmy/tesseract`;
}

/** Bun/Node OCR: one ind+eng worker. Use as `ctx.loadOcr = () => loadOcrBun()`; the caller terminates it. */
export async function loadOcrBun(opts: { cachePath?: string } = {}): Promise<Ocr> {
  const cachePath = opts.cachePath ?? (await defaultCachePath());
  // tesseract.js silently re-downloads the language data when this folder is missing (spike P3).
  const { mkdir } = await import("node:fs/promises");
  await mkdir(cachePath, { recursive: true });
  const worker = await start({ cachePath }, importForNode);
  return wrap(worker, (png) => Buffer.from(png));
}

/** Browser OCR: worker script, wasm core and language data all served from the same origin. */
export async function loadOcrBrowser(opts: { workerPath: string; corePath: string; langPath: string }): Promise<Ocr> {
  const worker = await start({ workerPath: opts.workerPath, corePath: opts.corePath, langPath: opts.langPath });
  return wrap(worker, (png) => new Blob([new Uint8Array(png)], { type: "image/png" }));
}
