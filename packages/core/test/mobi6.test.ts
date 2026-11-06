import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { fetchFixtures } from "../../../fixtures/fetch.ts";
import { domFor } from "../src/dom.ts";
import { mobiAdapter } from "../src/adapters/mobi/index.ts";
import { isCombo, mobi6HtmlToXhtml, preferKf8, withoutKf8Boundary } from "../src/adapters/mobi/mobi6.ts";
import { convert, registerAdapter, type Ctx, type Result } from "../src/index.ts";
import type { Book } from "../src/types.ts";

const ctx = { dom: domFor("bun") };
const x = (markup: string, links?: Parameters<typeof mobi6HtmlToXhtml>[2]) => mobi6HtmlToXhtml(markup, ctx, links);

describe("MOBI6 markup transforms", () => {
  test("a body-less section keeps every top-level node", () => {
    expect(x("<p>one</p><p>two</p>")).toBe("<p>one</p><p>two</p>");
  });

  test("tt becomes code", () => {
    expect(x("<p><tt>mono</tt></p>")).toBe("<p><code>mono</code></p>");
  });

  test("align becomes text-align", () => {
    expect(x(`<p align="center">Title</p>`)).toBe(`<p style="text-align: center">Title</p>`);
  });

  test("center becomes a centered div", () => {
    expect(x("<center>mid</center>")).toBe(`<div style="text-align: center">mid</div>`);
  });

  test("image width and height become CSS sizes", () => {
    const out = x(`<img src="a.jpg" width="50" height="20%"/>`, { image: (s) => s });
    expect(out).toBe(`<img src="a.jpg" alt="" style="width: 50px; height: 20%"/>`);
  });

  test("paragraph width becomes a first-line indent", () => {
    expect(x(`<p width="2em">x</p>`)).toBe(`<p style="text-indent: 2em">x</p>`);
  });

  test("relative font size becomes a span in em", () => {
    expect(x(`<font size="+2">big</font>`)).toBe(`<span style="font-size: 1.5em">big</span>`);
  });

  test("absolute font size becomes a span in em", () => {
    expect(x(`<font size="2">small</font>`)).toBe(`<span style="font-size: 0.8125em">small</span>`);
  });

  test("filepos link is rewritten to the resolved anchor", () => {
    const out = x(`<a filepos="0000012345">go</a>`, { filepos: (fp) => `ch0002.xhtml#filepos${fp}` });
    expect(out).toBe(`<a href="ch0002.xhtml#filepos0000012345">go</a>`);
  });

  test("unresolved filepos link loses its href", () => {
    expect(x(`<a filepos="99">go</a>`, { filepos: () => null })).toBe("<a>go</a>");
  });

  test("image by recindex takes the resolved asset path", () => {
    const out = x(`<img recindex="00003"/>`, { image: (rec) => (rec === "00003" ? "images/img0003.jpg" : null) });
    expect(out).toBe(`<img src="images/img0003.jpg" alt=""/>`);
  });

  test("unknown presentational attributes are dropped", () => {
    expect(x(`<p bgcolor="red" id="a1">t</p>`)).toBe(`<p id="a1">t</p>`);
  });
});

describe("filepos anchors inside table structure (RSC-005)", () => {
  const cases: Record<string, string> = {
    "directly in table": `<table><a id="filepos123"></a><tr><td>x</td></tr></table>`,
    "in tbody": `<table><tbody><a id="filepos123"></a><tr><td>x</td></tr></tbody></table>`,
    "in tr": `<table><tr><a id="filepos123"></a><td>x</td></tr></table>`,
    "after the last row": `<table><tr><td>x</td></tr><a id="filepos123"></a></table>`,
  };
  for (const [where, markup] of Object.entries(cases)) {
    test(`an anchor ${where} moves out of the table structure and keeps its id`, () => {
      const doc = ctx.dom.parseHTML(`<div>${x(markup)}</div><p><a href="#filepos123">back</a></p>`);
      expect(doc.querySelectorAll("table > a, thead > a, tbody > a, tfoot > a, tr > a").length).toBe(0);
      const href = doc.querySelector("a[href]")?.getAttribute("href") ?? "";
      expect(doc.getElementById(href.slice(1))?.localName).toBe("a");
      expect(doc.querySelector("td")?.textContent).toBe("x");
    });
  }
});

const book = (title: string): Book => ({
  meta: { title, creators: [], language: "en" },
  chapters: [],
  assets: [],
  toc: [],
  layout: "reflow",
  direction: "ltr",
});

describe("combo files prefer the KF8 part", () => {
  test("a working KF8 part wins without a warning", async () => {
    let mobi6Calls = 0;
    const r = await preferKf8(async () => book("kf8"), async () => (mobi6Calls++, book("mobi6")));
    expect([r.book.meta.title, r.warnings.length, mobi6Calls]).toEqual(["kf8", 0, 0]);
  });

  test("a failing KF8 part falls back to MOBI6 with a warning", async () => {
    const r = await preferKf8(async () => { throw new Error("bad skeleton"); }, async () => book("mobi6"));
    expect(r.book.meta.title).toBe("mobi6");
    expect(r.warnings).toEqual([expect.stringContaining("bad skeleton")]);
  });

  test("a file without a KF8 part reads MOBI6 without a warning", async () => {
    const r = await preferKf8(null, async () => book("mobi6"));
    expect([r.book.meta.title, r.warnings]).toEqual(["mobi6", []]);
  });
});

