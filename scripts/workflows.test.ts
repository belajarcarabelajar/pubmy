import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const repo = join(import.meta.dir, "..");

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  shell?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
};
type Job = {
  "runs-on": string;
  strategy?: { "fail-fast"?: boolean; matrix?: Record<string, unknown> };
  steps: Step[];
};
type Workflow = {
  name?: string;
  on: {
    push?: { tags?: string[]; branches?: string[] } | null;
    pull_request?: Record<string, unknown> | null;
  };
  permissions?: Record<string, string>;
  jobs: Record<string, Job>;
};

async function loadWorkflow(name: string): Promise<Workflow> {
  const text = await readFile(join(repo, ".github/workflows", name), "utf8");
  return Bun.YAML.parse(text) as Workflow;
}

describe("release", () => {
  test("runs on a pushed v* tag with write access to contents", async () => {
    const wf = await loadWorkflow("release-skill.yml");
    expect(wf.on.push?.tags).toEqual(["v*"]);
    expect(wf.permissions).toEqual({ contents: "write" });
  });

  test("sets up the pinned Bun, packs the skill, checks the version and smoke-tests the zip, then attaches it to a release", async () => {
    const wf = await loadWorkflow("release-skill.yml");
    const jobs = Object.values(wf.jobs);
    expect(jobs).toHaveLength(1);
    const steps = jobs[0]!.steps;
    expect(jobs[0]!["runs-on"]).toBe("ubuntu-latest");

    const index = (pred: (s: Step) => boolean) => steps.findIndex(pred);
    const checkout = index((s) => s.uses?.startsWith("actions/checkout@") ?? false);
    const setupBun = index((s) => s.uses?.startsWith("oven-sh/setup-bun@") ?? false);
    const install = index((s) => s.run?.includes("bun install --frozen-lockfile") ?? false);
    const pack = index((s) => s.run?.includes("bun scripts/pack-skill.ts") ?? false);
    const check = index((s) => s.run?.includes('bun scripts/release-check.ts "$GITHUB_REF_NAME" dist/pubmy-skill.zip') ?? false);
    const release = index((s) => s.run?.includes("gh release create") ?? false);

    expect(steps[setupBun]?.with?.["bun-version"]).toBe("1.4.4");
    expect([checkout, setupBun, install, pack, check, release].every((i) => i >= 0)).toBe(true);
    expect(checkout < setupBun && setupBun < install && install < pack && pack < check && check < release).toBe(true);
    expect(steps[check]!.name).toBe("Check version and smoke-test the zip");

    const releaseStep = steps[release]!;
    expect(releaseStep.run).toContain('gh release create "$GITHUB_REF_NAME" dist/pubmy-skill.zip');
    expect(releaseStep.run).toContain("--generate-notes");
    expect(releaseStep.env?.GH_TOKEN).toBe("${{ github.token }}");
  });
});

describe("install", () => {
  const runs = (steps: Step[]) => steps.map((s) => s.run ?? "");

  test("runs on pull requests and pushes to main with read-only contents", async () => {
    const wf = await loadWorkflow("install-check.yml");
    expect(wf.name).toBe("install-check");
    expect("pull_request" in wf.on).toBe(true);
    expect(wf.on.push?.branches).toEqual(["main"]);
    expect(wf.permissions).toEqual({ contents: "read" });
  });

  test("install job covers Linux, macOS and Windows without failing fast", async () => {
    const job = (await loadWorkflow("install-check.yml")).jobs.install!;
    expect(job.strategy?.["fail-fast"]).toBe(false);
    expect(job.strategy?.matrix?.os).toEqual(["ubuntu-latest", "macos-latest", "windows-latest"]);
    expect(job["runs-on"]).toBe("${{ matrix.os }}");
    const uses = job.steps.map((s) => s.uses ?? "");
    expect(uses.some((u) => u.startsWith("actions/checkout@"))).toBe(true);
    expect(uses.some((u) => u.startsWith("oven-sh/setup-bun@"))).toBe(true);
    const node = job.steps.find((s) => s.uses?.startsWith("actions/setup-node@"));
    expect(String(node?.with?.["node-version"])).toBe("22");
  });

  test("install job runs the README install test, then skills add and remove", async () => {
    const steps = (await loadWorkflow("install-check.yml")).jobs.install!.steps;
    const all = runs(steps);
    const readme = all.findIndex((r) => r.includes("bun test scripts/readme-install.test.ts"));
    const cli = steps.findIndex((s) => s.run?.includes("npx -y skills add") ?? false);
    expect(readme).toBeGreaterThanOrEqual(0);
    expect(cli).toBeGreaterThan(readme);

    const step = steps[cli]!;
    const script = step.run!;
    expect(step.shell).toBe("bash");
    expect(script).toContain("npx -y skills add ./ --skill pubmy -a codex -g -y");
    expect(script).toContain("npx -y skills remove pubmy -g -y");
    expect(script.indexOf("skills add")).toBeLessThan(script.indexOf("skills remove"));
    expect(script).toContain(".agents/skills/pubmy/scripts/pubmy.js");
    expect(step.env?.HOME).toBe("${{ runner.temp }}/skills-home");
    expect(step.env?.USERPROFILE).toBe("${{ runner.temp }}/skills-home");
  });

  test("dev-setup job runs the README developer setup commands in order", async () => {
    const job = (await loadWorkflow("install-check.yml")).jobs["dev-setup"]!;
    expect(job["runs-on"]).toBe("ubuntu-latest");
    const all = runs(job.steps);
    const order = ["bun install --frozen-lockfile", "bun run typecheck", "bun test apps/cli/test/cli.test.ts"].map((cmd) =>
      all.findIndex((r) => r.includes(cmd)),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test("dev-setup job also runs the release, workflow, packing and plugin manifest tests", async () => {
    const all = runs((await loadWorkflow("install-check.yml")).jobs["dev-setup"]!.steps);
    for (const file of ["scripts/release-check.test.ts", "scripts/workflows.test.ts", "scripts/pack-skill.test.ts", "scripts/plugin-manifest.test.ts"]) {
      expect(all.some((r) => r.includes("bun test") && r.includes(file)), file).toBe(true);
    }
  });
});
