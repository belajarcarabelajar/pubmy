import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Search engines find the pages of the site through these two files (2026-11-15: both were 404). robots.txt is a
// file in public/; the build generates sitemap.xml from the route table, with hreflang alternates for each twin pair.
const SITE = "https://pubmy.belajarcarabelajar.com/";
const PUBLIC = join(import.meta.dir, "..", "public");
const read = (name: string) => readFileSync(join(PUBLIC, name), "utf8");

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
  if (proc.exitCode !== 0) console.error(proc.stderr.toString());
  const xml = existsSync(join(out, "sitemap.xml")) ? readFileSync(join(out, "sitemap.xml"), "utf8") : "";
  const urls = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => ({
    loc: /<loc>([^<]*)<\/loc>/.exec(m[1]!)?.[1] ?? "",
    alt: [...m[1]!.matchAll(/<xhtml:link rel="alternate" hreflang="([^"]+)" href="([^"]+)"\/>/g)].map((a) => [a[1], a[2]]),
  }));
  // Twin pairs from the spec table, written out so the test does not read back the route table it checks.
  const PAIRS = [
    ["panduan/", "en/guide/"],
    ["format/", "en/formats/"],
    ["privasi/", "en/privacy/"],
    ["drm/", "en/drm/"],
    ["cli/", "en/cli/"],
    ["tentang/", "en/about/"],
    ["rilis/", "en/releases/"],
  ].map(([id, en]) => [SITE + id, SITE + en] as const);

  test("the build exits 0 and ships robots.txt unchanged", () => {
    expect(proc.exitCode).toBe(0);
    expect(readFileSync(join(out, "robots.txt"), "utf8")).toBe(read("robots.txt"));
  });

  test("the sitemap declares the sitemap and xhtml namespaces", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">');
  });

  test("lists the root and the 14 support pages exactly once each", () => {
    const locs = urls.map((u) => u.loc);
    expect(locs).toHaveLength(15);
    expect(new Set(locs).size).toBe(15);
    expect(locs.sort()).toEqual([SITE, ...PAIRS.flat()].sort());
  });

  test("every loc is https with a trailing slash", () => {
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u.loc).toMatch(/^https:\/\/pubmy\.belajarcarabelajar\.com\/(.*\/)?$/);
  });

  test("the root names itself for id and x-default", () => {
    expect(urls.find((u) => u.loc === SITE)?.alt).toEqual([["id", SITE], ["x-default", SITE]]);
  });

  test("every support page lists its own twin pair as id, en and x-default", () => {
    for (const [id, en] of PAIRS) {
      for (const loc of [id, en]) expect(urls.find((u) => u.loc === loc)?.alt).toEqual([["id", id], ["en", en], ["x-default", id]]);
    }
  });

  test("the 404 pages are not listed", () => {
    expect(xml).not.toContain("404");
  });

  test("public/ no longer holds a hand-written sitemap", () => {
    expect(existsSync(join(PUBLIC, "sitemap.xml"))).toBe(false);
  });
});
