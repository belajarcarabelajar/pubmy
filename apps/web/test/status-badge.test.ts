import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { refusalRow, renderRow, type RowView } from "../src/row.ts";

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

function declared(body: string, prop: string): string | undefined {
  return new RegExp(`(?:^|;)${prop}:([^;]+)`).exec(body)?.[1]?.trim();
}

function customProps(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(?:^|;)(--[\w-]+):([^;]+)/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

const light = customProps(rules.find((r) => r.sel === ":root" && r.ctx.length === 0)?.body ?? "");
const dark = customProps(rules.find((r) => r.sel === ":root" && r.ctx.includes(DARK))?.body ?? "");
const THEMES = { light, dark: { ...light, ...dark } } as const;

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

const STATUSES = ["default", "waiting", "converting", "ready", "failed", "deleted"] as const;
// What each status colour has to be, taken from the plan and not read back from the page.
const COLOUR: Record<(typeof STATUSES)[number], string> = {
  default: "var(--muted)",
  waiting: "var(--muted)",
  converting: "var(--accent-ink)",
  ready: "var(--ok)",
  failed: "var(--err)",
  deleted: "var(--muted)",
};

const isBadge = (entry: string) => /\.badge(?![\w-])/.test(entry);
const statusOf = (entry: string) => /li\.([\w-]+)\s+\.badge/.exec(entry)?.[1] ?? "default";

/** Every `.badge` rule, at any at-rule depth. */
const badgeRules = rules.filter((r) => r.sel.split(",").some(isBadge));

/** The rule that styles `.badge` for one status: the one whose selector list holds that status's entry. */
function ruleFor(status: (typeof STATUSES)[number]): Rule | undefined {
  return badgeRules.find((r) => r.sel.split(",").some((e) => isBadge(e) && statusOf(e) === status));
}

describe("flat status badge CSS", () => {
  test("the default and all five statuses have a .badge rule", () => {
    for (const s of STATUSES) expect(ruleFor(s), s).toBeDefined();
  });

  test("no .badge rule is a pill: no radius, no background, no padding", () => {
    expect(badgeRules.length).toBeGreaterThanOrEqual(5);
    for (const r of badgeRules) {
      expect(r.body, `${r.sel} border-radius`).not.toMatch(/(?:^|;)border-radius:/);
      expect(r.body, `${r.sel} background`).not.toMatch(/(?:^|;)background[\w-]*:/);
      expect(r.body, `${r.sel} padding`).not.toMatch(/(?:^|;)padding[\w-]*:/);
    }
  });

  test("no rule uses a tint token any more, so none is left defined", () => {
    expect(css).not.toContain("--tint-");
  });

  test("the glyph keeps its own rule and sits beside the text", () => {
    const li = ruleFor("default")!;
    expect(declared(li.body, "display")).toBe("inline-flex");
    expect(declared(li.body, "gap")).toBeDefined();
    const icon = rules.find((r) => r.sel === ".badge-icon" && r.ctx.length === 0);
    expect(icon).toBeDefined();
    expect(declared(icon!.body, "flex")).toBe("none");
  });
});

for (const [theme, tokens] of Object.entries(THEMES)) {
  describe(`${theme} theme status colours`, () => {
    for (const s of STATUSES) {
      test(`${s} text is ${COLOUR[s]} and at least 4.5:1 on --surface`, () => {
        const color = declared(ruleFor(s)?.body ?? "", "color");
        expect(color, `${s} colour`).toBe(COLOUR[s]);
        const token = /^var\((--[\w-]+)\)$/.exec(color!)![1]!;
        expect(contrast(tokens[token]!, tokens["--surface"]!)).toBeGreaterThanOrEqual(4.5);
      });
    }
  });
}

const li = () => parseHTML("<html><body><ul><li></li></ul></body></html>").document.querySelector("li") as unknown as HTMLLIElement;
const doc = () => parseHTML("<html><body></body></html>").document as unknown as Document;
const actions = { preview: () => {}, extend: () => {}, remove: () => {} };
const view = (status: string, statusText: string): RowView => ({ name: "buku.md", status, statusText });

describe("status stays text and glyph, not colour alone", () => {
  const glyphs: [string, RowView, string][] = [
    ["waiting", view("waiting", "Waiting"), "o"],
    ["converting", view("converting", "Converting"), "~"],
    [
      "ready",
      { ...view("ready", "Ready"), ready: { url: "blob:x", download: "buku.epub", expired: false, remaining: 1000 } },
      "✓",
    ],
    ["failed", view("failed", "Failed"), "x"],
    [
      "deleted",
      { ...view("ready", "Deleted"), ready: { download: "buku.epub", expired: true, remaining: 0 } },
      "-",
    ],
  ];

  test("every status row still emits a hidden glyph followed by the status word", () => {
    for (const [status, v, glyph] of glyphs) {
      const row = li();
      renderRow(row, v, "en", actions);
      const badge = row.querySelector(".status .badge")!;
      expect(badge, status).not.toBeNull();
      const icon = badge.querySelector(".badge-icon");
      expect(icon?.getAttribute("aria-hidden"), status).toBe("true");
      expect(icon?.textContent, status).toBe(glyph);
      expect(badge.textContent, status).toBe(glyph + v.statusText);
    }
  });

  test("the five glyphs differ from each other", () => {
    expect(new Set(glyphs.map(([, , g]) => g)).size).toBe(glyphs.length);
  });

  test("a refusal row keeps its x glyph and Refused word under the failed colour rule", () => {
    const row = refusalRow(doc(), "a.exe", "no", "en");
    expect(row.className.split(" ")).toContain("failed");
    expect(row.querySelector(".badge-icon")?.textContent).toBe("x");
    expect(row.querySelector(".badge")?.textContent).toBe("xRefused");
  });
});
