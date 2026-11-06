import { describe, expect, test } from "bun:test";
import type { Result } from "@pubmy/core";
import type { FromWorker, ToWorker } from "../src/job.ts";
import { createQueue } from "../src/queue.ts";
import { createWorkerClient, type WorkerLike } from "../src/worker-client.ts";

class FakeWorker implements WorkerLike {
  onmessage: ((e: MessageEvent<FromWorker>) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onmessageerror: ((e: MessageEvent) => void) | null = null;
  sent: ToWorker[] = [];
  terminated = false;
  throwOnPost = false;
  postMessage(m: ToWorker) {
    if (this.throwOnPost) throw new DOMException("could not clone", "DataCloneError");
    this.sent.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  reply(result: Result) {
    this.onmessage?.(new MessageEvent("message", { data: { type: "result", id: this.sent.at(-1)!.id, result } }));
  }
}

function setup(init: (w: FakeWorker, n: number) => void = () => {}) {
  const workers: FakeWorker[] = [];
  const client = createWorkerClient({
    create: () => {
      const w = new FakeWorker();
      init(w, workers.length);
      workers.push(w);
      return w;
    },
    onProgress: () => {},
  });
  return { workers, client };
}

const file = (name: string) => ({ name, size: 1, arrayBuffer: async () => new ArrayBuffer(1) });
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};
const OK: Result = { ok: true, epub: new Uint8Array([1]), check: { errors: 0, warnings: 0 } };
const FAILED: Result = { ok: false, code: "READ_FAILED", message: "read-failed" };
const signal = () => new AbortController().signal;

describe("createWorkerClient", () => {
  test("a worker error fails the running file and the next file gets a fresh worker", async () => {
    const { workers, client } = setup();
    const first = client.convert(file("a.txt"), signal());
    await settle();
    workers[0]!.onerror!(new Event("error"));
    expect(await first).toEqual(FAILED);
    expect(workers[0]!.terminated).toBe(true);

    const second = client.convert(file("b.txt"), signal());
    await settle();
    expect(workers.length).toBe(2);
    workers[1]!.reply(OK);
    expect(await second).toBe(OK);
  });

  test("a messageerror fails the running file", async () => {
    const { workers, client } = setup();
    const job = client.convert(file("a.txt"), signal());
    await settle();
    workers[0]!.onmessageerror!(new MessageEvent("messageerror"));
    expect(await job).toEqual(FAILED);
    expect(workers[0]!.terminated).toBe(true);
  });

  test("a postMessage that throws fails the file instead of leaving it pending", async () => {
    const { client } = setup((w) => (w.throwOnPost = true));
    expect(await client.convert(file("a.txt"), signal())).toEqual(FAILED);
  });

  test("after a worker crash the queue marks that file failed and converts the next one", async () => {
    const { workers, client } = setup();
    const q = createQueue({ maxFiles: 10, maxBytes: 1024, convert: client.convert, onChange: () => {} });
    q.add([file("a.txt"), file("b.txt")]);
    await settle();
    workers[0]!.onerror!(new Event("error"));
    await settle();
    expect(q.items.map((i) => i.status)).toEqual(["failed", "converting"]);
    workers[1]!.reply(OK);
    await settle();
    expect(q.items.map((i) => i.status)).toEqual(["failed", "ready"]);
  });
});
