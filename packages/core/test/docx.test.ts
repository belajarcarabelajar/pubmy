import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { strFromU8, unzipSync } from "fflate";
import {
  makeDocx, makeDocxWithEmf, makeDocxWithEntries, makeDocxWithHyperlink, makeEncryptedDocx, makePng,
} from "../../../fixtures/make-docx.ts";
import { docxAdapter } from "../src/adapters/docx.ts";
import { convert, domFor, registerAdapter, type Book, type Ctx, type Result } from "../src/index.ts";

let unregister = () => {};
beforeAll(() => {
  unregister = registerAdapter(docxAdapter);
});
afterAll(() => unregister());

const ctx: Ctx = {
  dom: domFor("bun"),
  loadOcr: () => Promise.reject(new Error("no OCR in docx tests")),
  progress: () => {},
  signal: new AbortController().signal,
};

/** Rewrites the uncompressed-size field of the central directory record named `name` (the fixture zip has no comment, so the EOCD is the last 22 bytes). */
function declareSize(zip: Uint8Array, name: string, size: number): Uint8Array {
  const out = zip.slice();
  const v = new DataView(out.buffer);
  const eocd = out.length - 22;
  let at = v.getUint32(eocd + 16, true);
  let patched = 0;
  for (let i = 0; i < v.getUint16(eocd + 10, true); i++) {
    const nameLen = v.getUint16(at + 28, true);
    if (strFromU8(out.subarray(at + 46, at + 46 + nameLen)) === name) {
      v.setUint32(at + 24, size, true);
      patched++;
    }
    at += 46 + nameLen + v.getUint16(at + 30, true) + v.getUint16(at + 32, true);
  }
  if (patched !== 1) throw new Error(`declareSize: ${patched} records named ${name}`);
  return out;
}

const read = (name: string, bytes: Uint8Array) => docxAdapter.read({ name, bytes }, ctx);
const allBodies = (b: Book) => b.chapters.map((c) => c.body).join("\n");

describe("docx adapter: Book model", () => {
  test("makes one chapter per Heading 1, titled from the heading", async () => {
    const book = await read("sample.docx", makeDocx());
    expect(book.chapters.map((c) => c.title)).toEqual(["Introduction", "Details"]);
  });

  test("keeps the bullet list", async () => {
    const book = await read("sample.docx", makeDocx());
    expect(book.chapters[0].body).toMatch(/<ul>\s*<li>First bullet<\/li>\s*<li>Second bullet<\/li>\s*<\/ul>/);
  });

  test("keeps the 2x2 table", async () => {
    const body = (await read("sample.docx", makeDocx())).chapters[1].body;
    expect((body.match(/<tr>/g) ?? []).length).toBe(2);
    expect(body).toContain("Cell B2");
  });

  test("turns the embedded PNG into an asset referenced by the chapter", async () => {
    const book = await read("sample.docx", makeDocx());
    expect(book.assets).toHaveLength(1);
    const [img] = book.assets;
    expect(img.mediaType).toBe("image/png");
    expect(img.data).toEqual(makePng());
    expect(book.chapters[0].body).toContain(`src="${img.href}"`);
  });

  test("links the footnote reference to the chapter that holds the note", async () => {
    const book = await read("sample.docx", makeDocx());
    const ref = book.chapters[0].body.match(/<a href="([^"]*)#(footnote-1)"/);
    expect(ref).not.toBeNull();
    const target = book.chapters.find((c) => c.href === (ref![1] || book.chapters[0].href))!;
    expect(target.body).toContain(`id="${ref![2]}"`);
    expect(target.body).toContain("The footnote text.");
  });

  test("a DOCX with no headings becomes one chapter titled from the file name", async () => {
    const book = await read("memo.docx", makeDocx({ headings: false }));
    expect(book.chapters.map((c) => c.title)).toEqual(["memo"]);
    expect(allBodies(book)).toContain("Second line of the memo.");
  });

  test("a CFB container is rejected as encrypted-office", async () => {
    await expect(read("locked.docx", makeEncryptedDocx())).rejects.toMatchObject({
      code: "READ_FAILED",
      message: "encrypted-office",
    });
  });
});

