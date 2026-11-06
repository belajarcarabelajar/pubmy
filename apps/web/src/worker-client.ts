import type { Result } from "@pubmy/core";
import type { FromWorker, ToWorker } from "./job.ts";

/** The part of a browser Worker the client uses. */
export interface WorkerLike {
  onmessage: ((e: MessageEvent<FromWorker>) => void) | null;
  onerror: ((e: Event) => void) | null;
  onmessageerror: ((e: MessageEvent) => void) | null;
  postMessage(m: ToWorker, transfer: Transferable[]): void;
  terminate(): void;
}

export interface JobFile {
  name: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface WorkerClientOptions<F extends JobFile> {
  create(): WorkerLike;
  onProgress(file: F, p: number): void;
}

const failed = (message: string): Result => ({ ok: false, code: "READ_FAILED", message });

/**
 * Runs conversions in one worker. A cancel, a crash or an unreadable message terminates it and fails
 * every job it held, so no row waits forever; the next job starts a fresh worker.
 */
export function createWorkerClient<F extends JobFile>(o: WorkerClientOptions<F>): { convert(file: F, signal: AbortSignal): Promise<Result> } {
  let worker: WorkerLike | null = null;
  let seq = 0;
  const pending = new Map<number, { file: F; resolve(r: Result): void }>();

  const recycle = (message: string) => {
    worker?.terminate();
    worker = null;
    for (const [id, job] of pending) {
      pending.delete(id);
      job.resolve(failed(message));
    }
  };

  const getWorker = (): WorkerLike => {
    if (worker) return worker;
    const w = o.create();
    w.onmessage = (e) => {
      const m = e.data;
      const job = pending.get(m.id);
      if (!job) return;
      if (m.type === "progress") return o.onProgress(job.file, m.p);
      pending.delete(m.id);
      job.resolve(m.result);
    };
    // A late event from a worker already replaced must not fail the jobs of its successor.
    w.onerror = () => worker === w && recycle("read-failed");
    w.onmessageerror = () => worker === w && recycle("read-failed");
    return (worker = w);
  };

  const convert = async (file: F, signal: AbortSignal): Promise<Result> => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (signal.aborted) return failed("cancelled");
    const id = ++seq;
    return new Promise<Result>((resolve) => {
      pending.set(id, { file, resolve });
      signal.addEventListener("abort", () => recycle("cancelled"), { once: true });
      try {
        getWorker().postMessage({ type: "convert", id, name: file.name, bytes }, [bytes.buffer]);
      } catch {
        recycle("read-failed");
      }
    });
  };
  return { convert };
}
