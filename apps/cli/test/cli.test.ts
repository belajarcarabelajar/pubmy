import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InputFile, Result } from "@pubmy/core";
import { run, type ConvertFn } from "../src/main.ts";
import { exitCode, formatReport, type Row } from "../src/report.ts";
import { outputPath, walk } from "../src/walk.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pubmy-cli-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const T0 = new Date("2026-01-01T00:00:00Z");
const T1 = new Date("2026-02-01T00:00:00Z");

async function put(rel: string, text = "hello", mtime = T0): Promise<string> {
  const p = join(root, rel);
  await mkdir(join(p, ".."), { recursive: true });
  await writeFile(p, text);
  await utimes(p, mtime, mtime);
  return p;
}

function fakeConvert(): ConvertFn & { calls: string[] } {
  const calls: string[] = [];
  const fn = async (f: InputFile): Promise<Result> => {
    calls.push(f.name);
    if (f.name.endsWith(".bin")) return { ok: false, code: "UNSUPPORTED", message: "no adapter" };
    if (f.name.endsWith(".bad")) return { ok: false, code: "DRM", message: "drm" };
    return { ok: true, epub: new TextEncoder().encode(`epub:${f.name}`), check: { errors: 0, warnings: 0 } };
  };
  return Object.assign(fn, { calls });
}

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (s: string) => void out.push(s), stderr: (s: string) => void err.push(s) },
    out: () => out.join(""),
    err: () => err.join(""),
  };
}

describe("walk", () => {
  test("lists files recursively as sorted relative paths", async () => {
    await put("a.txt");
    await put("sub/b.md");
    await put("sub/deep/c.html");
    expect(await walk(root)).toEqual(["a.txt", "sub/b.md", "sub/deep/c.html"]);
  });

  test("excludes the pubmy-epub output folder", async () => {
    await put("a.txt");
    await put("pubmy-epub/a.txt.epub");
    expect(await walk(root)).toEqual(["a.txt"]);
  });

  test("excludes dotfiles and dot folders", async () => {
    await put("a.txt");
    await put(".hidden.txt");
    await put(".git/config");
    expect(await walk(root)).toEqual(["a.txt"]);
  });

  test("skips a symlinked folder whose real path was already visited", async () => {
    await put("sub/b.md");
    await symlink(root, join(root, "sub", "loop"));
    expect(await walk(root)).toEqual(["sub/b.md"]);
  });
});

describe("outputPath", () => {
  test("mirrors the relative folder and keeps the source extension", () => {
    expect(outputPath("/r", "sub/deep/book.pdf")).toBe("/r/pubmy-epub/sub/deep/book.pdf.epub");
  });

  test("two sources with the same stem map to distinct outputs", () => {
    expect(outputPath("/r", "a.pdf")).not.toBe(outputPath("/r", "a.docx"));
    expect(outputPath("/r", "a.docx")).toBe("/r/pubmy-epub/a.docx.epub");
  });
});

describe("report", () => {
  const rows: Row[] = [
    { rel: "a.txt", status: "converted" },
    { rel: "b.txt", status: "skipped" },
    { rel: "c.bad", status: "failed", code: "DRM" },
    { rel: "d.bin", status: "unsupported" },
  ];

  test("prints one row per file with its status", () => {
    const lines = formatReport(rows).trimEnd().split("\n");
    expect(lines.some((l) => /a\.txt\s+converted$/.test(l))).toBe(true);
    expect(lines.some((l) => /b\.txt\s+skipped$/.test(l))).toBe(true);
    expect(lines.some((l) => /c\.bad\s+failed DRM$/.test(l))).toBe(true);
    expect(lines.some((l) => /d\.bin\s+unsupported$/.test(l))).toBe(true);
  });

  test("exit code is 1 when any row failed", () => {
    expect(exitCode(rows)).toBe(1);
  });

  test("exit code is 0 when only unsupported and skipped rows are present", () => {
    expect(exitCode([{ rel: "d.bin", status: "unsupported" }, { rel: "b", status: "skipped" }])).toBe(0);
  });
});

