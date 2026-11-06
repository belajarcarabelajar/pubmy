import { beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { makeCbz, makePng } from "../../../fixtures/make-cbz.ts";
import { fetchFixtures, uudecode } from "../../../fixtures/fetch.ts";
import { checkCaps, DEFAULT_LIMITS, imageSize, naturalCompare, readArchive } from "../src/adapters/comics.ts";
import { convert, createComicsAdapter, domFor, loadNodeLibarchive, pack, PubmyError, registerAdapter, validate, type Ctx } from "../src/index.ts";

const ctx: Ctx = {
  dom: domFor("bun"),
  loadOcr: () => Promise.reject(new Error("no OCR")),
  progress: () => {},
  signal: new AbortController().signal,
};
const RED = makePng(60, 90, [200, 0, 0]);
const GREEN = makePng(60, 90, [0, 200, 0]);
const BLUE = makePng(60, 90, [0, 0, 200]);
const cbz = (name = "Fixture Comic.cbz") => ({ name, bytes: makeCbz() });

async function failureOf(p: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof PubmyError) return { code: e.code, message: e.message };
    throw e;
  }
  throw new Error("expected a rejection");
}

describe("naturalCompare", () => {
  test("orders numbered page names by number, not by character", () => {
    expect(["p10.png", "p2.png", "P3.png", "p1.png"].sort(naturalCompare)).toEqual(["p1.png", "p2.png", "P3.png", "p10.png"]);
  });
});

describe("checkCaps", () => {
  test("accepts an archive inside both caps", () => {
    expect(() => checkCaps([{ size: 400 }, { size: 100 }], { maxBytes: 500, maxEntries: 2 })).not.toThrow();
  });

  test("rejects a total uncompressed size over the byte cap as archive-too-large", () => {
    expect(() => checkCaps([{ size: 400 }, { size: 101 }], { maxBytes: 500, maxEntries: 5000 })).toThrow(
      new PubmyError("READ_FAILED", "archive-too-large"),
    );
  });

  test("rejects an entry count over the entry cap as archive-too-large", () => {
    expect(() => checkCaps([{ size: 1 }, { size: 1 }, { size: 1 }], { maxBytes: 500, maxEntries: 2 })).toThrow(
      new PubmyError("READ_FAILED", "archive-too-large"),
    );
  });

  test("defaults to 500 MB and 5000 entries", () => {
    expect(() => checkCaps([{ size: 500 * 1024 * 1024 }])).not.toThrow();
    expect(() => checkCaps([{ size: 500 * 1024 * 1024 + 1 }])).toThrow("archive-too-large");
    expect(() => checkCaps(Array.from({ length: 5001 }, () => ({ size: 0 })))).toThrow("archive-too-large");
  });
});

describe("imageSize", () => {
  test("reads width and height from a PNG header", () => {
    expect(imageSize(makePng(60, 90, [0, 0, 0]))).toEqual({ width: 60, height: 90 });
  });

  test("reads width and height from a JPEG SOF0 marker after an APP0 segment", () => {
    const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x64, 0x00, 0x50, 0x03);
    expect(imageSize(jpeg)).toEqual({ width: 80, height: 100 });
  });

  test("returns null for bytes that are not an image", () => {
    expect(imageSize(strToU8("<ComicInfo/>"))).toBeNull();
  });
});

