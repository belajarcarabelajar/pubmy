import { describe, expect, test } from "bun:test";
import type { Result } from "@pubmy/core";
import { createQueue, type QueueFile } from "../src/queue.ts";

const MB = 1024 * 1024;

/** A file whose bytes are never expected to be read by the queue itself. */
function file(name: string, size = 10): QueueFile & { reads: number } {
  const f = {
    name,
    size,
    reads: 0,
    arrayBuffer: async () => {
      f.reads++;
      return new ArrayBuffer(size);
    },
  };
  return f;
}

const OK: Result = { ok: true, epub: new Uint8Array([1]), check: { errors: 0, warnings: 0 } };

/** convert() stub whose calls stay pending until the test settles them. */
function controlledConvert() {
  const calls: { name: string; signal: AbortSignal; settle: (r: Result) => void }[] = [];
  const convert = (f: QueueFile, signal: AbortSignal) =>
    new Promise<Result>((settle) => calls.push({ name: f.name, signal, settle }));
  return { calls, convert };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("createQueue limits", () => {
  test("an 11th file is refused with LIMIT_10", () => {
    const { convert } = controlledConvert();
    const q = createQueue({ maxFiles: 10, maxBytes: 50 * MB, convert, onChange: () => {} });
    const ten = Array.from({ length: 10 }, (_, i) => file(`f${i}.txt`));
    expect(q.add(ten)).toEqual([]);
    expect(q.add([file("eleven.txt")])).toEqual([{ name: "eleven.txt", code: "LIMIT_10" }]);
    expect(q.items.length).toBe(10);
  });

  test("adding to a nearly full queue refuses only the overflow", () => {
    const { convert } = controlledConvert();
    const q = createQueue({ maxFiles: 10, maxBytes: 50 * MB, convert, onChange: () => {} });
    q.add(Array.from({ length: 8 }, (_, i) => file(`a${i}.txt`)));
    const refused = q.add(["b0", "b1", "b2", "b3"].map((n) => file(`${n}.txt`)));
    expect(refused).toEqual([
      { name: "b2.txt", code: "LIMIT_10" },
      { name: "b3.txt", code: "LIMIT_10" },
    ]);
    expect(q.items.map((i) => i.name).slice(8)).toEqual(["b0.txt", "b1.txt"]);
  });

  test("a 51 MB file is refused with TOO_LARGE before its bytes are read", async () => {
    const { calls, convert } = controlledConvert();
    const q = createQueue({ maxFiles: 10, maxBytes: 50 * MB, convert, onChange: () => {} });
    const big = file("big.pdf", 51 * MB);
    expect(q.add([big])).toEqual([{ name: "big.pdf", code: "TOO_LARGE" }]);
    await flush();
    expect(big.reads).toBe(0);
    expect(calls.length).toBe(0);
    expect(q.items.length).toBe(0);
  });

  test("a file of exactly 50 MB is accepted", () => {
    const { convert } = controlledConvert();
    const q = createQueue({ maxFiles: 10, maxBytes: 50 * MB, convert, onChange: () => {} });
    expect(q.add([file("edge.pdf", 50 * MB)])).toEqual([]);
  });
});

describe("createQueue processing", () => {
  test("converts one file at a time, in order", async () => {
    const { calls, convert } = controlledConvert();
    const q = createQueue({ maxFiles: 10, maxBytes: 50 * MB, convert, onChange: () => {} });
    q.add([file("one.txt"), file("two.txt")]);
    await flush();
    expect(calls.map((c) => c.name)).toEqual(["one.txt"]);
    calls[0]!.settle(OK);
    await flush();
    expect(calls.map((c) => c.name)).toEqual(["one.txt", "two.txt"]);
    expect(q.items[0]!.status).toBe("ready");
    expect(q.items[0]!.result).toEqual(OK);
  });

  test("a failed result marks the item failed and the queue moves on", async () => {
    const { calls, convert } = controlledConvert();
    const q = createQueue({ maxFiles: 10, maxBytes: 50 * MB, convert, onChange: () => {} });
    q.add([file("bad.epub"), file("good.txt")]);
    await flush();
    calls[0]!.settle({ ok: false, code: "UNSUPPORTED", message: "already-epub" });
    await flush();
    expect(q.items[0]!.status).toBe("failed");
    expect(calls.length).toBe(2);
  });

  test("onChange reports each status change of an item", async () => {
    const { calls, convert } = controlledConvert();
    const seen: string[] = [];
    const q = createQueue({ maxFiles: 10, maxBytes: 50 * MB, convert, onChange: (it) => seen.push(`${it.name}:${it.status}`) });
    q.add([file("one.txt")]);
    await flush();
    calls[0]!.settle(OK);
    await flush();
    expect(seen).toEqual(["one.txt:waiting", "one.txt:converting", "one.txt:ready"]);
  });
});

describe("createQueue cancel", () => {
  test("removing a waiting row means it is never converted", async () => {
    const { calls, convert } = controlledConvert();
    const q = createQueue({ maxFiles: 10, maxBytes: 50 * MB, convert, onChange: () => {} });
    q.add([file("one.txt"), file("two.txt"), file("three.txt")]);
    await flush();
    q.remove(q.items[1]!.id);
    calls[0]!.settle(OK);
    await flush();
    expect(calls.map((c) => c.name)).toEqual(["one.txt", "three.txt"]);
  });

  test("removing the converting row aborts its signal and starts the next file", async () => {
    const { calls, convert } = controlledConvert();
    const q = createQueue({ maxFiles: 10, maxBytes: 50 * MB, convert, onChange: () => {} });
    q.add([file("one.txt"), file("two.txt")]);
    await flush();
    q.remove(q.items[0]!.id);
    await flush();
    expect(calls[0]!.signal.aborted).toBe(true);
    expect(calls.map((c) => c.name)).toEqual(["one.txt", "two.txt"]);
    expect(q.items.map((i) => i.name)).toEqual(["two.txt"]);
  });

  test("a removed row frees its slot", () => {
    const { convert } = controlledConvert();
    const q = createQueue({ maxFiles: 10, maxBytes: 50 * MB, convert, onChange: () => {} });
    q.add(Array.from({ length: 10 }, (_, i) => file(`f${i}.txt`)));
    q.remove(q.items[9]!.id);
    expect(q.add([file("again.txt")])).toEqual([]);
  });
});
