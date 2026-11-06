import { describe, expect, test } from "bun:test";
import type { Result } from "@pubmy/core";
import { createJobRunner, type FromWorker, type ToWorker } from "../src/job.ts";

type Core = typeof import("@pubmy/core");
const BASE = "https://pubmy.test/worker.js";
const OK: Result = { ok: true, epub: new Uint8Array([1]), check: { errors: 0, warnings: 0 } };
const FAILED: Result = { ok: false, code: "READ_FAILED", message: "read-failed" };

function fakeCore(convert: () => Promise<Result> = async () => OK) {
  const registered: unknown[] = [];
  const comicsOpts: { loadLibarchive?: unknown }[] = [];
  const core = {
    detect: () => ({ format: "txt" }),
    domFor: () => ({}),
    convert,
    registerAdapter: (a: unknown) => (registered.push(a), () => {}),
    createComicsAdapter: (o: { loadLibarchive?: unknown }) => (comicsOpts.push(o), { id: "comics" }),
  };
  return { core: core as unknown as Core, registered, comicsOpts };
}

const msg = (id: number): ToWorker => ({ type: "convert", id, name: "a.txt", bytes: new Uint8Array([65]) });

describe("createJobRunner", () => {
  test("a failed core load posts READ_FAILED for that file, and the next file loads the core again", async () => {
    const posted: FromWorker[] = [];
    const { core } = fakeCore();
    let loads = 0;
    const run = createJobRunner({
      base: BASE,
      post: (m) => posted.push(m),
      importCore: async () => {
        if (++loads === 1) throw new Error("chunk failed to load");
        return core;
      },
    });
    await run(msg(1));
    expect(posted).toEqual([{ type: "result", id: 1, result: FAILED }]);
    await run(msg(2));
    expect(posted[1]).toEqual({ type: "result", id: 2, result: OK });
  });

  test("a converter that throws posts READ_FAILED", async () => {
    const posted: FromWorker[] = [];
    const { core } = fakeCore(async () => Promise.reject(new Error("boom")));
    const run = createJobRunner({ base: BASE, post: (m) => posted.push(m), importCore: async () => core });
    await run(msg(3));
    expect(posted).toEqual([{ type: "result", id: 3, result: FAILED }]);
  });

  test("the comics adapter is registered once, with a libarchive loader", async () => {
    const f = fakeCore();
    const run = createJobRunner({ base: BASE, post: () => {}, importCore: async () => f.core });
    await run(msg(1));
    await run(msg(2));
    expect(f.registered).toEqual([{ id: "comics" }]);
    expect(typeof f.comicsOpts[0]?.loadLibarchive).toBe("function");
  });
});
