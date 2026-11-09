import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// PUBMY_INDEX_HTML points the test at another copy of the page; it exists so a mutation proof can run
// against a scratch copy without touching the real file. The default is the shipped page.
const INDEX = process.env.PUBMY_INDEX_HTML ?? join(import.meta.dir, "..", "index.html");
const html = readFileSync(INDEX, "utf8");
const css = (/<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, "");

interface Rule {
  sel: string;
  body: string;
  /** Enclosing at-rule preludes, outermost first, whitespace removed around punctuation. */
  ctx: string[];
}

function squash(s: string): string {
  return s
    .replace(/\s*([:;,{}()])\s*/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/;$/, "")
    .trim();
}

/** Flat list of style rules; at-rules are walked and recorded in `ctx`. */
function parse(text: string, ctx: string[]): Rule[] {
  const out: Rule[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open < 0) break;
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") depth--;
      j++;
    }
    const prelude = squash(text.slice(i, open));
    const inner = text.slice(open + 1, j - 1);
    if (prelude.startsWith("@")) out.push(...parse(inner, [...ctx, prelude]));
    else out.push({ sel: prelude, body: squash(inner), ctx });
    i = j;
  }
  return out;
}

const rules = parse(css, []);
const DARK = "@media(prefers-color-scheme:dark)";
const DRAWER = "@media(max-width:60rem)";

function declared(body: string, prop: string): string | undefined {
  return new RegExp(`(?:^|;)${prop}:([^;]+)`).exec(body)?.[1]?.trim();
}

/** The one rule whose selector list holds exactly `sel`, outside any at-rule unless `ctx` names one. */
function one(sel: string, ctx: string[] = []): Rule {
  const found = rules.filter((r) => r.sel.split(",").includes(sel) && r.ctx.join("|") === ctx.join("|"));
  expect(found, `${sel} ${ctx.join(" ")}`).toHaveLength(1);
  return found[0]!;
}

function customProps(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(?:^|;)(--[\w-]+):([^;]+)/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

const light = customProps(rules.find((r) => r.sel === ":root" && r.ctx.length === 0)?.body ?? "");
const dark = customProps(rules.find((r) => r.sel === ":root" && r.ctx.includes(DARK))?.body ?? "");

// WCAG 2.x relative luminance from a 3 or 6 digit hex colour, written out here so the test shares no code with the page.
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  if (!/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(h)) throw new Error(`not a hex colour: ${hex}`);
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE = "#ffffff";

/** The preview bar sits on the dialog's own background unless it declares one itself. */
function barBackground(): string {
  const bar = rules.find((r) => r.sel === ".pv-bar" && r.ctx.length === 0);
  const own = bar ? declared(bar.body, "background") : undefined;
  const bg = own ?? declared(one(".preview").body, "background");
  expect(bg, "the preview bar background").toMatch(/^#[0-9a-f]{3,6}$/i);
  return bg!;
}

function stageOf(theme: "light" | "dark"): string {
  const value = (theme === "light" ? light : dark)["--pv-stage"];
  expect(value, `--pv-stage in the ${theme} block`).toMatch(/^#[0-9a-f]{6}$/i);
  return value!;
}

describe("preview stage token", () => {
  test("--pv-stage is defined in the light :root and in the dark override", () => {
    expect(light["--pv-stage"], "light").toBeDefined();
    expect(dark["--pv-stage"], "dark").toBeDefined();
  });

  test(".pv-stage paints its background from var(--pv-stage)", () => {
    expect(declared(one(".pv-stage").body, "background")).toBe("var(--pv-stage)");
  });
});

for (const theme of ["light", "dark"] as const) {
  describe(`${theme} theme stage colour`, () => {
    test("the stage is lighter than the preview bar and darker than the white page", () => {
      const stage = luminance(stageOf(theme));
      expect(stage).toBeGreaterThan(luminance(barBackground()));
      expect(stage).toBeLessThan(luminance(WHITE));
    });

    test("the white page against the stage is at least 3:1 and softer than against the bar", () => {
      const stage = stageOf(theme);
      const against = contrast(WHITE, stage);
      expect(against).toBeGreaterThanOrEqual(3);
      expect(against).toBeLessThan(contrast(WHITE, barBackground()));
    });

    test("the arrow glyph colour on the stage is at least 4.5:1", () => {
      const arrow = declared(one(".pv-arrow").body, "color");
      expect(arrow, ".pv-arrow colour").toMatch(/^#[0-9a-f]{3,6}$/i);
      expect(contrast(arrow!, stageOf(theme))).toBeGreaterThanOrEqual(4.5);
    });
  });
}

describe("narrow-screen drawer", () => {
  // The list slides over the stage below 60rem and must stay opaque, so it keeps the bar colour and not the stage token.
  test("the contents drawer keeps its own bar-coloured background", () => {
    const drawer = one(".pv-toc", [DRAWER]);
    expect(declared(drawer.body, "position")).toBe("absolute");
    expect(declared(drawer.body, "background")).toBe(barBackground());
    expect(drawer.body).not.toContain("--pv-stage");
  });
});
