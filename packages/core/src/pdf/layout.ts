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
  /** "html" is ready XHTML in `text`: a figure or a rebuilt table, placed as it is. */
  kind: "heading" | "para" | "html";
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

/** A figure or table of a page, already XHTML. */
export interface PageFigure {
  /** Top edge in points, measured down from the top of the page. */
  top: number;
  html: string;
}

/** The positioned text of one page, with its figures. */
export interface PageText {
  items: TextItem[];
  width: number;
  height: number;
  /** Placed among the page's text blocks by their top edge. */
  figures?: PageFigure[];
}

/** A block with the 1-based page it starts on. */
export interface PageBlock extends Block {
  page: number;
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
/** Largest gap between two lines of one heading, in font sizes. */
const HEADING_GAP = 1.5;
/**
 * The same when the next line starts at the same x, as a wrapped heading does. NIH manuscript
 * nihms496502 sets 12 pt headings on a 20 pt pitch (1.67); the wider limit for every line would
 * also join the centred "Meta AI" under the arXiv 2302.13971 author line, 20 pt below at 12 pt.
 */
const HEADING_WRAP_GAP = 2;
/** Sentence-final punctuation, maybe followed by closing quotes or brackets. */
const SENTENCE_END = /[.?!:]["'”’)\]]*$/;
/** A figure or table caption; it never continues the paragraph before it. */
const CAPTION = /^(fig(ure)?\.?|table)\s*\d/i;
/** A reference list entry opens with a surname and initials: "Buss DM.", "Jang S, Smith CA.", "Gershoff, E. T.". */
const REFERENCE_START = /^\p{Lu}[\p{L}'’-]+,?\s+(\p{Lu}\.\s*)*\p{Lu}{1,3}[.,]/u;

/** A cut paragraph that plainly goes on: it ends in a comma, semicolon, open bracket or ampersand. */
const OPEN_END = /[,;(&]$/;
/** Sentence punctuation inside a run of text; a table header row ("GPU Power GPU Type") has none. */
const PUNCTUATED = /[,;]\s|\.\s|\.$/;

/** Prose has function words: two of the first twelve words start in lower case; a table header row has none. */
const readsAsProse = (s: string) => s.split(/\s+/, 12).filter((w) => /^\p{Ll}/u.test(w)).length >= 2;

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

/** Lines in a row above body size before they read as a callout box rather than a wrapped title. */
const PROSE_RUN_LINES = 3;
/** Callout text is set a little above body size (OpenStax 10.5 on 10 pt); a title well above it is never a callout. */
const CALLOUT_MAX_RATIO = 1.15;

/** Running text: half its words start in lower case and it has sentence punctuation; a title-case heading has neither. */
function readsAsSentences(s: string): boolean {
  const words = s.split(" ").filter(Boolean);
  return words.filter((w) => /^\p{Ll}/u.test(w)).length * 2 >= words.length && PUNCTUATED.test(s);
}

/**
 * Which lines are headings. A textbook callout box (OpenStax "Check Your Understanding", set
 * 5 percent above body size) is a run of 3+ large lines of one size, each under the next, that
 * reads as sentences: all its lines are body text, so the box stays one paragraph.
 */
function headingFlags(lines: Line[], body: number): boolean[] {
  const flags = lines.map((l) => isHeading(l, body));
  const large = (l: Line) => l.fontSize > body * HEADING_RATIO;
  let start = 0;
  for (let i = 1; i <= lines.length; i++) {
    const [a, b] = [lines[i - 1], lines[i]];
    const gap = b ? a.y - b.y : 0;
    if (b && large(a) && a.region === b.region && Math.abs(a.fontSize - b.fontSize) < 0.5 && gap > 0 && gap <= b.fontSize * HEADING_WRAP_GAP) continue;
    const run = lines.slice(start, i);
    if (run.length >= PROSE_RUN_LINES && large(run[0]) && run[0].fontSize <= body * CALLOUT_MAX_RATIO && readsAsSentences(run.map((l) => l.text).join(" "))) flags.fill(false, start, i);
    start = i;
  }
  return flags;
}

/**
 * A suspended compound ("within- and between-group"): a word of 3+ letters, its hyphen, then one
 * of these. arXiv 2302.13971 breaks "Con- nor" and "an- and..." in names, so "nor" and 2-letter
 * pieces are left out.
 */
const SUSPENDED_HEAD = /(^|\s)[A-Za-z]{3,}-$/;
const SUSPENDED = /^(and|or|to|but)\b/;

/** Two lines of one paragraph; a word hyphenated at the end of the first is joined again. */
function join(a: string, b: string): string {
  const suspended = SUSPENDED_HEAD.test(a) && SUSPENDED.test(b);
  if (/[A-Za-z]-$/.test(a) && /^[a-z]/.test(b) && !suspended) return a.slice(0, -1) + b;
  // before a capital the hyphen is the compound's own ("GPT-Neo", "CrowS-Pairs"): keep it, drop the space
  if (/[A-Za-z]-$/.test(a) && /^[A-Z]/.test(b)) return a + b;
  return `${a} ${b}`;
}

/** Headings of these sizes count as level 1: the largest when there are two or more heading sizes. */
export function titleSizeOf(headingSizes: number[]): number {
  const distinct = [...new Set(headingSizes.map((s) => Math.round(s * 10) / 10))];
  return distinct.length > 1 ? Math.max(...distinct) : Infinity;
}

/** Blocks of one page with the font size and the top edge (points down from the page top) of each. */
function build(items: TextItem[], page: PageInfo): { blocks: Block[]; sizes: number[]; tops: number[] } {
  const real = usableItems(items, page.height);
  const body = page.bodySize ?? bodySize(real);
  const lines = readingOrder(real, page.width);
  const flags = headingFlags(lines, body);
  const heads = lines.filter((_, k) => flags[k]);
  const title = page.titleSize ?? titleSizeOf(heads.map((l) => l.fontSize));
  const blocks: Block[] = [];
  const sizes: number[] = [];
  const tops: number[] = [];
  let prev: Line | undefined;
  let prevHead = false;
  for (const [k, l] of lines.entries()) {
    const head = flags[k];
    const last = blocks.at(-1);
    const sameRegion = prev !== undefined && prev.region === l.region;
    const gap = prev === undefined ? Infinity : prev.y - l.y;
    const near = sameRegion && gap <= l.fontSize * 1.6;
    const sameSize = prev !== undefined && Math.abs(prev.fontSize - l.fontSize) < 0.5;
    const wrapped = prev !== undefined && Math.abs(prev.x - l.x) < TOL && gap <= l.fontSize * HEADING_WRAP_GAP;
    if (head) {
      if (last?.kind === "heading" && prevHead && sameRegion && sameSize && (gap <= l.fontSize * HEADING_GAP || wrapped)) last.text += ` ${l.text}`;
      else blocks.push({ kind: "heading", level: l.fontSize >= title - 0.05 ? 1 : 2, text: l.text });
    } else {
      const continues =
        last?.kind === "para" && !prevHead && sameSize && (sameRegion ? near && l.x - prev!.x <= l.fontSize * 0.8 : /^[a-z]/.test(l.text));
      if (continues) last.text = join(last.text, l.text);
      else blocks.push({ kind: "para", text: l.text });
    }
    if (blocks.length > sizes.length) {
      sizes.push(l.fontSize);
      tops.push(page.height - l.y - l.fontSize);
    }
    prev = l;
    prevHead = head;
  }
  return { blocks, sizes, tops };
}

/** Pure: positioned text items of one page to heading and paragraph blocks in reading order. */
export function layoutPage(items: TextItem[], page: PageInfo): Block[] {
  return build(items, page).blocks;
}

interface Sized {
  block: PageBlock;
  /** Font size; 0 for a figure, which the page-break join passes over like a footnote. */
  size: number;
  top: number;
}

/**
 * The paragraph a page break cut, when the next page's first paragraph `first` goes on with it:
 * same size, and `first` starts in lower case, or the cut one lacks sentence-final punctuation,
 * `first` is not a new reference entry, and `first` reads as prose, or the cut one ends open (a
 * comma) and `first` carries sentence punctuation ("Sameroff, & Cole, 2003)."). arXiv 2302.13971
 * puts table header rows and nihms496502 puts reference entries at the top of a page after a cut sentence.
 * Smaller text after the cut paragraph, such as a footnote, is passed over.
 */
function cutParagraph(tail: Sized[], first: Sized): Sized | undefined {
  let k = tail.length - 1;
  while (k >= 0 && tail[k].size < first.size - 0.5) k--;
  const host = tail[k];
  if (host?.block.kind !== "para" || Math.abs(host.size - first.size) >= 0.5 || CAPTION.test(first.block.text)) return undefined;
  const next = first.block.text;
  if (/^[a-z]/.test(next)) return host;
  const cut = host.block.text;
  const goesOn = readsAsProse(next) || (OPEN_END.test(cut) && PUNCTUATED.test(next));
  return !SENTENCE_END.test(cut) && !REFERENCE_START.test(next) && goesOn ? host : undefined;
}

/**
 * Pure: the blocks of every page in reading order, each figure before the first text block below
 * its top edge, and a paragraph cut by a page break joined again, also across a figure.
 */
export function layoutPages(pages: PageText[], doc: { bodySize: number; titleSize: number }): PageBlock[] {
  const out: PageBlock[] = [];
  let tail: Sized[] = [];
  pages.forEach((p, k) => {
    const { blocks, sizes, tops } = build(p.items, { width: p.width, height: p.height, ...doc });
    const next: Sized[] = blocks.map((b, i) => ({ block: { ...b, page: k + 1 }, size: sizes[i], top: tops[i] }));
    for (const f of [...(p.figures ?? [])].sort((a, b) => a.top - b.top)) {
      const below = next.findIndex((n) => n.size > 0 && n.top > f.top);
      next.splice(below < 0 ? next.length : below, 0, { block: { kind: "html", text: f.html, page: k + 1 }, size: 0, top: f.top });
    }
    const at = next.findIndex((n) => n.size > 0);
    const host = next[at]?.block.kind === "para" ? cutParagraph(tail, next[at]) : undefined;
    if (host) host.block.text = join(host.block.text, next.splice(at, 1)[0].block.text);
    out.push(...next.map((n) => n.block));
    tail = host ? [host, ...next] : next;
  });
  return out;
}
