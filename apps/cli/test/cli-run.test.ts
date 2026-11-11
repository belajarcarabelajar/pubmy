import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InputFile, Result } from "@pubmy/core";
import * as main from "../src/main.ts";
import { run, type ConvertFn } from "../src/main.ts";

// Read through the namespace so a missing export fails its own tests, not the whole file.
const skipAfterNull = <T>(load: () => Promise<T | null>) => main.skipAfterNull(load);

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pubmy-cli-run-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const T0 = new Date("2026-01-01T00:00:00Z");

async function put(rel: string, text = "hello"): Promise<string> {
  const p = join(root, rel);
  await mkdir(join(p, ".."), { recursive: true });
  await writeFile(p, text);
  await utimes(p, T0, T0);
  return p;
}

function fakeConvert(): ConvertFn & { calls: string[] } {
  const calls: string[] = [];
  const fn = async (f: InputFile): Promise<Result> => {
    calls.push(f.name);
    return { ok: true, epub: new TextEncoder().encode(`epub:${f.name}`), check: { errors: 0, warnings: 0 } };
  };
  return Object.assign(fn, { calls });
}

const quiet = { stdout: () => {}, stderr: () => {} };

describe("run writes each EPUB atomically", () => {
  test("a failed write keeps the old EPUB whole and leaves no temporary file", async () => {
    await put("a.txt");
    await run([root], { ...quiet, convert: fakeConvert() });
    const out: string[] = [];
    // Not a byte array, so the write itself throws after the output file was opened.
    const broken: ConvertFn = async () => ({ ok: true, epub: {} as Uint8Array, check: { errors: 0, warnings: 0 } });
    const code = await run([root, "--force"], { stdout: (s) => void out.push(s), stderr: () => {}, convert: broken });
    expect(code).toBe(1);
    expect(out.join("")).toMatch(/a\.txt\s+failed WRITE_FAILED/);
    expect(await readFile(join(root, "pubmy-epub/a.txt.epub"), "utf8")).toBe("epub:a.txt");
    expect(await readdir(join(root, "pubmy-epub"))).toEqual(["a.txt.epub"]);
  });

  test("a successful write leaves only the EPUB in the output folder", async () => {
    await put("a.txt");
    expect(await run([root], { ...quiet, convert: fakeConvert() })).toBe(0);
    expect(await readdir(join(root, "pubmy-epub"))).toEqual(["a.txt.epub"]);
    expect(await readFile(join(root, "pubmy-epub/a.txt.epub"), "utf8")).toBe("epub:a.txt");
  });
});

describe("run keeps freshness honest", () => {
  test("a source edited during its conversion is converted again on the next run", async () => {
    const src = await put("a.txt");
    const touching: ConvertFn = async (f) => {
      const now = new Date();
      await utimes(src, now, now);
      return { ok: true, epub: new TextEncoder().encode(`epub:${f.name}`), check: { errors: 0, warnings: 0 } };
    };
    await run([root], { ...quiet, convert: touching });
    const again = fakeConvert();
    await run([root], { ...quiet, convert: again });
    expect(again.calls).toEqual(["a.txt"]);
  });

  test("the EPUB carries the source modification time", async () => {
    await put("a.txt");
    await run([root], { ...quiet, convert: fakeConvert() });
    expect((await stat(join(root, "pubmy-epub/a.txt.epub"))).mtimeMs).toBe(T0.getTime());
  });

  test("an unchanged source is still skipped after a run", async () => {
    await put("a.txt");
    await run([root], { ...quiet, convert: fakeConvert() });
    const again = fakeConvert();
    await run([root], { ...quiet, convert: again });
    expect(again.calls).toEqual([]);
  });

  test("--rtl reconverts a comic whose EPUB is already up to date", async () => {
    await put("comic.cbz");
    await run([root], { ...quiet, convert: fakeConvert() });
    const rtl = fakeConvert();
    await run([root, "--rtl"], { ...quiet, convert: rtl });
    expect(rtl.calls).toEqual(["comic.cbz"]);
  });
});

describe("skipAfterNull for the canvas renderer", () => {
  test("after one null load the loader is not called again", async () => {
    let calls = 0;
    const load = skipAfterNull(async () => {
      calls++;
      return null;
    });
    expect(await load()).toBeNull();
    expect(await load()).toBeNull();
    expect(calls).toBe(1);
  });

  test("a loader that returns a renderer is called each time", async () => {
    let calls = 0;
    const load = skipAfterNull(async () => ++calls);
    expect(await load()).toBe(1);
    expect(await load()).toBe(2);
  });
});
