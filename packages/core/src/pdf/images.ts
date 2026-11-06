// Raster images drawn on one pdf.js page, as PNG bytes in top-to-bottom order. Pure JS with fflate
// for deflate, so it runs in Bun without a canvas and inside a browser Web Worker. pdf.js hands out
// raw pixels only when the document was opened with isOffscreenCanvasSupported and
// isImageDecoderSupported both false; otherwise a browser gets ImageBitmaps, which are skipped here.
import { zlibSync } from "fflate";
import { getResolvedPDFJS } from "unpdf";

export interface PageImage {
  /** 8-bit gray or RGB PNG without alpha; transparency is composited onto white. */
  png: Uint8Array;
  /** Pixel size of the PNG, after any downscale. */
  width: number;
  height: number;
  /** Top and bottom edges of the drawn image in PDF points, measured down from the top of page.view. */
  top: number;
  bottom: number;
}

export interface PageImageOptions {
  /** Wider images are scaled down to this width with a box filter. Default 1600. */
  maxWidth?: number;
}

interface ObjStore {
  get(id: string, callback: (data: unknown) => void): unknown;
}

/** The part of a pdf.js PDFPageProxy this module reads. */
export interface ImagePage {
  view: number[];
  objs: ObjStore;
  commonObjs: ObjStore;
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[] }>;
}

interface RawImage {
  width: number;
  height: number;
  kind?: number;
  data?: Uint8Array | Uint8ClampedArray | null;
}

interface Pixels {
  w: number;
  h: number;
  ch: 1 | 3 | 4;
  data: Uint8Array;
}

type Matrix = number[];
type Kinds = { GRAYSCALE_1BPP: number; RGB_24BPP: number; RGBA_32BPP: number };

/**
 * Decorative images are skipped: drawn on less than 2 percent of the page area (logos, icons; the
 * 48 pt NIH logo covers 0.5 percent) or under 32 px on a side (rules, spacers, solid fills).
 */
const MIN_AREA = 0.02;
const MIN_PX = 32;
const SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const COLOR_TYPE = { 1: 0, 3: 2, 4: 6 } as const;

/** `inner` applied first, then `outer`, the way `cm` concatenates onto the current matrix. */
const mul = (outer: Matrix, inner: ArrayLike<number>): Matrix => [
  outer[0] * inner[0] + outer[2] * inner[1],
  outer[1] * inner[0] + outer[3] * inner[1],
  outer[0] * inner[2] + outer[2] * inner[3],
  outer[1] * inner[2] + outer[3] * inner[3],
  outer[0] * inner[4] + outer[2] * inner[5] + outer[4],
  outer[1] * inner[4] + outer[3] * inner[5] + outer[5],
];

function objectOf(page: ImagePage, id: string): Promise<RawImage | null> {
  // pdf.js keeps images shared between pages under "g_" ids in commonObjs
  const store = id.startsWith("g_") ? page.commonObjs : page.objs;
  return new Promise((resolve) => store.get(id, (d) => resolve((d as RawImage | null) ?? null)));
}

