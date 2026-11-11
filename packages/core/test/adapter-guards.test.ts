import { describe, expect, test } from "bun:test";
import { strFromU8, zipSync } from "fflate";
import { makeCbz, makePng } from "../../../fixtures/make-cbz.ts";
import { makeDocx } from "../../../fixtures/make-docx.ts";
import { builtinAdapters } from "../src/adapters/builtin.ts";
import { docxAdapter } from "../src/adapters/docx.ts";
import { nodeToXhtml } from "../src/adapters/mobi/kf8.ts";
import { detect } from "../src/detect.ts";
import { convert, createComicsAdapter, domFor, PubmyError, type Ctx, type Sniff } from "../src/index.ts";

const ctx: Ctx = {
  dom: domFor("bun"),
  loadOcr: () => Promise.reject(new Error("no OCR")),
  progress: () => {},
  signal: new AbortController().signal,
};

/** Rewrites the uncompressed-size field of the central directory record named `name` (zipSync writes no comment, so the EOCD is the last 22 bytes). */
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

async function failureOf(p: Promise<unknown>): Promise<{ code: string; message: string } | "no failure"> {
  try {
    await p;
  } catch (e) {
    return e instanceof PubmyError ? { code: e.code, message: e.message } : { code: "not-a-PubmyError", message: String(e) };
  }
  return "no failure";
}

describe("comics adapter: a CBZ whose entry inflates past its declared size", () => {
  const page = makePng(60, 90, [200, 0, 0]);
  const honest = zipSync({ "p1.png": page, "notes.bin": [new Uint8Array(200_000).fill(0x61), { level: 1 }] });

  test("is refused as READ_FAILED archive-too-large", async () => {
    const lying = declareSize(honest, "notes.bin", 1024);
    expect(await failureOf(createComicsAdapter().read({ name: "x.cbz", bytes: lying }, ctx))).toEqual({
      code: "READ_FAILED",
      message: "archive-too-large",
    });
  });

  test("the same archive with honest sizes still becomes a one-page book", async () => {
    const book = await createComicsAdapter().read({ name: "x.cbz", bytes: honest }, ctx);
    expect(book.assets.map((a) => a.data)).toEqual([page]);
  });

  test("the stored fixture comic still converts with its three pages", async () => {
    const book = await createComicsAdapter().read({ name: "Fixture Comic.cbz", bytes: makeCbz() }, ctx);
    expect(book.chapters).toHaveLength(3);
  });
});

describe("docx adapter: a DOCX named without its extension", () => {
  const sniff: Sniff = { format: "docx", ext: "" };

  test("detect() reports the format docx for the bytes of a file named laporan", () => {
    expect(detect(makeDocx(), "laporan")).toEqual(sniff);
  });

  test("is accepted by the docx adapter and by its lazy stand-in", () => {
    expect(docxAdapter.accepts(sniff)).toBe(true);
    expect(builtinAdapters.find((a) => a.accepts(sniff))?.id).toBe("docx");
  });

  test("converts to an EPUB through convert()", async () => {
    const r = await convert({ name: "laporan", bytes: makeDocx() }, ctx);
    expect(r.ok, r.ok ? "" : `${r.code}: ${r.message}`).toBe(true);
  });

  test("a .docx name with a format other than docx is still accepted, so an encrypted file gets its own message", () => {
    expect(docxAdapter.accepts({ format: "unknown", ext: "docx" })).toBe(true);
    expect(docxAdapter.accepts({ format: "zip", ext: "zip" })).toBe(false);
  });
});

describe("KF8 serialiser: only local book resources and web links leave nodeToXhtml", () => {
  const dom = (markup: string) => ctx.dom.parseHTML(`<!DOCTYPE html><html><body>${markup}</body></html>`);
  const xhtml = (markup: string) => Array.from(dom(markup).body.childNodes).map((n) => nodeToXhtml(n)).join("");

  test("an iframe, object, embed, form and input are dropped", () => {
    const out = xhtml(
      '<p>a</p><iframe src="javascript:alert(1)">f</iframe><object data="x.swf">o</object><embed src="x.swf"/>' +
        '<form action="https://evil.example/post"><input name="q" value="v"/></form><p>b</p>',
    );
    expect(out).toBe("<p>a</p><p>b</p>");
  });

  test("an img whose src is a remote, data, javascript, file or path URL is dropped", () => {
    for (const src of ["https://evil.example/t.gif", "//evil.example/t.gif", "data:image/gif;base64,R0lGOD", "javascript:alert(1)",
      "file:///etc/passwd", "../res0001.jpg", "res0001.jpg?x=1", "xres0001.jpg"]) {
      expect(xhtml(`<p>a<img src="${src}" alt="t"/>b</p>`)).toBe("<p>ab</p>");
    }
  });

  test("an img whose src is a book resource keeps it", () => {
    expect(xhtml('<p><img src="res0001.jpg" alt="t"/><img src="res12345.png"/></p>')).toBe(
      '<p><img src="res0001.jpg" alt="t"/><img src="res12345.png" alt=""/></p>',
    );
  });

  test("a link to a chapter file and a web link keep their href", () => {
    expect(xhtml('<a href="s0001.xhtml#x">in</a><a href="https://example.com/">out</a><a href="javascript:alert(1)">bad</a>')).toBe(
      '<a href="s0001.xhtml#x">in</a><a href="https://example.com/">out</a><a>bad</a>',
    );
  });

  test("inline SVG loses javascript:, data: and remote image targets on href and xlink:href", () => {
    const out = xhtml(
      '<svg viewBox="0 0 1 1"><a xlink:href="javascript:alert(1)"><text>t</text></a><a href="data:text/html,x"><text>u</text></a>' +
        '<image xlink:href="https://evil.example/t.gif"/><image href="//evil.example/t.gif"/><use href="other.svg#a"/></svg>',
    );
    expect(out).not.toMatch(/javascript:|data:|evil\.example|other\.svg/);
    expect(out).toContain("<text>t</text>");
    expect(out).toContain("<text>u</text>");
  });

  test("inline SVG keeps a book resource, a fragment, a chapter link and a web link", () => {
    const out = xhtml(
      '<svg viewBox="0 0 1 1"><image xlink:href="res0001.jpg" width="1" height="1"/><use href="#a"/>' +
        '<a xlink:href="s0002.xhtml#n"><text>in</text></a><a href="https://example.com/"><text>out</text></a></svg>',
    );
    expect(out).toContain('<image xlink:href="res0001.jpg" width="1" height="1">');
    expect(out).toContain('<use href="#a">');
    expect(out).toContain('<a xlink:href="s0002.xhtml#n">');
    expect(out).toContain('<a href="https://example.com/">');
    expect(out).toContain('viewBox="0 0 1 1"');
  });

  test("an SVG flow swapped in for its img is filtered the same way", () => {
    const doc = dom('<p><img src="kindle:flow:0001?mime=image/svg+xml"/></p>');
    const svg = dom(
      '<svg><image xlink:href="res0003.png"/><image xlink:href="https://evil.example/t.gif"/><a xlink:href="javascript:alert(1)"><text>t</text></a></svg>',
    ).querySelector("svg")!;
    const img = doc.querySelector("img")!;
    const out = nodeToXhtml(doc.body.firstChild!, new Map<Node, Node>([[img, svg]]));
    expect(out).toContain('<image xlink:href="res0003.png">');
    expect(out).not.toMatch(/javascript:|evil\.example/);
    expect(out).toContain("<text>t</text>");
  });
});
