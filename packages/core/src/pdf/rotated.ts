// Finds a page whose main content is printed a quarter turn (a landscape table on a portrait page)
// and reads its text back upright as a table grid: caption lines, rows of cells, footnote lines.
// Pure: raw pdf.js text items in, plain data out; tableHtml renders a grid as an XHTML table.
import { escText } from "../xml.ts";

export interface TableGrid {
  /** The title lines above the grid ("Table 1 ..."), joined with spaces. */
  caption?: string;
  /** Top to bottom; every row has one cell per column, "" where a column is empty. */
  rows: string[][];
  /** Lines below the grid, such as "* p < .05". */
  notes?: string[];
}

/** Side stamps ("NIH-PA Author Manuscript", the arXiv label) lie wholly inside the outer 6 percent of the page width. */
const EDGE = 0.06;
/** Running headers and footers sit in the top and bottom 10 percent of the page height, so upright text there does not count. */
const FURNITURE = 0.1;
/** Fewer quarter-turned characters than this is a label, not page content. */
const MIN_CHARS = 10;
/** Runs whose baselines differ by less than this many font sizes share a row (raised stars in the NIH sample sit 0.67 off). */
const ROW_TOLERANCE = 0.7;
/** Runs closer than this many font sizes belong to one cell; columns are further apart. */
const CELL_GAP = 0.6;
const NOTE = /^(\*|†|‡|§|Notes?\b)/;
const NUMERIC = /^[-+−–]?[\d.,]*\d[\d.,]*[%*†‡]*$/;

interface Item {
  str: string;
  t: number[];
  width: number;
}

interface Run {
  text: string;
  /** Upright coordinates: x along the reading direction, y down the rows, both in points. */
  x: number;
  y: number;
  end: number;
  size: number;
}

type Cell = Omit<Run, "y" | "size">;

const visible = (s: string) => s.replace(/\s+/g, "").length;
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "");

function itemOf(raw: unknown): Item | null {
  const r = raw as { str?: unknown; transform?: unknown; width?: unknown } | null;
  if (typeof r?.str !== "string" || !r.str.trim() || !Array.isArray(r.transform) || r.transform.length < 6) return null;
  return { str: r.str, t: r.transform as number[], width: typeof r.width === "number" ? r.width : 0 };
}

/** 0 for upright text, 90 for text reading up the page, -90 for text reading down, null for any other angle. */
function angleOf(t: number[]): 0 | 90 | -90 | null {
  const deg = (Math.atan2(t[1], t[0]) * 180) / Math.PI;
  for (const a of [0, 90, -90] as const) if (Math.abs(deg - a) < 1) return a;
  return null;
}

function isSideStamp(it: Item, angle: 90 | -90, x0: number, x1: number): boolean {
  const size = Math.hypot(it.t[2], it.t[3]);
  const x = it.t[4];
  // glyphs rise toward -x from a +90 baseline and toward +x from a -90 one
  const [from, to] = angle === 90 ? [x - size, x] : [x, x + size];
  const band = (x1 - x0) * EDGE;
  return to <= x0 + band || from >= x1 - band;
}

/** The page's quarter-turned runs in upright coordinates when they outweigh its upright body text, else null. */
function turnedRuns(items: readonly unknown[], view: readonly number[]): Run[] | null {
  const [x0, y0, x1, y1] = view;
  const height = y1 - y0;
  let upright = 0;
  const up: Item[] = [];
  const down: Item[] = [];
  for (const raw of items) {
    const it = itemOf(raw);
    const angle = it && angleOf(it.t);
    if (!it || angle === null) continue;
    if (angle === 0) {
      if (it.t[5] > y0 + height * FURNITURE && it.t[5] < y1 - height * FURNITURE) upright += visible(it.str);
    } else if (!isSideStamp(it, angle, x0, x1)) (angle === 90 ? up : down).push(it);
  }
  const chars = (list: Item[]) => list.reduce((n, it) => n + visible(it.str), 0);
  const [angle, list] = chars(up) >= chars(down) ? ([90, up] as const) : ([-90, down] as const);
  const turned = chars(list);
  if (turned < MIN_CHARS || turned <= upright) return null;
  return list.map((it) => {
    // +90: reading runs up the page and rows advance to the right; -90 is the mirror image
    const x = angle === 90 ? it.t[5] - y0 : y1 - it.t[5];
    const y = angle === 90 ? it.t[4] - x0 : x1 - it.t[4];
    return { text: it.str.trim().replace(/\s+/g, " "), x, y, end: x + it.width, size: Math.hypot(it.t[2], it.t[3]) };
  });
}

