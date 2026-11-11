import { describe, expect, test } from "bun:test";
import { docxAdapter } from "../src/adapters/docx.ts";
import { builtinAdapters, lazyAdapter } from "../src/adapters/builtin.ts";
import { mobiAdapter } from "../src/adapters/mobi/index.ts";
import { odtAdapter } from "../src/adapters/odt.ts";
import { pdfAdapter } from "../src/adapters/pdf.ts";
import { rtfAdapter } from "../src/adapters/rtf.ts";
import { textAdapter } from "../src/adapters/text.ts";
import { domFor, type Adapter, type Ctx, type Format, type Sniff } from "../src/index.ts";

// The adapters as they were registered before they loaded lazily, in the same order.
const REAL: Adapter[] = [docxAdapter, mobiAdapter, odtAdapter, pdfAdapter, rtfAdapter, textAdapter];
const FORMATS: Format[] = ["txt", "markdown", "html", "epub", "zip", "odt", "docx", "cbz", "pdf", "mobi", "rtf", "rar", "unknown"];
const EXTS = ["", "txt", "md", "markdown", "html", "htm", "epub", "zip", "odt", "docx", "cbz", "cbr", "pdf", "mobi", "azw3", "azw", "rtf", "rar", "bin"];

const ctx: Ctx = { dom: domFor("bun"), loadOcr: () => Promise.reject(new Error("no OCR")), progress: () => {}, signal: new AbortController().signal };

describe("built-in adapters load on their first file", () => {
  test("they keep the ids and the order of the adapters they stand for", () => {
    expect(builtinAdapters.map((a) => a.id)).toEqual(REAL.map((a) => a.id));
  });

  test("every format and extension goes to the same adapter as before", () => {
    const wrong: string[] = [];
    for (const format of FORMATS)
      for (const ext of EXTS) {
        const s: Sniff = { format, ext };
        const want = REAL.find((a) => a.accepts(s))?.id ?? "none";
        const got = builtinAdapters.find((a) => a.accepts(s))?.id ?? "none";
        if (want !== got) wrong.push(`${format}/${ext}: ${got}, want ${want}`);
      }
    expect(wrong).toEqual([]);
  });

  test("a DOCX named laporan, without an extension, goes to the docx adapter", () => {
    const s: Sniff = { format: "docx", ext: "" };
    expect(builtinAdapters.find((a) => a.accepts(s))?.id).toBe("docx");
    expect(REAL.find((a) => a.accepts(s))?.id).toBe("docx");
  });

  test("reading through the stand-in gives the real adapter's book", async () => {
    const file = { name: "note.txt", bytes: new TextEncoder().encode("Hello\n\nA second paragraph.") };
    const lazy = builtinAdapters.find((a) => a.id === textAdapter.id)!;
    expect(await lazy.read(file, ctx)).toEqual(await textAdapter.read(file, ctx));
  });

  test("a module that failed to load is tried again on the next file", async () => {
    let calls = 0;
    const adapter = lazyAdapter("t", () => true, async () => {
      calls++;
      if (calls === 1) throw new Error("chunk failed to load");
      return textAdapter;
    });
    const file = { name: "a.txt", bytes: new TextEncoder().encode("x") };
    await expect(adapter.read(file, ctx)).rejects.toThrow("chunk failed to load");
    await expect(adapter.read(file, ctx)).resolves.toBeDefined();
    await adapter.read(file, ctx);
    expect(calls).toBe(2);
  });
});
