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

const epubWithEncryption = (xml: string | Uint8Array) =>
  zipSync({ ...unzipSync(epub), "META-INF/encryption.xml": typeof xml === "string" ? strToU8(xml) : xml });

/** Deterministic bytes that deflate cannot shrink: the high byte of a 32-bit linear congruential generator. */
function noise(n: number): Uint8Array {
  const out = new Uint8Array(n);
  let x = 12345;
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

const concat = (a: Uint8Array, b: Uint8Array) => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
};

/** The central-directory record of an entry: where it starts and the sizes it declares. */
function central(zip: Uint8Array, name: string) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // zipSync writes no archive comment, so the end record is the last 22 bytes.
  const eocd = zip.length - 22;
  let at = view.getUint32(eocd + 16, true);
  for (let k = view.getUint16(eocd + 10, true); k > 0; k--) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const nameLen = view.getUint16(at + 28, true);
    if (new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLen)) === name) {
      return { at, compressed: view.getUint32(at + 20, true), declared: view.getUint32(at + 24, true) };
    }
    at += 46 + nameLen + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  throw new Error(`no central-directory record for ${name}`);
}

/** A copy of the zip whose central directory declares another uncompressed size for the entry. */
function declaring(zip: Uint8Array, name: string, size: number): Uint8Array {
  const copy = zip.slice();
  new DataView(copy.buffer).setUint32(central(copy, name).at + 24, size, true);
  return copy;
}

const READ_FAILED = { ok: false, code: "READ_FAILED", message: "read-failed" } as const;

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

/** The text as UTF-16 behind a byte order mark, built by hand so the fixture does not lean on TextDecoder's own tables. */
function utf16(text: string, order: "le" | "be"): Uint8Array {
  const out = new Uint8Array(2 + text.length * 2);
  out.set(order === "le" ? [0xff, 0xfe] : [0xfe, 0xff]);
  const [lo, hi] = order === "le" ? [2, 3] : [3, 2];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out[i * 2 + lo] = c & 0xff;
    out[i * 2 + hi] = c >> 8;
  }
  return out;
}

