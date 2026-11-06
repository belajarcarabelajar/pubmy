import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { strFromU8, unzipSync } from "fflate";
import { makeDocx, makeEncryptedDocx, makePng } from "../../../fixtures/make-docx.ts";
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
});
