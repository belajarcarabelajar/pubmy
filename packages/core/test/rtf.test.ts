import { describe, expect, test } from "bun:test";
import { strFromU8, unzipSync } from "fflate";
import { convert, domFor, registerAdapter, type Ctx } from "../src/index.ts";
import { readRtf, rtfAdapter } from "../src/adapters/rtf.ts";
import { PNG_1X1, makeRtf } from "../../../fixtures/make-rtf.ts";

const rtf = (body: string) => readRtf(new TextEncoder().encode(`{\\rtf1\\ansi ${body}}`));
const html = (body: string) => rtf(body).html;

describe("RTF reader", () => {
  test("splits paragraphs at \\par", () => {
    expect(html(String.raw`One\par Two\par`)).toBe("<p>One</p>\n<p>Two</p>");
  });

  test("wraps \\b runs in <b>", () => {
    expect(html(String.raw`a \b bold\b0  c\par`)).toBe("<p>a <b>bold</b> c</p>");
  });

  test("wraps \\i runs in <i>", () => {
    expect(html(String.raw`{\i it} x\par`)).toBe("<p><i>it</i> x</p>");
  });

  test("decodes \\u escapes and skips the fallback character", () => {
    expect(html(String.raw`荤?uro\par`)).toBe("<p>€uro</p>");
  });

  test("honours \\uc0 by skipping no fallback", () => {
    expect(html(String.raw`\uc0\u233 x\par`)).toBe("<p>éx</p>");
  });

  test("decodes \\'hh bytes as cp1252", () => {
    expect(html(String.raw`caf\'e9 \'80\par`)).toBe("<p>café €</p>");
  });

  test("escapes markup characters", () => {
    expect(html(String.raw`a < b & c\par`)).toBe("<p>a &lt; b &amp; c</p>");
  });

  test("skips unknown ignorable destinations and the font table", () => {
    expect(html(String.raw`{\fonttbl{\f0 Times;}}{\*\unknownthing junk}Kept\par`)).toBe("<p>Kept</p>");
  });

  test("keeps text inside unknown non-destination groups", () => {
    expect(html(String.raw`{\madeupword inner} text\par`)).toBe("<p>inner text</p>");
  });

  test("maps \\outlinelevel to heading levels", () => {
    expect(html(String.raw`\pard\outlinelevel1 Sub\par`)).toBe("<h2>Sub</h2>");
  });

  test("resets the heading level at \\pard", () => {
    expect(html(String.raw`\pard\outlinelevel0 H\par\pard Body\par`)).toBe("<h1>H</h1>\n<p>Body</p>");
  });

  test("groups \\ls paragraphs into a list without the listtext bullet", () => {
    expect(html(String.raw`\pard{\listtext\'95\tab}\ls1 A\par\pard{\listtext\'95\tab}\ls1 B\par\pard C\par`)).toBe(
      "<ul><li>A</li>\n<li>B</li></ul>\n<p>C</p>",
    );
  });

  test("renders table cells as paragraphs", () => {
    expect(html(String.raw`\trowd\cellx1000\cellx2000\pard\intbl A\cell B\cell\row`)).toBe("<p>A</p>\n<p>B</p>");
  });

  test("extracts a \\pngblip picture as an asset and an img tag", () => {
    const hex = Array.from(PNG_1X1, (b) => b.toString(16).padStart(2, "0")).join("");
    const r = rtf(String.raw`{\*\shppict{\pict\pngblip\picw1\pich1 ` + hex + String.raw`}}{\nonshppict{\pict\wmetafile8 00}}\par`);
    expect(r.assets).toHaveLength(1);
    expect(r.assets[0].mediaType).toBe("image/png");
    expect(r.assets[0].data).toEqual(PNG_1X1);
    expect(r.html).toBe(`<p><img src="${r.assets[0].href}" alt=""/></p>`);
  });

  test("reads the title from the info group", () => {
    expect(rtf(String.raw`{\info{\title My Book}}x\par`).title).toBe("My Book");
  });

  test("reads the generated fixture end to end", () => {
    const r = readRtf(makeRtf());
    expect(r.title).toBe("Fixture RTF");
    expect(r.html).toContain("<h1><b>Chapter One</b></h1>");
    expect(r.html).toContain("<h2>Section Two A</h2>");
    expect(r.html).toContain("<li>First item</li>");
    expect(r.html).toContain("café and €uro.");
    expect(r.html).toContain("<p>Cell B</p>");
    expect(r.assets).toHaveLength(1);
  });
});

describe("rtf adapter through convert()", () => {
  const ctx: Ctx = {
    dom: domFor("bun"),
    loadOcr: () => Promise.reject(new Error("no OCR")),
    progress: () => {},
    signal: new AbortController().signal,
  };
  const run = async () => {
    const off = registerAdapter(rtfAdapter);
    try {
      return await convert({ name: "sample.rtf", bytes: makeRtf() }, ctx);
    } finally {
      off();
    }
  };

  test("converts the fixture to an EPUB with 0 epubcheck errors", async () => {
    const r = await run();
    if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
    expect(r.check.errors).toBe(0);
  });

  test("makes one chapter per h1 and lists them in the nav", async () => {
    const r = await run();
    if (!r.ok) throw new Error(r.code);
    const f = unzipSync(r.epub);
    const nav = strFromU8(f["OEBPS/nav.xhtml"]);
    expect(nav).toContain(">Chapter One</a>");
    expect(nav).toContain(">Chapter Two</a>");
    expect((strFromU8(f["OEBPS/content.opf"]).match(/<itemref /g) ?? []).length).toBe(2);
  });

  test("packs the image next to the chapter that references it", async () => {
    const r = await run();
    if (!r.ok) throw new Error(r.code);
    const f = unzipSync(r.epub);
    expect(f["OEBPS/images/rtf-1.png"]).toEqual(PNG_1X1);
    expect(strFromU8(f["OEBPS/ch002.xhtml"])).toContain('src="images/rtf-1.png"');
  });
});
