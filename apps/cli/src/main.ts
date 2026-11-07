import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, stat } from "node:fs/promises";
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

const USAGE = "usage: pubmy <folder> [--force] [--rtl]\n";

async function coreConvert(): Promise<ConvertFn> {
  // Loaded lazily so tests with an injected convert never pull in the DOM and EPUB stack.
  const core = await import("@pubmy/core");
  const dom = core.domFor("bun");
  return (f) =>
    core.convert(f, {
      dom,
      // The scan code terminates each engine it gets, so every call loads a fresh one.
      loadOcr: async () => (await import("@pubmy/core/ocr")).loadOcrBun(),
      loadRenderer: async () => (await import("@pubmy/core/render-bun")).loadRendererBun(),
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

async function writeOutput(root: string, out: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(out), { recursive: true });
  const [realBase, realDir] = await Promise.all([realpath(join(root, OUT_DIR)), realpath(dirname(out))]);
  if (!isInside(realBase, realDir)) throw new Error(`output escapes ${OUT_DIR}`);
  // O_NOFOLLOW refuses a symlink planted at the target between the check and the write.
  const fh = await open(out, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0));
  try {
    await fh.writeFile(bytes);
  } finally {
    await fh.close();
  }
}

async function convertOne(root: string, rel: string, force: boolean, convert: ConvertFn): Promise<Row> {
  const src = join(root, rel);
  const out = outputPath(root, rel);
  if (!(await outputIsSafe(root, rel))) return { rel, status: "failed", code: "WRITE_FAILED" };
  const outTime = await mtimeMs(out);
  const srcTime = await mtimeMs(src);
  if (!force && outTime !== undefined && srcTime !== undefined && outTime >= srcTime) {
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
    await writeOutput(root, out, result.epub);
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
