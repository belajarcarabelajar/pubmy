import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { siteFooter, siteHeader } from "../site/layout.ts";
import { renderContent } from "../site/render.ts";
import { ROUTES } from "../site/routes.ts";
import { SITE_CSS } from "../site/styles.ts";

// Fixes from the parent's screenshot check of the built site (Chromium 156, 390 px and 1280 px): the converter bundle
// grew by the site CSS and route texts, the language control wrapped on phones, tables squeezed into thin columns,
// and the footer floated mid-screen on short pages.
const web = join(import.meta.dir, "..");
const doc = (fragment: string) => parseHTML(`<!doctype html><html><head></head><body>${fragment}</body></html>`).document;
const css = SITE_CSS.replace(/\s+/g, " ");
const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

interface Rule {
  sel: string;
  body: string;
  ctx: string;
}
/** Flat rules with their enclosing at-rule preludes joined by "|", whitespace squashed. */
function parse(src: string, ctx: string[] = []): Rule[] {
  const out: Rule[] = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf("{", i);
    if (open < 0) break;
    let depth = 1;
    let j = open + 1;
    for (; j < src.length && depth > 0; j++) depth += src[j] === "{" ? 1 : src[j] === "}" ? -1 : 0;
    const prelude = src.slice(i, open).trim().replace(/\s+/g, " ");
    const inner = src.slice(open + 1, j - 1);
    if (prelude.startsWith("@")) out.push(...parse(inner, [...ctx, prelude]));
    else for (const sel of prelude.split(",")) out.push({ sel: sel.trim(), body: inner, ctx: ctx.join("|") });
    i = j;
  }
  return out;
}
const rules = parse(SITE_CSS);
const decl = (body: string, prop: string) => new RegExp(`(?:^|;)\\s*${prop}:([^;]+)`).exec(body)?.[1]?.trim();
const where = (sel: string, ctx: (c: string) => boolean) => rules.filter((r) => r.sel === sel && ctx(r.ctx));
const rem = (v: string | undefined) => Number.parseFloat(v ?? "NaN") * 16;

