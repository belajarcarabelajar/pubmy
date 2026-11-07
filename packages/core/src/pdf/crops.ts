// Formula and diagram areas of a PDF page as PNG crops in the reflowable book (owner decision
// 2026-11-07: no generative AI; a PDF holds placed glyphs, not LaTeX). Display equations and
// diagrams become figures where they sit; an inline formula becomes a small image inside its
// sentence through a marker item that layout treats as one word. Scripts that stay text get
// <sup>/<sub>. Markers are private-use characters that esc() keeps and markup() turns into XHTML.
import type { MathArea, MathAreas } from "./math.ts";
import type { PageFigure, TextItem } from "./layout.ts";
import { escAttr } from "../xml.ts";

const INLINE = /([^]+)/g;
const SUP = ["", ""] as const;
const SUB = ["", ""] as const;

/** pubmy's marker characters; text from a PDF must never carry them (a forged marker breaks the XHTML). */
const MARKER_CHARS = /[\uE000-\uE005]/g;

/** A PDF's own text with any of pubmy's marker characters removed, before markers are added. */
export function ownText(s: string): string {
  return s.replace(MARKER_CHARS, "");
}

/** One area of one page waiting for its PNG. */
export interface Crop {
  page: number;
  id: string;
  area: MathArea;
  /** Words of the area's own text, for the alt text. */
  alt: string;
}

/** The areas of a page in render order (display, inline, diagrams), each with a stable id. */
export function cropsOf(page: number, areas: MathAreas, raw: { str?: string }[]): Crop[] {
  return [...areas.display, ...areas.inline, ...areas.diagrams].map((area, k) => {
    const words = ownText(area.itemIndexes.map((i) => raw[i]?.str ?? "").join(" ")).replace(/\s+/g, " ").trim();
    const alt = area.kind === "diagram" ? `Diagram on page ${page}` : words.slice(0, 120) || "Formula";
    return { page, id: `p${page}-m${k + 1}`, area, alt };
  });
}

/**
 * Takes the crop's text out of the page's items: a figure for a block area, a marker word for an
 * inline one. Returns the href the PNG must be stored under.
 */
export function applyCrop(items: (TextItem | null)[], figures: PageFigure[], crop: Crop, pageTop: number, inline: Map<string, string>): string {
  const src = `img/${crop.id}.png`;
  const { area } = crop;
  const kept = area.itemIndexes.filter((i) => items[i]);
  if (area.kind === "inline" && kept.length > 0) {
    const host = kept.reduce((a, b) => (items[b]!.fontSize > items[a]!.fontSize ? b : a));
    // The marker spans the formula's own glyphs, not the padded crop box, so the layout's gap rule
    // still sees the word spaces on both sides.
    const x0 = Math.min(...kept.map((i) => items[i]!.x));
    const x1 = Math.max(...kept.map((i) => items[i]!.x + items[i]!.width));
    items[host] = { ...items[host]!, str: `${crop.id}`, x: x0, width: x1 - x0, rotated: false };
    for (const i of kept) if (i !== host) items[i] = null;
    inline.set(crop.id, `<img class="math" src="${src}" alt="${escAttr(crop.alt)}"/>`);
  } else {
    for (const i of kept) items[i] = null;
    const cls = area.kind === "diagram" ? "" : ` class="math"`;
    figures.push({ top: pageTop - area.box.y1, html: `<figure${cls}><img src="${src}" alt="${escAttr(crop.alt)}"/></figure>` });
  }
  return src;
}

/** Wraps the text of a superscript or subscript item that stays text. */
export function markScript(item: TextItem, pos: "sup" | "sub"): TextItem {
  const [open, close] = pos === "sup" ? SUP : SUB;
  return { ...item, str: `${open}${item.str}${close}` };
}

/** Escaped text with its markers turned into XHTML. */
export function markup(escaped: string, inline: Map<string, string>): string {
  return escaped
    .replace(INLINE, (_m, id: string) => inline.get(id) ?? "")
    .replaceAll(SUP[0], "<sup>")
    .replaceAll(SUP[1], "</sup>")
    .replaceAll(SUB[0], "<sub>")
    .replaceAll(SUB[1], "</sub>");
}

/** Text without markers, for titles and the table of contents. */
export function plain(s: string): string {
  return s.replace(INLINE, "").replace(/[-]/g, "").replace(/\s+/g, " ").trim();
}
