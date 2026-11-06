import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { fetchFixtures } from "../../../fixtures/fetch.ts";
import { makeEncryptedPdf, makeImageOnlyPdf, makeTwoColumnPdf } from "../../../fixtures/make-pdf.ts";
import { pdfAdapter } from "../src/adapters/pdf.ts";
import { convert, domFor, registerAdapter, type Ctx, type Result } from "../src/index.ts";

const ctx: Ctx = {
  dom: domFor("bun"),
  loadOcr: () => Promise.reject(new Error("no OCR in pdf tests")),
  progress: () => {},
  signal: new AbortController().signal,
};

type Ok = Extract<Result, { ok: true }>;
function expectOk(r: Result): Ok {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
}
const files = (r: Ok) => unzipSync(r.epub);
const tocTitles = (r: Ok) =>
  [...strFromU8(files(r)["OEBPS/toc.ncx"]).matchAll(/<navPoint[^>]*>\s*<navLabel>\s*<text>([^<]*)<\/text>/g)].map((m) => m[1]);
const bookText = (r: Ok) =>
  Object.entries(files(r))
    .filter(([p]) => p.endsWith(".xhtml") && !p.endsWith("nav.xhtml"))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, b]) => strFromU8(b))
    .join("\n");

let unregister = () => {};
beforeAll(() => {
  unregister = registerAdapter(pdfAdapter);
});
afterAll(() => unregister());

const run = async (name: string, bytes: Uint8Array) => convert({ name, bytes }, ctx);

describe("pdf adapter: generated two-column page", () => {
  let r: Ok;
  beforeAll(async () => {
    r = expectOk(await run("two-column.pdf", await makeTwoColumnPdf()));
  });

  test("makes one chapter per section heading, in reading order", () => {
    expect(tocTitles(r)).toEqual(["1 Introduction", "2 Method", "3 Results"]);
  });

  test("reads the left column before the right column", () => {
    const text = bookText(r);
    expect(text.indexOf("Readers keep books")).toBeGreaterThan(-1);
    expect(text.indexOf("Readers keep books")).toBeLessThan(text.indexOf("The left column is read"));
  });

  test("drops the rotated side stamp", () => {
    expect(bookText(r)).not.toContain("stamp:generated");
  });

  test("takes the book title from the largest heading on the first page", () => {
    expect(strFromU8(files(r)["OEBPS/content.opf"])).toContain("A Generated Two Column Paper</dc:title>");
  });
});

test("pdf adapter: the PDF outline names the chapters when present", async () => {
  const r = expectOk(await run("outline.pdf", await makeTwoColumnPdf({ outline: ["Introduction", "Method", "Results"] })));
  expect(tocTitles(r)).toEqual(["Introduction", "Method", "Results"]);
});

test("pdf adapter: a password-protected PDF fails with READ_FAILED encrypted-pdf", async () => {
  expect(await run("locked.pdf", makeEncryptedPdf())).toEqual({ ok: false, code: "READ_FAILED", message: "encrypted-pdf" });
});

test("pdf adapter: an image-only page is refused with UNSUPPORTED scanned-pdf", async () => {
  expect(await run("scan.pdf", await makeImageOnlyPdf())).toEqual({ ok: false, code: "UNSUPPORTED", message: "scanned-pdf" });
});

describe("pdf adapter: arXiv 2302.13971v1 (CC BY 4.0)", () => {
  const fixtures = join(import.meta.dir, "..", "..", "..", "fixtures");
  let r: Result;
  beforeAll(async () => {
    const dl = join(fixtures, "out", "dl");
    expect(await fetchFixtures(join(fixtures, "sources"), dl)).toBe(0);
    r = await run("arxiv.pdf", new Uint8Array(readFileSync(join(dl, "arxiv-2302.13971v1.pdf"))));
  }, 120_000);

  test("converts to an EPUB with 0 epubcheck errors", () => {
    expect(expectOk(r).check.errors).toBe(0);
  });

  test("the first chapter title contains Introduction", () => {
    expect(tocTitles(expectOk(r))[0]).toContain("Introduction");
  });
});
