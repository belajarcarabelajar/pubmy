import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_BYTES, MAX_FILES, RETENTION_MS } from "../src/limits.ts";
import { ROUTES } from "../site/routes.ts";

// Support page content: one Markdown file per route key and language. The title and description live in the route
// table, so a body has no level-one heading. Facts that live in code are tokens the build replaces, so a page cannot
// keep quoting a limit after the code changes it.
const CONTENT = join(import.meta.dir, "..", "content");
const KEYS = ["guide", "formats", "privacy", "drm", "cli", "about", "releases", "notfound"] as const;
const LANGS = ["id", "en"] as const;
const TOKENS = new Set(["MAX_FILES", "MAX_MB", "RETENTION_MIN", "VERSION"]);

const path = (lang: string, key: string) => join(CONTENT, lang, `${key}.md`);
const read = (lang: string, key: string) => readFileSync(path(lang, key), "utf8");
/** The text outside fenced code blocks, where a shell comment would look like a heading. */
const prose = (md: string) => md.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "");
const headings = (md: string, level: number) => prose(md).split("\n").filter((l) => new RegExp(`^#{${level}} \\S`).test(l));

describe("limits shared by the converter and the support pages", () => {
  test("the values the pages quote", () => {
    expect(MAX_FILES).toBe(10);
    expect(MAX_BYTES).toBe(52_428_800);
    expect(RETENTION_MS).toBe(180_000);
  });
});

describe("content folder", () => {
  test("holds exactly one file per route key in each language", () => {
    for (const lang of LANGS) expect(readdirSync(join(CONTENT, lang)).sort()).toEqual(KEYS.map((k) => `${k}.md`).sort());
  });
});

for (const key of KEYS) {
  describe(key, () => {
    test(`${key}: exists in both languages with a body`, () => {
      for (const lang of LANGS) {
        expect(existsSync(path(lang, key))).toBe(true);
        expect(read(lang, key).trim().length).toBeGreaterThan(40);
      }
    });

    test(`${key}: has no level-one heading`, () => {
      for (const lang of LANGS) expect(headings(read(lang, key), 1)).toEqual([]);
    });

    test(`${key}: has the same number of sections in both languages`, () => {
      expect(headings(read("en", key), 2).length).toBe(headings(read("id", key), 2).length);
    });

    test(`${key}: uses only the known tokens`, () => {
      for (const lang of LANGS) {
        const used = [...read(lang, key).matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)].map((m) => m[1]!);
        expect(used.filter((t) => !TOKENS.has(t))).toEqual([]);
      }
    });

    test(`${key}: has no em dash`, () => {
      for (const lang of LANGS) expect(read(lang, key)).not.toContain("\u2014");
    });
  });
}

describe("page-specific content", () => {
  test("guide: both languages have a section titled exactly FAQ, the footer's #faq target", () => {
    for (const lang of LANGS) expect(headings(read(lang, "guide"), 2)).toContain("## FAQ");
  });

  test("guide and privacy: limits are written as tokens, not as numbers", () => {
    for (const lang of LANGS) {
      expect(read(lang, "guide")).toContain("{{MAX_FILES}}");
      expect(read(lang, "guide")).toContain("{{MAX_MB}}");
      expect(read(lang, "privacy")).toContain("{{RETENTION_MIN}}");
    }
  });

  test("releases: the current version comes from the {{VERSION}} token", () => {
    for (const lang of LANGS) expect(read(lang, "releases")).toContain("{{VERSION}}");
  });
});

describe("headings under the page title", () => {
  test("no section heading repeats the page's own title", () => {
    for (const key of KEYS) {
      const route = ROUTES.find((r) => r.key === key)!;
      for (const lang of LANGS) {
        const title = route.title[lang].trim().toLowerCase();
        const same = headings(read(lang, key), 2).filter((h) => h.slice(3).trim().toLowerCase() === title);
        expect({ key, lang, same }).toEqual({ key, lang, same: [] });
      }
    }
  });
});

describe("formats page and the converter's file picker", () => {
  test("every extension the picker accepts is named on the formats page in both languages", () => {
    const html = readFileSync(join(import.meta.dir, "..", "index.html"), "utf8");
    const accept = /accept="([^"]*\.epub[^"]*)"/.exec(html)?.[1];
    expect(accept).toBeDefined();
    const exts = accept!.split(",").map((e) => e.trim());
    expect(exts.length).toBeGreaterThan(10);
    for (const lang of LANGS) {
      const md = read(lang, "formats");
      expect({ lang, missing: exts.filter((e) => !md.includes("`" + e + "`")) }).toEqual({ lang, missing: [] });
    }
  });
});