describe("inspectEpub: encryption.xml is read the way an XML parser reads it", () => {
  const DRM = { ok: false, code: "DRM", message: "epub-drm" } as const;
  const aes = `<enc:EncryptionMethod Algorithm="${AES}"/>`;
  const fontsOnly = encryptionXml(`<enc:EncryptionMethod Algorithm="${FONT_IDPF}"/>`, `<enc:EncryptionMethod Algorithm="${FONT_ADOBE}"/>`);
  const orders = [
    ["little-endian", "le"],
    ["big-endian", "be"],
  ] as const;

  test.each(orders)("a UTF-16 %s encryption.xml with a non-font algorithm is refused as DRM epub-drm", (_label, order) => {
    expect(inspectEpub(epubWithEncryption(utf16(encryptionXml(aes), order)))).toEqual(DRM);
  });

  test.each(orders)("a UTF-16 %s encryption.xml with a non-font algorithm among font ones is refused as DRM epub-drm", (_label, order) => {
    const xml = encryptionXml(`<enc:EncryptionMethod Algorithm="${FONT_IDPF}"/>`, aes);
    expect(inspectEpub(epubWithEncryption(utf16(xml, order)))).toEqual(DRM);
  });

  test.each(orders)("a UTF-16 %s encryption.xml listing only the two font obfuscations is accepted", (_label, order) => {
    expect(inspectEpub(epubWithEncryption(utf16(fontsOnly, order)))).toEqual({ ok: true });
  });

  test("a UTF-8 encryption.xml behind a byte order mark with a non-font algorithm is refused as DRM epub-drm", () => {
    const bom = Uint8Array.of(0xef, 0xbb, 0xbf);
    expect(inspectEpub(epubWithEncryption(concat(bom, strToU8(encryptionXml(aes)))))).toEqual(DRM);
  });

  test("an EncryptionMethod inside an XML comment is not a method", () => {
    expect(inspectEpub(epubWithEncryption(encryptionXml(`<!-- ${aes} -->`)))).toEqual({ ok: true });
  });

  test("an EncryptionMethod inside a CDATA section is not a method", () => {
    expect(inspectEpub(epubWithEncryption(encryptionXml(`<![CDATA[ ${aes} ]]>`)))).toEqual({ ok: true });
  });

  test("the same EncryptionMethod outside a comment is refused as DRM epub-drm", () => {
    expect(inspectEpub(epubWithEncryption(encryptionXml(aes)))).toEqual(DRM);
  });

  test.each([
    ["a comment before it", `<!-- note -->${aes}`],
    ["a comment after it", `${aes}<!-- note -->`],
    ["two comments around it", `<!-- a --><!-- b -->${aes}<!-- c -->`],
    ["a CDATA section before it", `<![CDATA[ note ]]>${aes}`],
    // A comment opener inside CDATA is text, so the comment that follows must not reach back and swallow the tag.
    ["a comment opener inside CDATA before it and a real comment after", `<![CDATA[ <!-- ]]>${aes}<!-- x -->`],
    // A CDATA opener inside a comment is text for the same reason.
    ["a CDATA opener inside a comment before it and a real CDATA after", `<!-- <![CDATA[ -->${aes}<![CDATA[ x ]]>`],
  ])("a real EncryptionMethod with %s is refused as DRM epub-drm", (_label, method) => {
    expect(inspectEpub(epubWithEncryption(encryptionXml(method)))).toEqual(DRM);
  });

  test("two commented-out methods and a CDATA one are all ignored", () => {
    const hidden = `<!-- ${aes} --><![CDATA[ ${aes} ]]><!-- ${aes} -->`;
    expect(inspectEpub(epubWithEncryption(encryptionXml(hidden)))).toEqual({ ok: true });
  });

  // A tag after an unterminated opener stays visible: stripping stops there instead of guessing where the comment ends.
  test.each([
    ["an unterminated comment", `<!-- ${aes}`],
    ["an unterminated CDATA section", `<![CDATA[ ${aes}`],
    ["a hiding comment followed by an unterminated one", `<!-- ${aes} --><!-- ${aes}`],
  ])("an EncryptionMethod after %s still counts and is refused as DRM epub-drm", (_label, method) => {
    expect(inspectEpub(epubWithEncryption(encryptionXml(method)))).toEqual(DRM);
  });
});

