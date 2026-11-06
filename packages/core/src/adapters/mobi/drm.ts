// Pure readers for the Palm database (PDB) header and MOBI record 0. They run before
// foliate-js sees the file, so a DRM-locked or broken file is refused without parsing it.

const u16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

// EXTH 209 holds the tamper-proof keys Kindle DRM derives its book PIDs from.
const EXTH_TAMPER_KEYS = 209;

export interface DrmFlag {
  /** PalmDoc encryption type: 0 none, 1 old Mobipocket, 2 Mobipocket DRM. */
  encryption: number;
  exthDrm: boolean;
}

/** True when the PDB type and creator say BOOKMOBI (MOBI6, KF8 and combo files). */
export function isBookMobi(bytes: Uint8Array): boolean {
  return bytes.length >= 78 && ascii(bytes, 60, 68) === "BOOKMOBI";
}

function record0(bytes: Uint8Array): number {
  if (bytes.length < 82) throw new RangeError("pdb-header-truncated");
  const rec0 = u32(bytes, 78);
  if (rec0 + 16 > bytes.length) throw new RangeError("record0-truncated");
  return rec0;
}

/** Reads the DRM markers of record 0; throws RangeError when the header is cut short. */
export function readDrmFlag(bytes: Uint8Array): DrmFlag {
  const rec0 = record0(bytes);
  const encryption = u16(bytes, rec0 + 12);
  return { encryption, exthDrm: exthTypes(bytes, rec0).includes(EXTH_TAMPER_KEYS) };
}

function exthTypes(bytes: Uint8Array, rec0: number): number[] {
  if (rec0 + 132 > bytes.length || ascii(bytes, rec0 + 16, rec0 + 20) !== "MOBI") return [];
  if (!(u32(bytes, rec0 + 128) & 0x40)) return [];
  let p = rec0 + 16 + u32(bytes, rec0 + 20);
  if (p + 12 > bytes.length || ascii(bytes, p, p + 4) !== "EXTH") return [];
  const count = u32(bytes, p + 8);
  const types: number[] = [];
  p += 12;
  for (let i = 0; i < count && p + 8 <= bytes.length; i++) {
    types.push(u32(bytes, p));
    const len = u32(bytes, p + 4);
    if (len < 8) break;
    p += len;
  }
  return types;
}

/** True when every record the PDB header lists starts inside the file. */
export function recordsFit(bytes: Uint8Array): boolean {
  if (bytes.length < 78) return false;
  const n = u16(bytes, 76);
  if (78 + n * 8 > bytes.length) return false;
  for (let i = 0; i < n; i++) if (u32(bytes, 78 + i * 8) >= bytes.length) return false;
  return true;
}
