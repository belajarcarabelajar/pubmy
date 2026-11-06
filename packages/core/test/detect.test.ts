import { describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import { detect } from "../src/detect.ts";
import type { Format } from "../src/types.ts";
import { makeOdt } from "../../../fixtures/make-odt.ts";
import { makeRtf } from "../../../fixtures/make-rtf.ts";

const zip = (entries: Record<string, string>, mimetype?: string) =>
  zipSync({
    ...(mimetype ? { mimetype: [strToU8(mimetype), { level: 0 }] as [Uint8Array, { level: 0 }] } : {}),
    ...Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)])),
  });
const pad = (head: string, size = 128) => {
  const b = new Uint8Array(size);
  b.set(strToU8(head));
  return b;
};
const mobi = () => {
  const b = new Uint8Array(128);
  b.set(strToU8("BOOKMOBI"), 60);
  return b;
};

describe("detect: magic bytes for every v1 format", () => {
  const cases: [string, Uint8Array, string, Format][] = [
    ["epub", zip({ "OEBPS/content.opf": "<package/>" }, "application/epub+zip"), "book.zip", "epub"],
    ["odt", makeOdt(), "doc.bin", "odt"],
    ["docx", zip({ "[Content_Types].xml": "<Types/>", "word/document.xml": "<w:document/>" }), "doc.bin", "docx"],
    ["cbz", zip({ "001.jpg": "x", "002.png": "y", "sub/003.webp": "z" }), "comic.bin", "cbz"],
    ["cbz with ComicInfo.xml", zip({ "ComicInfo.xml": "<ComicInfo/>", "001.jpg": "x" }), "comic.bin", "cbz"],
    ["plain zip", zip({ "notes.txt": "x", "001.jpg": "y" }), "files.bin", "zip"],
    ["pdf", pad("%PDF-1.7\n"), "doc.bin", "pdf"],
    ["mobi", mobi(), "book.bin", "mobi"],
    ["rtf", makeRtf(), "doc.bin", "rtf"],
    ["rar", pad("Rar!\x1a\x07\x01\x00"), "comic.bin", "rar"],
  ];
  for (const [label, bytes, name, format] of cases) {
    test(`detects ${label} as ${format}`, () => {
      expect(detect(bytes, name).format).toBe(format);
    });
  }
});

describe("detect: extension and content fallbacks", () => {
  test("detects txt by extension", () => expect(detect(strToU8("hello"), "a.txt").format).toBe("txt"));
  test("detects markdown by extension", () => expect(detect(strToU8("# hi"), "a.md").format).toBe("markdown"));
  test("detects html by extension", () => expect(detect(strToU8("<p>x</p>"), "a.htm").format).toBe("html"));
  test("detects html by doctype", () => expect(detect(strToU8("<!DOCTYPE html><html></html>"), "a").format).toBe("html"));
  test("reports unknown bytes without a known extension", () =>
    expect(detect(new Uint8Array([1, 2, 3]), "a.xyz").format).toBe("unknown"));
  test("keeps a zip named .epub as epub", () =>
    expect(detect(zip({ "a.xhtml": "x" }), "book.epub").format).toBe("epub"));
  test("returns the lower-case extension", () => expect(detect(makeOdt(), "Doc.ODT").ext).toBe("odt"));
});
