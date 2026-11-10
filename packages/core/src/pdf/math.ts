// Areas of a born-digital PDF page that cannot stay reflowable text and are cropped to PNG instead:
// display equations, inline formulas with glyphs that extract wrong (or with a fraction or radical
// bar), and vector diagrams. Pure: it reads a snapshot the PDF adapter already has in its page
// loop (text items, real font names, the operator list), so it runs in Bun and in a Web Worker.
// Rules ported from the 2026-11-07 formula spike (OpenStax University Physics 1, arXiv 1706.03762).
import type { PageBox } from "../types.ts";
import { apply, areaOf, bbOf, clip, grow, inter, mul, overlapX, Sets, touching, union, type BB } from "./geometry.ts";

/** A raw pdf.js getTextContent() item; itemIndexes point into the array of these. */
export interface MathTextItem {
  str?: string;
  transform?: number[];
  width?: number;
  fontName?: string;
}

export interface MathPage {
  /** 1-based page number, copied into each PageBox. */
  page: number;
  view: number[];
  /** getTextContent().items as they come, marked-content entries included. */
  items: MathTextItem[];
  /** fontName (pdf.js id such as "g_d0_f3") to the font's real name, see realFontNames. */
  fonts: Record<string, string>;
  /** page.getOperatorList(), the same one images.ts reads. */
  ops: { fnArray: number[]; argsArray: unknown[] };
  /** (await getResolvedPDFJS()).OPS */
  OPS: Record<string, number>;
}

export type MathAreaKind = "display" | "inline" | "diagram";

export interface MathArea {
  kind: MathAreaKind;
  /** PDF points, origin bottom-left, padded a little and clipped to page.view. */
  box: PageBox;
  /** Text items drawn inside the crop; the caller drops them from the reflowed text. */
  itemIndexes: number[];
  /** Short reason for logs, such as "bar" or "unmapped,accent". */
  why: string;
}

/** A superscript or subscript in math that stays text, for <sup>/<sub>. */
export interface MathScript {
  index: number;
  pos: "sup" | "sub";
}

export interface MathAreas {
  display: MathArea[];
  inline: MathArea[];
  diagrams: MathArea[];
  scripts: MathScript[];
}

export interface FontStore {
  has(id: string): boolean;
  get(id: string): unknown;
}

/**
 * Real font names of the items' fonts. Needs a document opened with fontExtraProperties: true and
 * a prior page.getOperatorList(), which loads the fonts into page.commonObjs.
 */
export function realFontNames(commonObjs: FontStore, items: MathTextItem[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of new Set(items.map((i) => i.fontName).filter((f): f is string => !!f))) {
    try {
      const name = commonObjs.has(id) ? (commonObjs.get(id) as { name?: unknown } | null)?.name : undefined;
      if (typeof name === "string") out[id] = name;
    } catch {
      // a font pdf.js failed to load has no entry; its items count as body text
    }
  }
  return out;
}

interface Item {
  k: number;
  s: string;
  x: number;
  y: number;
  fs: number;
  font: string;
  bb: BB;
  math: boolean;
  unmapped: boolean;
  accent: boolean;
  sup: boolean;
  sub: boolean;
}
interface Path {
  bb: BB;
  rule: "h" | "v" | "rect" | "shape";
}
interface Line {
  items: Item[];
  bb: BB;
  y: number;
}

const MATH_FONT = /CMMI|CMSY|CMEX|CMBSY|MSAM|MSBM|MathematicalPi|Symbol|MT-?Extra|MTSY|MTMI|Euclid|LMMath|Math/i;
/** Math fonts whose glyphs extract as the wrong characters (ASCII lookalikes or nothing useful). */
const LOOKALIKE = /CMEX|MT-?Extra|MTSY|MathematicalPi|Euclid(Symbol|Extra|Math)/i;
const UNMAPPED_CHAR = /[\u0000-\u0008\u000E-\u001F-�]/;
const OP_CHAR = /[=+−×÷±∓·∙≈≠≤≥∝∑∏∫√∞∂∇→←↔∥⊥∈∼≡<>^∘⋅]/;
const ACCENT = /^[→⃗^ˆˇ˜¯˙]$/;
const GLUE = /^[\s()[\]{}.,;:·∙=+−×÷±<>≈∝\-–\d]+$/;
const BIG_DELIM = /[⎧⎨⎩⎪⎛⎜⎝⎞⎟⎠⎡⎢⎣⎤⎥⎦]/;
const FUNC = new Set(["sin", "cos", "tan", "log", "exp", "max", "min", "lim", "det", "cot", "sec", "csc", "sinh", "cosh", "tanh", "arg", "mod"]);
/** Words that may open a displayed line, as in "where h = ...". */
const CONNECTIVE = new Set(["where", "with", "and", "for", "if", "then", "when", "or", "since"]);
const EQ_NUMBER = /^\(\d+(\.\d+)?[a-z]?\)$/;
const PROBLEM_NUMBER = /^(\d+\.){1,3}\d*$/;

