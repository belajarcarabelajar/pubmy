import { afterAll, describe, expect, test } from "bun:test";
import { readDrmFlag } from "../src/adapters/mobi/drm.ts";
import { mobiAdapter } from "../src/adapters/mobi/index.ts";
import { convert, domFor, registerAdapter, type Ctx } from "../src/index.ts";

// Synthetic PDB: 78-byte header, one record-offset entry, record 0 at byte 96 holding a
// PalmDoc header, a 232-byte MOBI header and an optional EXTH block.
function makePdb(encryption: number, exthTypes: number[] = []): Uint8Array {
  const rec0 = 96;
  const mobiLen = 232;
  const exthLen = exthTypes.length ? 12 + exthTypes.length * 12 : 0;
  const buf = new Uint8Array(rec0 + 16 + mobiLen + exthLen + 16);
  const dv = new DataView(buf.buffer);
  const enc = new TextEncoder();
  buf.set(enc.encode("BOOKMOBI"), 60);
  dv.setUint16(76, 1);
  dv.setUint32(78, rec0);
  dv.setUint16(rec0 + 12, encryption);
  buf.set(enc.encode("MOBI"), rec0 + 16);
  dv.setUint32(rec0 + 20, mobiLen);
  dv.setUint32(rec0 + 36, 8);
  if (exthTypes.length) {
    dv.setUint32(rec0 + 128, 0x40);
    let p = rec0 + 16 + mobiLen;
    buf.set(enc.encode("EXTH"), p);
    dv.setUint32(p + 4, exthLen);
    dv.setUint32(p + 8, exthTypes.length);
    p += 12;
    for (const t of exthTypes) {
      dv.setUint32(p, t);
      dv.setUint32(p + 4, 12);
      p += 12;
    }
  }
  return buf;
}

describe("readDrmFlag", () => {
  test("reports PalmDoc encryption 2 (Mobipocket DRM) from record 0 offset 12", () => {
    expect(readDrmFlag(makePdb(2)).encryption).toBe(2);
  });

  test("reports encryption 0 for a DRM-free book", () => {
    expect(readDrmFlag(makePdb(0))).toEqual({ encryption: 0, exthDrm: false });
  });

  test("flags an EXTH 209 (tamper-proof keys) record as exthDrm", () => {
    expect(readDrmFlag(makePdb(0, [100, 209])).exthDrm).toBe(true);
  });

  test("throws on a header too short to hold record 0", () => {
    expect(() => readDrmFlag(makePdb(2).subarray(0, 100))).toThrow();
  });
});

describe("DRM refusal through convert()", () => {
  const ctx: Ctx = {
    dom: domFor("bun"),
    loadOcr: () => Promise.reject(new Error("no OCR")),
    progress: () => {},
    signal: new AbortController().signal,
  };
  const unregister = registerAdapter(mobiAdapter);
  afterAll(() => unregister());

  // The synthetic header has no text records, so any parse would end in READ_FAILED;
  // getting DRM proves the record-0 check ran first.
  test("an encryption=2 header gives code DRM", async () => {
    const r = await convert({ name: "locked.azw3", bytes: makePdb(2) }, ctx);
    expect(r).toMatchObject({ ok: false, code: "DRM" });
  });
});
