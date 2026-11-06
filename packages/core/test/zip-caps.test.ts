import { describe, expect, test } from "bun:test";
import { strFromU8, strToU8, zipSync } from "fflate";
import { PubmyError } from "../src/errors.ts";
import { checkZipCaps, DEFAULT_LIMITS, isUnsafePath, unzipCapped } from "../src/zip-caps.ts";

const tooLarge = new PubmyError("READ_FAILED", "archive-too-large");

/** Rewrites the uncompressed-size field of every central directory record, leaving the data alone. */
function declareSize(zip: Uint8Array, name: string, size: number): Uint8Array {
  const out = zip.slice();
  const v = new DataView(out.buffer);
  const eocd = out.length - 22;
  let at = v.getUint32(eocd + 16, true);
  const count = v.getUint16(eocd + 10, true);
  for (let i = 0; i < count; i++) {
    const nameLen = v.getUint16(at + 28, true);
    const entry = strFromU8(out.subarray(at + 46, at + 46 + nameLen));
    if (entry === name) v.setUint32(at + 24, size, true);
    at += 46 + nameLen + v.getUint16(at + 30, true) + v.getUint16(at + 32, true);
  }
  return out;
}

const manyEntries = (n: number) =>
  zipSync(Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${i}.txt`, new Uint8Array()])), { level: 0 });

describe("zip caps", () => {
  test("the default caps are 500 MB total and 5,000 entries", () => {
    expect(DEFAULT_LIMITS).toEqual({ maxBytes: 500 * 1024 * 1024, maxEntries: 5000 });
  });

  test("accepts an archive of exactly 5,000 entries", () => {
    expect(() => checkZipCaps(manyEntries(5000))).not.toThrow();
  });

  test("refuses an archive of 5,001 entries as archive-too-large", () => {
    expect(() => checkZipCaps(manyEntries(5001))).toThrow(tooLarge);
  });

  test("refuses a central directory that declares more than 500 MB, without inflating it", () => {
    const zip = zipSync({ "a.txt": strToU8("x"), "b.txt": strToU8("y") }, { level: 0 });
    const bomb = declareSize(declareSize(zip, "a.txt", 300 * 1024 * 1024), "b.txt", 300 * 1024 * 1024);
    expect(() => checkZipCaps(bomb)).toThrow(tooLarge);
    expect(() => unzipCapped(bomb)).toThrow(tooLarge);
  });

  test("accepts a declared total of exactly 500 MB", () => {
    const zip = declareSize(zipSync({ "a.txt": strToU8("x") }, { level: 0 }), "a.txt", 500 * 1024 * 1024);
    expect(() => checkZipCaps(zip)).not.toThrow();
  });

  test("honours custom limits", () => {
    expect(() => checkZipCaps(manyEntries(3), { maxBytes: 1000, maxEntries: 2 })).toThrow(tooLarge);
  });

  test("flags paths with a `..` segment as unsafe", () => {
    expect(isUnsafePath("../evil.txt")).toBe(true);
    expect(isUnsafePath("a/../../b.txt")).toBe(true);
    expect(isUnsafePath("a\\..\\b.txt")).toBe(true);
    expect(isUnsafePath("a/..b/c..txt")).toBe(false);
  });

  test("unzipCapped drops `..` entries and directories and keeps the rest", () => {
    const zip = zipSync({ "../evil.txt": strToU8("bad"), "ok/good.txt": strToU8("good"), "x/../../y.txt": strToU8("bad") });
    const files = unzipCapped(zip);
    expect(Object.keys(files)).toEqual(["ok/good.txt"]);
    expect(strFromU8(files["ok/good.txt"])).toBe("good");
  });
});