describe("converter bundle weight", () => {
  const out = mkdtempSync(join(tmpdir(), "pubmy-site-polish-"));
  afterAll(() => rmSync(out, { recursive: true, force: true }));
  const proc = Bun.spawnSync([process.execPath, join(web, "build.ts"), out], { stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) console.error(proc.stderr.toString());
  const index = existsSync(join(out, "index.html")) ? readFileSync(join(out, "index.html"), "utf8") : "";
  const preloaded = [...index.matchAll(/<link rel="modulepreload" href="\.\/([^"]+)">/g)].map((m) => m[1]!);
  const loaded = ["main.js", ...preloaded].map((f) => ({ f, code: existsSync(join(out, f)) ? readFileSync(join(out, f), "utf8") : "" }));

  test("the build exits 0 and main.js preloads its static chunks", () => {
    expect(proc.exitCode).toBe(0);
    expect(preloaded.length).toBeGreaterThan(0);
    expect(preloaded.every((f) => f.startsWith("chunks/"))).toBe(true);
  });

  test("the converter code still carries the header and footer labels it switches", () => {
    const all = loaded.map((l) => l.code).join("\n");
    for (const s of ["Laporkan masalah", "Report an issue", "Navigasi utama", "Bahasa Indonesia"]) expect(all).toContain(s);
  });

  test("main.js and its static chunks carry no site CSS", () => {
    expect(loaded.filter((l) => l.code.includes(".site-footer{") || l.code.includes("site-header")).map((l) => l.f)).toEqual([]);
  });

  test("main.js and its static chunks carry no route description", () => {
    const descriptions = ROUTES.flatMap((r) => [r.description.id, r.description.en]);
    expect(descriptions).toHaveLength(18);
    const hits = loaded.flatMap((l) => descriptions.filter((d) => l.code.includes(d)).map((d) => `${l.f}: ${d}`));
    expect(hits).toEqual([]);
  });
});

describe("phone header", () => {
  for (const [lang, short, long] of [["id", "EN", "English"], ["en", "ID", "Bahasa Indonesia"]] as const) {
    test(`${lang}: the language link shows a short code beside the full name it keeps as its accessible name`, () => {
      const sw = doc(siteHeader({ lang, current: "guide", converter: false })).querySelector("a#lang")!;
      expect(text(sw.querySelector(".lang-long"))).toBe(long);
      const code = sw.querySelector(".lang-short")!;
      expect(text(code)).toBe(short);
      expect(code.getAttribute("aria-hidden")).toBe("true");
    });
  }

  test("converter: the short code is switched by main.js and the long label keeps its id", () => {
    const d = doc(siteHeader({ lang: "id", current: "home", converter: true }));
    const code = d.querySelector("#lang .lang-short")!;
    expect(code.getAttribute("data-i18n")).toBe("lang-short");
    expect(code.getAttribute("aria-hidden")).toBe("true");
    expect(text(code)).toBe("EN");
    const label = d.querySelector("#lang-label")!;
    expect(label.classList.contains("lang-long")).toBe(true);
    expect(label.getAttribute("data-i18n")).toBe("lang-toggle");
  });

  test("the short code is hidden on wide screens", () => {
    expect(where(".site-header .lang-short", (c) => c === "").some((r) => decl(r.body, "display") === "none")).toBe(true);
  });

  test("below the phone breakpoint the long name is visually hidden, never display:none, and the code shows", () => {
    const narrow = (c: string) => /max-width:\s*([\d.]+)rem/.test(c) && rem(/max-width:\s*([\d.]+rem)/.exec(c)![1]) <= 30 * 16;
    const long = where(".site-header .lang-long", narrow);
    expect(long).toHaveLength(1);
    expect(decl(long[0]!.body, "width")).toBe("1px");
    expect(decl(long[0]!.body, "overflow")).toBe("hidden");
    expect(decl(long[0]!.body, "position")).toBe("absolute");
    expect(rules.filter((r) => r.sel.includes("lang-long") && decl(r.body, "display") === "none")).toEqual([]);
    const code = where(".site-header .lang-short", narrow);
    expect(code).toHaveLength(1);
    expect(decl(code[0]!.body, "display")).not.toBe("none");
  });

  // F3: the visual row must follow the DOM and Tab order (brand, Menu, language control) at every width.
  test("the DOM puts the brand, then the nav with its Menu, then the language control", () => {
    for (const converter of [false, true]) {
      const inner = doc(siteHeader({ lang: "id", current: "guide", converter })).querySelector(".site-header-inner")!;
      const kids = [...inner.children].filter((el) => !el.classList.contains("skip"));
      expect(kids.map((el) => el.classList.contains("site-brand") ? "brand" : el.classList.contains("site-nav") ? "nav" : el.id)).toEqual(["brand", "nav", "lang"]);
    }
  });

  test("no rule reorders the nav or the language control, so phones show brand, Menu, language control", () => {
    const reorder = rules.filter((r) => (r.sel === ".site-nav" || r.sel === ".site-header .lang" || r.sel === ".site-brand") && decl(r.body, "order") !== undefined);
    expect(reorder.map((r) => `${r.ctx || "(base)"} ${r.sel}{order:${decl(r.body, "order")}}`)).toEqual([]);
  });

  // Worst case with monospace glyphs (0.6em): the row must fit with 8 px to spare.
  const inner = where(".site-header-inner", (c) => c === "")[0]!.body;
  const brand = where(".site-brand", (c) => c === "")[0]!.body;
  const lang = where(".site-header .lang", (c) => c === "")[0]!.body;
  const summary = where(".nav-menu>summary", (c) => c === "")[0]!.body;
  const second = (v: string | undefined) => rem(v?.split(" ")[1] ?? v);
  // the logo is 32 px wide (layout.ts width attribute); "pubmy" is the brand text
  const brandW = 32 + rem(decl(brand, "gap")) + 5 * 0.6 * rem(decl(brand, "font-size"));
  const langW = (chars: number) => chars * 0.6 * rem(decl(lang, "font-size")) + 2 * second(decl(lang, "padding")) + 16 + rem(decl(lang, "gap")) + 2;
  const menuW = Math.max(44, 4 * 0.6 * 16 + 2 * second(decl(summary, "padding")) + 2);
  const row = (chars: number) => brandW + langW(chars) + menuW + 2 * second(decl(inner, "gap")) + 2 * second(decl(inner, "padding"));

  test("at 320 px the brand, the short code and Menu share one row", () => {
    expect(320 - row(2)).toBeGreaterThanOrEqual(8);
  });

  test("from the phone breakpoint up, the full name Bahasa Indonesia fits that row too", () => {
    const bp = rules.map((r) => /max-width:\s*([\d.]+)rem/.exec(r.ctx)).find((m, i) => m && rules[i]!.sel === ".site-header .lang-long");
    expect(bp).toBeTruthy();
    expect(rem(bp![1] + "rem") - row("Bahasa Indonesia".length)).toBeGreaterThanOrEqual(8);
  });

  test("the Menu summary keeps its 44 px target", () => {
    expect(decl(summary, "min-height")).toBe("44px");
    expect(decl(summary, "min-width")).toBe("44px");
  });
});

describe("tables on phones", () => {
  const html = renderContent("| Input | Extensions | Notes |\n|---|---|---|\n| PDF | `.pdf` | Columns |\n| Comics | `.cbz` | Fixed |", {});
  const d = doc(html);

  test("a table with a header row is marked for stacking and every cell names its column", () => {
    expect(d.querySelector("table")!.classList.contains("stack")).toBe(true);
    const labels = [...d.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.getAttribute("data-label")));
    expect(labels).toEqual([["Input", "Extensions", "Notes"], ["Input", "Extensions", "Notes"]]);
  });

  test("a header cell with code gives the plain text as the label", () => {
    const t = doc(renderContent("| `-a` value | Folder |\n|---|---|\n| x | y |", {}));
    expect([...t.querySelectorAll("td")].map((td) => td.getAttribute("data-label"))).toEqual(["-a value", "Folder"]);
  });

  test("below 40rem a stacked table becomes labelled blocks; above it stays a table", () => {
    const narrow = (c: string) => /max-width:\s*40rem/.test(c);
    expect(where(".page table.stack td", narrow).some((r) => decl(r.body, "display") === "block")).toBe(true);
    expect(where(".page table.stack tr", narrow).some((r) => /var\(--border\)/.test(decl(r.body, "border") ?? ""))).toBe(true);
    const before = where(".page table.stack td::before", narrow);
    expect(before).toHaveLength(1);
    expect(decl(before[0]!.body, "content")).toBe("attr(data-label)");
    expect(decl(before[0]!.body, "display")).toBe("block");
    expect(decl(before[0]!.body, "font-weight")).toMatch(/^(600|700|bold)$/);
    expect(decl(before[0]!.body, "color")).toBe("var(--muted)");
    const thead = where(".page table.stack thead", narrow);
    expect(thead).toHaveLength(1);
    expect(decl(thead[0]!.body, "width")).toBe("1px");
    expect(rules.filter((r) => r.sel.includes("table.stack") && !narrow(r.ctx))).toEqual([]);
  });
});