function pixelsOf(img: RawImage, kinds: Kinds): Pixels | null {
  const { width: w, height: h, data } = img;
  if (!data) return null;
  if (img.kind === kinds.GRAYSCALE_1BPP) {
    const stride = (w + 7) >> 3;
    if (data.length < stride * h) return null;
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = (data[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0;
    return { w, h, ch: 1, data: out };
  }
  const ch = img.kind === kinds.RGB_24BPP ? 3 : img.kind === kinds.RGBA_32BPP ? 4 : 0;
  if (ch === 0 || data.length < w * h * ch) return null;
  return { w, h, ch, data: new Uint8Array(data.subarray(0, w * h * ch)) };
}

/**
 * Composites alpha onto white, because Kindle flattens transparency onto white anyway (Kindle
 * Publishing Guidelines 2026.3, 11.4), then stores RGB with equal channels as gray.
 */
function compact(p: Pixels): Pixels {
  const n = p.w * p.h;
  let { ch, data } = p;
  if (ch === 4) {
    const rgb = new Uint8Array(n * 3);
    for (let k = 0; k < n; k++) {
      const a = data[k * 4 + 3];
      for (let c = 0; c < 3; c++) rgb[k * 3 + c] = Math.round((data[k * 4 + c] * a + 255 * (255 - a)) / 255);
    }
    [ch, data] = [3, rgb];
  }
  if (ch === 3) {
    let gray = true;
    for (let k = 0; k < data.length && gray; k += 3) gray = data[k] === data[k + 1] && data[k] === data[k + 2];
    if (gray) {
      const g = new Uint8Array(n);
      for (let k = 0; k < n; k++) g[k] = data[k * 3];
      [ch, data] = [1, g];
    }
  }
  return { w: p.w, h: p.h, ch, data };
}

/** Box filter: each output pixel is the mean of the source pixels it covers. */
function shrink(p: Pixels, maxWidth: number): Pixels {
  if (p.w <= maxWidth) return p;
  const w = maxWidth;
  const h = Math.max(1, Math.round((p.h * w) / p.w));
  const span = (k: number, from: number, to: number) => {
    const a = Math.floor((k * from) / to);
    return [a, Math.max(a + 1, Math.floor(((k + 1) * from) / to))];
  };
  const out = new Uint8Array(w * h * p.ch);
  for (let y = 0; y < h; y++) {
    const [ya, yb] = span(y, p.h, h);
    for (let x = 0; x < w; x++) {
      const [xa, xb] = span(x, p.w, w);
      const count = (yb - ya) * (xb - xa);
      for (let c = 0; c < p.ch; c++) {
        let sum = 0;
        for (let sy = ya; sy < yb; sy++) for (let sx = xa; sx < xb; sx++) sum += p.data[(sy * p.w + sx) * p.ch + c];
        out[(y * w + x) * p.ch + c] = Math.round(sum / count);
      }
    }
  }
  return { w, h, ch: p.ch, data: out };
}

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
function encodePng({ w, h, ch, data }: Pixels): Uint8Array {
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

/**
 * The raster images (image XObjects and inline images) drawn on a page, as PNGs ordered top to
 * bottom; decorative ones (see MIN_AREA, MIN_PX) are left out. Call page.cleanup() afterwards to
 * free the decoded pixels pdf.js keeps.
 */
export async function extractPageImages(page: ImagePage, opts: PageImageOptions = {}): Promise<PageImage[]> {
  const { OPS, ImageKind } = await getResolvedPDFJS();
  const { fnArray, argsArray } = await page.getOperatorList();
  const [vx0, vy0, vx1, vy1] = page.view;
  const pageArea = (vx1 - vx0) * (vy1 - vy0);
  const out: PageImage[] = [];
  const stack: Matrix[] = [];
  const groups: boolean[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  // annotation appearances and soft-mask content are not page figures
  let hidden = 0;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] as unknown[];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore || fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, args as number[]);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (args[0]) ctm = mul(ctm, args[0] as number[]);
    } else if (fn === OPS.beginAnnotation) {
      stack.push(ctm);
      hidden++;
    } else if (fn === OPS.endAnnotation) {
      ctm = stack.pop() ?? ctm;
      hidden--;
    } else if (fn === OPS.beginGroup) {
      groups.push(Boolean((args[0] as { smask?: unknown } | undefined)?.smask));
      if (groups.at(-1)) hidden++;
    } else if (fn === OPS.endGroup) {
      if (groups.pop()) hidden--;
    } else if ((fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) && hidden === 0) {
      const xs = [ctm[4], ctm[0] + ctm[4], ctm[2] + ctm[4], ctm[0] + ctm[2] + ctm[4]];
      const ys = [ctm[5], ctm[1] + ctm[5], ctm[3] + ctm[5], ctm[1] + ctm[3] + ctm[5]];
      const [x0, x1] = [Math.max(Math.min(...xs), vx0), Math.min(Math.max(...xs), vx1)];
      const [y0, y1] = [Math.max(Math.min(...ys), vy0), Math.min(Math.max(...ys), vy1)];
      if (x1 <= x0 || y1 <= y0 || ((x1 - x0) * (y1 - y0)) / pageArea < MIN_AREA) continue;
      const img = fn === OPS.paintInlineImageXObject ? (args[0] as RawImage) : await objectOf(page, args[0] as string);
      if (!img || img.width < MIN_PX || img.height < MIN_PX) continue;
      const px = pixelsOf(img, ImageKind);
      if (!px) continue;
      const small = shrink(compact(px), opts.maxWidth ?? 1600);
      out.push({ png: encodePng(small), width: small.w, height: small.h, top: vy1 - y1, bottom: vy1 - y0 });
    }
  }
  return out.sort((a, b) => a.top - b.top);
}