describe("comics adapter on CBZ", () => {
  test("accepts .cbz zips and RAR archives but not other zips", () => {
    const a = createComicsAdapter();
    expect([a.accepts({ format: "zip", ext: "cbz" }), a.accepts({ format: "rar", ext: "cbr" }), a.accepts({ format: "zip", ext: "docx" })])
      .toEqual([true, true, false]);
  });

  test("makes one fixed-layout page per image in natural filename order", async () => {
    const book = await createComicsAdapter().read(cbz(), ctx);
    expect(book.layout).toBe("fixed");
    expect(book.assets.map((a) => a.data)).toEqual([RED, GREEN, BLUE]);
    expect(book.chapters.map((c) => c.body.match(/src="([^"]+)"/)?.[1])).toEqual(book.assets.map((a) => a.href));
  });

  test("ignores non-image entries", async () => {
    const book = await createComicsAdapter().read(cbz(), ctx);
    expect(book.assets.every((a) => a.mediaType === "image/png")).toBe(true);
    expect(book.chapters).toHaveLength(3);
  });

  test("defaults to ltr and takes rtl from the option", async () => {
    expect((await createComicsAdapter().read(cbz(), ctx)).direction).toBe("ltr");
    expect((await createComicsAdapter({ direction: "rtl" }).read(cbz(), ctx)).direction).toBe("rtl");
  });

  test("titles the book after the file name and uses the first page as cover", async () => {
    const book = await createComicsAdapter().read(cbz("Seri/Volume 01.cbz"), ctx);
    expect(book.meta.title).toBe("Volume 01");
    expect(book.meta.cover).toBe(book.assets[0].href);
  });

  test("puts the image size on each page so the packager can write the viewport", async () => {
    const book = await createComicsAdapter().read(cbz(), ctx);
    expect(book.chapters[0].body).toContain(`width="60"`);
    expect(book.chapters[0].body).toContain(`height="90"`);
  });

  test("skips entries whose path contains ..", async () => {
    const bytes = zipSync({ "../evil.png": BLUE, "ok/../../evil2.png": BLUE, "p1.png": RED });
    const book = await createComicsAdapter().read({ name: "x.cbz", bytes }, ctx);
    expect(book.assets.map((a) => a.data)).toEqual([RED]);
  });

  test("an archive without images fails as UNSUPPORTED no-images", async () => {
    const bytes = zipSync({ "ComicInfo.xml": strToU8("<ComicInfo/>"), "notes.txt": strToU8("hi") });
    expect(await failureOf(createComicsAdapter().read({ name: "x.cbz", bytes }, ctx))).toEqual({ code: "UNSUPPORTED", message: "no-images" });
  });

  test("an archive over the entry cap fails as READ_FAILED archive-too-large", async () => {
    const adapter = createComicsAdapter({ limits: { maxBytes: 500 * 1024 * 1024, maxEntries: 2 } });
    expect(await failureOf(adapter.read(cbz(), ctx))).toEqual({ code: "READ_FAILED", message: "archive-too-large" });
  });

  test("an archive over the byte cap fails as READ_FAILED archive-too-large", async () => {
    const adapter = createComicsAdapter({ limits: { maxBytes: 1000, maxEntries: 5000 } });
    expect(await failureOf(adapter.read(cbz(), ctx))).toEqual({ code: "READ_FAILED", message: "archive-too-large" });
  });
});

// Phase B: these need the packager fixed-layout branch, fetch.ts uudecode and libarchive.js.
const opfOf = (epub: Uint8Array) => strFromU8(unzipSync(epub)["OEBPS/content.opf"]);

describe("comics EPUB", () => {
  test("a CBZ packs to a valid pre-paginated EPUB", async () => {
    const epub = pack(await createComicsAdapter().read(cbz(), ctx));
    expect(opfOf(epub)).toContain(`<meta property="rendition:layout">pre-paginated</meta>`);
    expect((await validate(epub)).messages).toEqual([]);
  });

  test("each page carries a viewport meta from its image size", async () => {
    const book = await createComicsAdapter().read(cbz(), ctx);
    const page = strFromU8(unzipSync(pack(book))[`OEBPS/${book.chapters[0].href}`]);
    expect(page).toContain(`<meta name="viewport" content="width=60, height=90"/>`);
  });

  test("convert() turns a CBZ into a validated EPUB and reports no-images through its result", async () => {
    const unregister = registerAdapter(createComicsAdapter());
    try {
      const ok = await convert({ name: "Fixture Comic.cbz", bytes: makeCbz() }, ctx);
      expect(ok.ok).toBe(true);
      const empty = await convert({ name: "empty.cbz", bytes: zipSync({ "notes.txt": strToU8("hi") }) }, ctx);
      expect(empty).toEqual({ ok: false, code: "UNSUPPORTED", message: "no-images" });
    } finally {
      unregister();
    }
  });

  test("rtl sets page-progression-direction in the OPF spine", async () => {
    const epub = pack(await createComicsAdapter({ direction: "rtl" }).read(cbz(), ctx));
    expect(opfOf(epub)).toMatch(/<spine[^>]*page-progression-direction="rtl"/);
  });
});

describe("uudecode", () => {
  test("decodes the body between begin and end", () => {
    expect(strFromU8(uudecode("begin 644 x\n#86)C\n`\nend\n"))).toBe("abc");
  });
});

describe("comics adapter on RAR (libarchive test files)", () => {
  const dl = join(mkdtempSync(join(tmpdir(), "pubmy-t9-")), "dl");
  beforeAll(async () => {
    const sources = join(dl, "..", "sources");
    mkdirSync(sources);
    copyFileSync(join(import.meta.dir, "../../../fixtures/sources/libarchive-rar.json"), join(sources, "libarchive-rar.json"));
    expect(await fetchFixtures(sources, dl)).toBe(0);
  });

  test("reads every file entry of a RAR4 archive, nested folders included", async () => {
    const entries = await readArchive(new Uint8Array(readFileSync(join(dl, "rar4.cbr"))), "rar", DEFAULT_LIMITS, loadNodeLibarchive);
    expect(entries.map((e) => [e.path, strFromU8(e.data)])).toEqual([
      ["test.txt", "test text document\r\n"],
      ["testdir/test.txt", "test text document\r\n"],
    ]);
  });

  test("reads a compressed RAR5 archive", async () => {
    const entries = await readArchive(new Uint8Array(readFileSync(join(dl, "rar5.cbr"))), "rar", DEFAULT_LIMITS, loadNodeLibarchive);
    expect(entries.map((e) => [e.path, e.data.length])).toEqual([["test.bin", 1200]]);
  });

  test("a RAR without images fails as UNSUPPORTED no-images, not as a read failure", async () => {
    const bytes = new Uint8Array(readFileSync(join(dl, "rar4.cbr")));
    expect(await failureOf(createComicsAdapter().read({ name: "rar4.cbr", bytes }, ctx))).toEqual({ code: "UNSUPPORTED", message: "no-images" });
  });
});
