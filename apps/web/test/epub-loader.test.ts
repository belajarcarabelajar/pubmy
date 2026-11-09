import { describe, expect, test } from "bun:test";
import { pack, type Book } from "@pubmy/core/browser";
import { unzipSync, zipSync } from "fflate";
import { createEpubLoader } from "../src/epub-loader.ts";

const book: Book = {
  meta: { title: "Preview fixture", creators: ["pubmy"], language: "en", modified: "2026-11-07T00:00:00Z" },
  chapters: [
    { href: "ch001.xhtml", title: "Alpha chapter", body: "<h1>Alpha chapter</h1><p>The first chapter text.</p>" },
    { href: "ch002.xhtml", title: "Beta chapter", body: "<h1>Beta chapter</h1><p>The second chapter text.</p>" },
  ],
  assets: [],
  toc: [],
  layout: "reflow",
  direction: "ltr",
};
const epub = pack(book);

/** The EPUB plus 64 MB of one byte whose central directory record declares 1,024 bytes (zipSync writes no comment, so the end record is the last 22 bytes). */
function lyingEpub(): Uint8Array {
  const zip = zipSync({ ...unzipSync(epub), "OEBPS/big.bin": [new Uint8Array(64 << 20).fill(0x61), { level: 1 }] });
  const v = new DataView(zip.buffer);
  const eocd = zip.length - 22;
  let at = v.getUint32(eocd + 16, true);
  for (let i = 0; i < v.getUint16(eocd + 10, true); i++) {
    const nameLen = v.getUint16(at + 28, true);
    if (new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLen)) === "OEBPS/big.bin") v.setUint32(at + 24, 1024, true);
    at += 46 + nameLen + v.getUint16(at + 30, true) + v.getUint16(at + 32, true);
  }
  return zip;
}

// foliate asks for every file by its path inside the container, resolved against the package document.
describe("createEpubLoader", () => {
  test("every spine document the package names loads through it", () => {
    const loader = createEpubLoader(epub);
    const opf = loader.loadText("OEBPS/content.opf") ?? "";
    const spine = [...opf.matchAll(/<itemref idref="([^"]+)"/g)].map(([, id]) => new RegExp(`<item id="${id}" href="([^"]+)"`).exec(opf)?.[1]);
    expect(spine).toEqual(["ch001.xhtml", "ch002.xhtml"]);
    for (const href of spine) expect(loader.loadText(`OEBPS/${href}`)).toContain("<body");
  });

  test("the table of contents loads through it and lists both chapters", () => {
    const nav = createEpubLoader(epub).loadText("OEBPS/nav.xhtml") ?? "";
    for (const part of ['href="ch001.xhtml"', "Alpha chapter", 'href="ch002.xhtml"', "Beta chapter"]) expect(nav).toContain(part);
  });

  test("a chapter loads as its XHTML text", async () => {
    const text = await createEpubLoader(epub).loadText("OEBPS/ch002.xhtml");
    expect(text).toContain("The second chapter text.");
  });

  test("a missing entry loads as null, which foliate reads as absent", async () => {
    const loader = createEpubLoader(epub);
    expect(await loader.loadText("META-INF/encryption.xml")).toBeNull();
    expect(await loader.loadBlob("META-INF/encryption.xml")).toBeNull();
    expect(loader.getSize("META-INF/encryption.xml")).toBe(0);
  });

  test("a blob carries the entry's bytes and its size", async () => {
    const loader = createEpubLoader(epub);
    const blob = await loader.loadBlob("OEBPS/ch001.xhtml");
    expect(await blob?.text()).toBe((await loader.loadText("OEBPS/ch001.xhtml")) ?? "missing");
    expect(loader.getSize("OEBPS/ch001.xhtml")).toBe(blob?.size ?? -1);
  });

  test("a normal EPUB loads every file in it with the bytes that went in", async () => {
    const loader = createEpubLoader(epub);
    const expected = Object.entries(unzipSync(epub)).filter(([name]) => !name.endsWith("/"));
    expect([...loader.entries].sort()).toEqual(expected.map(([name]) => name).sort());
    for (const [name, bytes] of expected) {
      expect(loader.getSize(name)).toBe(bytes.length);
      expect(new Uint8Array((await loader.loadBlob(name)?.arrayBuffer()) ?? new ArrayBuffer(0))).toEqual(bytes);
    }
  });

  test("a book whose central directory understates an entry is refused as archive-too-large, without inflating 64 MB", () => {
    const lying = lyingEpub();
    const t0 = performance.now();
    let thrown: { name?: string; code?: string; message?: string } | undefined;
    try {
      createEpubLoader(lying);
    } catch (e) {
      thrown = e as typeof thrown;
    }
    const ms = performance.now() - t0;
    expect({ name: thrown?.name, code: thrown?.code, message: thrown?.message }).toEqual({
      name: "PubmyError",
      code: "READ_FAILED",
      message: "archive-too-large",
    });
    // Inflating the whole 64 MB took 1.8 s to 5 s on the machines measured; one piece costs about 0.15 s.
    expect(ms).toBeLessThan(1000);
  }, 30_000);

  test("close() drops the bytes, so every later load is null", async () => {
    const loader = createEpubLoader(epub);
    expect(loader.entries).toContain("OEBPS/content.opf");
    loader.close();
    expect(loader.entries).toEqual([]);
    expect(await loader.loadText("OEBPS/ch001.xhtml")).toBeNull();
    expect(await loader.loadBlob("OEBPS/ch001.xhtml")).toBeNull();
  });
});
