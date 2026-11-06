// Zip-bomb guard shared by every adapter that opens an untrusted zip (CBZ, DOCX, ODT).
import { unzipSync, type Unzipped } from "fflate";
import { PubmyError } from "./errors.ts";

export interface Limits {
  /** Total uncompressed bytes. */
  maxBytes: number;
  maxEntries: number;
}
export const DEFAULT_LIMITS: Limits = { maxBytes: 500 * 1024 * 1024, maxEntries: 5000 };

const tooLarge = () => new PubmyError("READ_FAILED", "archive-too-large");

/** Throws READ_FAILED archive-too-large over the entry or total-size cap. */
export function checkCaps(entries: { size: number }[], limits: Limits = DEFAULT_LIMITS): void {
  if (entries.length > limits.maxEntries) throw tooLarge();
  let total = 0;
  for (const e of entries) {
    total += e.size;
    if (total > limits.maxBytes) throw tooLarge();
  }
}

/** True when a path has a `..` segment (either slash style). */
export const isUnsafePath = (path: string): boolean => path.split(/[\\/]/).includes("..");

/** Checks the sizes the central directory declares, without inflating anything. */
export function checkZipCaps(bytes: Uint8Array, limits: Limits = DEFAULT_LIMITS): void {
  const declared: { size: number }[] = [];
  unzipSync(bytes, { filter: (f) => (declared.push({ size: f.originalSize }), false) });
  checkCaps(declared, limits);
}

/** Unzips after the declared-size check, dropping directories and `..` paths; re-checks the real sizes. */
export function unzipCapped(bytes: Uint8Array, limits: Limits = DEFAULT_LIMITS): Unzipped {
  checkZipCaps(bytes, limits);
  const files = unzipSync(bytes, { filter: (f) => !f.name.endsWith("/") && !isUnsafePath(f.name) });
  // The declared sizes can lie.
  checkCaps(Object.values(files).map((d) => ({ size: d.length })), limits);
  return files;
}
