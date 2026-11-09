import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// PUBMY_INDEX_HTML points the test at another copy of the page; it exists so the RED proof can run
// against a mutated scratch copy without touching the real file. The default is the shipped page.
const INDEX = process.env.PUBMY_INDEX_HTML ?? join(import.meta.dir, "..", "index.html");
const html = readFileSync(INDEX, "utf8");
const css = (/<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, "");

/** Custom properties of the first :root rule. */
function tokens(): Record<string, string> {
  const rule = /:root\s*\{([^}]*)\}/.exec(css);
  const out: Record<string, string> = {};
  if (!rule) return out;
  for (const m of rule[1]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

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

const t = tokens();

function resolve(value: string): string {
  const v = value.trim();
  const ref = /^var\(\s*(--[\w-]+)\s*\)$/.exec(v);
  if (!ref) return v;
  const found = t[ref[1]!];
  if (found === undefined) throw new Error(`unresolved ${v}`);
  return resolve(found);
}

function declared(body: string, prop: string): string | undefined {
  return new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(body)?.[1]?.trim();
}

interface Tint {
  status: string;
  selector: string;
  background: string;
  color: string;
}

/**
 * Every `.badge` selector in a rule that sets a color. The badge is plain text with no background of its own,
 * so it is read on --surface, the row card behind it. `li .badge` is the default status.
 */
function tints(): Tint[] {
  const out: Tint[] = [];
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const fg = declared(rule[2]!, "color");
    if (fg === undefined) continue;
    for (const raw of rule[1]!.split(",")) {
      const selector = raw.trim();
      if (!/\.badge(?![\w-])/.test(selector)) continue;
      const status = /li\.([\w-]+)\s+\.badge/.exec(selector)?.[1] ?? "default";
      out.push({ status, selector, background: resolve("var(--surface)"), color: resolve(fg) });
    }
  }
  return out;
}

describe("status badge colours on the row surface", () => {
  const found = tints();

  test("the rules were found: at least 5 distinct pairs and every status covered", () => {
    // The waiting rule repeats the default colours, so pairs are keyed by selector as well as colour.
    const pairs = new Set(found.map((x) => `${x.selector}|${x.background}|${x.color}`));
    expect(pairs.size).toBeGreaterThanOrEqual(5);
    const statuses = new Set(found.map((x) => x.status));
    for (const s of ["default", "waiting", "converting", "ready", "failed", "deleted"]) {
      expect(statuses.has(s), s).toBe(true);
    }
  });

  for (const x of tints()) {
    test(`${x.selector} ${x.color} on ${x.background} is at least 4.5:1`, () => {
      expect(contrast(x.color, x.background)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
