import type { FailureCode, Result } from "@pubmy/core";
import { checkZipCaps } from "@pubmy/core/zip-caps";
import { strFromU8, unzipSync } from "fflate";
import type { Refusal } from "./queue.ts";

// Only types come from "@pubmy/core" and its runtime stays out of here: this file is reachable from main.ts, and
// the converter must load in the worker alone. checkZipCaps comes from the small zip-caps entry for that reason.

export const EPUB_MIME = "application/epub+zip";

export type Inspect = { ok: true } | Extract<Result, { ok: false }>;

export const isEpubFile = (f: { name: string; type?: string }): boolean => /\.epub$/i.test(f.name) || f.type === EPUB_MIME;

const fail = (code: FailureCode, message: string): Inspect => ({ ok: false, code, message });
const READ_FAILED = () => fail("READ_FAILED", "read-failed");

const CONTAINER = "META-INF/container.xml";
const ENCRYPTION = "META-INF/encryption.xml";
// The two font obfuscations foliate-js undoes itself; any other method means the book's content is encrypted.
const FONT_OBFUSCATION = new Set(["http://www.idpf.org/2008/embedding", "http://ns.adobe.com/pdf/enc#RC"]);

/** The package's mark: a zip local file header. */
const hasZipSignature = (b: Uint8Array) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/** A regex instead of a DOM: this runs on the main thread and under Bun, where DOMParser is absent. */
function usesDrm(encryptionXml: string): boolean {
  for (const [tag] of encryptionXml.matchAll(/<(?:[\w.-]+:)?EncryptionMethod(?=[\s/>])[^>]*>/g)) {
    const m = /\sAlgorithm\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(tag);
    if (!FONT_OBFUSCATION.has(m?.[1] ?? m?.[2] ?? "")) return true;
  }
  return false;
}

/** Decides whether dropped bytes are an EPUB the reader can open, inflating only the two META-INF entries. */
export function inspectEpub(bytes: Uint8Array): Inspect {
  if (bytes.length === 0) return fail("READ_FAILED", "empty-file");
  if (!hasZipSignature(bytes)) return READ_FAILED();
  try {
    checkZipCaps(bytes);
  } catch (e) {
    // Structural check: core's PubmyError carries a string code, while fflate's own errors carry a number.
    const code = (e as { code?: unknown } | null)?.code;
    if (typeof code === "string") return fail(code as FailureCode, (e as Error).message);
    return READ_FAILED();
  }
  let meta: Record<string, Uint8Array>;
  try {
    meta = unzipSync(bytes, { filter: (f) => f.name === CONTAINER || f.name === ENCRYPTION });
  } catch {
    return READ_FAILED();
  }
  if (!meta[CONTAINER]) return READ_FAILED();
  if (meta[ENCRYPTION] && usesDrm(strFromU8(meta[ENCRYPTION]))) return fail("DRM", "epub-drm");
  return { ok: true };
}

/** Splits a drop: EPUBs are opened (within the size and held-row limits), everything else is converted. */
export function splitDrop<F extends { name: string; size: number; type?: string }>(
  files: F[],
  o: { maxBytes: number; maxHeld: number; held: number },
): { toQueue: F[]; toOpen: F[]; refused: Refusal[] } {
  const toQueue: F[] = [];
  const toOpen: F[] = [];
  const refused: Refusal[] = [];
  for (const f of files) {
    if (!isEpubFile(f)) toQueue.push(f);
    else if (f.size > o.maxBytes) refused.push({ name: f.name, code: "TOO_LARGE" });
    else if (o.held + toOpen.length >= o.maxHeld) refused.push({ name: f.name, code: "LIMIT_10" });
    else toOpen.push(f);
  }
  return { toQueue, toOpen, refused };
}
