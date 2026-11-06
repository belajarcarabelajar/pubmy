import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InputFile, Result } from "@pubmy/core";
import { strFromU8, unzipSync } from "fflate";
import { makeCbz } from "../../../fixtures/make-cbz.ts";
import { run, type ConvertFn } from "../src/main.ts";
import { exitCode, formatReport, type Row } from "../src/report.ts";
import { outputPath, walk } from "../src/walk.ts";

let base: string;
let root: string;
// A sibling of root, so a link into it points outside the converted folder.
let outside: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "pubmy-cli-"));
  root = join(base, "root");
  outside = join(base, "outside");
  await mkdir(root);
  await mkdir(outside);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
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

  test("skips a symlinked folder whose real path is outside the folder", async () => {
    await put("a.txt");
    await writeFile(join(outside, "x.txt"), "secret");
    await symlink(outside, join(root, "ext"));
    expect(await walk(root)).toEqual(["a.txt"]);
  });

  test("skips a symlinked file whose real path is outside the folder", async () => {
    await put("a.txt");
    await writeFile(join(outside, "x.txt"), "secret");
    await symlink(join(outside, "x.txt"), join(root, "link.txt"));
    expect(await walk(root)).toEqual(["a.txt"]);
  });

  test("follows symlinks that stay inside the folder", async () => {
    await put("a.txt");
    await put(".src/x.md");
    await symlink(join(root, ".src"), join(root, "books"));
    await symlink(join(root, "a.txt"), join(root, "b.txt"));
    expect(await walk(root)).toEqual(["a.txt", "b.txt", "books/x.md"]);
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

  test("an OCR row shows its page count and rounded mean confidence", () => {
    const out = formatReport([{ rel: "scan.pdf", status: "converted", notes: { ocr: { pages: 12, meanConfidence: 93.6 } } }]);
    expect(out).toMatch(/scan\.pdf\s+converted \(OCR 12 pages, 94%\)\n/);
  });

  test("an OCR row without a confidence shows only the page count", () => {
    const out = formatReport([{ rel: "scan.pdf", status: "converted", notes: { ocr: { pages: 3, meanConfidence: Number.NaN } } }]);
    expect(out).toMatch(/scan\.pdf\s+converted \(OCR 3 pages\)\n/);
  });

  test("a row with warnings lists each warning", () => {
    const out = formatReport([{ rel: "b.mobi", status: "converted", notes: { warnings: ["kf8-part-failed"] } }]);
    expect(out).toMatch(/b\.mobi\s+converted \(warning: kf8-part-failed\)\n/);
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
    await put("sub/b.md");
    // A plain file where an output subfolder should be makes mkdir fail.
    await put("pubmy-epub/sub", "not a folder");
    const c = capture();
    expect(await run([root], { ...c.io, convert: fakeConvert() })).toBe(1);
    expect(c.out()).toMatch(/sub\/b\.md\s+failed WRITE_FAILED/);
  });

  test("exits 2 when pubmy-epub is a plain file", async () => {
    await put("a.txt");
    await put("pubmy-epub", "not a folder");
    const c = capture();
    const conv = fakeConvert();
    expect(await run([root], { ...c.io, convert: conv })).toBe(2);
    expect(c.err()).toMatch(/pubmy-epub/);
    expect(conv.calls).toEqual([]);
  });

  test("exits 2 when pubmy-epub is a symlink and writes nothing outside", async () => {
    await put("a.txt");
    await symlink(outside, join(root, "pubmy-epub"));
    const c = capture();
    const conv = fakeConvert();
    expect(await run([root], { ...c.io, convert: conv })).toBe(2);
    expect(c.err()).toMatch(/pubmy-epub/);
    expect(conv.calls).toEqual([]);
    expect(await readdir(outside)).toEqual([]);
  });

  test("a pre-existing symlinked output file is refused and its target is unchanged", async () => {
    await put("a.txt");
    const victim = join(outside, "victim.txt");
    await writeFile(victim, "keep");
    await mkdir(join(root, "pubmy-epub"));
    await symlink(victim, join(root, "pubmy-epub/a.txt.epub"));
    const c = capture();
    expect(await run([root], { ...c.io, convert: fakeConvert() })).toBe(1);
    expect(c.out()).toMatch(/a\.txt\s+failed WRITE_FAILED/);
    expect(await readFile(victim, "utf8")).toBe("keep");
    expect((await lstat(join(root, "pubmy-epub/a.txt.epub"))).isSymbolicLink()).toBe(true);
  });

  test("a symlinked output subfolder is refused and nothing is written outside", async () => {
    await put("sub/b.md");
    await mkdir(join(root, "pubmy-epub"));
    await symlink(outside, join(root, "pubmy-epub/sub"));
    const c = capture();
    expect(await run([root, "--force"], { ...c.io, convert: fakeConvert() })).toBe(1);
    expect(c.out()).toMatch(/sub\/b\.md\s+failed WRITE_FAILED/);
    expect(await readdir(outside)).toEqual([]);
  });

  test("a symlinked subfolder pointing outside is not converted", async () => {
    await put("a.txt");
    await writeFile(join(outside, "x.txt"), "secret");
    await symlink(outside, join(root, "ext"));
    const conv = fakeConvert();
    expect(await run([root], { ...capture().io, convert: conv })).toBe(0);
    expect(conv.calls).toEqual(["a.txt"]);
    await expect(stat(join(root, "pubmy-epub/ext"))).rejects.toThrow();
  });

  test("an in-tree symlinked file is still converted", async () => {
    await put("a.txt");
    await symlink(join(root, "a.txt"), join(root, "b.txt"));
    expect(await run([root], { ...capture().io, convert: fakeConvert() })).toBe(0);
    expect(await readFile(join(root, "pubmy-epub/b.txt.epub"), "utf8")).toBe("epub:b.txt");
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

  test("exits 2 on an unknown flag next to --rtl", async () => {
    expect(await run([root, "--rtl", "--nope"], { ...capture().io, convert: fakeConvert() })).toBe(2);
  });

  test("notes from the converter reach the report row", async () => {
    await put("scan.pdf");
    const c = capture();
    const withNotes: ConvertFn = async () => ({
      ok: true,
      epub: new Uint8Array([1]),
      check: { errors: 0, warnings: 0 },
      notes: { ocr: { pages: 2, meanConfidence: 88 } },
    });
    await run([root], { ...c.io, convert: withNotes });
    expect(c.out()).toMatch(/scan\.pdf\s+converted \(OCR 2 pages, 88%\)/);
  });

  async function opfOf(epubPath: string): Promise<string> {
    const files = unzipSync(new Uint8Array(await readFile(epubPath)));
    const opf = Object.keys(files).find((k) => k.endsWith(".opf"));
    if (!opf) throw new Error("no OPF in EPUB");
    return strFromU8(files[opf]!);
  }

  test("--rtl makes a comic read right-to-left", async () => {
    await writeFile(join(root, "comic.cbz"), makeCbz());
    expect(await run([root, "--rtl"], capture().io)).toBe(0);
    expect(await opfOf(join(root, "pubmy-epub/comic.cbz.epub"))).toContain(`page-progression-direction="rtl"`);
  }, 30_000);

  test("without --rtl a comic stays left-to-right, also after an --rtl run", async () => {
    await writeFile(join(root, "comic.cbz"), makeCbz());
    await run([root, "--rtl"], capture().io);
    expect(await run([root, "--force"], capture().io)).toBe(0);
    expect(await opfOf(join(root, "pubmy-epub/comic.cbz.epub"))).not.toContain("rtl");
  }, 30_000);
});
