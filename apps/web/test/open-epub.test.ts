import { describe, expect, test } from "bun:test";
import { pack, type Book } from "@pubmy/core/browser";
import { strToU8, unzipSync, zipSync } from "fflate";
import { createEpubLoader } from "../src/epub-loader.ts";
import { EPUB_MIME, inspectEpub, isEpubFile, splitDrop } from "../src/open-epub.ts";

const book: Book = {
  meta: { title: "Opener fixture", creators: ["pubmy"], language: "en", modified: "2026-11-09T00:00:00Z" },
  chapters: [{ href: "ch001.xhtml", title: "Alpha chapter", body: "<h1>Alpha chapter</h1><p>The first chapter text.</p>" }],
  assets: [],
  toc: [],
  layout: "reflow",
  direction: "ltr",
};
const epub = pack(book);

const FONT_IDPF = "http://www.idpf.org/2008/embedding";
const FONT_ADOBE = "http://ns.adobe.com/pdf/enc#RC";
const AES = "http://www.w3.org/2001/04/xmlenc#aes128-cbc";

/** An encryption.xml whose `EncryptedData` entries use the given `EncryptionMethod` element markup. */
const encryptionXml = (...methods: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">\n${methods
    .map((m, i) => `<enc:EncryptedData>${m}<enc:CipherData><enc:CipherReference URI="OEBPS/f${i}.bin"/></enc:CipherData></enc:EncryptedData>`)
    .join("\n")}\n</encryption>`;

const epubWithEncryption = (xml: string) => zipSync({ ...unzipSync(epub), "META-INF/encryption.xml": strToU8(xml) });

describe("isEpubFile", () => {
  test.each([
    ["book.epub", undefined, true],
    ["Foo.EPUB", "", true],
    ["Mixed.EpUb", undefined, true],
    ["noextension", "application/epub+zip", true],
    ["", "application/epub+zip", true],
    ["paper.pdf", "application/pdf", false],
    ["a.epub.txt", "text/plain", false],
    ["a.epub.txt", undefined, false],
    ["", "", false],
    ["", undefined, false],
  ] as const)("name %p with type %p is an EPUB: %p", (name, type, expected) => {
    expect(isEpubFile({ name, type })).toBe(expected);
  });

  test("the EPUB MIME type is application/epub+zip", () => {
    expect(EPUB_MIME).toBe("application/epub+zip");
  });
});

describe("splitDrop", () => {
  const file = (name: string, size = 100, type?: string) => ({ name, size, type });
  const room = { maxBytes: 1000, maxHeld: 10, held: 0 };

  test("EPUBs go to toOpen and every other file to toQueue, each in drop order", () => {
    const drop = [file("a.txt"), file("one.epub"), file("b.pdf"), file("two.EPUB"), file("c", 5, EPUB_MIME), file("d.docx")];
    const { toQueue, toOpen, refused } = splitDrop(drop, room);
    expect(toQueue.map((f) => f.name)).toEqual(["a.txt", "b.pdf", "d.docx"]);
    expect(toOpen.map((f) => f.name)).toEqual(["one.epub", "two.EPUB", "c"]);
    expect(refused).toEqual([]);
  });

  test("an EPUB over maxBytes is refused as TOO_LARGE and never opened or queued", () => {
    const { toQueue, toOpen, refused } = splitDrop([file("big.epub", 1001), file("fits.epub", 1000)], room);
    expect(refused).toEqual([{ name: "big.epub", code: "TOO_LARGE" }]);
    expect(toOpen.map((f) => f.name)).toEqual(["fits.epub"]);
    expect(toQueue).toEqual([]);
  });

  test("a non-EPUB over maxBytes still goes to toQueue, which refuses it itself", () => {
    const { toQueue, refused } = splitDrop([file("huge.pdf", 5000)], room);
    expect(toQueue.map((f) => f.name)).toEqual(["huge.pdf"]);
    expect(refused).toEqual([]);
  });

  test("EPUBs beyond the held limit are refused as LIMIT_10", () => {
    const drop = [file("a.epub"), file("b.epub"), file("c.epub"), file("d.epub")];
    const { toOpen, refused } = splitDrop(drop, { maxBytes: 1000, maxHeld: 2, held: 0 });
    expect(toOpen.map((f) => f.name)).toEqual(["a.epub", "b.epub"]);
    expect(refused).toEqual([
      { name: "c.epub", code: "LIMIT_10" },
      { name: "d.epub", code: "LIMIT_10" },
    ]);
  });

  test("rows already held count against the limit", () => {
    const { toOpen, refused } = splitDrop([file("a.epub"), file("b.epub")], { maxBytes: 1000, maxHeld: 10, held: 9 });
    expect(toOpen.map((f) => f.name)).toEqual(["a.epub"]);
    expect(refused).toEqual([{ name: "b.epub", code: "LIMIT_10" }]);
  });

  test("when held already equals the limit, the first EPUB is refused", () => {
    const { toOpen, refused } = splitDrop([file("a.epub")], { maxBytes: 1000, maxHeld: 10, held: 10 });
    expect(toOpen).toEqual([]);
    expect(refused).toEqual([{ name: "a.epub", code: "LIMIT_10" }]);
  });

  test("an EPUB that is both too large and past the limit is refused as TOO_LARGE", () => {
    const { refused } = splitDrop([file("big.epub", 5000)], { maxBytes: 1000, maxHeld: 1, held: 1 });
    expect(refused).toEqual([{ name: "big.epub", code: "TOO_LARGE" }]);
  });

  test("an oversize EPUB does not use up a slot", () => {
    const drop = [file("big.epub", 5000), file("a.epub"), file("b.epub")];
    const { toOpen, refused } = splitDrop(drop, { maxBytes: 1000, maxHeld: 2, held: 0 });
    expect(toOpen.map((f) => f.name)).toEqual(["a.epub", "b.epub"]);
    expect(refused).toEqual([{ name: "big.epub", code: "TOO_LARGE" }]);
  });

  test("refusals keep the drop order", () => {
    const drop = [file("x.epub", 5000), file("a.epub"), file("y.epub"), file("z.epub", 5000)];
    const { refused } = splitDrop(drop, { maxBytes: 1000, maxHeld: 1, held: 0 });
    expect(refused).toEqual([
      { name: "x.epub", code: "TOO_LARGE" },
      { name: "y.epub", code: "LIMIT_10" },
      { name: "z.epub", code: "TOO_LARGE" },
    ]);
  });
});

describe("inspectEpub", () => {
  test("a valid EPUB is accepted", () => {
    expect(inspectEpub(epub)).toEqual({ ok: true });
  });

  test("an encryption.xml with only the two font obfuscations is accepted", () => {
    const xml = encryptionXml(
      `<enc:EncryptionMethod Algorithm="${FONT_IDPF}"/>`,
      `<enc:EncryptionMethod Algorithm="${FONT_ADOBE}"/>`,
    );
    expect(inspectEpub(epubWithEncryption(xml))).toEqual({ ok: true });
  });

  test("an empty file is refused as READ_FAILED empty-file", () => {
    expect(inspectEpub(new Uint8Array(0))).toEqual({ ok: false, code: "READ_FAILED", message: "empty-file" });
  });

  test("bytes that are not a zip are refused as READ_FAILED read-failed", () => {
    const pdf = strToU8("%PDF-1.7\n1 0 obj\n<< >>\nendobj\n");
    expect(inspectEpub(pdf)).toEqual({ ok: false, code: "READ_FAILED", message: "read-failed" });
  });

  test("an empty zip, whose first four bytes are the end record, is refused as READ_FAILED read-failed", () => {
    expect(inspectEpub(zipSync({}))).toEqual({ ok: false, code: "READ_FAILED", message: "read-failed" });
  });

  test("a file shorter than the zip signature is refused as READ_FAILED read-failed", () => {
    expect(inspectEpub(Uint8Array.of(0x50, 0x4b, 0x03))).toEqual({ ok: false, code: "READ_FAILED", message: "read-failed" });
  });

  test("a truncated zip is refused as READ_FAILED read-failed", () => {
    expect(inspectEpub(epub.slice(0, 200))).toEqual({ ok: false, code: "READ_FAILED", message: "read-failed" });
  });

  test("a zip without META-INF/container.xml is refused as READ_FAILED read-failed", () => {
    const noContainer = zipSync({ mimetype: strToU8("application/epub+zip"), "OEBPS/a.xhtml": strToU8("<html/>") });
    expect(inspectEpub(noContainer)).toEqual({ ok: false, code: "READ_FAILED", message: "read-failed" });
  });

  test("a zip with more entries than the cap is refused as READ_FAILED archive-too-large", () => {
    const many: Record<string, Uint8Array> = { "META-INF/container.xml": strToU8("<container/>") };
    for (let i = 0; i < 5000; i++) many[`OEBPS/f${i}.txt`] = new Uint8Array(1);
    expect(Object.keys(many)).toHaveLength(5001);
    expect(inspectEpub(zipSync(many))).toEqual({ ok: false, code: "READ_FAILED", message: "archive-too-large" });
  });

  test("a zip at exactly the entry cap is not refused for size", () => {
    const atCap: Record<string, Uint8Array> = { "META-INF/container.xml": strToU8("<container/>") };
    for (let i = 0; i < 4999; i++) atCap[`OEBPS/f${i}.txt`] = new Uint8Array(1);
    expect(Object.keys(atCap)).toHaveLength(5000);
    expect(inspectEpub(zipSync(atCap))).toEqual({ ok: true });
  });

  test.each([
    ["an unprefixed element", `<EncryptionMethod Algorithm="${AES}"/>`],
    ["a prefixed element", `<enc:EncryptionMethod Algorithm="${AES}"/>`],
    ["a single-quoted attribute", `<enc:EncryptionMethod Algorithm='${AES}'/>`],
    ["an element with children and extra attributes", `<enc:EncryptionMethod Id="m1" Algorithm="${AES}"><enc:KeySize>128</enc:KeySize></enc:EncryptionMethod>`],
    ["an Algorithm that only starts like a font one", `<enc:EncryptionMethod Algorithm="${FONT_IDPF}/x"/>`],
  ])("%s with a non-font algorithm is refused as DRM epub-drm", (_label, method) => {
    expect(inspectEpub(epubWithEncryption(encryptionXml(method)))).toEqual({ ok: false, code: "DRM", message: "epub-drm" });
  });

  test("one non-font algorithm among font ones is refused as DRM epub-drm", () => {
    const xml = encryptionXml(
      `<enc:EncryptionMethod Algorithm="${FONT_IDPF}"/>`,
      `<enc:EncryptionMethod Algorithm="${AES}"/>`,
      `<enc:EncryptionMethod Algorithm="${FONT_ADOBE}"/>`,
    );
    expect(inspectEpub(epubWithEncryption(xml))).toEqual({ ok: false, code: "DRM", message: "epub-drm" });
  });

  test("an encryption.xml that lists no EncryptionMethod is accepted", () => {
    expect(inspectEpub(epubWithEncryption(encryptionXml()))).toEqual({ ok: true });
  });

  test("it inflates nothing beyond the two META-INF entries", () => {
    const clean = zipSync({ "OEBPS/big.txt": strToU8("a".repeat(5000)), "META-INF/container.xml": strToU8("<container/>") });
    // The first entry's deflate stream is overwritten with 0xff, which is not a valid block header.
    const view = new DataView(clean.buffer, clean.byteOffset, clean.byteLength);
    const start = 30 + view.getUint16(26, true) + view.getUint16(28, true);
    const corrupt = clean.slice();
    corrupt.fill(0xff, start, start + view.getUint32(18, true));
    // Positive control: the corruption really breaks a full unzip.
    expect(() => unzipSync(corrupt)).toThrow();
    expect(inspectEpub(corrupt)).toEqual({ ok: true });
  });
});

describe("createEpubLoader limits", () => {
  test("an archive over the byte cap throws archive-too-large", () => {
    expect(() => createEpubLoader(epub, { maxBytes: 10, maxEntries: 5000 })).toThrow("archive-too-large");
  });

  test("an archive over the entry cap throws archive-too-large", () => {
    expect(() => createEpubLoader(epub, { maxBytes: 500 * 1024 * 1024, maxEntries: 1 })).toThrow("archive-too-large");
  });

  test("a normal EPUB still loads with the default limits", () => {
    const loader = createEpubLoader(epub);
    expect(loader.loadText("OEBPS/ch001.xhtml")).toContain("The first chapter text.");
    expect(loader.entries).toContain("META-INF/container.xml");
  });

  test("entries with a .. segment are dropped", () => {
    const sneaky = zipSync({ "META-INF/container.xml": strToU8("<container/>"), "../escape.txt": strToU8("x") });
    expect(createEpubLoader(sneaky).entries).toEqual(["META-INF/container.xml"]);
  });
});
