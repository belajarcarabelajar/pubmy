import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { InputFile, Result } from "@pubmy/core";
import { exitCode, formatReport, type Row } from "./report.ts";
import { isInside, OUT_DIR, outputPath, walk } from "./walk.ts";

export type ConvertFn = (f: InputFile) => Promise<Result>;

export interface Io {
  stdout(s: string): void;
  stderr(s: string): void;
  now?: () => number;
  /** Replaces the core convert; tests inject a fake here. */
  convert?: ConvertFn;
}

const USAGE = "usage: pubmy <folder> [--force] [--rtl]\n  --force  reconvert every file\n  --rtl    right-to-left comics; reconverts every file, as --force does\n";

/** Wraps a loader so that once it yields null, later calls return null without loading again. */
export function skipAfterNull<T>(load: () => Promise<T | null>): () => Promise<T | null> {
  let unavailable = false;
  return async () => {
    if (unavailable) return null;
    const value = await load();
    if (value === null) unavailable = true;
    return value;
  };
}

declare const __PUBMY_DIR__: string | undefined;

/**
 * The skill bundle (apps/cli/build.ts) defines __PUBMY_DIR__ and ships the language data in tesseract-lang/ beside
 * pubmy.js. Run from source, the name is undeclared, so typeof is "undefined" and tesseract.js uses its CDN.
 */
function bundledLangPath(): string | undefined {
  return typeof __PUBMY_DIR__ === "string" ? join(__PUBMY_DIR__, "tesseract-lang") : undefined;
}

async function coreConvert(): Promise<ConvertFn> {
  // Loaded lazily so tests with an injected convert never pull in the DOM and EPUB stack.
  const core = await import("@pubmy/core");
  const dom = core.domFor("bun");
  // A failed canvas download can take up to its 180 s timeout, so it is tried once per run, not per PDF.
  const loadRenderer = skipAfterNull(async () => (await import("@pubmy/core/render-bun")).loadRendererBun());
  return (f) =>
    core.convert(f, {
      dom,
      // The scan code terminates each engine it gets, so every call loads a fresh one.
      loadOcr: async () => (await import("@pubmy/core/ocr")).loadOcrBun({ langPath: bundledLangPath() }),
      loadRenderer,
      progress: () => {},
      signal: new AbortController().signal,
    });
}

/** Swaps in the right-to-left comics adapter; the returned function puts the default back. */
async function useRtlComics(): Promise<() => void> {
  const { registerAdapter } = await import("@pubmy/core");
  const { createComicsAdapter } = await import("@pubmy/core");
  registerAdapter(createComicsAdapter({ direction: "rtl" }));
  // Same id, so this replaces the rtl adapter in place instead of leaving no comics adapter.
  return () => void registerAdapter(createComicsAdapter());
}

async function mtimeMs(path: string): Promise<number | undefined> {
  return stat(path).then((s) => s.mtimeMs, () => undefined);
}

/** False when pubmy-epub, a folder below it on the way to the output, or the output itself is a symlink. */
async function outputIsSafe(root: string, rel: string): Promise<boolean> {
  let p = join(root, OUT_DIR);
  for (const seg of ["", ...`${rel}.epub`.split("/")]) {
    p = join(p, seg);
    const s = await lstat(p).catch(() => undefined);
    if (s === undefined) return true;
    if (s.isSymbolicLink()) return false;
  }
  return true;
}

/** Writes through a temporary file and a rename, so a failed write never leaves a truncated EPUB that looks fresh. */
async function writeOutput(root: string, out: string, bytes: Uint8Array, srcTime: number | undefined): Promise<void> {
  await mkdir(dirname(out), { recursive: true });
  const [realBase, realDir] = await Promise.all([realpath(join(root, OUT_DIR)), realpath(dirname(out))]);
  if (!isInside(realBase, realDir)) throw new Error(`output escapes ${OUT_DIR}`);
  // The temporary file sits inside pubmy-epub, which walk never lists. O_EXCL and O_NOFOLLOW refuse a file
  // or symlink planted at its name; the rename then replaces the target entry instead of following it.
  const tmp = `${out}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  const fh = await open(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0));
  try {
    try {
      await fh.writeFile(bytes);
      // The source time read before conversion, so a source edited meanwhile still counts as newer next run.
      if (srcTime !== undefined) await fh.utimes(new Date(), new Date(srcTime));
    } finally {
      await fh.close();
    }
    await rename(tmp, out);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

async function convertOne(root: string, rel: string, force: boolean, convert: ConvertFn): Promise<Row> {
  const src = join(root, rel);
  const out = outputPath(root, rel);
  if (!(await outputIsSafe(root, rel))) return { rel, status: "failed", code: "WRITE_FAILED" };
  const outTime = await mtimeMs(out);
  const srcTime = await mtimeMs(src);
  // Whole milliseconds: the output gets the source time through a Date, which drops the sub-millisecond part.
  if (!force && outTime !== undefined && srcTime !== undefined && Math.trunc(outTime) >= Math.trunc(srcTime)) {
    return { rel, status: "skipped" };
  }
  let result: Result;
  try {
    const bytes = new Uint8Array(await readFile(src));
    result = await convert({ name: basename(rel), bytes });
  } catch {
    return { rel, status: "failed", code: "READ_FAILED" };
  }
  if (!result.ok) {
    return result.code === "UNSUPPORTED" ? { rel, status: "unsupported" } : { rel, status: "failed", code: result.code };
  }
  try {
    await writeOutput(root, out, result.epub, srcTime);
  } catch {
    return { rel, status: "failed", code: "WRITE_FAILED" };
  }
  return result.notes ? { rel, status: "converted", notes: result.notes } : { rel, status: "converted" };
}

/** Converts every file under the folder into `<folder>/pubmy-epub/`; resolves to the exit code. */
export async function run(argv: string[], io: Io): Promise<number> {
  const now = io.now ?? Date.now;
  const started = now();
  let force = false;
  let rtl = false;
  const positional: string[] = [];
  for (const a of argv) {
    if (a === "--force") force = true;
    else if (a === "--rtl") rtl = true;
    else if (a.startsWith("-")) {
      io.stderr(`unknown flag: ${a}\n${USAGE}`);
      return 2;
    } else positional.push(a);
  }
  const root = positional[0];
  if (positional.length !== 1 || root === undefined) {
    io.stderr(USAGE);
    return 2;
  }
  const isDir = await stat(root).then((s) => s.isDirectory(), () => false);
  if (!isDir) {
    io.stderr(`not a directory: ${root}\n${USAGE}`);
    return 2;
  }
  const outDir = join(root, OUT_DIR);
  const outNotDir = await lstat(outDir).then((s) => !s.isDirectory(), () => false);
  if (outNotDir) {
    io.stderr(`${outDir} exists but is not a real folder (a symlink or a file); move it away and rerun\n${USAGE}`);
    return 2;
  }

  // An earlier run may have written left-to-right comics that look up to date.
  if (rtl) force = true;
  const convert = io.convert ?? (await coreConvert());
  const restore = rtl ? await useRtlComics() : () => {};
  const rows: Row[] = [];
  try {
    for (const rel of await walk(root)) {
      rows.push(await convertOne(root, rel, force, convert));
    }
  } finally {
    restore();
  }
  io.stdout(formatReport(rows));
  io.stderr(`${rows.length} file(s) in ${Math.round(now() - started)} ms\n`);
  return exitCode(rows);
}

if (import.meta.main) {
  process.exitCode = await run(process.argv.slice(2), {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  });
}
