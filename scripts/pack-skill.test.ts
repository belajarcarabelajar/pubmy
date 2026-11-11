import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { unzipSync } from "fflate";
import { packSkill } from "./pack-skill.ts";

const temps: string[] = [];
async function temp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `pubmy-pack-${prefix}-`));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("packSkill", () => {
  test("every entry sits under pubmy/ and the zip holds SKILL.md and the CLI bundle", async () => {
    const out = join(await temp("out"), "nested/dir/pubmy-skill.zip");
    const entries = await packSkill(out);
    expect(entries).toContain("pubmy/SKILL.md");
    expect(entries).toContain("pubmy/scripts/pubmy.js");
    for (const name of entries) expect(name.startsWith("pubmy/")).toBe(true);
    const zipped = Object.keys(unzipSync(new Uint8Array(await readFile(out)))).sort();
    expect(zipped).toEqual([...entries].sort());
  }, 120_000);

  // Pinned from @tesseract.js-data/{ind,eng}@1.0.0 4.0.0_best_int (bun.lock sha512 integrity). A changed
  // file fails here, so new language data is a reviewed change, never a silent swap.
  test("the zip carries ind and eng OCR language data with pinned sha256", async () => {
    const out = join(await temp("out"), "pubmy-skill.zip");
    await packSkill(out);
    const zip = unzipSync(new Uint8Array(await readFile(out)));
    const sha = (name: string) => {
      const data = zip[name];
      return data === undefined ? "missing" : new Bun.CryptoHasher("sha256").update(data).digest("hex");
    };
    expect({ ind: sha("pubmy/scripts/tesseract-lang/ind.traineddata.gz"), eng: sha("pubmy/scripts/tesseract-lang/eng.traineddata.gz") }).toEqual({
      ind: "a8896d2f584a5baae73d658b86b765acc7b15b7ba05e014f62b1a2a23b699a91",
      eng: "45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91",
    });
  }, 120_000);

  test("two packs of the same tree are byte-identical", async () => {
    const dir = await temp("det");
    const a = join(dir, "a.zip");
    const b = join(dir, "b.zip");
    await packSkill(a);
    await packSkill(b);
    expect(Buffer.compare(await readFile(a), await readFile(b))).toBe(0);
  }, 120_000);

  test("skips .DS_Store files", async () => {
    const src = await temp("src");
    await mkdir(join(src, "scripts"), { recursive: true });
    await writeFile(join(src, "SKILL.md"), "# skill\n");
    await writeFile(join(src, ".DS_Store"), "junk");
    await writeFile(join(src, "scripts/.DS_Store"), "junk");
    await writeFile(join(src, "scripts/run.js"), "console.log(1);\n");
    const entries = await packSkill(join(await temp("out"), "x.zip"), src);
    expect([...entries].sort()).toEqual(["pubmy/SKILL.md", "pubmy/scripts/run.js"]);
  });

  test("throws naming the SKILL.md path when it is missing", async () => {
    const src = await temp("empty");
    const out = join(await temp("out"), "x.zip");
    await expect(packSkill(out, src)).rejects.toThrow(join(src, "SKILL.md"));
  });

  test("the unzipped skill converts a Markdown file to EPUB", async () => {
    const out = join(await temp("out"), "pubmy-skill.zip");
    await packSkill(out);
    const unpacked = await temp("unzip");
    for (const [name, data] of Object.entries(unzipSync(new Uint8Array(await readFile(out))))) {
      if (name.endsWith("/")) continue;
      await mkdir(dirname(join(unpacked, name)), { recursive: true });
      await writeFile(join(unpacked, name), data);
    }
    const input = await temp("in");
    await writeFile(join(input, "note.md"), "# Hello\n\nA short note.\n");
    const proc = Bun.spawnSync(["bun", join(unpacked, "pubmy/scripts/pubmy.js"), input], { stdout: "pipe", stderr: "pipe" });
    expect(proc.exitCode, proc.stderr.toString()).toBe(0);
    // README "CLI usage": <folder>/book.ext becomes <folder>/pubmy-epub/book.ext.epub
    const epub = await stat(join(input, "pubmy-epub/note.md.epub"));
    expect(epub.size).toBeGreaterThan(0);
  }, 120_000);
});
