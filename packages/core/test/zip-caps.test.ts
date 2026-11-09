import { describe, expect, test } from "bun:test";
import { strFromU8, strToU8, zipSync } from "fflate";
import { PubmyError } from "../src/errors.ts";
import { checkZipCaps, DEFAULT_LIMITS, isUnsafePath, unzipBounded, unzipCapped } from "../src/zip-caps.ts";

const tooLarge = new PubmyError("READ_FAILED", "archive-too-large");

/** Runs `patch` on a copy of the zip with the offset of the central directory record named `name` (zipSync writes no comment, so the EOCD is the last 22 bytes). */
function patchCentral(zip: Uint8Array, name: string, patch: (v: DataView, at: number) => void): Uint8Array {
  const out = zip.slice();
  const v = new DataView(out.buffer);
  const eocd = out.length - 22;
  let at = v.getUint32(eocd + 16, true);
  const count = v.getUint16(eocd + 10, true);
  for (let i = 0; i < count; i++) {
    const nameLen = v.getUint16(at + 28, true);
    const entry = strFromU8(out.subarray(at + 46, at + 46 + nameLen));
    if (entry === name) patch(v, at);
    at += 46 + nameLen + v.getUint16(at + 30, true) + v.getUint16(at + 32, true);
  }
  return out;
}

/** Rewrites the uncompressed-size field of the central directory record named `name`, leaving the data alone. */
const declareSize = (zip: Uint8Array, name: string, size: number) =>
  patchCentral(zip, name, (v, at) => v.setUint32(at + 24, size, true));

/** Runs `patch` on a copy of the zip with the offset of its end-of-central-directory record. */
function patchEocd(zip: Uint8Array, patch: (v: DataView, eocd: number) => void): Uint8Array {
  const out = zip.slice();
  patch(new DataView(out.buffer), out.length - 22);
  return out;
}

/** What `fn` threw as code and message, `undefined` when it did not throw; a raw fflate error shows as `not-a-PubmyError`. */
function failure(fn: () => unknown): { code: string; message: string } | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof PubmyError ? { code: e.code, message: e.message } : { code: "not-a-PubmyError", message: String(e) };
  }
  return undefined;
}
const unreadable = { code: "READ_FAILED", message: "read-failed" };
const tooBig = { code: "READ_FAILED", message: "archive-too-large" };

