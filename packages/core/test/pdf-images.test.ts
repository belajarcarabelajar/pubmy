import { beforeAll, expect, test } from "bun:test";
import { unzlibSync } from "fflate";
import { getDocumentProxy } from "unpdf";
import { BITONAL, FIGURE, makeFiguresPdf, makeImageKindsPdf } from "../../../fixtures/make-pdf-figures.ts";
import { extractPageImages, type PageImage } from "../src/pdf/images.ts";

// The options the PDF adapter must pass too: without them a browser gets ImageBitmaps, not pixels.
const open = (bytes: Uint8Array) => getDocumentProxy(bytes, { isOffscreenCanvasSupported: false, isImageDecoderSupported: false });

let figurePage: PageImage[] = [];
let kindsPage: PageImage[] = [];
beforeAll(async () => {
  figurePage = await extractPageImages(await (await open(await makeFiguresPdf())).getPage(1));
  kindsPage = await extractPageImages(await (await open(await makeImageKindsPdf())).getPage(1));
});

// Bitwise CRC-32 straight from the PNG spec, independent of the table-driven one in the code.
function crc32(bytes: Uint8Array): number {
  let c = ~0;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

/** Minimal PNG reader per the spec: checks every chunk CRC, inflates IDAT, reverses the five row filters. */
function decodePng(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let width = 0;
  let height = 0;
  let colorType = -1;
  const idat: number[] = [];
  for (let off = 8; off < png.length; ) {
    const len = view.getUint32(off);
    const type = String.fromCharCode(...png.subarray(off + 4, off + 8));
    if (view.getUint32(off + 8 + len) !== crc32(png.subarray(off + 4, off + 8 + len))) throw new Error(`bad CRC in ${type}`);
    if (type === "IHDR") {
      width = view.getUint32(off + 8);
      height = view.getUint32(off + 12);
      colorType = png[off + 17];
    }
    if (type === "IDAT") idat.push(...png.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = unzlibSync(Uint8Array.from(idat));
  const ch = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[colorType];
  const stride = width * ch;
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? px[y * stride + i - ch] : 0;
      const b = y > 0 ? px[(y - 1) * stride + i] : 0;
      const c = y > 0 && i >= ch ? px[(y - 1) * stride + i - ch] : 0;
      const p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      px[y * stride + i] = (raw[y * (stride + 1) + 1 + i] + [0, a, b, (a + b) >> 1, paeth][filter]) & 255;
    }
  }
  return { width, height, colorType, px };
}

test("skips the small logo and keeps only the figure", () => {
  expect(figurePage.map((i) => [i.width, i.height])).toEqual([[FIGURE.width, FIGURE.height]]);
});

test("writes the PNG signature and an IHDR with the figure's size", () => {
  const png = figurePage[0]?.png ?? new Uint8Array();
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(String.fromCharCode(...png.subarray(12, 16))).toBe("IHDR");
  expect([decodePng(png).width, decodePng(png).height]).toEqual([FIGURE.width, FIGURE.height]);
});

test("a gray figure decodes back to the same pixels in one gray channel", () => {
  const { colorType, px } = decodePng(figurePage[0]?.png ?? new Uint8Array());
  expect(colorType).toBe(0);
  expect(px).toEqual(FIGURE.pixels);
});

test("returns the page's images top to bottom, top measured in points from the page top", () => {
  // boxes in fixtures/make-pdf-figures.ts KIND_BOXES: 792 - (560 + 128), 792 - (330 + 144), 792 - (80 + 100)
  expect(kindsPage.map((i) => i.top)).toEqual([104, 318, 612]);
});

test("an image with a soft mask is flattened onto white into an RGB PNG without alpha", () => {
  const { colorType, px } = decodePng(kindsPage[0]?.png ?? new Uint8Array());
  // row 0 of RGBA_IMAGE: black at alpha 128, (5, 0, 3) opaque, (10, 0, 6) fully transparent
  expect([colorType, ...px.subarray(0, 9)]).toEqual([2, 127, 127, 127, 5, 0, 3, 255, 255, 255]);
});

test("a 1-bit image decodes back to black and white gray pixels", () => {
  const { colorType, px } = decodePng(kindsPage[1]?.png ?? new Uint8Array());
  const want = Uint8Array.from({ length: BITONAL.width * BITONAL.height }, (_, k) =>
    BITONAL.white(k % BITONAL.width, Math.floor(k / BITONAL.width)) ? 255 : 0,
  );
  expect(colorType).toBe(0);
  expect(px).toEqual(want);
});

test("an image wider than 1600 px is scaled down to 1600 px wide, keeping its halves", () => {
  const png = decodePng(kindsPage[2]?.png ?? new Uint8Array());
  expect([png.width, png.height, kindsPage[2]?.width, kindsPage[2]?.height]).toEqual([1600, 32, 1600, 32]);
  const row = (x: number) => [...png.px.subarray(x * 3, x * 3 + 3)];
  expect([row(0), row(799), row(800), row(1599)]).toEqual([[255, 0, 0], [255, 0, 0], [0, 0, 255], [0, 0, 255]]);
});
