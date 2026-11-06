import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "..", "scripts", "check-assets.ts");
const made: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pubmy-assets-"));
  made.push(dir);
  return dir;
}

function runCheck(dir: string) {
  const proc = Bun.spawnSync([process.execPath, SCRIPT, dir]);
  return { exitCode: proc.exitCode, output: proc.stdout.toString() + proc.stderr.toString() };
}

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

describe("check-assets", () => {
  test("a 26 MB file fails and its path is printed", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "nested"));
    const big = join(dir, "nested", "big.wasm");
    writeFileSync(big, "");
    // Sparse file: logical size is what Workers counts, and it costs no disk.
    truncateSync(big, 26 * 1024 * 1024);
    const result = runCheck(dir);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain(big);
  });

  test("a directory of small files passes", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "index.html"), "<!doctype html>");
    const edge = join(dir, "edge.bin");
    writeFileSync(edge, "");
    truncateSync(edge, 26_214_400);
    expect(runCheck(dir).exitCode).toBe(0);
  });
});
