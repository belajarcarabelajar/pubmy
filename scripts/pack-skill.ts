import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { zipSync, type Zippable } from "fflate";

const DEFAULT_SKILL_DIR = join(import.meta.dir, "../skills/pubmy");
// Built from local date parts because fflate writes DOS time from local getters; a UTC
// instant near 1980 would shift below fflate's 1980 floor in western timezones.
const FIXED_MTIME = new Date(2000, 0, 1, 0, 0, 0);

export async function packSkill(outFile = "dist/pubmy-skill.zip", skillDir = DEFAULT_SKILL_DIR): Promise<string[]> {
  const skillMd = join(skillDir, "SKILL.md");
  if (!existsSync(skillMd)) throw new Error(`pack-skill: missing ${skillMd}`);

  const dirents = await readdir(skillDir, { recursive: true, withFileTypes: true });
  const files = dirents
    .filter((d) => d.isFile() && d.name !== ".DS_Store")
    .map((d) => relative(skillDir, join(d.parentPath, d.name)).split(sep).join("/"))
    .sort();

  const tree: Zippable = {};
  for (const rel of files) {
    tree[`pubmy/${rel}`] = [new Uint8Array(await readFile(join(skillDir, rel))), { mtime: FIXED_MTIME }];
  }

  const out = resolve(outFile);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, zipSync(tree, { mtime: FIXED_MTIME }));
  return Object.keys(tree);
}

if (import.meta.main) {
  const out = process.argv[2] ?? "dist/pubmy-skill.zip";
  const entries = await packSkill(out);
  console.log(`${basename(out)}: ${entries.length} entries -> ${resolve(out)}`);
}
