import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchFixtures } from "../../../fixtures/fetch.ts";
import { mobiAdapter } from "../src/adapters/mobi/index.ts";
import * as dom from "../src/dom.ts";
import { convert, domFor, registerAdapter, type Ctx, type Result } from "../src/index.ts";

const FIXTURES = join(import.meta.dir, "../../../fixtures");
const DL = join(FIXTURES, "out/dl");
const KEYS = ["document", "DOMParser", "XMLSerializer"] as const;
const g = globalThis as Record<string, unknown>;

const ctx: Ctx = {
  dom: domFor("bun"),
  loadOcr: () => Promise.reject(new Error("no OCR")),
  progress: () => {},
  signal: new AbortController().signal,
};
const bytesOf = (name: string) => new Uint8Array(readFileSync(join(DL, name)));
const absent = (): Record<string, string> => Object.fromEntries(KEYS.map((k) => [k, typeof g[k]]));
const NONE = { document: "undefined", DOMParser: "undefined", XMLSerializer: "undefined" };

function expectOk(r: Result): void {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
}

const unregister = registerAdapter(mobiAdapter);
afterAll(() => unregister());

beforeAll(async () => {
  const sources = mkdtempSync(join(tmpdir(), "pubmy-gutenberg-"));
  copyFileSync(join(FIXTURES, "sources/gutenberg.json"), join(sources, "gutenberg.json"));
  expect(await fetchFixtures(sources, DL)).toBe(0);
}, 120_000);

describe("DOM globals under Bun", () => {
  test("a Gutenberg AZW3 conversion leaves no DOM globals behind", async () => {
    expect(absent()).toEqual(NONE);
    expectOk(await convert({ name: "pg11-kf8.azw3", bytes: bytesOf("pg11-kf8.azw3") }, ctx));
    expect(absent()).toEqual(NONE);
  }, 120_000);

  test("a Gutenberg MOBI6 conversion leaves no DOM globals behind", async () => {
    expect(absent()).toEqual(NONE);
    expectOk(await convert({ name: "pg11-kindle.mobi", bytes: bytesOf("pg11-kindle.mobi") }, ctx));
    expect(absent()).toEqual(NONE);
  }, 120_000);

  test("an error thrown inside the scope still removes the globals", async () => {
    let inside = "";
    const run = dom.withDomGlobals(async () => {
      inside = typeof g.document;
      throw new Error("boom");
    });
    await expect(run).rejects.toThrow("boom");
    expect(inside).toBe("object");
    expect(absent()).toEqual(NONE);
  });

  test("overlapping scopes keep the globals until the last one ends", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const long = dom.withDomGlobals(async () => {
      await gate;
      return typeof g.document;
    });
    await dom.withDomGlobals(async () => {});
    expect(typeof g.document).toBe("object");
    release();
    expect(await long).toBe("object");
    expect(absent()).toEqual(NONE);
  });

  test("pre-existing globals are used inside the scope and kept afterwards", async () => {
    const doc = { createElement: () => ({ innerText: "", value: "&" }) };
    class Parser {}
    g.document = doc;
    g.DOMParser = Parser;
    try {
      const seen = await dom.withDomGlobals(async () => [g.document, g.DOMParser]);
      expect(seen[0]).toBe(doc);
      expect(seen[1]).toBe(Parser);
      expect(g.document).toBe(doc);
      expect(g.DOMParser).toBe(Parser);
      expect(typeof g.XMLSerializer).toBe("undefined");
    } finally {
      delete g.document;
      delete g.DOMParser;
    }
  });
});