type Ok = Extract<Result, { ok: true }>;
function expectOk(r: Result): Ok {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
}

describe("docx adapter: convert()", () => {
  test("converts the sample DOCX to an EPUB with 0 epubcheck errors", async () => {
    const r = expectOk(await convert({ name: "sample.docx", bytes: makeDocx() }, ctx));
    expect(r.check.errors).toBe(0);
  });

  test("lists both headings in the nav", async () => {
    const r = expectOk(await convert({ name: "sample.docx", bytes: makeDocx() }, ctx));
    const nav = strFromU8(unzipSync(r.epub)["OEBPS/nav.xhtml"]);
    expect(nav).toContain(">Introduction</a>");
    expect(nav).toContain(">Details</a>");
  });

  test("a password-protected DOCX is READ_FAILED with encrypted-office", async () => {
    const r = await convert({ name: "locked.docx", bytes: makeEncryptedDocx() }, ctx);
    expect(r).toEqual({ ok: false, code: "READ_FAILED", message: "encrypted-office" });
  });

  test("a DOCX with 6,000 extra entries is READ_FAILED with archive-too-large", async () => {
    const extra = Object.fromEntries(Array.from({ length: 6000 }, (_, i) => [`junk/${i}.txt`, new Uint8Array()]));
    const r = await convert({ name: "bomb.docx", bytes: makeDocxWithEntries(extra) }, ctx);
    expect(r).toEqual({ ok: false, code: "READ_FAILED", message: "archive-too-large" });
  });

  test("a DOCX whose entry inflates past its declared size is READ_FAILED with archive-too-large", async () => {
    const big = new Uint8Array(200_000).fill(0x61);
    const honest = makeDocxWithEntries({ "junk/big.bin": big });
    expectOk(await convert({ name: "honest.docx", bytes: honest }, ctx));
    const r = await convert({ name: "lying.docx", bytes: declareSize(honest, "junk/big.bin", 1024) }, ctx);
    expect(r).toEqual({ ok: false, code: "READ_FAILED", message: "archive-too-large" });
  });

  test("a javascript: hyperlink leaves no javascript: in any chapter but keeps its text", async () => {
    const r = expectOk(await convert({ name: "links.docx", bytes: makeDocxWithHyperlink("javascript:alert(1)") }, ctx));
    const files = unzipSync(r.epub);
    const chapters = Object.keys(files).filter((p) => /^OEBPS\/ch\d+\.xhtml$/.test(p)).map((p) => strFromU8(files[p]));
    expect(chapters.length).toBeGreaterThan(0);
    const all = chapters.join("\n");
    expect(all).not.toMatch(/javascript:/i);
    expect(all).toContain("Click me");
  });

  test("an https hyperlink keeps its href", async () => {
    const book = await read("links.docx", makeDocxWithHyperlink("https://example.com/a?b=1&c=2"));
    expect(allBodies(book)).toContain('href="https://example.com/a?b=1&amp;c=2"');
  });

  test("an EMF picture is dropped with its alt text kept, and the book still passes epubcheck", async () => {
    const r = expectOk(await convert({ name: "chart.docx", bytes: makeDocxWithEmf() }, ctx));
    expect(r.check.errors).toBe(0);
    const files = unzipSync(r.epub);
    expect(Object.keys(files).filter((p) => p.startsWith("OEBPS/images/"))).toEqual([]);
    const all = Object.keys(files).filter((p) => /^OEBPS\/ch\d+\.xhtml$/.test(p)).map((p) => strFromU8(files[p])).join("\n");
    expect(all).toContain("Vector chart");
    expect(all).not.toContain("<img");
  });
});
