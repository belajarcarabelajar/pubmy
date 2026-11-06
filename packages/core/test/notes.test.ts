import { expect, test } from "bun:test";
import { convert, domFor, registerAdapter } from "../src/index.ts";
import type { Book, Ctx } from "../src/index.ts";

const ctx: Ctx = {
  dom: domFor("bun"),
  loadOcr: () => Promise.reject(new Error("no ocr in this test")),
  progress: () => {},
  signal: new AbortController().signal,
};

const book: Book = {
  meta: { title: "Catatan", creators: [], language: "id" },
  chapters: [{ href: "ch001.xhtml", title: "Satu", body: "<h1>Satu</h1><p>isi</p>" }],
  assets: [],
  toc: [],
  layout: "reflow",
  direction: "ltr",
  notes: { ocr: { pages: 2, meanConfidence: 94 }, warnings: ["kf8-part-failed"] },
};

test("notes an adapter puts on the Book reach the successful Result", async () => {
  const off = registerAdapter({ id: "test-notes", accepts: (s) => s.ext === "notestest", read: async () => book });
  try {
    const r = await convert({ name: "x.notestest", bytes: new TextEncoder().encode("x") }, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.notes).toEqual({ ocr: { pages: 2, meanConfidence: 94 }, warnings: ["kf8-part-failed"] });
  } finally {
    off();
  }
});
