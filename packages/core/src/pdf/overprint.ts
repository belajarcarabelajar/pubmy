import type { TextItem } from "./layout.ts";

const SIZE = 0.1;
const BASELINE = 0.5;
const START = 1;

/**
 * Some PDFs draw a block twice at the same spot (a header table printed again, a faux-bold copy a
 * fraction of a point to the right). pdf.js reports both, and the line builder would join them into
 * "USER MANUALUSER MANUAL". An item goes when another item sits on top of it with the same size and
 * the same text, or with longer text that starts with it (a ":" under ": 2 dari 9"). Of two equal
 * items the first stays; empty items are left to the later filters. Survivors keep their order.
 */
export function dropOverprints(items: TextItem[]): TextItem[] {
  const text = items.map((i) => i.str.trim());
  return items.filter((a, i) => {
    if (text[i] === "") return true;
    return !items.some((b, j) => {
      if (j === i || text[j] === "") return false;
      if (Math.abs(a.fontSize - b.fontSize) > SIZE || Math.abs(a.y - b.y) > BASELINE || Math.abs(a.x - b.x) > START) return false;
      return text[j].startsWith(text[i]) && (text[j].length > text[i].length || j < i);
    });
  });
}
