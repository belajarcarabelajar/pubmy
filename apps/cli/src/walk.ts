import { readdir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";

export const OUT_DIR = "pubmy-epub";

/** Relative paths of every source file under root, sorted. */
export async function walk(root: string): Promise<string[]> {
  const files: string[] = [];
  const seen = new Set<string>();

  async function visit(dir: string, rel: string): Promise<void> {
    const real = await realpath(dir);
    if (seen.has(real)) return;
    seen.add(real);
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === OUT_DIR) continue;
      const abs = join(dir, e.name);
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      let isDir = e.isDirectory();
      if (e.isSymbolicLink()) {
        // A dangling link stays in the list so the run reports it as READ_FAILED.
        isDir = await stat(abs).then((s) => s.isDirectory(), () => false);
      }
      if (isDir) await visit(abs, childRel);
      else files.push(childRel);
    }
  }

  await visit(root, "");
  return files.sort();
}

/** Always `<name>.<ext>.epub`, so a.pdf and a.docx never collide. */
export function outputPath(root: string, rel: string): string {
  return join(root, OUT_DIR, `${rel}.epub`);
}
