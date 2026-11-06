import type { Ctx, Result } from "@pubmy/core";
import { browserLibarchiveLoader } from "./libarchive-loader.ts";
import { ocrPaths } from "./ocr-paths.ts";

export type ToWorker = { type: "convert"; id: number; name: string; bytes: Uint8Array };
export type FromWorker = { type: "progress"; id: number; p: number } | { type: "result"; id: number; result: Result };

type Core = typeof import("@pubmy/core");

export interface JobDeps {
  importCore(): Promise<Core>;
  /** The worker's own URL; same-origin asset URLs resolve against it. */
  base: string;
  post(m: FromWorker, transfer?: Transferable[]): void;
}

const fail = (code: Extract<Result, { ok: false }>["code"], message: string): Result => ({ ok: false, code, message });

/** Handles one convert message; every outcome, including a core that fails to load, posts one result. */
export function createJobRunner(d: JobDeps): (msg: ToWorker) => Promise<void> {
  let core: Promise<Core> | null = null;
  const loadCore = () =>
    (core ??= d
      .importCore()
      .then((c) => {
        c.registerAdapter(c.createComicsAdapter({ loadLibarchive: browserLibarchiveLoader(d.base) }));
        return c;
      })
      .catch((e: unknown) => {
        // A failed chunk load is not cached, so the next file tries again.
        core = null;
        throw e;
      }));

  async function run(id: number, name: string, bytes: Uint8Array): Promise<Result> {
    try {
      const c = await loadCore();
      // unpdf needs the Iterator global; older browsers get a clear refusal for PDFs only.
      if (c.detect(bytes, name).format === "pdf" && !("Iterator" in globalThis)) return fail("UNSUPPORTED", "browser-unsupported");
      const ctx: Ctx = {
        // DOMParser is a Window API and is missing in dedicated workers, so linkedom stands in here.
        dom: c.domFor(typeof DOMParser === "function" ? "browser" : "bun"),
        // A fresh engine per call; the CSP allows only same-origin fetches, so every OCR file comes from dist.
        loadOcr: async () => (await import("@pubmy/core/ocr")).loadOcrBrowser(ocrPaths(d.base)),
        progress: (p) => d.post({ type: "progress", id, p }),
        // Cancelling terminates this worker from the page, so the signal never needs to fire here.
        signal: new AbortController().signal,
      };
      return await c.convert({ name, bytes }, ctx);
    } catch {
      return fail("READ_FAILED", "read-failed");
    }
  }

  return async ({ id, name, bytes }) => {
    const result = await run(id, name, bytes);
    try {
      d.post({ type: "result", id, result }, result.ok ? [result.epub.buffer as ArrayBuffer] : []);
    } catch {
      d.post({ type: "result", id, result: fail("READ_FAILED", "read-failed") });
    }
  };
}
