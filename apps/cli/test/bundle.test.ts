import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeCbz } from "../../../fixtures/make-cbz.ts";
import { makeDocx } from "../../../fixtures/make-docx.ts";
import { makeOdt } from "../../../fixtures/make-odt.ts";
import { makeTwoColumnPdf } from "../../../fixtures/make-pdf.ts";
import { makeRtf } from "../../../fixtures/make-rtf.ts";
import { makeScan } from "../../../fixtures/make-scan.ts";
import { fetchFixtures } from "../../../fixtures/fetch.ts";

const repo = join(import.meta.dir, "../../..");
const skillDir = join(repo, "skills/pubmy");
const FIXTURES = join(repo, "fixtures");
const DL = join(FIXTURES, "out/dl");

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

  beforeAll(async () => {
    const sources = await mkdtemp(join(tmpdir(), "pubmy-gutenberg-"));
    await copyFile(join(FIXTURES, "sources/gutenberg.json"), join(sources, "gutenberg.json"));
    expect(await fetchFixtures(sources, DL)).toBe(0);
    await rm(sources, { recursive: true, force: true });
  }, 120_000);

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

  async function put(root: string, rel: string, bytes: Uint8Array | string): Promise<void> {
    await mkdir(join(root, rel, ".."), { recursive: true });
    await writeFile(join(root, rel), bytes);
  }

  /** One file per supported format group, spread over three folder levels. */
  async function makeFullTree(): Promise<string> {
    const root = join(work, "books");
    await put(root, "notes.md", "# Chapter One\n\nHello from *Markdown*.\n");
    await put(root, "docs/report.docx", makeDocx());
    await put(root, "docs/letter.odt", makeOdt());
    await put(root, "docs/old/memo.rtf", makeRtf());
    await put(root, "pdf/two-column.pdf", await makeTwoColumnPdf());
    await put(root, "pdf/scan.pdf", await makeScan());
    await put(root, "comics/issue.cbz", makeCbz());
    await put(root, "ebooks/pg11.azw3", new Uint8Array(await readFile(join(DL, "pg11-kf8.azw3"))));
    await put(root, "ebooks/pg11.mobi", new Uint8Array(await readFile(join(DL, "pg11-kindle.mobi"))));
    return root;
  }

  const expected = [
    "comics/issue.cbz.epub",
    "docs/letter.odt.epub",
    "docs/old/memo.rtf.epub",
    "docs/report.docx.epub",
    "ebooks/pg11.azw3.epub",
    "ebooks/pg11.mobi.epub",
    "notes.md.epub",
    "pdf/scan.pdf.epub",
    "pdf/two-column.pdf.epub",
  ];

  async function listTree(dir: string, prefix = ""): Promise<string[]> {
    const out: string[] = [];
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const rel = prefix + e.name;
      if (e.isDirectory()) out.push(...(await listTree(join(dir, e.name), `${rel}/`)));
      else out.push(rel);
    }
    return out.sort();
  }

  test(
    "converts one file per format into a mirrored pubmy-epub tree of EPUBs and exits 0",
    async () => {
      const script = await installedScript();
      const root = await makeFullTree();
      const r = await runBundle(script, [root]);
      expect({ code: r.code, out: r.out, err: r.err }).toMatchObject({ code: 0 });
      expect(await listTree(join(root, "pubmy-epub"))).toEqual(expected);
      for (const rel of expected) {
        const bytes = new Uint8Array(await readFile(join(root, "pubmy-epub", rel)));
        expect(new TextDecoder().decode(bytes.subarray(30, 58))).toBe("mimetypeapplication/epub+zip");
      }
      expect(r.out).toMatch(/pdf\/scan\.pdf\s+converted \(OCR \d+ pages/m);
      // OCR read the bundled language data, so nothing was fetched into the cache.
      const cached = await readdir(join(work, "home/.cache/pubmy/tesseract")).catch(() => []);
      expect(cached.filter((n) => n.includes("traineddata"))).toEqual([]);
    },
    300_000,
  );

  test(
    "a rerun converts nothing and leaves the EPUBs untouched",
    async () => {
      const script = await installedScript();
      const root = join(work, "books");
      await put(root, "a.txt", "Chapter One\n\nHello from a plain text file.\n");
      await put(root, "sub/c.html", "<!doctype html><html><head><title>C</title></head><body><h1>Chapter</h1><p>Hello HTML.</p></body></html>");
      expect((await runBundle(script, [root])).code).toBe(0);
      const before = (await stat(join(root, "pubmy-epub/a.txt.epub"))).mtimeMs;
      const r = await runBundle(script, [root]);
      expect(r.code).toBe(0);
      expect(r.out).not.toMatch(/\sconverted/m);
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
