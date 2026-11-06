// MOBI6 and KF8 (AZW3) through foliate-js mobi.js. The record-0 DRM check runs on the raw
// bytes before mobi.js parses anything, so a locked book is never opened.
import { unzlibSync } from "fflate";
// @ts-ignore: the vendored foliate-js file ships no type declarations.
import { MOBI } from "../../../vendor/foliate-mobi.js";
import { withDomGlobals } from "../../dom.ts";
import { PubmyError } from "../../errors.ts";
import type { Adapter, Book, Ctx, InputFile } from "../../types.ts";
import { isBookMobi, readDrmFlag, recordsFit } from "./drm.ts";
import { kf8ToBook, type Kf8Book } from "./kf8.ts";
import { isCombo, preferKf8, readMobi6, withoutKf8Boundary, type FoliateMobi6Book } from "./mobi6.ts";

/** Reads a foliate-js MOBI6 book; implemented in mobi6.ts. */
export type Mobi6Reader = (book: FoliateMobi6Book, ctx: Pick<Ctx, "progress" | "signal">) => Promise<Book>;
const mobi6Reader: Mobi6Reader = readMobi6;

/** Checks the raw bytes; throws PubmyError for a non-MOBI, DRM-locked or truncated file. */
export function checkMobiBytes(bytes: Uint8Array): void {
  if (!isBookMobi(bytes)) throw new PubmyError("UNSUPPORTED", "not-bookmobi");
  let encryption: number;
  try {
    encryption = readDrmFlag(bytes).encryption;
  } catch {
    throw new PubmyError("READ_FAILED", "truncated");
  }
  if (encryption !== 0) throw new PubmyError("DRM", "drm-protected");
  if (!recordsFit(bytes)) throw new PubmyError("READ_FAILED", "truncated");
}

/**
 * Opens the bytes with foliate-js; a KF8 book has `transformTarget`, a MOBI6 book does not.
 * Call it, and read the returned book, inside withDomGlobals: mobi.js looks up document and
 * CSS.escape while sections load, not only while opening.
 */
export async function openMobi(bytes: Uint8Array): Promise<Kf8Book | FoliateMobi6Book> {
  try {
    return await new MOBI({ unzlib: unzlibSync }).open(new Blob([bytes as BlobPart]));
  } catch {
    throw new PubmyError("READ_FAILED", "mobi-parse-failed");
  }
}

export const isKf8 = (book: Kf8Book | FoliateMobi6Book): book is Kf8Book => "transformTarget" in book;

export const mobiAdapter: Adapter = {
  id: "mobi",
  accepts: (s) => s.format === "mobi",
  async read(file: InputFile, ctx: Ctx): Promise<Book> {
    checkMobiBytes(file.bytes);
    return withDomGlobals(() => readMobi(file, ctx));
  },
};

async function readMobi(file: InputFile, ctx: Ctx): Promise<Book> {
  if (!isCombo(file.bytes)) {
    const book = await openMobi(file.bytes);
    return isKf8(book) ? kf8ToBook(book) : mobi6Reader(book, ctx);
  }
  // foliate opens a combo file through its KF8 part; hiding EXTH 121 exposes the MOBI6 part.
  const { book, warnings } = await preferKf8(
    async () => {
      const kf8 = await openMobi(file.bytes);
      if (!isKf8(kf8)) throw new Error("no KF8 part");
      return kf8ToBook(kf8);
    },
    async () => {
      const mobi6 = await openMobi(withoutKf8Boundary(file.bytes));
      if (isKf8(mobi6)) throw new PubmyError("READ_FAILED", "mobi-parse-failed");
      return mobi6Reader(mobi6, ctx);
    },
  );
  if (!warnings.length) return book;
  return { ...book, notes: { ...book.notes, warnings: [...(book.notes?.warnings ?? []), ...warnings] } };
}
