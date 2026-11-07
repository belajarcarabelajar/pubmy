import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { unzipSync } from "fflate";

const DEFAULT_PLUGIN_JSON = join(import.meta.dir, "../.claude-plugin/plugin.json");

// plugin.json "version" pins plugin users until it changes, so a tag that disagrees with it
// would publish a release those users never receive.
export function checkVersion(tag: string, pluginJsonPath = DEFAULT_PLUGIN_JSON): string | null {
  const { version } = JSON.parse(readFileSync(pluginJsonPath, "utf8")) as { version?: string };
  if (typeof version !== "string" || version === "") return `release-check: ${pluginJsonPath} has no version; set it before tagging ${tag}`;
  if (tag === `v${version}`) return null;
  return `release-check: tag ${tag} does not match plugin.json version ${version} (expected v${version})`;
}

export async function smokeZip(zipPath: string): Promise<void> {
  const unpacked = await mkdtemp(join(tmpdir(), "pubmy-smoke-zip-"));
  const input = await mkdtemp(join(tmpdir(), "pubmy-smoke-input-"));
  try {
    const entries = unzipSync(new Uint8Array(await readFile(zipPath)));
    for (const [name, data] of Object.entries(entries)) {
      const target = resolve(unpacked, name);
      if (!target.startsWith(unpacked + sep)) throw new Error(`release-check: zip entry escapes the folder: ${name}`);
      if (name.endsWith("/")) continue;
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, data);
    }

    const converter = join(unpacked, "pubmy/scripts/pubmy.js");
    if (!existsSync(converter)) throw new Error(`release-check: ${zipPath} has no pubmy/scripts/pubmy.js`);

    await writeFile(join(input, "note.md"), "# Release smoke test\n\nOne paragraph to convert.\n");
    const proc = Bun.spawn([process.execPath, converter, input], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const output = `${stdout}${stderr}`.trim();
    if (code !== 0) throw new Error(`release-check: converter exited ${code}\n${output}`);
    const epub = join(input, "pubmy-epub/note.md.epub");
    if (!existsSync(epub)) throw new Error(`release-check: converter exited 0 but ${epub} is missing\n${output}`);
  } finally {
    await rm(unpacked, { recursive: true, force: true });
    await rm(input, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const [tag, zip] = process.argv.slice(2);
  if (!tag || !zip) {
    console.error("usage: bun scripts/release-check.ts <tag> <zip>");
    process.exit(1);
  }
  const mismatch = checkVersion(tag);
  if (mismatch) {
    console.error(mismatch);
    process.exit(1);
  }
  console.log(`version: ${tag} matches .claude-plugin/plugin.json`);
  try {
    await smokeZip(zip);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  console.log(`smoke: ${zip} converted note.md to pubmy-epub/note.md.epub`);
}