describe("inspectEpub: the two META-INF entries are read within bounds", () => {
  const CONTAINER = "META-INF/container.xml";
  const ENCRYPTION = "META-INF/encryption.xml";
  const timed = (zip: Uint8Array) => {
    const t0 = performance.now();
    const result = inspectEpub(zip);
    return { result, ms: performance.now() - t0 };
  };

  // Both stay inside the 128 KiB declared bound, so the scan is what takes the time and not the size cap.
  test("8000 unterminated comment openers are scanned in linear time", () => {
    const xml = "<!--".repeat(8000);
    expect(strToU8(xml).length).toBeLessThanOrEqual(128 * 1024);
    const { result, ms } = timed(epubWithEncryption(xml));
    expect(result).toEqual({ ok: true });
    expect(ms).toBeLessThan(100);
  });

  test("8000 closed comments are scanned in linear time", () => {
    const xml = "<!-- x -->".repeat(8000);
    expect(strToU8(xml).length).toBeLessThanOrEqual(128 * 1024);
    const { result, ms } = timed(epubWithEncryption(xml));
    expect(result).toEqual({ ok: true });
    expect(ms).toBeLessThan(100);
  });

  test("an encryption.xml of 20000 unclosed EncryptionMethod tags is answered in under 500 ms", () => {
    const { result, ms } = timed(epubWithEncryption("<EncryptionMethod ".repeat(20000)));
    expect(typeof result.ok).toBe("boolean");
    expect(ms).toBeLessThan(500);
  });

  // Largest such file the declared-size bound lets through, so the scan itself is what takes the time.
  test("unclosed EncryptionMethod tags up to the declared-size bound are scanned in linear time", () => {
    const xml = "<EncryptionMethod ".repeat(7281);
    expect(xml.length).toBeLessThanOrEqual(128 * 1024);
    const { result, ms } = timed(epubWithEncryption(xml));
    expect(result).toEqual({ ok: true });
    expect(ms).toBeLessThan(100);
  });

  test("a container.xml whose compressed size is over 16 KiB is refused as READ_FAILED read-failed", () => {
    const zip = zipSync({ ...unzipSync(epub), [CONTAINER]: noise(32 * 1024) });
    // Fixture check: over the compressed bound but under the declared one, so only the compressed bound can refuse it.
    expect(central(zip, CONTAINER).compressed).toBeGreaterThan(16 * 1024);
    expect(central(zip, CONTAINER).declared).toBeLessThan(128 * 1024);
    expect(inspectEpub(zip)).toEqual(READ_FAILED);
  });

  // Skipping a too-large encryption.xml as if absent would let a DRM book through as ok.
  test("an oversize encryption.xml that names a non-font algorithm is refused as READ_FAILED read-failed, not ignored", () => {
    const xml = strToU8(encryptionXml(`<enc:EncryptionMethod Algorithm="${AES}"/>`));
    // Control: unpadded, the same file is DRM.
    expect(inspectEpub(epubWithEncryption(xml))).toEqual({ ok: false, code: "DRM", message: "epub-drm" });
    const zip = epubWithEncryption(concat(xml, noise(32 * 1024)));
    expect(central(zip, ENCRYPTION).compressed).toBeGreaterThan(16 * 1024);
    expect(inspectEpub(zip)).toEqual(READ_FAILED);
  });

  test("a container.xml of 24 MB of one letter, about 24 KB compressed, is refused fast as READ_FAILED read-failed", () => {
    const zip = zipSync({ ...unzipSync(epub), [CONTAINER]: new Uint8Array(24 * 1024 * 1024).fill(0x61) });
    expect(central(zip, CONTAINER).compressed).toBeGreaterThan(16 * 1024);
    expect(central(zip, CONTAINER).declared).toBe(24 * 1024 * 1024);
    const { result, ms } = timed(zip);
    expect(result).toEqual(READ_FAILED);
    expect(ms).toBeLessThan(500);
  });

  test("an encryption.xml that declares 200 KiB uncompressed is refused as READ_FAILED read-failed", () => {
    const honest = epubWithEncryption(encryptionXml(`<enc:EncryptionMethod Algorithm="${FONT_IDPF}"/>`));
    const lying = declaring(honest, ENCRYPTION, 200 * 1024);
    expect(central(lying, ENCRYPTION).declared).toBe(200 * 1024);
    expect(inspectEpub(honest)).toEqual({ ok: true });
    expect(inspectEpub(lying)).toEqual(READ_FAILED);
  });

  test("a zip whose central directory declares 600 MiB is refused as READ_FAILED archive-too-large", () => {
    const zip = declaring(epub, CONTAINER, 600 * 1024 * 1024);
    expect(central(zip, CONTAINER).declared).toBe(600 * 1024 * 1024);
    expect(inspectEpub(zip)).toEqual({ ok: false, code: "READ_FAILED", message: "archive-too-large" });
  });

  test.each([
    ["no attributes", "<enc:EncryptionMethod/>"],
    ["only an Id", `<enc:EncryptionMethod Id="m1"/>`],
  ])("an EncryptionMethod with %s has no Algorithm and is refused as DRM epub-drm", (_label, method) => {
    expect(inspectEpub(epubWithEncryption(encryptionXml(method)))).toEqual({ ok: false, code: "DRM", message: "epub-drm" });
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
