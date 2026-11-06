import { describe, expect, test } from "bun:test";
import { pack, type Book } from "@pubmy/core/browser";
import { createEpubLoader } from "../src/epub-loader.ts";

const book: Book = {
  meta: { title: "Preview fixture", creators: ["pubmy"], language: "en", modified: "2026-11-07T00:00:00Z" },
  chapters: [
    { href: "ch001.xhtml", title: "Alpha chapter", body: "<h1>Alpha chapter</h1><p>The first chapter text.</p>" },
    { href: "ch002.xhtml", title: "Beta chapter", body: "<h1>Beta chapter</h1><p>The second chapter text.</p>" },
  ],
  assets: [],
  toc: [],
  layout: "reflow",
  direction: "ltr",
};
const epub = pack(book);

// foliate asks for every file by its path inside the container, resolved against the package document.
describe("createEpubLoader", () => {
  test("every spine document the package names loads through it", () => {
    const loader = createEpubLoader(epub);
    const opf = loader.loadText("OEBPS/content.opf") ?? "";
    const spine = [...opf.matchAll(/<itemref idref="([^"]+)"/g)].map(([, id]) => new RegExp(`<item id="${id}" href="([^"]+)"`).exec(opf)?.[1]);
    expect(spine).toEqual(["ch001.xhtml", "ch002.xhtml"]);
    for (const href of spine) expect(loader.loadText(`OEBPS/${href}`)).toContain("<body");
  });

  test("the table of contents loads through it and lists both chapters", () => {
    const nav = createEpubLoader(epub).loadText("OEBPS/nav.xhtml") ?? "";
    for (const part of ['href="ch001.xhtml"', "Alpha chapter", 'href="ch002.xhtml"', "Beta chapter"]) expect(nav).toContain(part);
  });

  test("a chapter loads as its XHTML text", async () => {
    const text = await createEpubLoader(epub).loadText("OEBPS/ch002.xhtml");
    expect(text).toContain("The second chapter text.");
  });

  test("a missing entry loads as null, which foliate reads as absent", async () => {
    const loader = createEpubLoader(epub);
    expect(await loader.loadText("META-INF/encryption.xml")).toBeNull();
    expect(await loader.loadBlob("META-INF/encryption.xml")).toBeNull();
    expect(loader.getSize("META-INF/encryption.xml")).toBe(0);
  });

  test("a blob carries the entry's bytes and its size", async () => {
    const loader = createEpubLoader(epub);
    const blob = await loader.loadBlob("OEBPS/ch001.xhtml");
    expect(await blob?.text()).toBe((await loader.loadText("OEBPS/ch001.xhtml")) ?? "missing");
    expect(loader.getSize("OEBPS/ch001.xhtml")).toBe(blob?.size ?? -1);
  });

  test("close() drops the bytes, so every later load is null", async () => {
    const loader = createEpubLoader(epub);
    expect(loader.entries).toContain("OEBPS/content.opf");
    loader.close();
    expect(loader.entries).toEqual([]);
    expect(await loader.loadText("OEBPS/ch001.xhtml")).toBeNull();
    expect(await loader.loadBlob("OEBPS/ch001.xhtml")).toBeNull();
  });
});
