// 8-bit PNG encoder shared by raster figures (pdf/images.ts) and formula crops (render/*). Pure
// TypeScript with fflate for deflate, so it runs in Bun and in a browser Web Worker alike.
import { zlibSync } from "fflate";

export interface Pixels {
  w: number;
  h: number;
  ch: 1 | 3 | 4;
  data: Uint8Array;
}

const SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const COLOR_TYPE = { 1: 0, 3: 2, 4: 6 } as const;

let crcTable: Uint32Array | undefined;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(body.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let k = 0; k < 4; k++) out[4 + k] = type.charCodeAt(k);
  out.set(body, 8);
  view.setUint32(body.length + 8, crc32(out.subarray(4, body.length + 8)));
  return out;
}

/** PNG filter predictors: 0 none, 1 sub, 2 up, 3 average, 4 Paeth. */
function predict(f: number, d: Uint8Array, row: number, i: number, ch: number, stride: number): number {
  if (f === 0) return 0;
  const a = i >= ch ? d[row + i - ch] : 0;
  const b = row > 0 ? d[row - stride + i] : 0;
  if (f === 1) return a;
  if (f === 2) return b;
  if (f === 3) return (a + b) >> 1;
  const c = row > 0 && i >= ch ? d[row - stride + i - ch] : 0;
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** 8-bit PNG; each row takes the filter with the smallest sum of signed residuals, then zlib level 9. */
export function encodePng({ w, h, ch, data }: Pixels): Uint8Array {
  const stride = w * ch;
  const raw = new Uint8Array((stride + 1) * h);
  const trial = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const row = y * stride;
    let best = Infinity;
    for (let f = 0; f < 5; f++) {
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const v = (data[row + i] - predict(f, data, row, i, ch, stride)) & 255;
        trial[i] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < best) {
        best = score;
        raw[y * (stride + 1)] = f;
        raw.set(trial, y * (stride + 1) + 1);
      }
    }
  }
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, w);
  new DataView(ihdr.buffer).setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = COLOR_TYPE[ch];
  const parts = [SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", zlibSync(raw, { level: 9 })), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** RGBA pixels flattened onto white (Kindle drops transparency) as a gray PNG, or RGB when any pixel has colour. */
export function opaquePng(w: number, h: number, rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const flat = new Uint8Array(w * h * 3);
  let gray = true;
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    const alpha = rgba[i + 3];
    for (let k = 0; k < 3; k++) flat[j + k] = Math.round((rgba[i + k] * alpha + 255 * (255 - alpha)) / 255);
    if (flat[j] !== flat[j + 1] || flat[j] !== flat[j + 2]) gray = false;
  }
  if (!gray) return encodePng({ w, h, ch: 3, data: flat });
  const one = new Uint8Array(w * h);
  for (let i = 0; i < one.length; i++) one[i] = flat[i * 3];
  return encodePng({ w, h, ch: 1, data: one });
}
