// Zip-bomb guard shared by every adapter that opens an untrusted zip (CBZ, DOCX, ODT).
import { Inflate, strFromU8, unzipSync, type Unzipped } from "fflate";
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

const readFailed = () => new PubmyError("READ_FAILED", "read-failed");
const END_RECORD = 0x06054b50;
const CENTRAL_RECORD = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
// Deflate expands at most 1,032 to 1, so one piece yields at most about 4 MB before the size check can run: 80 to
// 160 ms measured on the Colab pool, against 450 ms for 16 KiB pieces and +100 ms per 40 MB of honest data.
const PIECE = 4 * 1024;

interface Entry {
  name: string;
  method: number;
  compressed: number;
  size: number;
  offset: number;
}

/** Strict reader of the central directory: no ZIP64, no spanned archive, every record inside the file; anything else throws. */
function readEntries(bytes: Uint8Array, v: DataView): Entry[] {
  // The same backwards scan fflate makes, so both readers see the same directory.
  const lowest = Math.max(0, bytes.length - 22 - 0x10000);
  let end = bytes.length - 22;
  while (end >= lowest && v.getUint32(end, true) !== END_RECORD) end--;
  if (end < lowest) throw readFailed();
  const count = v.getUint16(end + 10, true);
  const disks = v.getUint16(end + 4, true) | v.getUint16(end + 6, true);
  const directory = v.getUint32(end + 16, true);
  if (disks || v.getUint16(end + 8, true) !== count) throw readFailed();
  if (count === 0xffff || v.getUint32(end + 12, true) === 0xffffffff || directory === 0xffffffff) throw readFailed();
  const entries: Entry[] = [];
  let at = directory;
  for (let i = 0; i < count; i++) {
    if (v.getUint32(at, true) !== CENTRAL_RECORD) throw readFailed();
    const nameEnd = at + 46 + v.getUint16(at + 28, true);
    const entry = {
      // fflate's rule, so both unzips give the same keys: UTF-8 only when general purpose flag bit 11 is set, else Latin-1.
      name: strFromU8(bytes.subarray(at + 46, nameEnd), !(v.getUint16(at + 8, true) & 0x800)),
      method: v.getUint16(at + 10, true),
      compressed: v.getUint32(at + 20, true),
      size: v.getUint32(at + 24, true),
      offset: v.getUint32(at + 42, true),
    };
    if (entry.compressed === 0xffffffff || entry.size === 0xffffffff || entry.offset === 0xffffffff) throw readFailed();
    at = nameEnd + v.getUint16(at + 30, true) + v.getUint16(at + 32, true);
    if (at > end) throw readFailed();
    entries.push(entry);
  }
  return entries;
}

/** The entry's stored bytes. The central directory's sizes are used because a data descriptor leaves the local header's at 0. */
function entryData(bytes: Uint8Array, v: DataView, e: Entry): Uint8Array {
  if (v.getUint32(e.offset, true) !== LOCAL_HEADER) throw readFailed();
  const start = e.offset + 30 + v.getUint16(e.offset + 26, true) + v.getUint16(e.offset + 28, true);
  if (start + e.compressed > bytes.length) throw readFailed();
  return bytes.subarray(start, start + e.compressed);
}

/** Inflates `data` piece by piece and throws archive-too-large as soon as the output passes `declared` or `room`. */
function inflateBounded(data: Uint8Array, declared: number, room: number): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [];
  let got = 0;
  const inflate = new Inflate((chunk) => {
    got += chunk.length;
    if (got > declared || got > room) throw tooLarge();
    parts.push(chunk);
  });
  let at = 0;
  do {
    const next = Math.min(at + PIECE, data.length);
    inflate.push(data.subarray(at, next), next === data.length);
    at = next;
  } while (at < data.length);
  const out = new Uint8Array(got);
  let end = 0;
  for (const part of parts) {
    out.set(part, end);
    end += part.length;
  }
  return out;
}

/**
 * Same files as `unzipCapped` for an honest zip, but the unzip cost follows the declared sizes, not the real ones:
 * `unzipSync` decodes a whole deflate stream before the real size can be compared with the declared one, so an
 * archive that lies costs main-thread time in proportion to what it really inflates to. Here an entry is refused
 * as soon as its output passes the size the central directory declares. Whatever cannot be bounded (ZIP64, a method
 * other than stored or deflate, data outside the file) is refused as read-failed, never handed to an unbounded path.
 */
export function unzipBounded(bytes: Uint8Array, limits: Limits = DEFAULT_LIMITS): Unzipped {
  const files: Unzipped = {};
  try {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const entries = readEntries(bytes, v);
    checkCaps(entries, limits);
    let total = 0;
    for (const e of entries) {
      if (e.name.endsWith("/") || isUnsafePath(e.name)) continue;
      const data = entryData(bytes, v, e);
      if (e.method === 0 && data.length !== e.size) throw tooLarge();
      if (e.method !== 0 && e.method !== 8) throw readFailed();
      const out = e.method === 0 ? new Uint8Array(data) : inflateBounded(data, e.size, limits.maxBytes - total);
      files[e.name] = out;
      total += out.length;
    }
    return files;
  } catch (error) {
    throw error instanceof PubmyError ? error : readFailed();
  }
}
