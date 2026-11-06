import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = join(import.meta.dir, "../../..");
const skillDir = join(repo, "skills/pubmy");

describe("readme", () => {
  test("lists the three skill install dirs", async () => {
    const readme = await readFile(join(repo, "README.md"), "utf8");
    for (const dir of ["~/.claude/skills", "~/.agents/skills", "~/.gemini/config/skills"]) {
      expect(readme).toContain(dir);
    }
  });

  test("names the five harnesses", async () => {
    const readme = await readFile(join(repo, "README.md"), "utf8");
    for (const name of ["Claude Code", "Codex", "Cursor", "OpenCode", "Antigravity"]) {
      expect(readme).toContain(name);
    }
  });

  test("README and SKILL.md contain no em dash", async () => {
    const readme = await readFile(join(repo, "README.md"), "utf8");
    const skill = await readFile(join(skillDir, "SKILL.md"), "utf8");
    expect(readme.includes("—")).toBe(false);
    expect(skill.includes("—")).toBe(false);
  });

  test("SKILL.md frontmatter names the skill pubmy", async () => {
    const skill = await readFile(join(skillDir, "SKILL.md"), "utf8");
    const front = skill.match(/^---\n([\s\S]*?)\n---\n/);
    expect(front).not.toBeNull();
    expect(front![1]).toMatch(/^name: pubmy$/m);
    const desc = front![1].match(/^description: (.+)$/m);
    expect(desc).not.toBeNull();
    expect(desc![1].length).toBeLessThanOrEqual(320);
  });
});

describe("bundle", () => {
  let work: string;

  beforeEach(async () => {
    work = await mkdtemp(join(tmpdir(), "pubmy-bundle-"));
  });

  afterEach(async () => {
    await rm(work, { recursive: true, force: true });
  });

  // The skill folder is copied out of the repo so that no node_modules above it can satisfy an import.
  async function installedScript(): Promise<string> {
    const dest = join(work, "skills/pubmy");
    await cp(skillDir, dest, { recursive: true });
    return join(dest, "scripts/pubmy.js");
  }

  async function runBundle(script: string, args: string[]): Promise<{ code: number; out: string; err: string }> {
    const home = join(work, "home");
    await mkdir(home, { recursive: true });
    const proc = Bun.spawn([process.execPath, script, ...args], {
      cwd: work,
      env: { ...process.env, HOME: home, USERPROFILE: home },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { code, out, err };
  }

  async function makeTree(): Promise<string> {
    const root = join(work, "books");
    await mkdir(join(root, "sub"), { recursive: true });
    await writeFile(join(root, "a.txt"), "Chapter One\n\nHello from a plain text file.\n");
    await writeFile(join(root, "sub/b.md"), "# Chapter One\n\nHello from *Markdown*.\n");
    await writeFile(join(root, "sub/c.html"), "<!doctype html><html><head><title>C</title></head><body><h1>Chapter</h1><p>Hello HTML.</p></body></html>");
    return root;
  }

  const expected = ["a.txt.epub", "sub/b.md.epub", "sub/c.html.epub"];

  test(
    "converts a temp tree into a mirrored pubmy-epub folder and exits 0",
    async () => {
      const script = await installedScript();
      const root = await makeTree();
      const r = await runBundle(script, [root]);
      expect(r.code).toBe(0);
      for (const rel of expected) {
        const bytes = new Uint8Array(await readFile(join(root, "pubmy-epub", rel)));
        expect(new TextDecoder().decode(bytes.subarray(0, 2))).toBe("PK");
        expect(new TextDecoder().decode(bytes.subarray(30, 58))).toBe("mimetypeapplication/epub+zip");
      }
      expect((await readdir(join(root, "pubmy-epub/sub"))).sort()).toEqual(["b.md.epub", "c.html.epub"]);
    },
    300_000,
  );

  test(
    "a rerun converts nothing and leaves the EPUBs untouched",
    async () => {
      const script = await installedScript();
      const root = await makeTree();
      expect((await runBundle(script, [root])).code).toBe(0);
      const before = (await stat(join(root, "pubmy-epub/a.txt.epub"))).mtimeMs;
      const r = await runBundle(script, [root]);
      expect(r.code).toBe(0);
      expect(r.out).not.toMatch(/\sconverted$/m);
      expect(r.out).toMatch(/a\.txt\s+skipped$/m);
      expect((await stat(join(root, "pubmy-epub/a.txt.epub"))).mtimeMs).toBe(before);
    },
    300_000,
  );

  test("exits 2 with a usage message when no folder is given", async () => {
    const script = await installedScript();
    const r = await runBundle(script, []);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/usage/i);
  });
});
