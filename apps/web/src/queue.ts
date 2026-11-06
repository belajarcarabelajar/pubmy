import type { Result } from "@pubmy/core";

/** The part of a browser File the queue needs; the queue itself never reads the bytes. */
export interface QueueFile {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type ItemStatus = "waiting" | "converting" | "ready" | "failed";

export interface QueueItem<F extends QueueFile = QueueFile> {
  id: number;
  name: string;
  file: F;
  status: ItemStatus;
  result?: Result;
}

export interface Refusal {
  name: string;
  code: "LIMIT_10" | "TOO_LARGE";
}

export interface QueueOptions<F extends QueueFile> {
  maxFiles: number;
  maxBytes: number;
  convert(file: F, signal: AbortSignal): Promise<Result>;
  onChange(item: QueueItem<F>): void;
}

export interface Queue<F extends QueueFile> {
  /** Live list of rows, in the order they were added. */
  readonly items: QueueItem<F>[];
  add(files: F[]): Refusal[];
  /** Drops a row; a waiting row is never converted, a converting row has its signal aborted. */
  remove(id: number): void;
}

export function createQueue<F extends QueueFile>(o: QueueOptions<F>): Queue<F> {
  const items: QueueItem<F>[] = [];
  let nextId = 1;
  let running: { item: QueueItem<F>; ctrl: AbortController } | null = null;

  const set = (item: QueueItem<F>, status: ItemStatus, result?: Result) => {
    item.status = status;
    if (result) item.result = result;
    o.onChange(item);
  };

  const pump = () => {
    if (running) return;
    const item = items.find((i) => i.status === "waiting");
    if (!item) return;
    const job = { item, ctrl: new AbortController() };
    running = job;
    set(item, "converting");
    Promise.resolve()
      .then(() => o.convert(item.file, job.ctrl.signal))
      .catch((): Result => ({ ok: false, code: "READ_FAILED", message: "read-failed" }))
      .then((result) => {
        // A removed row may settle late; its slot has already moved on.
        if (running !== job) return;
        running = null;
        set(item, result.ok ? "ready" : "failed", result);
        pump();
      });
  };

  return {
    items,
    add(files) {
      const refused: Refusal[] = [];
      for (const file of files) {
        if (file.size > o.maxBytes) refused.push({ name: file.name, code: "TOO_LARGE" });
        else if (items.length >= o.maxFiles) refused.push({ name: file.name, code: "LIMIT_10" });
        else {
          const item: QueueItem<F> = { id: nextId++, name: file.name, file, status: "waiting" };
          items.push(item);
          o.onChange(item);
        }
      }
      pump();
      return refused;
    },
    remove(id) {
      const i = items.findIndex((x) => x.id === id);
      if (i < 0) return;
      items.splice(i, 1);
      if (running?.item.id === id) {
        running.ctrl.abort();
        running = null;
        pump();
      }
    },
  };
}
