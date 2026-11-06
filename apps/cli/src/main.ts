import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { InputFile, Result } from "@pubmy/core";
import { exitCode, formatReport, type Row } from "./report.ts";
import { outputPath, walk } from "./walk.ts";

export type ConvertFn = (f: InputFile) => Promise<Result>;

export interface Io {
  stdout(s: string): void;
  stderr(s: string): void;
  now?: () => number;
  /** Replaces the core convert; tests inject a fake here. */
  convert?: ConvertFn;
}

const USAGE = "usage: pubmy <folder> [--force]\n";

async function coreConvert(): Promise<ConvertFn> {
  // Loaded lazily so tests with an injected convert never pull in the DOM and EPUB stack.
  const core = await import("@pubmy/core");
  const dom = core.domFor("bun");
  return (f) =>
    core.convert(f, {
      dom,
      loadOcr: () => Promise.reject(new Error("OCR is not available in the CLI")),
      progress: () => {},
      signal: new AbortController().signal,
    });
}

async function mtimeMs(path: string): Promise<number | undefined> {
  return stat(path).then((s) => s.mtimeMs, () => undefined);
}

async function convertOne(root: string, rel: string, force: boolean, convert: ConvertFn): Promise<Row> {
  const src = join(root, rel);
  const out = outputPath(root, rel);
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
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, result.epub);
  } catch {
    return { rel, status: "failed", code: "WRITE_FAILED" };
  }
  return { rel, status: "converted" };
}

/** Converts every file under the folder into `<folder>/pubmy-epub/`; resolves to the exit code. */
export async function run(argv: string[], io: Io): Promise<number> {
  const now = io.now ?? Date.now;
  const started = now();
  let force = false;
  const positional: string[] = [];
  for (const a of argv) {
    if (a === "--force") force = true;
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

  const convert = io.convert ?? (await coreConvert());
  const rows: Row[] = [];
  for (const rel of await walk(root)) {
    rows.push(await convertOne(root, rel, force, convert));
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
