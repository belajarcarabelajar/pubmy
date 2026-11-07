import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packSkill } from "./pack-skill.ts";
import { checkVersion, smokeZip } from "./release-check.ts";

const repo = join(import.meta.dir, "..");
const temps: string[] = [];
async function temp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `pubmy-release-${prefix}-`));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function pluginJsonWith(version: string): Promise<string> {
  const file = join(await temp("plugin"), "plugin.json");
  await writeFile(file, JSON.stringify({ name: "pubmy", version }));
  return file;
}

describe("checkVersion", () => {
  test("a tag equal to v plus the plugin.json version is accepted", async () => {
    expect(checkVersion("v1.2.3", await pluginJsonWith("1.2.3"))).toBeNull();
  });

  test("the default path reads the repo plugin.json", async () => {
    const { version } = JSON.parse(await readFile(join(repo, ".claude-plugin/plugin.json"), "utf8")) as { version: string };
    expect(checkVersion(`v${version}`)).toBeNull();
  });

  test("a mismatched tag returns a message naming the tag and the plugin.json version", async () => {
    const message = checkVersion("v9.9.9", await pluginJsonWith("1.2.3"));
    expect(message).toContain("v9.9.9");
    expect(message).toContain("1.2.3");
  });

  test("a plugin.json without a version refuses every tag, including vundefined", async () => {
    const file = join(await temp("plugin"), "plugin.json");
    await writeFile(file, JSON.stringify({ name: "pubmy" }));
    expect(checkVersion("vundefined", file)).toContain("no version");
  });
});

describe("smokeZip", () => {
  test("the packed skill converts a Markdown file", async () => {
    const zip = join(await temp("good"), "pubmy-skill.zip");
    await packSkill(zip);
    await smokeZip(zip);
  }, 180_000);

  test("a zip whose converter exits 1 is rejected with the converter output", async () => {
    const skillDir = await temp("broken-skill");
    await mkdir(join(skillDir, "scripts"), { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), await readFile(join(repo, "skills/pubmy/SKILL.md")));
    await writeFile(join(skillDir, "scripts/pubmy.js"), 'console.error("broken-converter-marker");\nprocess.exit(1);\n');
    const zip = join(await temp("broken"), "pubmy-skill.zip");
    await packSkill(zip, skillDir);
    await expect(smokeZip(zip)).rejects.toThrow("broken-converter-marker");
  }, 60_000);
});

describe("CLI", () => {
  async function run(...args: string[]) {
    const proc = Bun.spawn([process.execPath, join(repo, "scripts/release-check.ts"), ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, output: stdout + stderr };
  }

  test("exits 1 and names the tag when it does not match plugin.json", async () => {
    const { code, output } = await run("v9.9.9", join(await temp("cli"), "missing.zip"));
    expect(code).toBe(1);
    expect(output).toContain("v9.9.9");
  }, 30_000);

  test("exits 1 with usage when arguments are missing", async () => {
    const { code, output } = await run();
    expect(code).toBe(1);
    expect(output).toContain("usage");
  }, 30_000);
});
