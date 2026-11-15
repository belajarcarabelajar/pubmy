import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Search engines find the one page of the site through these two files (2026-11-15: both were 404).
const SITE = "https://pubmy.belajarcarabelajar.com/";
const PUBLIC = join(import.meta.dir, "..", "public");
const read = (name: string) => readFileSync(join(PUBLIC, name), "utf8");

describe("sitemap.xml", () => {
  test("lists exactly the site root, over https with a trailing slash", () => {
    const xml = read("sitemap.xml");
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect([...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1])).toEqual([SITE]);
  });
});

describe("robots.txt", () => {
  const lines = () => read("robots.txt").split(/\r?\n/).map((l) => l.trim());

  test("points crawlers at the sitemap by its absolute URL", () => {
    expect(lines()).toContain(`Sitemap: ${SITE}sitemap.xml`);
  });

  test("does not block the site", () => {
    expect(lines().filter((l) => /^disallow:\s*\/\s*$/i.test(l))).toEqual([]);
  });
});

describe("build output", () => {
  const out = mkdtempSync(join(tmpdir(), "pubmy-sitemap-"));
  afterAll(() => rmSync(out, { recursive: true, force: true }));
  const proc = Bun.spawnSync([process.execPath, join(import.meta.dir, "..", "build.ts"), out], { stdout: "pipe", stderr: "pipe" });

  test("ships robots.txt and sitemap.xml at the site root", () => {
    expect(proc.exitCode).toBe(0);
    for (const name of ["robots.txt", "sitemap.xml"]) expect(readFileSync(join(out, name), "utf8")).toBe(read(name));
  });
});
