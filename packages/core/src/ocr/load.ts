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
 * tesseract.js picks browser or node once, when it is first loaded, from `typeof document`. MOBI
 * conversions now scope their linkedom globals (withDomGlobals), but a document left by any other code,
 * or a scan converted while a MOBI conversion runs, would still send it down the browser path, which
 * reads `window.location`; so under Bun the global stays hidden while the module loads.
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

/** Default Bun cache: ~/.cache/pubmy/tesseract (traineddata fetched from the CDN when no langPath is given). */
export async function defaultCachePath(): Promise<string> {
  const { homedir } = await import("node:os");
  return `${homedir()}/.cache/pubmy/tesseract`;
}

/**
 * Bun/Node OCR: one ind+eng worker. Use as `ctx.loadOcr = () => loadOcrBun()`; the caller terminates it.
 * `langPath` is a local folder holding ind.traineddata.gz and eng.traineddata.gz (the skill bundles them).
 */
export async function loadOcrBun(opts: { cachePath?: string; langPath?: string } = {}): Promise<Ocr> {
  if (opts.langPath !== undefined) {
    // tesseract.js 7 never settles createWorker when a language file is missing (it throws inside its message
    // handler), so the files are checked first.
    const { access } = await import("node:fs/promises");
    for (const lang of LANGS.split("+")) {
      await access(`${opts.langPath}/${lang}.traineddata.gz`).catch(() => {
        throw new PubmyError("READ_FAILED", "ocr-unavailable");
      });
    }
    // The cache is read before langPath, so a copy fetched from the CDN by an older version would win;
    // "none" neither reads nor writes it.
    const worker = await start({ langPath: opts.langPath, cacheMethod: "none" }, importForNode);
    return wrap(worker, (png) => Buffer.from(png));
  }
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
