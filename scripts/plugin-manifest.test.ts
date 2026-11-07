// Claude Code plugin install path: `claude plugin marketplace add belajarcarabelajar/pubmy`, then `claude plugin install pubmy@pubmy`.
// Run: bun test scripts/plugin-manifest.test.ts
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = join(import.meta.dir, "..");
const readJson = async (p: string) => JSON.parse(await readFile(join(repo, p), "utf8"));

describe("claude plugin manifest", () => {
  test("marketplace lists one plugin named pubmy, owned by Iwan Kurniawan", async () => {
    const m = await readJson(".claude-plugin/marketplace.json");
    expect(m.name).toBe("pubmy");
    expect(m.owner.name).toBe("Iwan Kurniawan");
    expect(m.plugins.map((p: { name: string }) => p.name)).toEqual(["pubmy"]);
  });

  test("entry name equals the plugin.json name", async () => {
    const m = await readJson(".claude-plugin/marketplace.json");
    const p = await readJson(".claude-plugin/plugin.json");
    expect(p.name).toBe(m.plugins[0].name);
  });

  test("entry source is the repo root, which holds skills/pubmy/SKILL.md", async () => {
    const m = await readJson(".claude-plugin/marketplace.json");
    const src = m.plugins[0].source;
    expect(typeof src).toBe("string");
    expect(src.includes("..")).toBe(false);
    expect(existsSync(join(resolve(repo, src), "skills/pubmy/SKILL.md"))).toBe(true);
  });

  test("plugin.json carries version, MIT licence and the repository URL", async () => {
    const p = await readJson(".claude-plugin/plugin.json");
    expect(p.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(p.license).toBe("MIT");
    expect(p.repository).toBe("https://github.com/belajarcarabelajar/pubmy");
  });
});

const claude = Bun.which("claude");

describe("claude plugin install", () => {
  test.skipIf(!claude)(
    "installs pubmy@pubmy from this checkout into an isolated config dir and lists skill pubmy",
    async () => {
      const cfg = await mkdtemp(join(tmpdir(), "pubmy-plugin-"));
      const env = { ...process.env, CLAUDE_CONFIG_DIR: cfg };
      const run = (args: string[]) => {
        const r = Bun.spawnSync([claude!, ...args], { env, cwd: repo, stdin: "ignore" });
        return { code: r.exitCode, out: `${r.stdout}${r.stderr}` };
      };
      try {
        const add = run(["plugin", "marketplace", "add", repo]);
        expect(add.code, add.out).toBe(0);
        const install = run(["plugin", "install", "pubmy@pubmy"]);
        expect(install.code, install.out).toBe(0);
        const details = run(["plugin", "details", "pubmy"]);
        expect(details.code, details.out).toBe(0);
        expect(details.out).toMatch(/Skills \(1\)[^\n]*pubmy/);
      } finally {
        await rm(cfg, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
