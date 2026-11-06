// Pure layout logic (no I/O): rebuild reading order of a multi-column PDF page from positioned text items.
// PDF coordinates: origin bottom-left, y grows upward.

export interface Item {
  str: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  /** Text not running left-to-right on the page (transform b or c non-zero), e.g. the arXiv side stamp. */
  rotated?: boolean;
}

export interface Line {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  region: "full" | "left" | "right";
}

const TOL = 3;

/**
 * Left edge of the right column: the most common item start x (weighted by characters)
 * in the middle 30-70 percent of the page, if it carries at least 15 percent of the text.
 * A start-x histogram survives centred lines that sit in the gutter, which an
 * "empty gutter" search does not (arXiv 2302.13971 p1, "Meta AI").
 */
export function rightColumnStart(items: Item[], pageWidth: number): number | null {
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

function toLines(items: Item[], region: Line["region"]): Line[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: Item[][] = [];
  for (const i of sorted) {
    const g = groups.at(-1);
    if (g && Math.abs(g[0].y - i.y) < Math.max(g[0].fontSize, i.fontSize) * 0.5) g.push(i);
    else groups.push([i]);
  }
  return groups.map((g) => {
    g.sort((a, b) => a.x - b.x);
    let text = "";
    let end = -Infinity;
    for (const i of g) {
      if (text && i.x - end > i.fontSize * 0.15 && !text.endsWith(" ") && !i.str.startsWith(" ")) text += " ";
      text += i.str;
      end = Math.max(end, i.x + i.width);
    }
    return {
      text: text.replace(/\s+/g, " ").trim(),
      x: g[0].x,
      y: g[0].y,
      fontSize: Math.max(...g.map((i) => i.fontSize)),
      region,
    };
  }).filter((l) => l.text);
}

/**
 * Reading order: the page is cut into horizontal bands at every full-width line
 * (one that crosses the gutter); inside a band the left column is read before the right.
 */
export function readingOrder(items: Item[], pageWidth: number): Line[] {
  const real = items.filter((i) => i.str.trim() && !i.rotated);
  const mid = rightColumnStart(real, pageWidth);
  if (mid === null) return toLines(real, "full");
  const crosses = (i: Item) => i.x < mid - TOL && i.x + i.width > mid + TOL;
  const sameLine = (a: Item, b: Item) => Math.abs(a.y - b.y) < Math.max(a.fontSize, b.fontSize) * 0.5;
  const seeds = real.filter(crosses);
  const full: Item[] = [];
  const cols: Item[] = [];
  // an item on the same baseline as a gutter-crossing item belongs to that full-width line
  for (const i of real) (seeds.some((s) => sameLine(s, i)) ? full : cols).push(i);
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

/** Body size = character-weighted median font size; heading = line font size > median * 1.2. */
export function bodyFontSize(lines: Line[]): number {
  const sizes: number[] = [];
  for (const l of lines) for (let k = 0; k < l.text.length; k++) sizes.push(l.fontSize);
  sizes.sort((a, b) => a - b);
  return sizes[Math.floor(sizes.length / 2)] ?? 0;
}

export function headings(lines: Line[], ratio = 1.2): Line[] {
  const body = bodyFontSize(lines);
  return lines.filter((l) => l.fontSize > body * ratio);
}
