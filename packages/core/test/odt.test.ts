import { describe, expect, test } from "bun:test";
import { strFromU8, unzipSync } from "fflate";
import { convert, domFor, registerAdapter, type Ctx } from "../src/index.ts";
import { odtAdapter, readOdt } from "../src/adapters/odt.ts";
import { makeOdt, makeOdtWithEntries } from "../../../fixtures/make-odt.ts";
import { PNG_1X1 } from "../../../fixtures/make-rtf.ts";

const html = (body: string) => readOdt(makeOdt(body)).html;

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

describe("ODT reader", () => {
  test("maps text:h outline levels to heading levels", () => {
    expect(html('<text:h text:outline-level="1">A</text:h><text:h text:outline-level="3">C</text:h>')).toBe(
      "<h1>A</h1>\n<h3>C</h3>",
    );
  });

  test("defaults a text:h without outline level to h1", () => {
    expect(html("<text:h>A</text:h>")).toBe("<h1>A</h1>");
  });

  test("maps text:p to p and flattens spans", () => {
    expect(html('<text:p>a <text:span text:style-name="T1">b</text:span> c</text:p>')).toBe("<p>a b c</p>");
  });

  test("drops empty paragraphs", () => {
    expect(html("<text:p/><text:p> </text:p><text:p>x</text:p>")).toBe("<p>x</p>");
  });

  test("expands text:s, text:tab and text:line-break", () => {
    expect(html('<text:p>a<text:s text:c="2"/>b<text:tab/>c<text:line-break/>d</text:p>')).toBe(
      "<p>a  b\tc<br/>d</p>",
    );
  });

  test("caps a text:s count of one billion at 1,000 no-break spaces", () => {
    const start = performance.now();
    const out = html('<text:p>a<text:s text:c="1000000000"/>b</text:p>');
    const ms = performance.now() - start;
    expect(out).toBe(`<p>a${"\u00a0".repeat(1000)}b</p>`);
    // Capped, the paragraph costs under 10 ms; uncapped it builds a string of one billion characters, 17 s measured
    // on the test runner. The bound sits between the two with room for a loaded machine.
    expect(ms).toBeLessThan(1500);
  });

  test("keeps a text:s count of exactly 1,000", () => {
    expect(html('<text:p>a<text:s text:c="1000"/>b</text:p>')).toBe(`<p>a${"\u00a0".repeat(1000)}b</p>`);
  });

  test("decodes XML entities and re-escapes markup characters", () => {
    expect(html("<text:p>&lt;tag&gt; &amp; &#233;&#x20AC;</text:p>")).toBe("<p>&lt;tag&gt; &amp; é€</p>");
  });

  test("maps nested text:list to ul and li", () => {
    expect(
      html(
        "<text:list><text:list-item><text:p>A</text:p><text:list><text:list-item><text:p>B</text:p></text:list-item></text:list></text:list-item></text:list>",
      ),
    ).toBe("<ul><li><p>A</p><ul><li><p>B</p></li></ul></li></ul>");
  });

  test("maps table:table to table rows and cells", () => {
    expect(
      html(
        '<table:table><table:table-column/><table:table-row><table:table-cell table:number-columns-spanned="2"><text:p>A</text:p></table:table-cell><table:covered-table-cell/></table:table-row></table:table>',
      ),
    ).toBe('<table><tr><td colspan="2"><p>A</p></td></tr></table>');
  });

  test("turns draw:image into an asset and an img with the frame title as alt", () => {
    const r = readOdt(makeOdt());
    expect(r.assets).toHaveLength(1);
    expect(r.assets[0].mediaType).toBe("image/png");
    expect(r.assets[0].data).toEqual(PNG_1X1);
    expect(r.html).toContain(`<p><img src="${r.assets[0].href}" alt="A dot"/></p>`);
  });

  test("ignores styles outside the body", () => {
    expect(html("<text:p>x</text:p>")).not.toContain("P1");
  });

  test("renders a footnote citation inline and its body after the text", () => {
    const out = readOdt(makeOdt()).html;
    expect(out).toContain("<p>Noted<sup>1</sup>.</p>");
    expect(out.indexOf("Footnote body.")).toBeGreaterThan(out.indexOf("Noted"));
  });

  test("reads the title from meta.xml", () => {
    expect(readOdt(makeOdt("<text:p>x</text:p>", "My &amp; Book")).title).toBe("My & Book");
  });

  test("reads the generated fixture end to end", () => {
    const out = readOdt(makeOdt()).html;
    expect(out).toContain("<h1>Chapter One</h1>");
    expect(out).toContain("<h2>Section Two A</h2>");
    expect(out).toContain("<p>Plain styled text &amp; more  spaced.<br/>Next line.</p>");
    expect(out).toContain("<li><p>Nested item</p></li>");
    expect(out).toContain("<td><p>Cell B</p></td>");
  });

  test("throws when content.xml is missing", () => {
    expect(() => readOdt(new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]))).toThrow(/content\.xml/);
  });
});

describe("odt adapter through convert()", () => {
  const ctx: Ctx = {
    dom: domFor("bun"),
    loadOcr: () => Promise.reject(new Error("no OCR")),
    progress: () => {},
    signal: new AbortController().signal,
  };
  const run = async () => {
    const off = registerAdapter(odtAdapter);
    try {
      return await convert({ name: "sample.odt", bytes: makeOdt() }, ctx);
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
    expect(f["OEBPS/images/odt-1-dot.png"]).toEqual(PNG_1X1);
    expect(strFromU8(f["OEBPS/ch002.xhtml"])).toContain('src="images/odt-1-dot.png"');
  });

  test("an ODT with 6,000 entries fails as READ_FAILED archive-too-large", async () => {
    const extra = Array.from({ length: 6000 }, (_, i): [string, Uint8Array] => [`junk/${i}.txt`, new Uint8Array()]);
    const off = registerAdapter(odtAdapter);
    try {
      const r = await convert({ name: "bomb.odt", bytes: makeOdtWithEntries(extra) }, ctx);
      expect(r).toEqual({ ok: false, code: "READ_FAILED", message: "archive-too-large" });
    } finally {
      off();
    }
  });
});

describe("ODT reader archive safety", () => {
  test("refuses an entry that inflates past its declared size as READ_FAILED archive-too-large", () => {
    const honest = makeOdtWithEntries([["junk/big.bin", new Uint8Array(200_000).fill(0x61)]]);
    expect(readOdt(honest).html).toContain("<h1>Chapter One</h1>");
    let thrown: unknown;
    try {
      readOdt(declareSize(honest, "junk/big.bin", 1024));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toMatchObject({ code: "READ_FAILED", message: "archive-too-large" });
  });

  test("ignores an entry whose path climbs out with `..`", () => {
    const body = '<text:p><draw:frame><draw:image xlink:href="../evil.png"/></draw:frame>Text</text:p>';
    const doc = readOdt(makeOdtWithEntries([["../evil.png", PNG_1X1]], body));
    expect(doc.assets).toEqual([]);
    expect(doc.html).toBe("<p>Text</p>");
  });
});
