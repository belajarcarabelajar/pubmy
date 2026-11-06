// Pure page layout (no I/O): rebuilds the reading order of a born-digital PDF page from
// positioned text items and groups the lines into headings and paragraphs.
// Lifted from spike p4-unpdf-cbr/src/layout.ts. PDF coordinates: origin bottom-left, y grows up.

export interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  /** Text not running left-to-right (transform b or c non-zero), e.g. the arXiv side stamp. */
  rotated?: boolean;
}

export interface Block {
  kind: "heading" | "para";
  level?: 1 | 2;
  text: string;
}

export interface PageInfo {
  width: number;
  height: number;
  /** Body font size for the whole document; the page's own median when absent. */
  bodySize?: number;
  /** Headings at this size or larger are level 1; when absent, the largest of 2+ heading sizes on the page. */
  titleSize?: number;
}

interface Line {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  region: "full" | "left" | "right";
}

const TOL = 3;
/** A heading is any size above the body median (spike H4b: 11.96 against 10.91 failed a 1.2 ratio). */
const HEADING_RATIO = 1.03;
const HEADING_MAX_WORDS = 12;

/**
 * Left edge of the right column: the most common item start x (weighted by characters)
 * in the middle 30-70 percent of the page, if it carries at least 15 percent of the text.
 */
function rightColumnStart(items: TextItem[], pageWidth: number): number | null {
  const hist = new Map<number, number>();
  let total = 0;
  for (const i of items) {
    const n = i.str.trim().length;
    total += n;
    const x = Math.round(i.x);
    if (x > pageWidth * 0.3 && x < pageWidth * 0.7) hist.set(x, (hist.get(x) ?? 0) + n);
  }
  let best: [number, number] | null = null;
  for (const [x, n] of hist) if (!best || n > best[1]) best = [x, n];
  return best && best[1] >= total * 0.15 ? best[0] : null;
}

const sameLine = (a: TextItem, b: TextItem) => Math.abs(a.y - b.y) < Math.max(a.fontSize, b.fontSize) * 0.5;

function toLines(items: TextItem[], region: Line["region"]): Line[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: TextItem[][] = [];
  for (const i of sorted) {
    const g = groups.at(-1);
    if (g && sameLine(g[0], i)) g.push(i);
    else groups.push([i]);
  }
  return groups
    .map((g) => {
      g.sort((a, b) => a.x - b.x);
      let text = "";
      let end = -Infinity;
      for (const i of g) {
        if (text && i.x - end > i.fontSize * 0.15 && !text.endsWith(" ") && !i.str.startsWith(" ")) text += " ";
        text += i.str;
        end = Math.max(end, i.x + i.width);
      }
      return { text: text.replace(/\s+/g, " ").trim(), x: g[0].x, y: g[0].y, fontSize: Math.max(...g.map((i) => i.fontSize)), region };
    })
    .filter((l) => l.text);
}

/** Bands cut at every full-width line; inside a band the left column is read before the right. */
function readingOrder(items: TextItem[], pageWidth: number): Line[] {
  const mid = rightColumnStart(items, pageWidth);
  if (mid === null) return toLines(items, "full");
  const seeds = items.filter((i) => i.x < mid - TOL && i.x + i.width > mid + TOL);
  const full: TextItem[] = [];
  const cols: TextItem[] = [];
  for (const i of items) (seeds.some((s) => sameLine(s, i)) ? full : cols).push(i);
  const fullLines = toLines(full, "full");
  const out: Line[] = [];
  let top = Infinity;
  for (const cut of [...fullLines.map((l) => l.y), -Infinity]) {
    const band = cols.filter((i) => i.y < top && i.y > cut);
    out.push(...toLines(band.filter((i) => i.x < mid - TOL), "left"), ...toLines(band.filter((i) => i.x >= mid - TOL), "right"));
    const f = fullLines.find((l) => l.y === cut);
    if (f) out.push(f);
    top = cut;
  }
  return out;
}

/** Character-weighted median font size of the given items. */
export function bodySize(items: TextItem[]): number {
  const sizes: number[] = [];
  for (const i of items) for (let k = 0; k < i.str.trim().length; k++) sizes.push(i.fontSize);
  sizes.sort((a, b) => a - b);
  return sizes[Math.floor(sizes.length / 2)] ?? 0;
}

/** Items that take part in the layout: visible, unrotated, not a lone page number in the margin. */
export function usableItems(items: TextItem[], pageHeight: number): TextItem[] {
  return items.filter(
    (i) => i.str.trim() && !i.rotated && !(/^\d{1,4}$/.test(i.str.trim()) && (i.y < pageHeight * 0.08 || i.y > pageHeight * 0.95)),
  );
}

const wordCount = (s: string) => s.split(" ").filter(Boolean).length;
const isHeading = (l: Line, body: number) => l.fontSize > body * HEADING_RATIO && wordCount(l.text) <= HEADING_MAX_WORDS;

function join(a: string, b: string): string {
  return /[A-Za-z]-$/.test(a) && /^[a-z]/.test(b) ? a.slice(0, -1) + b : `${a} ${b}`;
}

/** Headings of these sizes count as level 1: the largest when there are two or more heading sizes. */
export function titleSizeOf(headingSizes: number[]): number {
  const distinct = [...new Set(headingSizes.map((s) => Math.round(s * 10) / 10))];
  return distinct.length > 1 ? Math.max(...distinct) : Infinity;
}

/** Pure: positioned text items of one page to heading and paragraph blocks in reading order. */
export function layoutPage(items: TextItem[], page: PageInfo): Block[] {
  const real = usableItems(items, page.height);
  const body = page.bodySize ?? bodySize(real);
  const lines = readingOrder(real, page.width);
  const heads = lines.filter((l) => isHeading(l, body));
  const title = page.titleSize ?? titleSizeOf(heads.map((l) => l.fontSize));
  const blocks: Block[] = [];
  let prev: Line | undefined;
  let prevHead = false;
  for (const l of lines) {
    const head = isHeading(l, body);
    const last = blocks.at(-1);
    const near = prev !== undefined && prev.region === l.region && prev.y - l.y <= l.fontSize * 1.6;
    const sameSize = prev !== undefined && Math.abs(prev.fontSize - l.fontSize) < 0.5;
    if (head) {
      if (last?.kind === "heading" && prevHead && near && sameSize && prev!.y - l.y <= l.fontSize * 1.5) last.text += ` ${l.text}`;
      else blocks.push({ kind: "heading", level: l.fontSize >= title - 0.05 ? 1 : 2, text: l.text });
    } else {
      const continues =
        last?.kind === "para" &&
        !prevHead &&
        sameSize &&
        (prev!.region === l.region ? near && l.x - prev!.x <= l.fontSize * 0.8 : /^[a-z]/.test(l.text));
      if (continues) last.text = join(last.text, l.text);
      else blocks.push({ kind: "para", text: l.text });
    }
    prev = l;
    prevHead = head;
  }
  return blocks;
}
