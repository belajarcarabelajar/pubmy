import { expect, test } from "bun:test";
import type { TextItem } from "../src/pdf/layout.ts";
import { dropOverprints } from "../src/pdf/overprint.ts";

const it = (str: string, x: number, y: number, fontSize = 10): TextItem => ({ str, x, y, width: str.length * 5, fontSize });
const strs = (items: TextItem[]) => items.map((i) => i.str);

test("an exact duplicate collapses to one item", () => {
  expect(strs(dropOverprints([it("USER MANUAL", 100, 700), it("USER MANUAL", 100, 700)]))).toEqual(["USER MANUAL"]);
});

test("the first of two equal items stays", () => {
  const first = it("Tanggal Terbit", 100, 700);
  const second = it("Tanggal Terbit", 100, 700);
  const out = dropOverprints([first, second]);
  expect(out).toHaveLength(1);
  expect(out[0]).toBe(first);
});

test("a short item under a longer one at the same spot is dropped and the longer stays", () => {
  expect(strs(dropOverprints([it(":", 200, 650), it(": 2 dari 9", 200, 650)]))).toEqual([": 2 dari 9"]);
  expect(strs(dropOverprints([it(": 2 dari 9", 200, 650), it(":", 200, 650)]))).toEqual([": 2 dari 9"]);
});

test("a faux-bold copy 0.4 pt to the right collapses", () => {
  expect(strs(dropOverprints([it("Bold", 100, 700), it("Bold", 100.4, 700)]))).toEqual(["Bold"]);
});

test("the same word 10 pt apart on one baseline stays", () => {
  expect(strs(dropOverprints([it("Ya", 100, 700), it("Ya", 110, 700)]))).toEqual(["Ya", "Ya"]);
});

test("two equal short items on different baselines stay", () => {
  expect(strs(dropOverprints([it("Total", 100, 700), it("Total", 100, 688)]))).toEqual(["Total", "Total"]);
});

test("the same text at different font sizes stays", () => {
  expect(strs(dropOverprints([it("Judul", 100, 700, 10), it("Judul", 100, 700, 14)]))).toEqual(["Judul", "Judul"]);
});

test("survivors keep their original order", () => {
  const out = dropOverprints([it("a", 10, 700), it(":", 200, 650), it("b", 50, 600), it(": 2 dari 9", 200, 650), it("a", 10, 700)]);
  expect(strs(out)).toEqual(["a", "b", ": 2 dari 9"]);
});

test("the input array is not mutated", () => {
  const input = [it("x", 100, 700), it("x", 100, 700)];
  dropOverprints(input);
  expect(input).toHaveLength(2);
});

test("an item with whitespace-only text is left alone", () => {
  expect(dropOverprints([it(" ", 100, 700), it(" ", 100, 700), it("", 100, 700), it("", 100, 700)])).toHaveLength(4);
});

test("a rotated duplicate collapses like the rest", () => {
  const side = (): TextItem => ({ ...it("arXiv:1234", 20, 400), rotated: true });
  expect(dropOverprints([side(), side()])).toHaveLength(1);
});
