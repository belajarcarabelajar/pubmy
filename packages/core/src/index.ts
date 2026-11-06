import { comicsAdapter } from "./adapters/comics.ts";
import { docxAdapter } from "./adapters/docx.ts";
import { mobiAdapter } from "./adapters/mobi/index.ts";
import { odtAdapter } from "./adapters/odt.ts";
import { pdfAdapter } from "./adapters/pdf.ts";
import { rtfAdapter } from "./adapters/rtf.ts";
import { textAdapter } from "./adapters/text.ts";
import { detect } from "./detect.ts";
import { PubmyError } from "./errors.ts";
import { pack } from "./packager.ts";
import type { Adapter, Book, Ctx, FailureCode, InputFile, Result } from "./types.ts";
import { validate } from "./validate.ts";

export type * from "./types.ts";
export { detect } from "./detect.ts";
export { domFor } from "./dom.ts";
export { pack } from "./packager.ts";
export { validate } from "./validate.ts";
export { PubmyError } from "./errors.ts";

const adapters: Adapter[] = [comicsAdapter, docxAdapter, mobiAdapter, odtAdapter, pdfAdapter, rtfAdapter, textAdapter];

/**
 * Adds an adapter ahead of the ones already registered (newest first, the built-in text adapter last),
 * or replaces the one with the same id in place. Returns a function that removes it again.
 */
export function registerAdapter(a: Adapter): () => void {
  const i = adapters.findIndex((x) => x.id === a.id);
  if (i >= 0) adapters[i] = a;
  else adapters.unshift(a);
  return () => {
    const j = adapters.indexOf(a);
    if (j >= 0) adapters.splice(j, 1);
  };
}

const fail = (code: FailureCode, message: string): Result => ({ ok: false, code, message });

/** Converts one input file to EPUB 3; an EPUB with validation errors is never returned. */
export async function convert(file: InputFile, ctx: Ctx): Promise<Result> {
  if (file.bytes.length === 0) return fail("READ_FAILED", "empty-file");
  const sniff = detect(file.bytes, file.name);
  if (sniff.format === "epub") return fail("UNSUPPORTED", "already-epub");
  const adapter = adapters.find((a) => a.accepts(sniff));
  if (!adapter) return fail("UNSUPPORTED", "unsupported-format");
  let book: Book;
  try {
    book = await adapter.read(file, ctx);
  } catch (e) {
    if (e instanceof PubmyError) return fail(e.code, e.message);
    return fail("READ_FAILED", "read-failed");
  }
  let epub: Uint8Array;
  try {
    epub = pack(book);
  } catch {
    return fail("INVALID_EPUB", "invalid-epub");
  }
  const check = await validate(epub);
  if (check.errors > 0) return fail("INVALID_EPUB", "invalid-epub");
  ctx.progress(1);
  return { ok: true, epub, check: { errors: 0, warnings: check.warnings }, ...(book.notes ? { notes: book.notes } : {}) };
}
