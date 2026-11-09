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

// A real container.xml is about 250 bytes and a real encryption.xml a few KB. They are inflated on the main thread, so an
// entry that is big, or claims to be, is refused instead of inflated.
const META_MAX_COMPRESSED = 16 * 1024;
const META_MAX_DECLARED = 128 * 1024;

/** The package's mark: a zip local file header. */
const hasZipSignature = (b: Uint8Array) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/** An XML parser reads UTF-16 when the file starts with a byte order mark, so a UTF-16 encryption.xml must not be read as UTF-8. */
function decodeXml(b: Uint8Array): string {
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(b.subarray(2));
  return strFromU8(b);
}

/**
 * Drops comments and CDATA sections the way a parser skips them, in one pass over indexOf so the cost stays linear
 * (a lazy `[\s\S]*?` regex retries from every opener of an unclosed file). Each opener is searched for once and
 * again only after the scan has moved past it. An opener without a terminator ends the stripping and the rest is
 * kept, so a tag after it is still seen.
 */
function stripCommentsAndCdata(xml: string): string {
  const parts: string[] = [];
  let pos = 0;
  let comment = xml.indexOf("<!--");
  let cdata = xml.indexOf("<![CDATA[");
  while (comment !== -1 || cdata !== -1) {
    const isComment = cdata === -1 || (comment !== -1 && comment < cdata);
    const start = isComment ? comment : cdata;
    const end = xml.indexOf(isComment ? "-->" : "]]>", start + (isComment ? 4 : 9));
    if (end === -1) break;
    parts.push(xml.slice(pos, start), " ");
    pos = end + 3;
    // An opener that sat inside the stretch just dropped is text, so it is searched for again from the new position.
    if (comment !== -1 && comment < pos) comment = xml.indexOf("<!--", pos);
    if (cdata !== -1 && cdata < pos) cdata = xml.indexOf("<![CDATA[", pos);
  }
  parts.push(xml.slice(pos));
  return parts.join("");
}

/**
 * A regex instead of a DOM: this runs on the main thread and under Bun, where DOMParser is absent.
 * `[^<>]*` ends each attempt at the next tag, so a file of unclosed tags is scanned in linear time.
 */
function usesDrm(encryptionXml: string): boolean {
  for (const [tag] of stripCommentsAndCdata(encryptionXml).matchAll(/<(?:[\w.-]+:)?EncryptionMethod(?=[\s/>])[^<>]*>/g)) {
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
  let oversize = false;
  let meta: Record<string, Uint8Array>;
  try {
    meta = unzipSync(bytes, {
      filter: (f) => {
        if (f.name !== CONTAINER && f.name !== ENCRYPTION) return false;
        // Refused, never treated as absent: skipping an oversize encryption.xml would let a DRM book through.
        if (f.size > META_MAX_COMPRESSED || f.originalSize > META_MAX_DECLARED) {
          oversize = true;
          return false;
        }
        return true;
      },
    });
  } catch {
    return READ_FAILED();
  }
  if (oversize) return READ_FAILED();
  if (!meta[CONTAINER]) return READ_FAILED();
  if (meta[ENCRYPTION] && usesDrm(decodeXml(meta[ENCRYPTION]))) return fail("DRM", "epub-drm");
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
