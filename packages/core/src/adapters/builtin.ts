import type { Adapter, Sniff } from "../types.ts";

/**
 * Stands in for an adapter whose code loads on its first file, so a bundler puts each format in its own chunk
 * and a Markdown file in the browser no longer downloads the DOCX, MOBI, ODT and RTF readers. A failed load is
 * not kept, so the next file tries again.
 */
export function lazyAdapter(id: string, accepts: (s: Sniff) => boolean, load: () => Promise<Adapter>): Adapter {
  let real: Promise<Adapter> | null = null;
  return {
    id,
    accepts,
    async read(file, ctx) {
      real ??= load().catch((e: unknown) => {
        real = null;
        throw e;
      });
      return (await real).read(file, ctx);
    },
  };
}

// Each accepts() repeats the real adapter's own; builtin-adapters.test.ts checks every format against it.
export const builtinAdapters: Adapter[] = [
  lazyAdapter("docx", (s) => s.ext === "docx", async () => (await import("./docx.ts")).docxAdapter),
  lazyAdapter("mobi", (s) => s.format === "mobi", async () => (await import("./mobi/index.ts")).mobiAdapter),
  lazyAdapter("odt", (s) => s.format === "odt", async () => (await import("./odt.ts")).odtAdapter),
  lazyAdapter("pdf", (s) => s.format === "pdf", async () => (await import("./pdf.ts")).pdfAdapter),
  lazyAdapter("rtf", (s) => s.format === "rtf", async () => (await import("./rtf.ts")).rtfAdapter),
  lazyAdapter("text", (s) => s.format === "txt" || s.format === "markdown" || s.format === "html", async () => (await import("./text.ts")).textAdapter),
];
