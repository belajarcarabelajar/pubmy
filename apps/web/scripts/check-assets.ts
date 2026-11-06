import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// Workers static assets reject any single file larger than 25 MiB.
export const MAX_ASSET_BYTES = 26_214_400;

export function findOversized(dir: string, limit = MAX_ASSET_BYTES): string[] {
  const oversized: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) oversized.push(...findOversized(path, limit));
    else if (entry.isFile() && statSync(path).size > limit) oversized.push(path);
  }
  return oversized;
}

if (import.meta.main) {
  const dir = resolve(process.argv[2] ?? "dist");
  const oversized = findOversized(dir);
  if (oversized.length > 0) {
    console.error(`Assets over ${MAX_ASSET_BYTES} bytes:`);
    for (const path of oversized) console.error(path);
    process.exit(1);
  }
  console.log(`All assets in ${dir} are at most ${MAX_ASSET_BYTES} bytes.`);
}