// Minimal record 0: PDB header, MOBI header with the EXTH flag, one EXTH 121 record.
function withExth121(value: number): Uint8Array {
  const rec0 = 96;
  const headerLen = 232;
  const b = new Uint8Array(rec0 + 16 + headerLen + 24);
  const v = new DataView(b.buffer);
  v.setUint32(78, rec0);
  v.setUint32(rec0 + 20, headerLen);
  v.setUint32(rec0 + 128, 0x40);
  const exth = rec0 + 16 + headerLen;
  b.set([0x45, 0x58, 0x54, 0x48], exth);
  v.setUint32(exth + 4, 24);
  v.setUint32(exth + 8, 1);
  v.setUint32(exth + 12, 121);
  v.setUint32(exth + 16, 12);
  v.setUint32(exth + 20, value);
  return b;
}

describe("combo file detection", () => {
  test("EXTH 121 naming a record marks a combo file", () => {
    expect(isCombo(withExth121(5))).toBe(true);
  });

  test("EXTH 121 of 0xffffffff is not a combo file", () => {
    expect(isCombo(withExth121(0xffffffff))).toBe(false);
  });

  test("hiding the boundary leaves the original bytes untouched", () => {
    const bytes = withExth121(5);
    expect([isCombo(withoutKf8Boundary(bytes)), isCombo(bytes)]).toEqual([false, true]);
  });
});

const FIXTURES = join(import.meta.dir, "../../../fixtures");
const DL = join(FIXTURES, "out/dl");
const fullCtx: Ctx = {
  dom: domFor("bun"),
  loadOcr: () => Promise.reject(new Error("no OCR")),
  progress: () => {},
  signal: new AbortController().signal,
};
const bytesOf = (name: string) => new Uint8Array(readFileSync(join(DL, name)));
const read = (name: string): Promise<Book> => mobiAdapter.read({ name, bytes: bytesOf(name) }, fullCtx);
type Ok = Extract<Result, { ok: true }>;
function expectOk(r: Result): Ok {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
}
// Visible characters only, so markup and whitespace differences between the two paths do not count.
const textLength = (b: Book) =>
  b.chapters
    .map((c) => c.body.replace(/<[^>]*>/g, "").replace(/&#?\w+;/g, "x").replace(/\s+/g, ""))
    .join("").length;

describe("mobi adapter: Gutenberg MOBI6", () => {
  let unregister = () => {};
  beforeAll(async () => {
    unregister = registerAdapter(mobiAdapter);
    const sources = mkdtempSync(join(tmpdir(), "pubmy-gutenberg-"));
    copyFileSync(join(FIXTURES, "sources/gutenberg.json"), join(sources, "gutenberg.json"));
    expect(await fetchFixtures(sources, DL)).toBe(0);
  }, 120_000);
  afterAll(() => unregister());

  for (const id of ["pg11", "pg28885"]) {
    test(`${id} converts with 0 epubcheck errors`, async () => {
      const r = expectOk(await convert({ name: `${id}-kindle.mobi`, bytes: bytesOf(`${id}-kindle.mobi`) }, fullCtx));
      expect(r.check.errors).toBe(0);
    }, 120_000);

    test(`${id} text length is within 1 % of the AZW3 of the same book`, async () => {
      const mobi6 = textLength(await read(`${id}-kindle.mobi`));
      const kf8 = textLength(await read(`${id}-kf8.azw3`));
      expect(Math.abs(mobi6 - kf8) / kf8).toBeLessThanOrEqual(0.01);
    }, 120_000);
  }

  // Java EPUBCheck 5.4.0 reported 17 RSC-005 here that epubcheck-ts missed.
  test("pg28885 has no anchor directly inside table structure", async () => {
    const book = await read("pg28885-kindle.mobi");
    const misplaced = book.chapters.reduce(
      (n, c) => n + fullCtx.dom.parseHTML(`<div>${c.body}</div>`).querySelectorAll("table > a, thead > a, tbody > a, tfoot > a, tr > a").length,
      0,
    );
    expect(misplaced).toBe(0);
  }, 120_000);

  test("a centered paragraph keeps text-align: center in the EPUB", async () => {
    const r = expectOk(await convert({ name: "pg11-kindle.mobi", bytes: bytesOf("pg11-kindle.mobi") }, fullCtx));
    const xhtml = Object.entries(unzipSync(r.epub))
      .filter(([p]) => p.endsWith(".xhtml") && !p.endsWith("nav.xhtml"))
      .map(([, b]) => strFromU8(b))
      .join("\n");
    expect(xhtml).toMatch(/<(p|div)\b[^>]*style="[^"]*text-align: center/);
  }, 120_000);
});
