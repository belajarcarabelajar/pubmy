import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { fetchFixtures } from "../../../fixtures/fetch.ts";
import { makeEncryptedPdf, makeImageOnlyPdf, makeRunningHeadPdf, makeTwoColumnPdf } from "../../../fixtures/make-pdf.ts";
import { CAPTION, makeFiguresPdf, STAMP } from "../../../fixtures/make-pdf-figures.ts";
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

describe("pdf adapter: generated pages with a running header and footer", () => {
  let r: Ok;
  beforeAll(async () => {
    r = expectOk(await run("running-head.pdf", await makeRunningHeadPdf()));
  });

  test("drops the running header", () => {
    expect(bookText(r)).not.toContain("Doe and Roe");
  });

  test("drops the running footer, also where page 1 prints it at the top", () => {
    expect(bookText(r)).not.toContain("Author manuscript");
  });

  test("a paragraph cut mid-sentence by the page break goes on past the footnote under it", () => {
    expect(bookText(r)).toContain("earlier work (Gutman, Sameroff, &amp; Cole, 2003) and later");
  });

  test("a paragraph that ends its sentence at the foot of a page stays apart from the next page", () => {
    expect(bookText(r)).toContain("<p>Next page opens a new paragraph in upper case.</p>");
  });

  test("makes one chapter per section heading, a heading wrapped onto two lines included", () => {
    expect(tocTitles(r)).toEqual(["Introduction", "Parental Discipline and Youth Conduct Problems and Depressive Symptoms", "Method", "Results"]);
  });
});

describe("pdf adapter: generated figure and sideways table", () => {
  let r: Ok;
  beforeAll(async () => {
    r = expectOk(await run("figures.pdf", await makeFiguresPdf()));
  });
  const pngs = () => Object.keys(files(r)).filter((p) => p.endsWith(".png"));

  test("keeps the raster figure as a PNG file in the EPUB", () => {
    expect(pngs()).toEqual(["OEBPS/img/p1-1.png"]);
    expect([...files(r)["OEBPS/img/p1-1.png"].slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  test("lists the figure in the manifest as image/png", () => {
    expect(strFromU8(files(r)["OEBPS/content.opf"])).toContain('href="img/p1-1.png" media-type="image/png"');
  });

  test("shows the figure where it sits on the page, before its caption, named by the caption", () => {
    const text = bookText(r);
    const img = text.indexOf('<img src="img/p1-1.png" alt="Figure 1"');
    expect(img).toBeGreaterThan(text.indexOf("compare every value."));
    expect(img).toBeLessThan(text.indexOf(CAPTION));
  });

  test("rebuilds the table printed sideways as an XHTML table with its caption and notes", () => {
    const text = bookText(r);
    expect(text).toContain("<caption>Table 1 Correlations among generated scores</caption>");
    expect(text).toContain("<td>2. Mood</td><td>.32***</td><td>1.00</td><td></td>");
    expect(text).toContain("<p>* p &lt; .05</p>");
  });

  test("keeps the side stamp out of the book", () => {
    expect(bookText(r)).not.toContain(STAMP);
  });
});

test("pdf adapter: the PDF outline names the chapters when present", async () => {
  const r = expectOk(await run("outline.pdf", await makeTwoColumnPdf({ outline: ["Introduction", "Method", "Results"] })));
  expect(tocTitles(r)).toEqual(["Introduction", "Method", "Results"]);
});

test("pdf adapter: a password-protected PDF fails with READ_FAILED encrypted-pdf", async () => {
  expect(await run("locked.pdf", makeEncryptedPdf())).toEqual({ ok: false, code: "READ_FAILED", message: "encrypted-pdf" });
});

// tesseract is the external boundary here; scan.test.ts runs the real engine.
const fakeOcr = (confidence: number): Ctx => ({
  ...ctx,
  loadOcr: async () => ({
    recognize: async () => ({ text: "Teks hasil pindaian.\n", confidence }),
    terminate: async () => {},
  }),
});

test("pdf adapter: an image-only page converts through OCR", async () => {
  const r = expectOk(await convert({ name: "scan.pdf", bytes: await makeImageOnlyPdf() }, fakeOcr(88)));
  expect(bookText(r)).toContain("Teks hasil pindaian.");
  expect(r.notes?.ocr).toEqual({ pages: 1, meanConfidence: 88 });
  expect(r.notes?.warnings ?? []).not.toContain("low-ocr-confidence");
});

test("pdf adapter: OCR confidence under 50 adds the low-ocr-confidence warning", async () => {
  const r = expectOk(await convert({ name: "scan.pdf", bytes: await makeImageOnlyPdf() }, fakeOcr(30)));
  expect(r.notes?.warnings).toContain("low-ocr-confidence");
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
