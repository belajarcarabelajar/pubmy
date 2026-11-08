import { describe, expect, test } from "bun:test";
import { unzipSync } from "fflate";
import { batchView, zipEpubs } from "../src/batch.ts";

describe("zipEpubs", () => {
  test("round trip keeps names and exact bytes for two distinct files", async () => {
    const one = Uint8Array.from([80, 75, 3, 4, 1, 2, 3, 250, 251, 252]);
    const two = Uint8Array.from([9, 8, 7, 6, 5, 0, 0, 1]);
    const zip = await zipEpubs([
      { name: "one.epub", epub: one },
      { name: "two.epub", epub: two },
    ]);
    const out = unzipSync(zip);
    expect(Object.keys(out).sort()).toEqual(["one.epub", "two.epub"]);
    expect(Array.from(out["one.epub"]!)).toEqual([80, 75, 3, 4, 1, 2, 3, 250, 251, 252]);
    expect(Array.from(out["two.epub"]!)).toEqual([9, 8, 7, 6, 5, 0, 0, 1]);
  });

  test("duplicate names get (2) and (3) before the extension", async () => {
    const zip = await zipEpubs([
      { name: "a.epub", epub: Uint8Array.from([1]) },
      { name: "a.epub", epub: Uint8Array.from([2]) },
      { name: "a.epub", epub: Uint8Array.from([3]) },
    ]);
    const out = unzipSync(zip);
    expect(Object.keys(out).sort()).toEqual(["a (2).epub", "a (3).epub", "a.epub"]);
    expect(Array.from(out["a.epub"]!)).toEqual([1]);
    expect(Array.from(out["a (2).epub"]!)).toEqual([2]);
    expect(Array.from(out["a (3).epub"]!)).toEqual([3]);
  });

  test("a name that already ends in (2).epub is just a name", async () => {
    const zip = await zipEpubs([
      { name: "a (2).epub", epub: Uint8Array.from([1]) },
      { name: "b.epub", epub: Uint8Array.from([2]) },
    ]);
    expect(Object.keys(unzipSync(zip)).sort()).toEqual(["a (2).epub", "b.epub"]);
  });

  test("a non-ASCII name survives unchanged", async () => {
    const zip = await zipEpubs([{ name: "Buku Pelajaran Šéf 日本語.epub", epub: Uint8Array.from([7, 7]) }]);
    const out = unzipSync(zip);
    expect(Object.keys(out)).toEqual(["Buku Pelajaran Šéf 日本語.epub"]);
    expect(Array.from(out["Buku Pelajaran Šéf 日本語.epub"]!)).toEqual([7, 7]);
  });

  test("an empty list gives a valid ZIP with zero entries", async () => {
    const zip = await zipEpubs([]);
    expect(zip).toBeInstanceOf(Uint8Array);
    expect(Object.keys(unzipSync(zip))).toEqual([]);
  });

  test("entries are stored, not deflated", async () => {
    const payload = new Uint8Array(1000).fill(65);
    const zip = await zipEpubs([{ name: "big.epub", epub: payload }]);
    const seen: { name: string; size: number; originalSize: number; compression: number }[] = [];
    unzipSync(zip, {
      filter: (f) => {
        seen.push({ name: f.name, size: f.size, originalSize: f.originalSize, compression: f.compression });
        return true;
      },
    });
    // 1000 repeated bytes deflate to a few bytes; a stored entry keeps all 1000.
    expect(seen).toEqual([{ name: "big.epub", size: 1000, originalSize: 1000, compression: 0 }]);
  });
});

describe("batchView", () => {
  test("Download all from 2 ready rows, Clear all from 2 rows", () => {
    expect(batchView(0, 0)).toEqual({ downloadAll: false, clearAll: false });
    expect(batchView(1, 0)).toEqual({ downloadAll: false, clearAll: false });
    expect(batchView(1, 1)).toEqual({ downloadAll: false, clearAll: false });
    expect(batchView(2, 1)).toEqual({ downloadAll: false, clearAll: true });
    expect(batchView(2, 2)).toEqual({ downloadAll: true, clearAll: true });
    expect(batchView(10, 10)).toEqual({ downloadAll: true, clearAll: true });
  });
});
