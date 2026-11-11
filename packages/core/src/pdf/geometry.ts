// Box geometry for pdf/math.ts: boxes are [x0, y0, x1, y1] in PDF points (origin bottom-left).
export type BB = [number, number, number, number];

export const union = (a: BB, b: BB): BB => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
export const overlapX = (a: BB, b: BB) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
export const inter = (a: BB, b: BB) => overlapX(a, b) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
export const areaOf = (a: BB) => Math.max(0.001, (a[2] - a[0]) * (a[3] - a[1]));
export const grow = (a: BB, d: number): BB => [a[0] - d, a[1] - d, a[2] + d, a[3] + d];
export const bbOf = (pts: [number, number][]): BB => [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
export const mul = (m: number[], n: ArrayLike<number>) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
export const apply = (m: number[], x: number, y: number): [number, number] => [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]];

export class Sets {
  private p: number[];
  constructor(n: number) {
    this.p = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    while (this.p[x] !== x) x = this.p[x] = this.p[this.p[x]];
    return x;
  }
  join(a: number, b: number): void {
    this.p[this.find(a)] = this.find(b);
  }
  groups(): number[][] {
    const m = new Map<number, number[]>();
    this.p.forEach((_, i) => {
      const root = this.find(i);
      const g = m.get(root);
      if (g) g.push(i);
      else m.set(root, [i]);
    });
    return [...m.values()];
  }
}

const CELL = 32;

/**
 * `a` cut down to `view` widened by one grid cell, or null when nothing of it is left (a box off
 * the page, a coordinate that is not a number). A PDF may draw a path out to 1e12; unclipped, such
 * a box would make touching() walk billions of cells.
 */
export function clip(a: BB, view: number[]): BB | null {
  const b: BB = [Math.max(a[0], view[0] - CELL), Math.max(a[1], view[1] - CELL), Math.min(a[2], view[2] + CELL), Math.min(a[3], view[3] + CELL)];
  return b[2] >= b[0] && b[3] >= b[1] ? b : null;
}

/**
 * Calls join(a, b) for each pair of boxes within `gap` of each other. Boxes are bucketed on a grid
 * of CELL points, so a page of 20,000 scattered strokes (a plot, a map) is not compared pair by pair.
 */
export function touching(boxes: BB[], gap: number, join: (a: number, b: number) => void): void {
  const cells = new Map<string, number[]>();
  boxes.forEach((bb, i) => {
    const [x0, y0, x1, y1] = grow(bb, gap / 2).map((v) => Math.floor(v / CELL));
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const key = `${x},${y}`;
        const list = cells.get(key);
        if (list) list.push(i);
        else cells.set(key, [i]);
      }
  });
  const seen = new Set<number>();
  for (const list of cells.values())
    for (let a = 0; a < list.length; a++)
      for (let b = a + 1; b < list.length; b++) {
        const [i, j] = list[a] < list[b] ? [list[a], list[b]] : [list[b], list[a]];
        const key = i * boxes.length + j;
        if (seen.has(key)) continue;
        seen.add(key);
        if (inter(grow(boxes[i], gap), boxes[j]) > 0) join(i, j);
      }
}