const family = (f: string) => f.replace(/-(Bold|Italic|BoldItalic|Oblique|Regular|Roman)$/i, "").replace(/\d+$/, "");
/** Prose words of an item: 3+ letter words outside math fonts and scripts, function names excepted. */
const proseWords = (i: Item) => (i.math || i.sup || i.sub || i.accent ? [] : (i.s.match(/\p{L}{3,}/gu) ?? []).filter((w) => !FUNC.has(w.toLowerCase())));

function itemsOf(p: MathPage): { items: Item[]; body: number } {
  const items: Item[] = [];
  p.items.forEach((r, k) => {
    const t = r.transform;
    if (typeof r.str !== "string" || !r.str.trim() || !t || Math.abs(t[1]) > 1e-6 || Math.abs(t[2]) > 1e-6) return;
    const fs = Math.hypot(t[2], t[3]);
    const font = (p.fonts[r.fontName ?? ""] ?? "").replace(/^[A-Z]{6}\+/, "");
    const lookalike = LOOKALIKE.test(font);
    items.push({ k, s: r.str, x: t[4], y: t[5], fs, font, bb: [t[4], t[5] - 0.25 * fs, t[4] + (r.width ?? 0), t[5] + 0.8 * fs], math: MATH_FONT.test(font), unmapped: lookalike || UNMAPPED_CHAR.test(r.str), accent: false, sup: false, sub: false });
  });
  const chars = new Map<string, number>();
  for (const i of items) chars.set(i.font, (chars.get(i.font) ?? 0) + i.s.length);
  const bodyFam = family([...chars.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "");
  // a TeX text font or a STIX-like font beside a different body family sets math, not prose
  for (const i of items)
    if (!i.math && family(i.font) !== bodyFam && (/^(CMR|CMBX|CMTI|LMRoman)/i.test(i.font) || (/STIX|XITS|Cambria|Asana/i.test(i.font) && !/\p{L}{4,}/u.test(i.s)))) i.math = true;
  const sizes = items.flatMap((i) => Array<number>(i.s.length).fill(i.fs)).sort((a, b) => a - b);
  return { items, body: sizes[sizes.length >> 1] ?? 10 };
}

function graphicsOf(p: MathPage, pw: number, ph: number): { paths: Path[]; images: BB[] } {
  const { OPS } = p;
  const paint = new Set([OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const image = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat]);
  const paths: Path[] = [];
  const images: BB[] = [];
  const stack: number[][] = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  p.ops.fnArray.forEach((fn, q) => {
    const a = p.ops.argsArray[q] as unknown[] | null;
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = mul(a as number[], ctm);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (Array.isArray(a?.[0])) ctm = mul(a[0] as number[], ctm);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (image.has(fn)) {
      const im = clip(bbOf([apply(ctm, 0, 0), apply(ctm, 1, 0), apply(ctm, 0, 1), apply(ctm, 1, 1)]), p.view);
      if (im) images.push(im);
    } else if (fn === OPS.constructPath && a && paint.has(a[0] as number)) {
      // pdf.js 5: [paintOp, [path], minMax]; path ops 0 moveTo, 1 lineTo, 2 curveTo, 3 quadratic, 4 close
      const d = (a[1] as ArrayLike<number>[] | undefined)?.[0];
      if (!d) return;
      const pts: [number, number][] = [];
      let bent = false;
      let last: [number, number] | null = null;
      for (let i = 0; i < d.length; ) {
        const op = d[i++];
        const n = op === 0 || op === 1 ? 2 : op === 2 ? 6 : op === 3 ? 4 : 0;
        if (op === 4) continue;
        if (n === 0) break;
        for (let c = 0; c < n; c += 2) pts.push(apply(ctm, d[i + c], d[i + c + 1]));
        const end = pts[pts.length - 1];
        if (op >= 2 || (op === 1 && last && Math.abs(end[0] - last[0]) > 1 && Math.abs(end[1] - last[1]) > 1)) bent = true;
        last = end;
        i += n;
      }
      if (!pts.length) return;
      const raw = bbOf(pts);
      const [w, h] = [raw[2] - raw[0], raw[3] - raw[1]];
      if (w > pw * 0.95 && h > ph * 0.95) return;
      const bb = clip(raw, p.view);
      if (!bb) return;
      paths.push({ bb, rule: bent ? "shape" : h <= 1.6 && w >= 3 ? "h" : w <= 1.6 && h >= 3 ? "v" : "rect" });
    }
  });
  return { paths, images };
}

/** An accent glyph drawn above a letter takes the letter's baseline, so it joins the letter's line. */
function attachAccents(items: Item[]): void {
  for (const a of items) {
    if (!ACCENT.test(a.s.trim())) continue;
    const under = items
      .filter((o) => o !== a && o.y < a.y && a.y - o.y < o.fs * 1.3 && overlapX(a.bb, o.bb) > 0 && o.s.trim().length <= 3 && !ACCENT.test(o.s.trim()))
      .sort((p, q) => q.y - p.y)[0];
    if (!under) continue;
    // the accented letter is a math symbol even in a text font
    under.math = true;
    a.accent = true;
    a.bb = union(a.bb, [a.bb[0], under.bb[1], a.bb[2], under.bb[1]]);
    a.y = under.y;
  }
}

function linesOf(items: Item[], body: number): Line[] {
  const rows: Item[][] = [];
  for (const i of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.at(-1);
    if (row && Math.abs(row[0].y - i.y) < Math.max(row[0].fs, i.fs) * 0.5) row.push(i);
    else rows.push([i]);
  }
  const lines: Line[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let cur: Item[] = [];
    let end = -1e9;
    for (const i of row) {
      if (cur.length && i.x - end > body * 2.2) lines.push(lineOf(cur)), (cur = []);
      cur.push(i);
      end = Math.max(end, i.bb[2]);
    }
    if (cur.length) lines.push(lineOf(cur));
  }
  return lines;
}
const lineOf = (items: Item[]): Line => ({ items, bb: items.map((i) => i.bb).reduce(union), y: mainY(items) });

/** Baseline carrying the most characters. */
function mainY(items: Item[]): number {
  const by = new Map<number, number>();
  for (const i of items) if (!i.accent) by.set(Math.round(i.y * 2) / 2, (by.get(Math.round(i.y * 2) / 2) ?? 0) + i.s.length);
  return [...by.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? items[0].y;
}

/** Scripts are smaller than the main text and off its baseline; a same-size item set a little high is not. */
function markScripts(items: Item[], body: number): void {
  const y = mainY(items);
  const size = Math.max(...items.filter((i) => Math.abs(i.y - y) < 0.5).map((i) => i.fs), body);
  for (const i of items) {
    i.sup = i.sub = false;
    if (i.accent || i.fs >= size * 0.9 || PROBLEM_NUMBER.test(i.s.trim())) continue;
    if (i.y - y > body * 0.2) i.sup = true;
    else if (y - i.y > body * 0.12) i.sub = true;
  }
}

const above = (i: Item, b: BB, body: number) => i.y > b[1] && i.y < b[1] + body * 1.6 && overlapX(i.bb, b) > 0.4 * Math.max(0.1, i.bb[2] - i.bb[0]);
const below = (i: Item, b: BB, body: number) => i.y < b[1] - 0.2 * body && i.y > b[1] - body * 1.6 && overlapX(i.bb, b) > 0.4 * Math.max(0.1, i.bb[2] - i.bb[0]);

function areaFrom(kind: MathAreaKind, p: MathPage, items: Item[], extra: BB[], why: string, pad: number): MathArea {
  const bb = grow([...items.map((i) => i.bb), ...extra].reduce(union), pad);
  const [vx0, vy0, vx1, vy1] = p.view;
  return {
    kind,
    box: { page: p.page, x0: Math.max(vx0, bb[0]), y0: Math.max(vy0, bb[1]), x1: Math.min(vx1, bb[2]), y1: Math.min(vy1, bb[3]) },
    itemIndexes: items.map((i) => i.k).sort((a, b) => a - b),
    why,
  };
}

/**
 * TeX hangs the radical sign from its bar, so the sign's baseline sits up to a line above its
 * operand's (arXiv 1706.03762: 7.8 pt over a 10 pt operand) and would join the line above. The
 * sign takes the baseline of the operand that starts at its right edge; its box stays where it is.
 */
function hangRadicals(items: Item[], body: number): void {
  for (const s of items.filter((i) => i.s.trim() === "√")) {
    const operand = items
      .filter((o) => o !== s && Math.abs(o.bb[0] - s.bb[2]) < 1.5 && s.y - o.y > 0.3 * body && s.y - o.y < 1.2 * body)
      .sort((a, b) => b.y - a.y)[0];
    if (operand) s.y = operand.y;
  }
}

/**
 * An inline area keeps to its own line: tall glyphs (24 pt fences, sums with limits) must not pull
 * the letters of the lines above and below into the crop. Text whose baseline is within 0.9 body
 * sizes is the formula's own (limits, scripts); farther text is another line.
 */
function clipToLine(a: MathArea, run: Item[], items: Item[], body: number): MathArea {
  const own = new Set(run.map((i) => i.k));
  const base = run.map((i) => i.y).sort((x, y) => x - y)[run.length >> 1];
  const across = items.filter((i) => !own.has(i.k) && i.bb[0] < a.box.x1 && i.bb[2] > a.box.x0);
  // ascenders reach 0.75 of the size above the baseline, descenders 0.25 below it
  const y0 = Math.max(a.box.y0, ...across.filter((i) => i.y < base - 0.9 * body).map((i) => i.y + 0.75 * i.fs));
  const y1 = Math.min(a.box.y1, ...across.filter((i) => i.y > base + 0.9 * body).map((i) => i.y - 0.25 * i.fs));
  return y1 > y0 ? { ...a, box: { ...a.box, y0, y1 } } : a;
}

export function findMathAreas(p: MathPage): MathAreas {
  const [vx0, vy0, vx1, vy1] = p.view;
  const pw = vx1 - vx0;
  const { items, body } = itemsOf(p);
  const { paths, images } = graphicsOf(p, pw, vy1 - vy0);
  attachAccents(items);
  hangRadicals(items, body);
  const lines = linesOf(items, body);
  const lineAt = new Map<Item, number>();
  lines.forEach((l, li) => l.items.forEach((i) => lineAt.set(i, li)));
  const sets = new Sets(lines.length);

  const hrules = paths.filter((q) => q.rule === "h" && q.bb[2] - q.bb[0] <= pw * 0.5);
  // a rule that starts at a radical sign's right edge is the radical's bar, never a fraction bar,
  // even with text of the line above over it
  const radicals = hrules.filter((b) => items.some((i) => i.s.includes("√") && Math.abs(i.bb[2] - b.bb[0]) < 3 && i.bb[3] > b.bb[1] - 3));
  const fractions = hrules.flatMap((b) => {
    if (radicals.includes(b)) return [];
    const num = items.filter((i) => above(i, b.bb, body));
    const den = items.filter((i) => below(i, b.bb, body));
    return num.length && den.length ? [{ bb: b.bb, num, den }] : [];
  });
  const bars = [...fractions.map((f) => f.bb), ...radicals.map((r) => r.bb)];
  const barItems = new Set<Item>([...fractions.flatMap((f) => [...f.num, ...f.den]), ...items.filter((i) => radicals.some((r) => i.y < r.bb[1] && inter(i.bb, [r.bb[0], r.bb[1] - body, r.bb[2], r.bb[1]]) > 0) || i.s.includes("√"))]);

  for (const f of fractions) {
    const own = [...f.num, ...f.den].map((i) => lineAt.get(i) as number);
    for (const li of own) sets.join(li, own[0]);
    // the host line: beside the bar at its height, such as "v =" before the fraction
    const mid = f.bb[1];
    lines.forEach((l, li) => {
      if (Math.abs(l.y + body * 0.3 - mid) < body * 0.6 && l.bb[0] - f.bb[2] < body * 2 && f.bb[0] - l.bb[2] < body * 2) sets.join(li, own[0]);
    });
  }
  // scripts and limits on their own line next to the main line
  for (let a = 0; a < lines.length; a++)
    for (let b = a + 1; b < lines.length; b++) {
      const [A, B] = [lines[a], lines[b]];
      const dy = Math.abs((A.bb[1] + A.bb[3]) / 2 - (B.bb[1] + B.bb[3]) / 2);
      if (dy > 0.3 && dy < body * 0.65 && Math.max(A.bb[0], B.bb[0]) - Math.min(A.bb[2], B.bb[2]) < body * 1.2) sets.join(a, b);
    }
  // brace and bracket pieces stacked over several lines
  for (const it of items.filter((i) => BIG_DELIM.test(i.s))) {
    const col = items.filter((o) => BIG_DELIM.test(o.s) && Math.abs(o.x - it.x) < 3);
    const lo = Math.min(...col.map((o) => o.bb[1]));
    const hi = Math.max(...col.map((o) => o.bb[3]));
    lines.forEach((l, li) => {
      if (l.bb[1] >= lo - 2 && l.bb[3] <= hi + 2 && l.bb[0] >= it.x - 2) sets.join(li, lineAt.get(it) as number);
    });
  }
  // an equation number joins the formula on its baseline
  lines.forEach((l, li) => {
    if (l.items.length !== 1 || !EQ_NUMBER.test(l.items[0].s.trim())) return;
    const host = lines.findIndex((o, oi) => oi !== li && Math.abs(o.y - l.y) < body * 0.8 && o.bb[2] < l.bb[0] && o.items.flatMap(proseWords).length <= 1);
    if (host >= 0) sets.join(li, host);
  });

  const wide = paths.filter((q) => q.rule === "h" && q.bb[2] - q.bb[0] > pw * 0.3).map((q) => q.bb[1]).sort((a, b) => a - b);
  const table: [number, number] | null = wide.length >= 3 ? [wide[0], wide[wide.length - 1]] : null;
  const longLines = lines.filter((l) => l.items.flatMap(proseWords).length >= 4);
  const lefts = longLines.map((l) => Math.round(l.bb[0]));
  const colLefts = [...new Set(lefts)].filter((x) => lefts.filter((v) => v === x).length >= 2);
  const display: MathArea[] = [];
  const inline: MathArea[] = [];

  for (const group of sets.groups()) {
    const its = group.flatMap((li) => lines[li].items).sort((a, b) => a.x - b.x);
    markScripts(its, body);
    const bb = its.map((i) => i.bb).reduce(union);
    if (table && bb[1] >= table[0] - 2 && bb[3] <= table[1] + 14) continue;
    const hasBar = fractions.some((f) => f.num.some((i) => its.includes(i)));
    const isMath = (i: Item) => i.math || i.unmapped || i.accent || i.sup || i.sub || barItems.has(i) || [...i.s].some((c) => OP_CHAR.test(c));
    // a prose tail such as ", and" after the last math item stays text
    let last = its.length - 1;
    while (last > 0 && !isMath(its[last]) && (proseWords(its[last]).length > 0 || !/\p{L}|\d/u.test(its[last].s))) last--;
    const core = its.slice(0, last + 1);
    const tailWords = its.slice(last + 1).flatMap(proseWords).length;
    const words = core.flatMap(proseWords);
    const lead = core.find((i) => !i.accent);
    const leadWord = lead && proseWords(lead).length > 0 && !CONNECTIVE.has(proseWords(lead)[0].toLowerCase());
    const chars = core.reduce((n, i) => n + i.s.trim().length, 0);
    const why = [hasBar ? "bar" : "", core.some((i) => i.unmapped) ? "unmapped" : "", core.some((i) => i.accent) ? "accent" : ""].filter(Boolean).join(",");
    const mathy = core.some(isMath);
    // more than two words after the formula means a sentence goes on: the formula is inline
    const proseOk = tailWords <= 2 && (hasBar ? words.length <= 3 : words.length <= 1 && !leadWord);
    if (mathy && proseOk && chars >= 3 && !PROBLEM_NUMBER.test(core[0].s.trim())) {
      const cbb = core.map((i) => i.bb).reduce(union);
      const others = lines.filter((_, li) => !group.includes(li) && overlapX(lines[li].bb, cbb) > 0);
      const gapUp = Math.min(99, ...others.filter((l) => l.bb[1] >= cbb[3] - 1).map((l) => l.bb[1] - cbb[3]));
      const gapDown = Math.min(99, ...others.filter((l) => l.bb[3] <= cbb[1] + 1).map((l) => cbb[1] - l.bb[3]));
      const colLeft = colLefts.filter((x) => x <= cbb[0] + 1).sort((a, b) => b - a)[0] ?? Math.min(...lines.map((l) => l.bb[0]));
      if (cbb[0] - colLeft >= 8 || (gapUp >= 8 && gapDown >= 8)) {
        display.push(areaFrom("display", p, core, bars.filter((b) => inter(grow(b, 1), cbb) > 0), why || "display", 1));
        continue;
      }
    }
    // inline runs: crop only what text cannot carry (unmapped glyphs, accents, bars)
    const runs: Item[][] = [];
    let run: Item[] = [];
    const flush = () => {
      while (run.length && !isMath(run[run.length - 1])) run.pop();
      if (run.length) runs.push(run);
      run = [];
    };
    for (const i of its) {
      // a subscript word in the text font ("d" with "model" below it) belongs to the formula
      const prose = /\p{L}{4,}/u.test(i.s) && !i.math && !i.sup && !i.sub;
      const glue = run.length > 0 && i.s.trim().length <= 4 && (GLUE.test(i.s) || !/\p{L}{3,}/u.test(i.s));
      if (!prose && (isMath(i) && !PROBLEM_NUMBER.test(i.s.trim()) ? true : glue)) run.push(i);
      else flush();
    }
    flush();
    for (const r of runs) {
      const rbb = r.map((i) => i.bb).reduce(union);
      // a radical's bar belongs to the run under it, not to the line above that it touches
      const bar = bars.filter((b) => inter(grow(b, 1), rbb) > 0 && (!radicals.some((q) => q.bb === b) || r.some((i) => i.y < b[1] && i.bb[2] > b[0] - 3 && i.bb[0] < b[2])));
      const reasons = [r.some((i) => i.unmapped) ? "unmapped" : "", r.some((i) => i.accent) ? "accent" : "", bar.length ? "bar" : ""].filter(Boolean);
      if (reasons.length) inline.push(clipToLine(areaFrom("inline", p, r, bar, reasons.join(","), 1), r, items, body));
    }
  }

  const cropped = new Set([...display, ...inline].flatMap((a) => a.itemIndexes));
  const scripts: MathScript[] = items.filter((i) => (i.sup || i.sub) && !cropped.has(i.k)).map((i) => ({ index: i.k, pos: i.sup ? "sup" : "sub" }));
  const byTop = (a: MathArea, b: MathArea) => b.box.y1 - a.box.y1 || a.box.x0 - b.box.x0;
  return { display: display.sort(byTop), inline: inline.sort(byTop), diagrams: diagramsOf(p, items, paths, images, bars, cropped, pw).sort(byTop), scripts };
}

/** Vector drawings: at least 4 paths of which 2 are curved or diagonal, away from raster images. */
function diagramsOf(p: MathPage, items: Item[], paths: Path[], images: BB[], bars: BB[], cropped: Set<number>, pw: number): MathArea[] {
  const onImage = (b: BB) => images.some((im) => inter(im, b) > 0.5 * areaOf(b));
  const cand = paths.filter((q) => !bars.includes(q.bb) && !(q.rule === "h" && q.bb[2] - q.bb[0] > pw * 0.5) && !onImage(q.bb));
  const sets = new Sets(cand.length);
  touching(cand.map((q) => q.bb), 4, (a, b) => sets.join(a, b));
  const out: MathArea[] = [];
  for (const g of sets.groups()) {
    const bb = g.map((i) => cand[i].bb).reduce(union);
    if (g.length < 4 || g.filter((i) => cand[i].rule === "shape").length < 2 || bb[2] - bb[0] <= 25 || bb[3] - bb[1] <= 25 || onImage(bb)) continue;
    const inside = (i: Item) => {
      const [cx, cy] = [(i.bb[0] + i.bb[2]) / 2, (i.bb[1] + i.bb[3]) / 2];
      return cx >= bb[0] - 3 && cx <= bb[2] + 3 && cy >= bb[1] - 3 && cy <= bb[3] + 3;
    };
    // a few strokes around running text (an example box) are a frame, not a figure; attention maps
    // in arXiv 1706.03762 hold sentences too, but are drawn with hundreds of paths
    if (g.length < 12 && items.filter((i) => inside(i) && i.s.trim().length > 12 && /\p{L}{3,}\s+\p{L}{3,}/u.test(i.s)).length >= 3) continue;
    const labels = items.filter((i) => inside(i) && !cropped.has(i.k) && !/^(Figure|Fig\.)/i.test(i.s.trim()));
    const rotated = p.items.flatMap((r, k) => {
      const t = r.transform;
      return t && r.str?.trim() && (Math.abs(t[1]) > 1e-6 || Math.abs(t[2]) > 1e-6) && t[4] >= bb[0] && t[4] <= bb[2] && t[5] >= bb[1] && t[5] <= bb[3] ? [k] : [];
    });
    const area = areaFrom("diagram", p, labels, [bb], `paths${g.length}`, 2);
    area.itemIndexes = [...area.itemIndexes, ...rotated].sort((a, b) => a - b);
    out.push(area);
  }
  return out;
}
