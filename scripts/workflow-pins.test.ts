import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { run } from "../apps/cli/src/main.ts";

const repo = join(import.meta.dir, "..");
const WORKFLOWS = ["install-check.yml", "release-skill.yml"];

type Step = { uses?: string; run?: string; with?: Record<string, unknown> };
type Workflow = { jobs: Record<string, { steps: Step[] }> };

async function text(name: string): Promise<string> {
  return readFile(join(repo, ".github/workflows", name), "utf8");
}

async function load(name: string): Promise<Workflow> {
  return Bun.YAML.parse(await text(name)) as Workflow;
}

describe("workflow action pins", () => {
  for (const name of WORKFLOWS) {
    test(`${name} pins every action to a full commit SHA with a version comment`, async () => {
      const lines = (await text(name)).split("\n").filter((l) => /^\s*-?\s*uses:/.test(l));
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line, line).toMatch(/uses:\s*[\w.-]+\/[\w.-]+@[0-9a-f]{40}\s+#\s*v\d+\.\d+\.\d+\s*$/);
      }
    });
  }

  test("a tag-pinned action line is refused by the same pattern (positive control)", () => {
    expect("      - uses: actions/checkout@v7").not.toMatch(/uses:\s*[\w.-]+\/[\w.-]+@[0-9a-f]{40}\s+#\s*v\d+\.\d+\.\d+\s*$/);
  });

  test("the release checkout does not persist the write token", async () => {
    const steps = Object.values((await load("release-skill.yml")).jobs)[0]!.steps;
    const checkout = steps.find((s) => s.uses?.startsWith("actions/checkout@"));
    expect(checkout?.with?.["persist-credentials"]).toBe(false);
  });
});

describe("dev-setup", () => {
  const runs = async () => (await load("install-check.yml")).jobs["dev-setup"]!.steps.map((s) => s.run ?? "");

  test("runs the CLI run test and this workflow pin test", async () => {
    const all = await runs();
    for (const file of ["apps/cli/test/cli-run.test.ts", "scripts/workflow-pins.test.ts"]) {
      expect(all.some((r) => r.includes("bun test") && r.includes(file)), file).toBe(true);
    }
  });
});

describe("committed skill bundle", () => {
  test("prints the same usage text as the CLI source", async () => {
    let expected = "";
    const code = await run([], { stdout: () => {}, stderr: (s) => (expected += s) });
    expect(code).toBe(2);
    expect(expected).toContain("usage: pubmy");

    const proc = Bun.spawnSync(["bun", join(repo, "skills/pubmy/scripts/pubmy.js")], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    expect(proc.exitCode).toBe(2);
    expect(proc.stderr.toString()).toBe(expected);
  });
});
