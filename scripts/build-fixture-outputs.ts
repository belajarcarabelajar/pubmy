// Builds every fixture and converts it to EPUB for the Java EPUBCheck cross-check (T13).
// 1. bun fixtures/fetch.ts                        -> fixtures/out/dl/
// 2. bun fixtures/make-<kind>.ts fixtures/out/gen -> fixtures/out/gen/ (each maker names its own files)
// 3. core convert() over fixtures/out/{gen,dl}/*  -> fixtures/out/epub/<name>.<ext>.epub
// Prints one line per file with its Result code. Exit 1 when a step fails, a fixture fails to
// convert, or a fixture listed in EXPECTED_FAILURE does anything but fail with its listed code.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { convert, domFor } from "@pubmy/core";
import type { Ctx, FailureCode } from "@pubmy/core";
import { loadOcrBun } from "@pubmy/core/ocr";

const root = resolve(import.meta.dir, "..");
const out = join(root, "fixtures/out");

/**
 * Fixtures that are not books, so no EPUB is the correct outcome. Each must fail with exactly
 * this code; converting, or failing with another code, fails the run.
 */
const EXPECTED_FAILURE: Record<string, FailureCode> = {
  // libarchive's RAR test archives (fixtures/sources/libarchive-rar.json) hold no images.
  "rar4.cbr": "UNSUPPORTED",
  "rar5.cbr": "UNSUPPORTED",
  // Deliberate password-protected inputs from make-docx.ts and make-pdf.ts. Their adapters refuse
  // them as READ_FAILED encrypted-office / encrypted-pdf (docx.test.ts, pdf.test.ts); DRM is for e-book DRM.
  "encrypted.docx": "READ_FAILED",
  "encrypted.pdf": "READ_FAILED",
};

function run(cmd: string[]): number {
  console.log(`$ ${cmd.join(" ")}`);
  return Bun.spawnSync(cmd, { cwd: root, stdout: "inherit", stderr: "inherit" }).exitCode;
}

const ctx: Ctx = {
  dom: domFor("bun"),
  // A fresh engine per call; the adapter that asked for it terminates it.
  loadOcr: () => loadOcrBun(),
  progress: () => {},
  signal: new AbortController().signal,
};

const listFiles = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => !f.startsWith(".") && statSync(join(dir, f)).isFile())
        .sort()
        .map((f) => join(dir, f))
    : [];

async function main(): Promise<number> {
  let failed = 0;
  const gen = join(out, "gen");
  const epubDir = join(out, "epub");
  // Stale generated files and EPUBs would be converted or cross-checked as if current.
  for (const f of listFiles(gen)) rmSync(f);
  for (const f of listFiles(epubDir)) if (f.endsWith(".epub")) rmSync(f);
  mkdirSync(gen, { recursive: true });
  mkdirSync(epubDir, { recursive: true });

  if (run(["bun", "fixtures/fetch.ts"]) !== 0) {
    console.error("FAIL fixtures/fetch.ts");
    failed++;
  }
  const makers = readdirSync(join(root, "fixtures"))
    .filter((f) => /^make-[a-z0-9-]+\.ts$/.test(f))
    .sort();
  for (const maker of makers) {
    if (run(["bun", join("fixtures", maker), gen]) !== 0) {
      console.error(`FAIL fixtures/${maker}`);
      failed++;
    }
  }

  const inputs = [...listFiles(gen), ...listFiles(join(out, "dl"))];
  if (inputs.length === 0) {
    console.error("FAIL no fixtures under fixtures/out/{gen,dl}");
    return 1;
  }
  const seen = new Set<string>();
  let okCount = 0;
  let expected = 0;
  for (const path of inputs) {
    const name = path.slice(path.lastIndexOf("/") + 1);
    const rel = path.slice(out.length + 1);
    if (seen.has(name)) {
      console.log(`FAIL ${rel}: DUPLICATE_NAME (another fixture is also called ${name})`);
      failed++;
      continue;
    }
    seen.add(name);
    const want = EXPECTED_FAILURE[name];
    const result = await convert({ name, bytes: new Uint8Array(readFileSync(path)) }, ctx);
    if (result.ok && !want) {
      await Bun.write(join(epubDir, `${name}.epub`), result.epub);
      console.log(`OK   ${rel} -> epub/${name}.epub (warnings=${result.check.warnings})`);
      okCount++;
    } else if (!result.ok && want === result.code) {
      console.log(`OK   ${rel}: ${result.code} ${result.message} (expected, not a book)`);
      expected++;
    } else if (result.ok) {
      console.log(`FAIL ${rel}: converted, but ${want} was expected`);
      failed++;
    } else {
      console.log(`FAIL ${rel}: ${result.code} ${result.message}${want ? ` (expected ${want})` : ""}`);
      failed++;
    }
  }
  console.log(`${okCount} converted, ${expected} expected failures, ${failed} failure(s), ${inputs.length} fixtures`);
  return failed > 0 ? 1 : 0;
}

process.exit(await main());
