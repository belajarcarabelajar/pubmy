import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { fetchFixtures } from "../../../fixtures/fetch.ts";
import { mobiAdapter } from "../src/adapters/mobi/index.ts";
import { convert, domFor, registerAdapter, type Book, type Ctx, type Result } from "../src/index.ts";

const FIXTURES = join(import.meta.dir, "../../../fixtures");
const DL = join(FIXTURES, "out/dl");

const ctx: Ctx = {
  dom: domFor("bun"),
  loadOcr: () => Promise.reject(new Error("no OCR")),
  progress: () => {},
  signal: new AbortController().signal,
};
const unregister = registerAdapter(mobiAdapter);
afterAll(() => unregister());

const bytesOf = (name: string) => new Uint8Array(readFileSync(join(DL, name)));
const read = (name: string): Promise<Book> => mobiAdapter.read({ name, bytes: bytesOf(name) }, ctx);

type Ok = Extract<Result, { ok: true }>;
function expectOk(r: Result): Ok {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
}

beforeAll(async () => {
  // Fetches only gutenberg.json, so a bad pin in another source file cannot fail this suite.
  // Later runs only re-hash the cached copies.
  const sources = mkdtempSync(join(tmpdir(), "pubmy-gutenberg-"));
  copyFileSync(join(FIXTURES, "sources/gutenberg.json"), join(sources, "gutenberg.json"));
  expect(await fetchFixtures(sources, DL)).toBe(0);
}, 120_000);

describe("mobi adapter: Gutenberg KF8 (AZW3)", () => {
  test("pg11 converts with 0 epubcheck errors", async () => {
    const r = expectOk(await convert({ name: "pg11-kf8.azw3", bytes: bytesOf("pg11-kf8.azw3") }, ctx));
    expect(r.check.errors).toBe(0);
  }, 60_000);

  test("pg28885 converts with 0 epubcheck errors", async () => {
    const r = expectOk(await convert({ name: "pg28885-kf8.azw3", bytes: bytesOf("pg28885-kf8.azw3") }, ctx));
    expect(r.check.errors).toBe(0);
  }, 60_000);

  test("pg11 keeps its 16 top-level TOC entries", async () => {
    expect((await read("pg11-kf8.azw3")).toc.length).toBe(16);
  }, 60_000);

  test("pg28885 keeps its 4 top-level TOC entries", async () => {
    expect((await read("pg28885-kf8.azw3")).toc.length).toBe(4);
  }, 60_000);

  test("repacks title, author and language from EXTH", async () => {
    const { meta } = await read("pg11-kf8.azw3");
    expect(meta.title).toContain("Alice");
    expect(meta.creators).toContain("Lewis Carroll");
    expect(meta.language).toBe("en");
  }, 60_000);

  test("repacks images as assets and points the cover at one of them", async () => {
    const book = await read("pg28885-kf8.azw3");
    const images = book.assets.filter((a) => a.mediaType.startsWith("image/"));
    expect(images.length).toBeGreaterThan(10);
    expect(images.map((a) => a.href)).toContain(book.meta.cover ?? "missing-cover");
  }, 60_000);

  test("repacks CSS as a text/css asset that chapters link to", async () => {
    const book = await read("pg11-kf8.azw3");
    const css = book.assets.find((a) => a.mediaType === "text/css");
    expect(css).toBeDefined();
    expect(book.chapters.some((c) => c.body.includes(`href="${css?.href}"`))).toBe(true);
  }, 60_000);

  test("keeps SVG wrapper pages as XHTML-embedded SVG whose image is an asset", async () => {
    const book = await read("pg28885-kf8.azw3");
    const svgPage = book.chapters.find((c) => c.body.includes("<svg"));
    expect(svgPage).toBeDefined();
    const ref = /<image\b[^>]*xlink:href="([^"]+)"/.exec(svgPage?.body ?? "")?.[1];
    expect(book.assets.map((a) => a.href)).toContain(ref ?? "missing-image-ref");
  }, 60_000);

  test("leaves no unresolved kindle: URL in any chapter", async () => {
    const book = await read("pg28885-kf8.azw3");
    expect(book.chapters.filter((c) => c.body.includes("kindle:")).map((c) => c.href)).toEqual([]);
  }, 60_000);

  test("writes the SVG pages into the EPUB", async () => {
    const r = expectOk(await convert({ name: "pg28885-kf8.azw3", bytes: bytesOf("pg28885-kf8.azw3") }, ctx));
    const pages = Object.entries(unzipSync(r.epub)).filter(([p]) => p.endsWith(".xhtml")).map(([, b]) => strFromU8(b));
    expect(pages.some((p) => p.includes("<svg"))).toBe(true);
  }, 60_000);
});

describe("mobi adapter: refusals", () => {
  test("a truncated file gives READ_FAILED", async () => {
    const bytes = bytesOf("pg11-kf8.azw3");
    const r = await convert({ name: "cut.azw3", bytes: bytes.subarray(0, bytes.length >> 1) }, ctx);
    expect(r).toMatchObject({ ok: false, code: "READ_FAILED" });
  });

  test("an .azw3 name over bytes that are not BOOKMOBI gives UNSUPPORTED", async () => {
    const r = await convert({ name: "fake.azw3", bytes: new Uint8Array(200).fill(0x41) }, ctx);
    expect(r).toMatchObject({ ok: false, code: "UNSUPPORTED" });
  });
});
