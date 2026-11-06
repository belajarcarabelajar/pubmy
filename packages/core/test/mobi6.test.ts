import { describe, expect, test } from "bun:test";
import { domFor } from "../src/dom.ts";
import { mobi6HtmlToXhtml, preferKf8 } from "../src/adapters/mobi/mobi6.ts";
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
