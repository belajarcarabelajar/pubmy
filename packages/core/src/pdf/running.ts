// Pure (no I/O): finds running heads and feet, the lines a PDF repeats in the top or bottom band
// of most pages, and removes them before layout so they do not land in the text as paragraphs.
// Digits do not count when lines are compared: "Wang and Kenny Page 8" repeats "... Page 9".
import type { TextItem } from "./layout.ts";

export interface PageItems {
  items: TextItem[];
  height: number;
}

/** Share of the page height at the top and at the bottom where running heads and feet sit. */
const BAND = 0.1;
/** A line is running when it repeats on at least this many pages and on half of them. */
const MIN_PAGES = 3;
/** Share of the page height at each end that the position rule looks at; wider than BAND. */
const ZONE = 0.15;
/** How far, as a share of the page height, the position rule reaches past the block the band rule removed. */
const REACH = 0.05;
/** Points to which x and y are rounded when two items count as the same position. */
const ROUND = 2;

/** Lower case, every number as "#", punctuation and spacing ignored. */
function keyOf(line: TextItem[]): string {
  return [...line]
    .sort((a, b) => a.x - b.x)
    .map((i) => i.str)
    .join(" ")
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/[^\p{L}#]+/gu, " ")
    .trim();
}

/** Unrotated items in the top or bottom band, grouped into lines by baseline. */
function bandLines(p: PageItems): TextItem[][] {
  const band = p.items
    .filter((i) => !i.rotated && i.str.trim() && (i.y > p.height * (1 - BAND) || i.y < p.height * BAND))
    .sort((a, b) => b.y - a.y);
  const lines: TextItem[][] = [];
  for (const i of band) {
    const line = lines.at(-1);
    if (line && Math.abs(line[0].y - i.y) < Math.max(line[0].fontSize, i.fontSize) * 0.5) line.push(i);
    else lines.push([i]);
  }
  return lines;
}

/**
 * The items below a running header, or above a running footer, that the band rule missed because
 * the template block reaches past BAND, each with its position key. An item qualifies only when
 * (a) it is unrotated and in the top or bottom ZONE and its text holds a letter, so numbers and
 * punctuation never qualify; (b) it lies within REACH of the block the band rule already removed
 * on that side of that page, so a page without a detected header or footer is never touched; and
 * (c) its position key (text with digits as "#", x and y to the nearest 2 pt) repeats on enough
 * pages, which the caller checks. The rule only continues a detected block: position alone cannot
 * tell a template row from a per-page data row such as a total or a list entry.
 */
function continuation(p: PageItems, dropped: Set<TextItem>): { item: TextItem; key: string }[] {
  // Infinity and -Infinity when nothing was dropped on that side: no item is within reach of them.
  let topEdge = Infinity;
  let bottomEdge = -Infinity;
  for (const i of dropped) {
    if (i.y > p.height * (1 - BAND)) topEdge = Math.min(topEdge, i.y);
    else if (i.y < p.height * BAND) bottomEdge = Math.max(bottomEdge, i.y);
  }
  const reach = p.height * REACH;
  return p.items
    .filter((i) => !i.rotated && i.str.trim())
    .filter((i) => (i.y > p.height * (1 - ZONE) && i.y >= topEdge - reach) || (i.y < p.height * ZONE && i.y <= bottomEdge + reach))
    .map((item) => ({ item, text: keyOf([item]) }))
    .filter(({ text }) => /\p{L}/u.test(text))
    .map(({ item, text }) => ({ item, key: `${text}@${Math.round(item.x / ROUND)},${Math.round(item.y / ROUND)}` }));
}

/** The keys that occur on at least `need` different pages (each page counts once per key). */
function repeated(perPage: string[][], need: number): Set<string> {
  const seen = new Map<string, number>();
  for (const keys of perPage) for (const key of new Set(keys)) seen.set(key, (seen.get(key) ?? 0) + 1);
  return new Set([...seen].filter(([key, n]) => key && n >= need).map(([key]) => key));
}

/**
 * The pages without their running heads and feet. A running line also goes where it sits in
 * the other band, such as a journal footer that page 1 prints at the top. A second rule continues
 * a detected block: the letter-bearing items that sit just beyond it and repeat at the same
 * position on enough pages go too, which catches the last rows of a header table that end below
 * the band. Documents of fewer than 3 pages come back unchanged: two pages cannot tell a running
 * line from body text.
 */
export function stripRunning<P extends PageItems>(pages: P[]): P[] {
  if (pages.length < MIN_PAGES) return pages;
  const need = Math.max(MIN_PAGES, Math.floor(pages.length / 2));
  const lines = pages.map(bandLines);
  const running = repeated(lines.map((page) => page.map(keyOf)), need);
  const dropped = lines.map((page) => page.filter((l) => running.has(keyOf(l))).flat());
  const next = pages.map((p, k) => continuation(p, new Set(dropped[k])));
  const anchored = repeated(next.map((page) => page.map((c) => c.key)), need);
  return pages.map((p, k) => {
    const drop = new Set(dropped[k]);
    for (const c of next[k]) if (anchored.has(c.key)) drop.add(c.item);
    return drop.size > 0 ? { ...p, items: p.items.filter((i) => !drop.has(i)) } : p;
  });
}
