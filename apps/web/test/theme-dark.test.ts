import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// PUBMY_INDEX_HTML points the test at another copy of the page; it exists so the mutation proof can run
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

/** Flat list of style rules; at-rules (@media, @keyframes) are walked and recorded in `ctx`. */
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
const REDUCED = "@media(prefers-reduced-motion:reduce)";

function customProps(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(?:^|;)(--[\w-]+):([^;]+)/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

function declared(body: string, prop: string): string | undefined {
  return new RegExp(`(?:^|;)${prop}:([^;]+)`).exec(body)?.[1]?.trim();
}

const plainRoots = rules.filter((r) => r.sel === ":root" && r.ctx.length === 0);
const darkRoots = rules.filter((r) => r.sel === ":root" && r.ctx.includes(DARK));
const light = plainRoots[0] ? customProps(plainRoots[0].body) : {};
const dark = darkRoots[0] ? customProps(darkRoots[0].body) : {};

const TOKENS = [
  "--accent",
  "--accent-ink",
  "--bg",
  "--surface",
  "--text",
  "--muted",
  "--border",
  "--ok",
  "--err",
  "--tint-accent",
  "--tint-ok",
  "--tint-err",
  "--tint-neutral",
  "--track",
  "--over-bg",
  "--disabled-bg",
];

// WCAG 2.x relative luminance from a 6 digit hex colour, written out here so the test shares no code with the page.
function luminance(hex: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`not a 6 digit hex colour: ${hex}`);
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("token blocks", () => {
  test("exactly one plain :root rule, it is the first rule, and it holds color-scheme and all 16 tokens", () => {
    expect(plainRoots).toHaveLength(1);
    expect(rules[0]).toBe(plainRoots[0]!);
    expect(declared(plainRoots[0]!.body, "color-scheme")).toBe("light dark");
    expect(Object.keys(light).sort()).toEqual([...TOKENS].sort());
    for (const k of TOKENS) expect(light[k], k).toMatch(/^#[0-9a-f]{6}$/i);
  });

  test("exactly one prefers-color-scheme dark block, holding one :root that overrides every light token", () => {
    expect(css.match(/@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)/g) ?? []).toHaveLength(1);
    expect(darkRoots).toHaveLength(1);
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
    for (const k of TOKENS) expect(dark[k], k).toMatch(/^#[0-9a-f]{6}$/i);
  });

  test("dark values live only inside the dark block", () => {
    expect(rules.filter((r) => r.sel === ":root")).toHaveLength(2);
    expect(rules.filter((r) => r.sel === ":root" && r.ctx.length === 0)).toHaveLength(1);
  });
});

// Each pair is [foreground token, background token] or a literal white foreground.
const PAIRS: [string, string][] = [
  ["--text", "--bg"],
  ["--text", "--surface"],
  ["--muted", "--bg"],
  ["--muted", "--surface"],
  ["--accent-ink", "--surface"],
  ["--accent-ink", "--bg"],
  ["#ffffff", "--accent"],
  ["--ok", "--surface"],
  ["--err", "--surface"],
  ["--ok", "--tint-ok"],
  ["--err", "--tint-err"],
  ["--accent-ink", "--tint-accent"],
  ["--muted", "--tint-neutral"],
];

for (const theme of ["light", "dark"] as const) {
  describe(`${theme} theme contrast`, () => {
    const t = theme === "light" ? light : { ...light, ...dark };
    const val = (k: string) => (k.startsWith("#") ? k : t[k]!);
    for (const [fg, bg] of PAIRS) {
      test(`${fg} on ${bg} is at least 4.5:1`, () => {
        expect(contrast(val(fg), val(bg))).toBeGreaterThanOrEqual(4.5);
      });
    }
  });
}

describe("tokens only", () => {
  test("every .badge rule takes background and color from var(--token), and every status has a rule", () => {
    const badge = rules.filter((r) => r.sel.split(",").some((p) => /\.badge(?![\w-])/.test(p)));
    const statuses = new Set<string>();
    for (const r of badge) {
      for (const p of r.sel.split(",")) {
        if (/\.badge(?![\w-])/.test(p)) statuses.add(/li\.([\w-]+)\s+\.badge/.exec(p)?.[1] ?? "default");
      }
      const bg = declared(r.body, "background");
      const fg = declared(r.body, "color");
      if (bg === undefined && fg === undefined) continue;
      expect(bg, r.sel).toMatch(/^var\(--[\w-]+\)$/);
      expect(fg, r.sel).toMatch(/^var\(--[\w-]+\)$/);
    }
    for (const s of ["default", "waiting", "converting", "ready", "failed", "deleted"]) {
      expect(statuses.has(s), s).toBe(true);
    }
  });

  test("outside the light :root, the dark block and the reader dialog, the only hex colour is #fff", () => {
    const first = plainRoots[0];
    const reader = (r: Rule) => r.sel.split(",").every((p) => /^\.(preview|pv)/.test(p));
    const rest = rules.filter((r) => r !== first && !r.ctx.includes(DARK) && !reader(r));
    expect(rest.length).toBeGreaterThan(20);
    const stray: string[] = [];
    for (const r of rest) {
      for (const m of r.body.matchAll(/#[0-9a-f]{3,8}(?![\w-])/gi)) {
        if (!/^#f{3}(f{3})?$/i.test(m[0])) stray.push(`${r.sel} ${m[0]}`);
      }
    }
    expect(stray).toEqual([]);
  });
});

describe("indeterminate bar", () => {
  const bar = rules.filter((r) => r.sel === "progress.bar:not([value])" && r.ctx.length === 0);

  test("an animated diagonal stripe sits on the element and its keyframes move background-position", () => {
    expect(bar).toHaveLength(1);
    const body = bar[0]!.body;
    expect(body).toContain("repeating-linear-gradient");
    expect(body).toContain("background-size");
    const name = /(?:^|;)animation:([\w-]+)/.exec(body)?.[1];
    expect(name, "animation name").toBeDefined();
    const frames = rules.filter((r) => r.ctx.includes(`@keyframes ${name}`));
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.some((r) => r.body.includes("background-position"))).toBe(true);
  });

  test("the webkit and moz tracks are transparent for that state so the stripe shows", () => {
    for (const pseudo of ["::-webkit-progress-bar", "::-moz-progress-bar"]) {
      const r = rules.find((x) => x.sel === `progress.bar:not([value])${pseudo}`);
      expect(r, pseudo).toBeDefined();
      expect(declared(r!.body, "background")).toBe("transparent");
    }
  });

  test("prefers-reduced-motion switches the animation off for it", () => {
    const r = rules.find((x) => x.sel === "progress.bar:not([value])" && x.ctx.includes(REDUCED));
    expect(r).toBeDefined();
    expect(declared(r!.body, "animation")).toBe("none");
  });
});

describe("overflow menu CSS", () => {
  const sel = (re: RegExp) => rules.filter((r) => r.ctx.length === 0 && r.sel.split(",").some((p) => re.test(p)));

  test(".more is a 44px square target", () => {
    const more = sel(/\.more(?![\w-])/);
    expect(more.length).toBeGreaterThan(0);
    const bodies = more.map((r) => r.body).join(";");
    expect(declared(bodies, "min-width")).toBe("44px");
    expect(declared(bodies, "min-height") ?? "44px").toBe("44px");
  });

  test(".menu is a fixed popover that is only a flex column while open", () => {
    const menu = rules.find((r) => r.sel === ".menu" && r.ctx.length === 0);
    expect(menu).toBeDefined();
    expect(declared(menu!.body, "position")).toBe("fixed");
    expect(declared(menu!.body, "margin")).toBe("0");
    expect(declared(menu!.body, "inset")).toBe("auto");
    expect(declared(menu!.body, "background")).toBe("var(--surface)");
    expect(declared(menu!.body, "border")).toContain("var(--border)");
    expect(declared(menu!.body, "display")).toBeUndefined();
    const open = rules.find((r) => r.sel === ".menu:popover-open" && r.ctx.length === 0);
    expect(open).toBeDefined();
    expect(declared(open!.body, "display")).toBe("flex");
    expect(declared(open!.body, "flex-direction")).toBe("column");
  });

  test(".menu button is a full-width 44px ghost target", () => {
    const items = sel(/\.menu button(?![\w-])/);
    expect(items.length).toBeGreaterThan(0);
    const bodies = items.map((r) => r.body).join(";");
    expect(declared(bodies, "width")).toBe("100%");
    expect(declared(bodies, "min-height")).toBe("44px");
    expect(declared(bodies, "justify-content")).toBe("flex-start");
  });
});
