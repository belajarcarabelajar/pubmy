// Pure (no I/O): the book title of a born-digital PDF from its first page, and the masthead
// banners on that page that must not open chapters. nihms496502 prints "NIH Public Access" at
// 22 pt and "Author Manuscript" at 14 pt above its 14 pt article title.
import type { PageBlock, TextItem } from "./layout.ts";

export interface TitleInput {
  /** Every block of the book; only the page-1 headings are read, and indexes refer to this array. */
  blocks: PageBlock[];
  /** Page-1 text items after the running lines are stripped. */
  items: TextItem[];
  pageHeight: number;
  /** The PDF Info dictionary Title, as pdf.js returns it. */
  metaTitle?: unknown;
  fileName: string;
}

export interface BookTitle {
  title: string;
  /** Index of the title block, -1 when the title came from metadata or the file name. */
  at: number;
  /** Indexes of page-1 masthead banners, in ascending order. */
  skip: number[];
}

/** Banners sit in the top margin; the makeTwoColumnPdf title starts 4 percent down its page. */
const TOP_BAND = 0.08;
const BANNER_MAX_WORDS = 4;
/** Banners that publishers repeat on every article of that kind. */
const KNOWN_BANNER = /^(nih public access|hhs public access|author manuscript|europe pmc funders group)$/i;
/** A citation or rights line, set large on some first pages. */
const RUNNING_LINE = /\bdoi\b|\bissn\b|\bvol\.\s*\d|\bpp\.\s*\d|available in pmc|©|\bcopyright\b|\b(19|20)\d\d;\s*\d/i;
/** Sizes within this many points of the largest count as the title size. */
const SIZE_TOL = 0.5;
const PLACEHOLDER = /^(untitled|title|no title|unknown|none|document\s*\d*)$/i;
const GENERATOR = /^microsoft (word|powerpoint|excel)\s*-/i;
const FILE_NAME = /\.(pdf|docx?|odt|rtf|txt|tex|dvi|ps|indd|qxd|pages|pptx?|xlsx?)$/i;

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const words = (s: string) => s.split(" ").filter(Boolean).length;

/** Size and top edge (points down from the page top) of the item that opens `text`: the longest prefix, then the largest. */
function measure(text: string, items: TextItem[], pageHeight: number): { size: number; top: number } {
  let best: TextItem | undefined;
  let bestLen = 0;
  for (const i of items) {
    const s = clean(i.str);
    if (!s || i.rotated || !text.startsWith(s)) continue;
    if (s.length > bestLen || (s.length === bestLen && best && i.fontSize > best.fontSize)) [best, bestLen] = [i, s.length];
  }
  return best ? { size: best.fontSize, top: pageHeight - best.y - best.fontSize } : { size: 0, top: Infinity };
}

function saneMeta(meta: unknown, stem: string): string {
  const t = typeof meta === "string" ? clean(meta) : "";
  const bad = !/\p{L}/u.test(t) || PLACEHOLDER.test(t) || GENERATOR.test(t) || FILE_NAME.test(t) || t === stem;
  return bad ? "" : t;
}

/**
 * Pure: the longest heading among the largest sizes on page 1 that is neither a banner nor a
 * running line, else a sane metadata Title, else the file name. A banner is a heading of at most
 * four words in the top band that is a known masthead or comes before a longer heading.
 */
export function bookTitle(input: TitleInput): BookTitle {
  const heads = input.blocks.flatMap((b, k) => {
    if (b.page !== 1 || b.kind !== "heading") return [];
    const text = clean(b.text);
    return [{ k, text, n: words(text), ...measure(text, input.items, input.pageHeight) }];
  });
  const banner = (h: (typeof heads)[number]) =>
    h.top < input.pageHeight * TOP_BAND && h.n <= BANNER_MAX_WORDS && (KNOWN_BANNER.test(h.text) || heads.some((o) => o.k > h.k && o.n > h.n));
  const skip = heads.filter(banner).map((h) => h.k);
  const candidates = heads.filter((h) => !skip.includes(h.k) && !RUNNING_LINE.test(h.text));
  const largest = Math.max(...candidates.map((h) => h.size));
  const pick = candidates.filter((h) => h.size >= largest - SIZE_TOL).reduce<(typeof heads)[number] | undefined>((a, h) => (!a || h.n > a.n ? h : a), undefined);
  if (pick) return { title: pick.text, at: pick.k, skip };
  const stem = input.fileName.replace(/\.[^.]+$/, "");
  return { title: saneMeta(input.metaTitle, stem) || stem, at: -1, skip };
}