function rowsOf(runs: Run[]): Run[][] {
  const rows: Run[][] = [];
  for (const r of [...runs].sort((a, b) => a.y - b.y)) {
    const row = rows.at(-1);
    if (row && r.y - row[0].y < Math.max(row[0].size, r.size) * ROW_TOLERANCE) row.push(r);
    else rows.push([r]);
  }
  return rows;
}

function cellsOf(row: Run[]): Cell[] {
  const cells: Cell[] = [];
  for (const r of [...row].sort((a, b) => a.x - b.x)) {
    const last = cells.at(-1);
    const gap = last ? r.x - last.end : Infinity;
    if (last && gap < r.size * CELL_GAP) {
      last.text += gap > r.size * 0.15 ? ` ${r.text}` : r.text;
      last.end = Math.max(last.end, r.end);
    } else cells.push({ text: r.text, x: r.x, end: r.end });
  }
  return cells;
}

/**
 * A row holding only a label that goes on from the row above: the second line of a wrapped row
 * label ("9. Maternal warmth: age" / "13" in the NIH sample). It starts in lower case or with a
 * digit, so a group heading row such as "Mothers" stays a row of its own.
 */
function continuesLabel(row: string[], above: string[] | undefined): boolean {
  if (!above || !above.slice(1).some(Boolean)) return false;
  return /^[\p{Ll}\d]/u.test(row[0] ?? "") && row.slice(1).every((c) => c === "");
}

/**
 * The grid of a page printed a quarter turn: title lines above the first row of two or more cells
 * become the caption, lines below the last such row become notes, and cells keep their column by
 * clustering cell starts. A page with turned text but no such row (only a table's footnotes) gives
 * no rows and every line as a note. null when the page is not printed turned or holds only side stamps.
 */
export function rotatedTable(items: readonly unknown[], view: readonly number[]): TableGrid | null {
  const runs = turnedRuns(items, view);
  if (!runs) return null;
  const rows = rowsOf(runs).map(cellsOf);
  const line = (cells: Cell[]) => cells.map((c) => c.text).join(" ");
  const multi = rows.flatMap((cells, k) => (cells.length >= 2 && !NOTE.test(cells[0].text) ? [k] : []));
  if (multi.length === 0) return { rows: [], notes: rows.map(line) };
  const [first, last] = [multi[0], multi[multi.length - 1]];
  const body = rows.slice(first, last + 1);
  const sizes = runs.map((r) => r.size).sort((a, b) => a - b);
  const tolerance = sizes[Math.floor(sizes.length / 2)];
  const starts = body.flat().map((c) => c.x).sort((a, b) => a - b);
  const columns = starts.filter((x, k) => k === 0 || x - starts[k - 1] > tolerance);
  const grid: string[][] = [];
  for (const cells of body) {
    const out = columns.map(() => "");
    for (const c of cells) {
      let k = 0;
      while (k + 1 < columns.length && columns[k + 1] <= c.x) k++;
      out[k] = out[k] ? `${out[k]} ${c.text}` : c.text;
    }
    const above = grid.at(-1);
    if (continuesLabel(out, above)) above![0] = `${above![0]} ${out[0]}`;
    else grid.push(out);
  }
  const caption = rows.slice(0, first).map(line).join(" ");
  const notes = rows.slice(last + 1).map(line);
  return { ...(caption ? { caption } : {}), rows: grid, ...(notes.length ? { notes } : {}) };
}

/** A blank corner over a column of row labels, or words over a body that holds numbers. */
function hasHeader(rows: string[][]): boolean {
  const [first, ...rest] = rows;
  const filled = first?.filter(Boolean) ?? [];
  if (rest.length === 0 || filled.length < 2) return false;
  const corner = first[0] === "" && rest.filter((r) => r[0] !== "").length * 2 > rest.length;
  const words = !filled.some((c) => NUMERIC.test(c)) && rest.some((r) => r.some((c) => NUMERIC.test(c)));
  return corner || words;
}

/** XHTML table for a grid: caption, header row in thead when the first row looks like one, notes as paragraphs after it. */
export function tableHtml(grid: TableGrid): string {
  const esc = (s: string) => escText(clean(s));
  const tr = (cells: string[], tag: "th" | "td") => `<tr>${cells.map((c) => `<${tag}>${esc(c)}</${tag}>`).join("")}</tr>`;
  const head = hasHeader(grid.rows);
  const table =
    grid.rows.length === 0
      ? grid.caption ? `<p>${esc(grid.caption)}</p>` : ""
      : `<table>${grid.caption ? `<caption>${esc(grid.caption)}</caption>` : ""}` +
        (head ? `<thead>${tr(grid.rows[0], "th")}</thead>` : "") +
        `<tbody>${(head ? grid.rows.slice(1) : grid.rows).map((r) => tr(r, "td")).join("")}</tbody></table>`;
  return table + (grid.notes ?? []).map((n) => `<p>${esc(n)}</p>`).join("");
}
