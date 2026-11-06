import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { fetchFixtures } from "../../../fixtures/fetch.ts";
import { convert, domFor, pack, registerAdapter, validate, type Book, type Ctx } from "../src/index.ts";

// A known-good 1x1 PNG.
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="),
  (c) => c.charCodeAt(0),
);

function book(over: Partial<Book> = {}): Book {
  return {
    meta: { title: "Test Book", creators: ["Iwan"], language: "id", identifier: "urn:uuid:00000000-0000-4000-8000-000000000001" },
    chapters: [{ href: "ch001.xhtml", title: "Bab Satu", body: "<h1>Bab Satu</h1><p>Isi.</p>" }],
    assets: [],
    toc: [],
    layout: "reflow",
    direction: "ltr",
    ...over,
  };
}

const ctx: Ctx = {
  dom: domFor("bun"),
  loadOcr: () => Promise.reject(new Error("no OCR")),
  progress: () => {},
  signal: new AbortController().signal,
};

describe("packager", () => {
  test("writes mimetype as the first zip entry, stored uncompressed", () => {
    const epub = pack(book());
    const name = strFromU8(epub.subarray(30, 38));
    const method = epub[8] | (epub[9] << 8);
    expect(name).toBe("mimetype");
    expect(method).toBe(0);
    expect(strFromU8(epub.subarray(38, 58))).toBe("application/epub+zip");
  });

  test("ships both nav.xhtml and toc.ncx", () => {
    const f = unzipSync(pack(book()));
    expect(f["OEBPS/nav.xhtml"]).toBeDefined();
    expect(f["OEBPS/toc.ncx"]).toBeDefined();
  });

  test("a well-formed Book validates with 0 errors", async () => {
    const res = await validate(pack(book()));
    expect(res.errors).toBe(0);
  });

  test("control: corrupting the OPF makes validate report errors", async () => {
    const f = unzipSync(pack(book()));
    const opf = strFromU8(f["OEBPS/content.opf"]).replace(/<spine[\s\S]*<\/spine>/, "").replace("<dc:title>", "<dc:titel>");
    const broken = zipSync({
      mimetype: [strToU8("application/epub+zip"), { level: 0 }],
      ...Object.fromEntries(Object.entries(f).filter(([p]) => p !== "mimetype")),
      "OEBPS/content.opf": strToU8(opf),
    });
    const res = await validate(broken);
    expect(res.errors).toBeGreaterThan(0);
  });

  describe("Kindle fixes on a crafted chapter", () => {
    const crafted =
      '<h1>Bab</h1><p onclick="steal()" class="x">a\u0001b\u001fc\td</p>' +
      "<!-- note -- with -- dashes --><script>alert(1)</script>" +
      '<p>line<br>next<img src="pic.png" alt="dot"></p>';
    const chapter = () => {
      const f = unzipSync(pack(book({
        chapters: [{ href: "ch001.xhtml", title: "Bab", body: crafted }],
        assets: [{ href: "pic.png", mediaType: "image/png", data: PNG }],
      })));
      return strFromU8(f["OEBPS/ch001.xhtml"]);
    };

    test("strips C0 control characters but keeps tab", () => {
      const x = chapter();
      expect(x).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/);
      expect(x).toContain("abc\td");
    });

    test("rewrites -- inside comments", () => {
      const comments = chapter().match(/<!--([\s\S]*?)-->/g) ?? [];
      expect(comments.length).toBe(1);
      for (const c of comments) expect(c.slice(4, -3)).not.toContain("--");
    });

    test("self-closes void tags", () => {
      const x = chapter();
      expect(x).toContain("<br/>");
      expect(x).toMatch(/<img [^>]*\/>/);
    });

    test("drops script elements", () => {
      expect(chapter()).not.toContain("<script");
    });

    test("drops on* attributes", () => {
      const x = chapter();
      expect(x).not.toContain("onclick");
      expect(x).toContain('class="x"');
    });

    test("the fixed chapter validates with 0 errors", async () => {
      const epub = pack(book({
        chapters: [{ href: "ch001.xhtml", title: "Bab", body: crafted }],
        assets: [{ href: "pic.png", mediaType: "image/png", data: PNG }],
      }));
      expect((await validate(epub)).errors).toBe(0);
    });
  });

  test("convert refuses a Book with a missing image as INVALID_EPUB without bytes", async () => {
    registerAdapter({
      id: "test-broken-image",
      accepts: (s) => s.ext === "pubmy-broken-test",
      read: async () => book({ chapters: [{ href: "ch001.xhtml", title: "Bab", body: '<p><img src="missing.png" alt=""/></p>' }] }),
    });
    const r = await convert({ name: "x.pubmy-broken-test", bytes: new Uint8Array([1, 2, 3]) }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INVALID_EPUB");
    expect("epub" in r).toBe(false);
  });
});

describe("fixtures/fetch", () => {
  test("an empty sources folder exits 0", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pubmy-fetch-"));
    try {
      expect(await fetchFixtures(join(dir, "sources"), join(dir, "dl"))).toBe(0);
      expect(await fetchFixtures(dir, join(dir, "dl"))).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