describe("footer placement", () => {
  test("a page with the site footer is a column at least the viewport tall, with main taking the free space", () => {
    const body = where("body:has(>.site-footer)", (c) => c === "");
    expect(body).toHaveLength(1);
    expect(decl(body[0]!.body, "display")).toBe("flex");
    expect(decl(body[0]!.body, "flex-direction")).toBe("column");
    expect(decl(body[0]!.body, "min-height")).toBe("100dvh");
    expect(css).not.toContain("100vh");
  });

  test("main grows and stays full width, so the converter's centred max-width column still centres", () => {
    const main = where("body:has(>.site-footer)>main", (c) => c === "");
    expect(main).toHaveLength(1);
    expect(decl(main[0]!.body, "flex")).toMatch(/^1\b/);
    expect(decl(main[0]!.body, "width")).toBe("100%");
    expect(decl(main[0]!.body, "max-width")).toBeUndefined();
  });
});

describe("footer brand", () => {
  for (const [lang, tagline] of [
    ["id", "Ubah dokumen, e-book, dan komik jadi EPUB 3 yang lolos Send to Kindle."],
    ["en", "Turn documents, e-books and comics into EPUB 3 that passes Send to Kindle."],
  ] as const) {
    test(`${lang}: the first footer block is the logo, the name and the tagline`, () => {
      const cols = doc(siteFooter({ lang, version: "0.2.0", converter: false })).querySelector(".footer-cols")!;
      const brand = cols.firstElementChild!;
      expect(brand.classList.contains("footer-brand")).toBe(true);
      const img = brand.querySelector("img")!;
      expect([img.getAttribute("src"), img.getAttribute("width"), img.getAttribute("height"), img.getAttribute("alt")]).toEqual(["/icon.svg", "32", "32", ""]);
      expect(text(brand.querySelector(".footer-name"))).toBe("pubmy");
      expect(text(brand.querySelector(".footer-tagline"))).toBe(tagline);
    });
  }

  test("converter: the tagline is switched by main.js", () => {
    const d = doc(siteFooter({ lang: "id", version: "0.2.0", converter: true }));
    expect(d.querySelector(".footer-tagline")!.getAttribute("data-i18n")).toBe("footer-tagline");
  });

  test("wide screens give the brand a wider first track", () => {
    const wide = where(".footer-cols", (c) => /min-width:\s*48rem/.test(c));
    expect(wide).toHaveLength(1);
    const cols = decl(wide[0]!.body, "grid-template-columns") ?? "";
    expect(cols).toMatch(/^minmax\(/);
    expect(cols).toContain("repeat(3,");
  });

  test("footer links keep 44 px for touch and shrink to 2rem only for a fine pointer", () => {
    expect(decl(where(".footer-cols a", (c) => c === "")[0]!.body, "min-height")).toBe("44px");
    const fine = where(".footer-cols a", (c) => /pointer:\s*fine/.test(c));
    expect(fine).toHaveLength(1);
    expect(decl(fine[0]!.body, "min-height")).toBe("2rem");
  });
});
