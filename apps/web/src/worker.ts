import type { Ctx, Result } from "@pubmy/core";

export type ToWorker = { type: "convert"; id: number; name: string; bytes: Uint8Array };
export type FromWorker = { type: "progress"; id: number; p: number } | { type: "result"; id: number; result: Result };

interface WorkerScope {
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
  postMessage(m: FromWorker, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

// The core and its adapters load on the first file, as a separate chunk, so the page itself stays small.
let core: Promise<typeof import("@pubmy/core")> | null = null;
const loadCore = () => (core ??= import("@pubmy/core"));

const fail = (code: Extract<Result, { ok: false }>["code"], message: string): Result => ({ ok: false, code, message });

async function run(id: number, name: string, bytes: Uint8Array): Promise<Result> {
  const c = await loadCore();
  // unpdf needs the Iterator global; older browsers get a clear refusal for PDFs only.
  if (c.detect(bytes, name).format === "pdf" && !("Iterator" in globalThis)) return fail("UNSUPPORTED", "browser-unsupported");
  const ctx: Ctx = {
    // DOMParser is a Window API and is missing in dedicated workers, so linkedom stands in here.
    dom: c.domFor(typeof DOMParser === "function" ? "browser" : "bun"),
    loadOcr: () => Promise.reject(new Error("ocr-unavailable")),
    progress: (p) => scope.postMessage({ type: "progress", id, p }),
    // Cancelling terminates this worker from the page, so the signal never needs to fire here.
    signal: new AbortController().signal,
  };
  try {
    return await c.convert({ name, bytes }, ctx);
  } catch {
    return fail("READ_FAILED", "read-failed");
  }
}

scope.onmessage = async (e) => {
  const { id, name, bytes } = e.data;
  const result = await run(id, name, bytes);
  scope.postMessage({ type: "result", id, result }, result.ok ? [result.epub.buffer as ArrayBuffer] : []);
};
