import { afterEach, describe, expect, test } from "bun:test";
import { DOMMatrix, ImageData, Path2D, createCanvas, loadImage, type Canvas } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { loadRendererBrowser } from "../src/render/browser.ts";

// Bun has no OffscreenCanvas; this stand-in exposes only the browser surface the renderer uses,
// backed by a real Skia canvas so the pixels are real.
class FakeOffscreenCanvas {
  #c: Canvas;
  constructor(w: number, h: number) {
    this.#c = createCanvas(Math.max(1, w), Math.max(1, h));
  }
  get width() {
    return this.#c.width;
  }
  set width(v: number) {
    this.#c.width = Math.max(1, v);
  }
  get height() {
    return this.#c.height;
  }
  set height(v: number) {
    this.#c.height = Math.max(1, v);
  }
  getContext(_type: "2d") {
    return this.#c.getContext("2d");
  }
  async convertToBlob(o?: { type?: string }) {
    if (o?.type !== "image/png") throw new Error("only png");
    return new Blob([new Uint8Array(await this.#c.encode("png"))], { type: "image/png" });
  }
}

// A browser worker also has Path2D, DOMMatrix and ImageData, which pdf.js draws with; Bun has none.
const BROWSER_GLOBALS = { OffscreenCanvas: FakeOffscreenCanvas, Path2D, DOMMatrix, ImageData };
const g = globalThis as unknown as Record<string, unknown>;
const original = Object.fromEntries(Object.keys(BROWSER_GLOBALS).map((k) => [k, g[k]]));
afterEach(() => {
  for (const [k, v] of Object.entries(original)) if (v === undefined) delete g[k];
  else g[k] = v;
});

// 200 x 200 pt page, PDF coordinates (origin bottom-left): a fraction a/b with its bar in the middle,
// a black square at the top-left, nothing at the bottom-left.
async function fractionPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("a", { x: 95, y: 115, size: 24, font });
  page.drawLine({ start: { x: 80, y: 108 }, end: { x: 120, y: 108 }, thickness: 2, color: rgb(0, 0, 0) });
  page.drawText("b", { x: 95, y: 82, size: 24, font });
  page.drawRectangle({ x: 0, y: 150, width: 50, height: 50, color: rgb(0, 0, 0) });
  return await doc.save();
}

const BAR = { page: 1, x0: 75, y0: 104, x1: 125, y1: 112 };
const LETTER_A = { page: 1, x0: 90, y0: 112, x1: 115, y1: 145 };
const EMPTY = { page: 1, x0: 0, y0: 0, x1: 50, y1: 50 };

function ihdr(png: Uint8Array) {
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { w: v.getUint32(16), h: v.getUint32(20), colourType: png[25] };
}

async function pixels(png: Uint8Array) {
  const img = await loadImage(Buffer.from(png));
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height).data;
}

async function darkCount(png: Uint8Array): Promise<number> {
  const d = await pixels(png);
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i]! + d[i + 1]! + d[i + 2]! < 3 * 128) n++;
  return n;
}

async function renderer() {
  Object.assign(g, BROWSER_GLOBALS);
  const r = await loadRendererBrowser();
  if (!r) throw new Error("renderer missing");
  return r;
}

/** Lines written to console.log and console.warn while `run` runs. */
async function consoleOf(run: () => Promise<unknown>): Promise<string[]> {
  const lines: string[] = [];
  const [log, warn] = [console.log, console.warn];
  console.log = console.warn = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  try {
    await run();
  } finally {
    [console.log, console.warn] = [log, warn];
  }
  return lines;
}

describe("loadRendererBrowser", () => {
  test("rendering a page with unembedded fonts writes no pdf.js warning to the console", async () => {
    const r = await renderer();
    const pdf = await fractionPdf();
    const lines = await consoleOf(() => r.renderBoxes(pdf, [LETTER_A], 72));
    expect(lines.filter((l) => l.startsWith("Warning:"))).toEqual([]);
  });

  test("is null when the runtime has no OffscreenCanvas", async () => {
    delete g.OffscreenCanvas;
    expect(await loadRendererBrowser()).toBeNull();
  });

  test("renders a box as a PNG of the box size at the given dpi", async () => {
    const r = await renderer();
    const [png] = await r.renderBoxes(await fractionPdf(), [BAR], 144);
    expect(png).toBeInstanceOf(Uint8Array);
    expect(Array.from(png!.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(ihdr(png!)).toMatchObject({ w: 100, h: 16 });
  });

  test("the PNG has no alpha channel, like the CLI's (gray or RGB)", async () => {
    const r = await renderer();
    const [png] = await r.renderBoxes(await fractionPdf(), [BAR], 144);
    expect([0, 2]).toContain(ihdr(png!).colourType);
  });

  test("the box over the fraction bar carries ink", async () => {
    const r = await renderer();
    const [png] = await r.renderBoxes(await fractionPdf(), [BAR], 144);
    expect(await darkCount(png!)).toBeGreaterThan(100 * 2);
  });

  test("boxes are placed in PDF coordinates, so an empty corner stays white", async () => {
    const r = await renderer();
    const [png] = await r.renderBoxes(await fractionPdf(), [EMPTY], 72);
    expect(await darkCount(png!)).toBe(0);
  });

  test("text glyphs render inside a box that holds only a letter", async () => {
    const r = await renderer();
    const [png] = await r.renderBoxes(await fractionPdf(), [LETTER_A], 144);
    expect(await darkCount(png!)).toBeGreaterThan(50);
  });

  test("pixels are opaque: an empty area is flattened to white", async () => {
    const r = await renderer();
    const [png] = await r.renderBoxes(await fractionPdf(), [EMPTY], 72);
    const d = await pixels(png!);
    expect(d.every((v) => v === 255)).toBe(true);
  });

  test("results follow the order of the boxes", async () => {
    const r = await renderer();
    const out = await r.renderBoxes(await fractionPdf(), [EMPTY, BAR], 72);
    expect(out.map((p) => ({ w: ihdr(p!).w, h: ihdr(p!).h }))).toEqual([
      { w: 50, h: 50 },
      { w: 50, h: 8 },
    ]);
  });

  test("a box that cannot render is null and the others still render", async () => {
    const r = await renderer();
    const out = await r.renderBoxes(await fractionPdf(), [{ ...BAR, page: 9 }, BAR], 72);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeInstanceOf(Uint8Array);
  });

  test("an aborted signal rejects with its reason", async () => {
    const r = await renderer();
    const ac = new AbortController();
    ac.abort(new Error("stop"));
    await expect(r.renderBoxes(await fractionPdf(), [BAR], 72, ac.signal)).rejects.toThrow("stop");
  });

  test("an unreadable PDF gives null for every box", async () => {
    const r = await renderer();
    expect(await r.renderBoxes(new TextEncoder().encode("not a pdf"), [BAR, EMPTY], 72)).toEqual([null, null]);
  });
});