describe("run", () => {
  test("mirrors a two-level tree into pubmy-epub and exits 0", async () => {
    await put("a.txt");
    await put("sub/b.md");
    const c = capture();
    const code = await run([root], { ...c.io, convert: fakeConvert() });
    expect(code).toBe(0);
    expect(await readFile(join(root, "pubmy-epub/a.txt.epub"), "utf8")).toBe("epub:a.txt");
    expect(await readFile(join(root, "pubmy-epub/sub/b.md.epub"), "utf8")).toBe("epub:b.md");
    expect(c.out()).toMatch(/sub\/b\.md\s+converted/);
  });

  test("a second run converts nothing", async () => {
    await put("a.txt");
    await put("sub/b.md");
    await run([root], { ...capture().io, convert: fakeConvert() });
    const second = fakeConvert();
    const c = capture();
    expect(await run([root], { ...c.io, convert: second })).toBe(0);
    expect(second.calls).toEqual([]);
    expect(c.out()).not.toMatch(/converted/);
  });

  test("a source touched after its output is reconverted", async () => {
    await put("a.txt");
    await run([root], { ...capture().io, convert: fakeConvert() });
    const out = join(root, "pubmy-epub/a.txt.epub");
    await utimes(out, T0, T0);
    await utimes(join(root, "a.txt"), T1, T1);
    const again = fakeConvert();
    await run([root], { ...capture().io, convert: again });
    expect(again.calls).toEqual(["a.txt"]);
  });

  test("--force reconverts up-to-date files", async () => {
    await put("a.txt");
    await run([root], { ...capture().io, convert: fakeConvert() });
    const forced = fakeConvert();
    await run([root, "--force"], { ...capture().io, convert: forced });
    expect(forced.calls).toEqual(["a.txt"]);
  });

  test("exits 1 when any file fails and reports its code", async () => {
    await put("a.txt");
    await put("c.bad");
    const c = capture();
    expect(await run([root], { ...c.io, convert: fakeConvert() })).toBe(1);
    expect(c.out()).toMatch(/c\.bad\s+failed DRM/);
  });

  test("unsupported files do not fail the run and get no output", async () => {
    await put("d.bin");
    const c = capture();
    expect(await run([root], { ...c.io, convert: fakeConvert() })).toBe(0);
    expect(c.out()).toMatch(/d\.bin\s+unsupported/);
    await expect(stat(join(root, "pubmy-epub/d.bin.epub"))).rejects.toThrow();
  });

  test("a.pdf and a.docx both get their own output", async () => {
    await put("a.pdf");
    await put("a.docx");
    await run([root], { ...capture().io, convert: fakeConvert() });
    expect(await readFile(join(root, "pubmy-epub/a.pdf.epub"), "utf8")).toBe("epub:a.pdf");
    expect(await readFile(join(root, "pubmy-epub/a.docx.epub"), "utf8")).toBe("epub:a.docx");
  });

  test("a convert that throws is reported as failed READ_FAILED", async () => {
    await put("a.txt");
    const c = capture();
    const boom: ConvertFn = async () => {
      throw new Error("disk gone");
    };
    expect(await run([root], { ...c.io, convert: boom })).toBe(1);
    expect(c.out()).toMatch(/a\.txt\s+failed READ_FAILED/);
  });

  test("an output that cannot be written is reported as failed WRITE_FAILED", async () => {
    await put("a.txt");
    // A plain file where the output folder should be makes mkdir fail.
    await put("pubmy-epub", "not a folder");
    const c = capture();
    expect(await run([root], { ...c.io, convert: fakeConvert() })).toBe(1);
    expect(c.out()).toMatch(/a\.txt\s+failed WRITE_FAILED/);
  });

  test("without an injected convert the core turns a txt file into a zip-based EPUB", async () => {
    await put("notes.txt", "Chapter one\n\nSome text for the reader.\n");
    const c = capture();
    expect(await run([root], c.io)).toBe(0);
    expect(c.out()).toMatch(/notes\.txt\s+converted/);
    const epub = await readFile(join(root, "pubmy-epub/notes.txt.epub"));
    expect([...epub.subarray(0, 2)]).toEqual([0x50, 0x4b]);
  }, 30_000);

  test("exits 2 without a folder argument", async () => {
    const c = capture();
    expect(await run([], { ...c.io, convert: fakeConvert() })).toBe(2);
    expect(c.err()).toMatch(/usage/i);
  });

  test("exits 2 when the folder is not a directory", async () => {
    const file = await put("a.txt");
    expect(await run([file], { ...capture().io, convert: fakeConvert() })).toBe(2);
  });

  test("exits 2 on an unknown flag", async () => {
    expect(await run([root, "--nope"], { ...capture().io, convert: fakeConvert() })).toBe(2);
  });
});
