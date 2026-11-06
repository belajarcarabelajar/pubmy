import { describe, expect, test } from "bun:test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { convert, domFor, type Ctx, type Result } from "../src/index.ts";

const ctx: Ctx = {
  dom: domFor("bun"),
  loadOcr: () => Promise.reject(new Error("no OCR in text tests")),
  progress: () => {},
  signal: new AbortController().signal,
};

const run = (name: string, text: string | Uint8Array) =>
  convert({ name, bytes: typeof text === "string" ? strToU8(text) : text }, ctx);

type Ok = Extract<Result, { ok: true }>;
function expectOk(r: Result): Ok {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
}
const files = (r: Ok) => unzipSync(r.epub);
const opf = (r: Ok) => strFromU8(files(r)["OEBPS/content.opf"]);
const spineCount = (r: Ok) => (opf(r).match(/<itemref /g) ?? []).length;
const chapterText = (r: Ok) =>
  Object.entries(files(r))
    .filter(([p]) => p.endsWith(".xhtml") && !p.endsWith("nav.xhtml"))
    .map(([, b]) => strFromU8(b))
    .join("\n");

describe("text adapter: HTML", () => {
  const html = `<!DOCTYPE html><html lang="en"><head><title>Doc</title></head><body>
    <h1>First</h1><p>Alpha paragraph.</p><h1>Second</h1><p>Beta paragraph.</p></body></html>`;

  test("converts to an EPUB with 0 epubcheck errors", async () => {
    const r = expectOk(await run("book.html", html));
    expect(r.check.errors).toBe(0);
  });

  test("makes one chapter per h1", async () => {
    const r = expectOk(await run("book.html", html));
    expect(spineCount(r)).toBe(2);
  });

  test("lists every chapter in the nav and in toc.ncx", async () => {
    const r = expectOk(await run("book.html", html));
    const f = files(r);
    const nav = strFromU8(f["OEBPS/nav.xhtml"]);
    const ncx = strFromU8(f["OEBPS/toc.ncx"]);
    expect(nav).toContain(">First</a>");
    expect(nav).toContain(">Second</a>");
    expect((ncx.match(/<navPoint /g) ?? []).length).toBe(2);
  });

  test("takes dc:language from the html lang attribute", async () => {
    const r = expectOk(await run("book.html", html));
    expect(opf(r)).toContain("<dc:language>en</dc:language>");
  });
});

describe("text adapter: Markdown", () => {
  const md = "# One\n\nSome *emphasis* here.\n\n# Two\n\nMore text.\n";

  test("converts to an EPUB with 0 epubcheck errors", async () => {
    const r = expectOk(await run("notes.md", md));
    expect(r.check.errors).toBe(0);
  });

  test("makes one chapter per h1", async () => {
    const r = expectOk(await run("notes.md", md));
    expect(spineCount(r)).toBe(2);
  });

  test("renders inline Markdown through markdown-it", async () => {
    const r = expectOk(await run("notes.md", md));
    expect(chapterText(r)).toContain("<em>emphasis</em>");
  });
});

describe("text adapter: TXT", () => {
  test("converts to an EPUB with 0 epubcheck errors", async () => {
    const r = expectOk(await run("story.txt", "Line one.\n\nLine two & more <stuff>.\n"));
    expect(r.check.errors).toBe(0);
  });

  test("defaults dc:language to id", async () => {
    const r = expectOk(await run("story.txt", "Halo dunia.\n"));
    expect(opf(r)).toContain("<dc:language>id</dc:language>");
  });

  test("decodes non-UTF-8 bytes as windows-1252", async () => {
    // "café – ok" in windows-1252: e9 = é, 96 = en dash
    const bytes = new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x20, 0x96, 0x20, 0x6f, 0x6b]);
    const r = expectOk(await run("old.txt", bytes));
    expect(chapterText(r)).toContain("café – ok");
  });
});

describe("convert refusals", () => {
  test("an EPUB input is refused as UNSUPPORTED with already-epub", async () => {
    const epub = zipSync({
      mimetype: [strToU8("application/epub+zip"), { level: 0 }],
      "META-INF/container.xml": strToU8("<container/>"),
    });
    const r = await run("book.epub", epub);
    expect(r).toEqual({ ok: false, code: "UNSUPPORTED", message: "already-epub" });
  });

  test("an empty file is READ_FAILED", async () => {
    const r = await run("empty.txt", new Uint8Array());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("READ_FAILED");
  });

  test("unknown magic bytes with an unknown extension are UNSUPPORTED", async () => {
    const r = await run("blob.xyz", new Uint8Array([0x00, 0x13, 0x37, 0x42, 0x99]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("UNSUPPORTED");
  });
});
