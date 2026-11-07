// Runs the README's own install and uninstall blocks in a throwaway home folder, so the README cannot drift from what works.
// bash blocks on Linux and macOS, PowerShell blocks on Windows. CI runs this file on all three (.github/workflows/install-check.yml).
// Run: bun test scripts/readme-install.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packSkill } from "./pack-skill.ts";

const repo = join(import.meta.dir, "..");
const RELEASE_ZIP_URL = "https://github.com/belajarcarabelajar/pubmy/releases/latest/download/pubmy-skill.zip";
const windows = process.platform === "win32";
const lang = windows ? "powershell" : "bash";
// Home folders each harness reads (README "Install the skill" table).
const HARNESS_DIRS = [".claude/skills", ".agents/skills", ".gemini/config/skills"];

/** Returns the body of every fenced block in `lang` between `heading` and the next heading of the same or higher level. */
export function blocksUnder(markdown: string, heading: string, language: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start < 0) return [];
  const level = heading.match(/^#+/)![0].length;
  const blocks: string[] = [];
  // Every fence is tracked, whatever its language, so a `# comment` inside a code block is never read as a heading.
  let inFence = false;
  let current: string[] | null = null;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("```")) {
      if (inFence) {
        if (current) blocks.push(current.join("\n"));
        current = null;
      } else if (line.trim() === "```" + language) current = [];
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      current?.push(line);
      continue;
    }
    const h = line.match(/^(#+) /);
    if (h && h[1].length <= level) break;
  }
  return blocks;
}

function runBlock(script: string, home: string) {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const cmd = windows ? ["pwsh", "-NoProfile", "-NonInteractive", "-Command", script] : ["bash", "-e", "-c", script];
  const r = Bun.spawnSync(cmd, { cwd: repo, env, stdin: "ignore" });
  return { code: r.exitCode, out: `${r.stdout}${r.stderr}` };
}

/** The copy blocks under "From a clone"; the first bash block there is `git clone`, which the test does not run. */
const installBlocks = (md: string) => blocksUnder(md, "### From a clone", lang).filter((b) => !b.includes("git clone"));

let readme = "";
let home = "";

beforeAll(async () => {
  readme = await readFile(join(repo, "README.md"), "utf8");
  home = await mkdtemp(join(tmpdir(), "pubmy-home-"));
});

afterAll(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("readme block extraction", () => {
  test("a `# comment` line inside another language's block does not end the section", () => {
    const md = ["### Install", "```bash", "# Claude Code", "cp a b", "```", "```powershell", "# Claude Code", "Copy-Item a b", "```", "### Next", "```powershell", "no", "```"].join("\n");
    expect(blocksUnder(md, "### Install", "powershell")).toEqual(["# Claude Code\nCopy-Item a b"]);
  });

  test("README has bash and PowerShell copy and remove blocks, whatever system runs the test", () => {
    for (const language of ["bash", "powershell"]) {
      expect(blocksUnder(readme, "### From a clone", language).filter((b) => !b.includes("git clone")).length, language).toBe(1);
      expect(blocksUnder(readme, "### Remove a copied skill", language).length, language).toBe(1);
    }
  });
});

describe("readme install blocks", () => {
  test("README has an install block and an uninstall block for this system", () => {
    expect(installBlocks(readme).length).toBeGreaterThan(0);
    expect(blocksUnder(readme, "### Remove a copied skill", lang).length).toBeGreaterThan(0);
  });

  test("README documents the one-command installs and the skill ZIP", () => {
    expect(readme).toContain("npx skills add belajarcarabelajar/pubmy");
    expect(readme).toContain("/plugin install pubmy --marketplace belajarcarabelajar/pubmy");
    expect(readme).toContain("claude plugin install pubmy@pubmy");
    expect(readme).toContain("https://github.com/belajarcarabelajar/pubmy/releases/latest/download/pubmy-skill.zip");
    expect(readme).toContain("npx skills remove pubmy");
    expect(readme).toContain("claude plugin uninstall pubmy@pubmy");
    expect(readme).toContain("## Developer setup");
  });

  test(
    "install block puts the skill in every harness folder and the installed copy converts a file",
    async () => {
      const [install] = installBlocks(readme);
      const r = runBlock(install!, home);
      expect(r.code, r.out).toBe(0);
      for (const dir of HARNESS_DIRS) expect(existsSync(join(home, dir, "pubmy/SKILL.md")), dir).toBe(true);

      const input = join(home, "books");
      await mkdir(input, { recursive: true });
      await writeFile(join(input, "note.md"), "# Hello\n\nA short note.\n");
      const conv = Bun.spawnSync(["bun", join(home, ".claude/skills/pubmy/scripts/pubmy.js"), input], { stdin: "ignore" });
      expect(conv.exitCode, `${conv.stdout}${conv.stderr}`).toBe(0);
      expect(existsSync(join(input, "pubmy-epub/note.md.epub"))).toBe(true);
    },
    240_000,
  );

  test("uninstall block removes the skill from every harness folder", () => {
    const [uninstall] = blocksUnder(readme, "### Remove a copied skill", lang);
    const r = runBlock(uninstall!, home);
    expect(r.code, r.out).toBe(0);
    for (const dir of HARNESS_DIRS) expect(existsSync(join(home, dir, "pubmy")), dir).toBe(false);
  });
});

describe("readme ZIP download block", () => {
  test(
    "downloads the release ZIP, served locally, and leaves a complete skill in the Claude Code folder",
    async () => {
      const blocks = blocksUnder(readme, "### Download the ZIP", lang);
      expect(blocks.length).toBe(1);
      expect(blocks[0]).toContain(RELEASE_ZIP_URL);

      const zipHome = await mkdtemp(join(tmpdir(), "pubmy-zip-home-"));
      const zipFile = join(zipHome, "served", "pubmy-skill.zip");
      await packSkill(zipFile);
      // The block downloads from the release URL; the test serves the same file from this machine instead.
      const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response(Bun.file(zipFile)) });
      try {
        const script = blocks[0]!.replaceAll(RELEASE_ZIP_URL, `http://127.0.0.1:${server.port}/pubmy-skill.zip`);
        // Async spawn: a blocking spawn would stop this process from answering the download.
        const env = { ...process.env, HOME: zipHome, USERPROFILE: zipHome };
        const cmd = windows ? ["pwsh", "-NoProfile", "-NonInteractive", "-Command", script] : ["bash", "-e", "-c", script];
        const proc = Bun.spawn(cmd, { cwd: repo, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
        const code = await proc.exited;
        const out = `${await new Response(proc.stdout).text()}${await new Response(proc.stderr).text()}`;
        expect(code, out).toBe(0);
        for (const f of ["SKILL.md", "scripts/pubmy.js"]) {
          expect(existsSync(join(zipHome, ".claude/skills/pubmy", f)), f).toBe(true);
        }
      } finally {
        server.stop(true);
        await rm(zipHome, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