/** Deterministic noise: it does not collapse under deflate, so the entry spans many 16 KiB pieces. */
function noise(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  let s = 12345;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    out[i] = s >>> 24;
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

// A streamed zip: its local headers carry flag bit 3 and sizes 0, the real sizes follow the data. Written by
// `python3 -I -c` with zipfile onto a stream that cannot seek: "a.txt" deflated, "b.txt" stored.
const STREAMED_ZIP_BASE64 =
  "UEsDBBQACAAIAOecaV0AAAAAAAAAAAAAAAAFAAAAYS50eHQrLilKTcxNTVFISU3LSSxJVUjNKymq1FMoHhUfFuIAUEsHCByX8IMfAAAA4AEAAFBLAwQUAAgAAAAAACEAAAAAAAAAAAAAAAAABQAAAGIudHh0c3RvcmVkIGVudHJ5UEsHCMapHpUMAAAADAAAAFBLAQIUAxQACAAIAOecaV0cl/CDHwAAAOABAAAFAAAAAAAAAAAAAACAAQAAAABhLnR4dFBLAQIUAxQACAAAAAAAIQDGqR6VDAAAAAwAAAAFAAAAAAAAAAAAAACAAVIAAABiLnR4dFBLBQYAAAAAAgACAGYAAACRAAAAAAA=";

const text = strToU8("The quick brown fox jumps over the lazy dog. ".repeat(8000));
const honestInputs: Record<string, Uint8Array<ArrayBuffer>> = {
  mimetype: strToU8("application/epub+zip"),
  "OEBPS/stored.bin": noise(40_000),
  "OEBPS/chapter.xhtml": text,
  "OEBPS/noise.bin": noise(70_000),
  "OEBPS/empty.txt": new Uint8Array(),
  "OEBPS/é.txt": strToU8("a name that is not ASCII"),
};
const honest = zipSync({
  mimetype: [honestInputs.mimetype, { level: 0 }],
  "OEBPS/stored.bin": [honestInputs["OEBPS/stored.bin"], { level: 0 }],
  "OEBPS/chapter.xhtml": [text, { level: 9 }],
  "OEBPS/noise.bin": [honestInputs["OEBPS/noise.bin"], { level: 9 }],
  "OEBPS/empty.txt": honestInputs["OEBPS/empty.txt"],
  "OEBPS/dir/": new Uint8Array(),
  "../evil": strToU8("bad"),
  "OEBPS/é.txt": honestInputs["OEBPS/é.txt"],
});
const small = zipSync({ "a.txt": [strToU8("alpha ".repeat(40)), { level: 0 }], "b.txt": [strToU8("beta ".repeat(40)), { level: 9 }] });

const sameFiles = (a: Record<string, Uint8Array>, b: Record<string, Uint8Array>) => {
  expect(Object.keys(b)).toEqual(Object.keys(a));
  for (const name of Object.keys(a)) expect(b[name]).toEqual(a[name]);
};

describe("unzipBounded", () => {
  test("an honest zip unzips to the files that went in, directories and `..` paths dropped", () => {
    const files = unzipBounded(honest);
    expect(Object.keys(files).sort()).toEqual(Object.keys(honestInputs).sort());
    for (const name of Object.keys(honestInputs)) expect(files[name]).toEqual(honestInputs[name]);
  });

  test("an honest zip unzips exactly as unzipCapped does", () => {
    sameFiles(unzipCapped(honest), unzipBounded(honest));
    sameFiles(unzipCapped(small), unzipBounded(small));
  });

  test("a streamed zip with data descriptors (local sizes 0) unzips exactly as unzipCapped does", () => {
    const zip = Uint8Array.from(atob(STREAMED_ZIP_BASE64), (c) => c.charCodeAt(0));
    const v = new DataView(zip.buffer);
    expect([v.getUint16(6, true) & 8, v.getUint32(18, true), v.getUint32(22, true)]).toEqual([8, 0, 0]);
    const files = unzipBounded(zip);
    expect(strFromU8(files["a.txt"])).toBe("streamed deflate entry. ".repeat(20));
    expect(strFromU8(files["b.txt"])).toBe("stored entry");
    sameFiles(unzipCapped(zip), files);
  });

  test("an empty archive unzips to no files", () => {
    expect(unzipBounded(zipSync({}))).toEqual({});
  });

  test("an entry that inflates past the size its central directory declares is refused, and decoding stops early", () => {
    // 64 MB of one byte deflates to about 64 KB, so the declared size of 1,024 hides a 64 MB inflate.
    const lying = declareSize(zipSync({ "ok.txt": strToU8("fine"), "big.bin": [new Uint8Array(64 << 20).fill(0x61), { level: 1 }] }), "big.bin", 1024);
    const t0 = performance.now();
    const result = failure(() => unzipBounded(lying));
    const ms = performance.now() - t0;
    expect(result).toEqual(tooBig);
    expect(ms).toBeLessThan(300);
  }, 30_000);

  test("an entry one byte over its declared size is refused, and at its declared size is kept", () => {
    const zip = zipSync({ "a.txt": [text.subarray(0, 50_000), { level: 9 }] });
    expect(unzipBounded(declareSize(zip, "a.txt", 50_000))["a.txt"].length).toBe(50_000);
    expect(failure(() => unzipBounded(declareSize(zip, "a.txt", 49_999)))).toEqual(tooBig);
  });

  test("a total over limits.maxBytes or an entry count over limits.maxEntries is refused", () => {
    expect(failure(() => unzipBounded(honest, { maxBytes: 100_000, maxEntries: 5000 }))).toEqual(tooBig);
    expect(failure(() => unzipBounded(honest, { maxBytes: DEFAULT_LIMITS.maxBytes, maxEntries: 3 }))).toEqual(tooBig);
  });

  test("a central directory that declares more than 500 MB is refused before anything is inflated", () => {
    const bomb = declareSize(declareSize(small, "a.txt", 300 * 1024 * 1024), "b.txt", 300 * 1024 * 1024);
    expect(failure(() => unzipBounded(bomb))).toEqual(tooBig);
  });

  test("a stored entry whose compressed size differs from its declared size is refused, either way round", () => {
    const stored = zipSync({ "a.txt": [strToU8("x".repeat(100)), { level: 0 }] });
    expect(failure(() => unzipBounded(declareSize(stored, "a.txt", 50)))).toEqual(tooBig);
    expect(failure(() => unzipBounded(declareSize(stored, "a.txt", 150)))).toEqual(tooBig);
  });

  test("a compression method other than stored or deflate is read-failed", () => {
    for (const method of [9, 12]) {
      const zip = patchCentral(small, "b.txt", (v, at) => v.setUint16(at + 10, method, true));
      expect(failure(() => unzipBounded(zip))).toEqual(unreadable);
    }
  });

  test("a ZIP64 marker in a size, offset, or count field is read-failed, never read as a size", () => {
    const at = (field: number, wide: boolean) => (v: DataView, base: number) =>
      wide ? v.setUint32(base + field, 0xffffffff, true) : v.setUint16(base + field, 0xffff, true);
    const centralCases = [20, 24, 42].map((field) => patchCentral(small, "a.txt", at(field, true)));
    const eocdCases = [
      patchEocd(small, at(8, false)),
      patchEocd(small, at(10, false)),
      patchEocd(small, at(12, true)),
      patchEocd(small, at(16, true)),
    ];
    for (const zip of [...centralCases, ...eocdCases]) expect(failure(() => unzipBounded(zip))).toEqual(unreadable);
  });

  test("a spanned archive (a disk number other than 0) is read-failed", () => {
    expect(failure(() => unzipBounded(patchEocd(small, (v, e) => v.setUint16(e + 4, 1, true))))).toEqual(unreadable);
    expect(failure(() => unzipBounded(patchEocd(small, (v, e) => v.setUint16(e + 6, 1, true))))).toEqual(unreadable);
  });

  test("a file cut off at any length is read-failed, never a hang or a raw error", () => {
    for (let n = 0; n < small.length; n++) expect(failure(() => unzipBounded(small.subarray(0, n)))).toEqual(unreadable);
  });

  test("a central directory cut short while its end record survives is read-failed", () => {
    const eocd = small.length - 22;
    const cut = new Uint8Array([...small.subarray(0, eocd - 20), ...small.subarray(eocd)]);
    expect(failure(() => unzipBounded(cut))).toEqual(unreadable);
  });

  test("entry data cut out of the middle of the file is read-failed", () => {
    const cut = new Uint8Array([...small.subarray(0, 40), ...small.subarray(60)]);
    expect(failure(() => unzipBounded(cut))).toEqual(unreadable);
  });

  test("an entry whose data does not fit in the file is read-failed, before any size rule applies", () => {
    const stored = zipSync({ "a.txt": [strToU8("x".repeat(100)), { level: 0 }] });
    for (const zip of [small, stored]) {
      const lying = patchCentral(zip, zip === small ? "b.txt" : "a.txt", (v, at) => v.setUint32(at + 20, zip.length, true));
      expect(failure(() => unzipBounded(lying))).toEqual(unreadable);
    }
  });

  test("a deflate stream cut short inside the file is read-failed", () => {
    const zip = zipSync({ "a.txt": [text.subarray(0, 50_000), { level: 9 }] });
    const cut = patchCentral(zip, "a.txt", (v, at) => v.setUint32(at + 20, v.getUint32(at + 20, true) - 5, true));
    expect(failure(() => unzipBounded(cut))).toEqual(unreadable);
  });

  test("a central directory record or local header with the wrong signature is read-failed", () => {
    const badRecord = patchEocd(small, (v, e) => v.setUint16(e + 10, 3, true));
    const badLocal = patchCentral(small, "b.txt", (v, at) => v.setUint32(v.getUint32(at + 42, true), 0, true));
    for (const zip of [badRecord, badLocal]) expect(failure(() => unzipBounded(zip))).toEqual(unreadable);
  });

  test("the last of two entries with one name wins, as in unzipCapped", () => {
    const twin = patchCentral(small, "b.txt", (v, at) => v.setUint8(at + 46, "a".charCodeAt(0)));
    const files = unzipBounded(twin);
    expect(Object.keys(files)).toEqual(["a.txt"]);
    expect(strFromU8(files["a.txt"])).toBe("beta ".repeat(40));
    sameFiles(unzipCapped(twin), files);
  });
});
