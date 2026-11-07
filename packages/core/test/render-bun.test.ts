import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzlibSync } from "fflate";
import { PDFDocument, rgb } from "pdf-lib";
import { hostCanvasPlatform, loadRendererBun } from "../src/render/bun.ts";
import { CANVAS_PINS, canvasPlatform, ensureCanvas } from "../src/render/fetch-canvas.ts";

const scratch = () => mkdtempSync(join(tmpdir(), "pubmy-render-bun-"));

/** One ustar entry per file, the layout npm uses (everything under "package/"). */
function tgz(files: Record<string, string>): Uint8Array {
  const parts: Uint8Array[] = [];
  const enc = new TextEncoder();
  for (const [name, text] of Object.entries(files)) {
    const body = enc.encode(text);
    const h = new Uint8Array(512);
    const put = (at: number, s: string) => h.set(enc.encode(s), at);
    put(0, `package/${name}`);
    put(100, "0000644\0");
    put(108, "0000000\0");
    put(116, "0000000\0");
    put(124, `${body.length.toString(8).padStart(11, "0")}\0`);
    put(136, "00000000000\0");
    put(148, "        ");
    h[156] = 48;
    put(257, "ustar\0");
    put(263, "00");
    const sum = h.reduce((n, b) => n + b, 0);
    put(148, `${sum.toString(8).padStart(6, "0")}\0 `);
    parts.push(h, body, new Uint8Array(Math.ceil(body.length / 512) * 512 - body.length));
  }
  parts.push(new Uint8Array(1024));
  const tar = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    tar.set(p, at);
    at += p.length;
  }
  return Bun.gzipSync(tar);
}

const sri = (b: Uint8Array) => `sha512-${new Bun.CryptoHasher("sha512").update(b).digest("base64")}`;

const MAIN = tgz({ "index.js": "module.exports = 1;", "README.md": "skip me" });
const NATIVE = tgz({ "skia.linux-x64-gnu.node": "not really a library", "package.json": "{}" });

function fakeRegistry(bodies: Record<string, Uint8Array>) {
  const calls: string[] = [];
  const fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const hit = Object.entries(bodies).find(([pkg]) => url.endsWith(`/${pkg}-1.1.0.tgz`));
    return hit ? new Response(new Uint8Array(hit[1])) : new Response("not found", { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const quiet = () => {};

describe("canvasPlatform", () => {
  test("maps OS, CPU and libc to the @napi-rs/canvas platform package", () => {
    expect([
      canvasPlatform("linux", "x64", "gnu"),
      canvasPlatform("linux", "x64", "musl"),
      canvasPlatform("linux", "arm64", "gnu"),
      canvasPlatform("linux", "arm64", "musl"),
      canvasPlatform("darwin", "x64"),
      canvasPlatform("darwin", "arm64"),
      canvasPlatform("win32", "x64"),
    ]).toEqual(["linux-x64-gnu", "linux-x64-musl", "linux-arm64-gnu", "linux-arm64-musl", "darwin-x64", "darwin-arm64", "win32-x64-msvc"]);
  });

  test("has no package for an unsupported OS or CPU", () => {
    expect([canvasPlatform("win32", "arm64"), canvasPlatform("freebsd", "x64"), canvasPlatform("linux", "ia32", "gnu")]).toEqual([null, null, null]);
  });

  test("pins the registry integrity of the wrapper and all seven platform packages", () => {
    expect(Object.keys(CANVAS_PINS).length).toBe(8);
    // Literal copied from the spike, which fetched and verified this tarball.
    expect(CANVAS_PINS["canvas-linux-x64-gnu"]).toBe("sha512-uQ9JuJlRhQdHyttcMWOiwLkfIqkqaB0YFUVe835LUe12THt2b51HXkTItq0fxWT1jdhUPX2ylWZ1walkJyD6GQ==");
  });
});

describe("ensureCanvas", () => {
  const pins = { canvas: sri(MAIN), "canvas-linux-x64-gnu": sri(NATIVE) };

  test("a verified download lands the wrapper js and the native library in the cache", async () => {
    const cacheDir = join(scratch(), "linux-x64-gnu");
    const { fetch } = fakeRegistry({ canvas: MAIN, "canvas-linux-x64-gnu": NATIVE });
    const got = await ensureCanvas({ key: "linux-x64-gnu", cacheDir, fetch, pins, onDownload: quiet });
    expect(got).toEqual({ mainDir: join(cacheDir, "main"), nodeFile: join(cacheDir, "skia.linux-x64-gnu.node") });
    expect(await Bun.file(join(cacheDir, "main/index.js")).text()).toBe("module.exports = 1;");
    expect(await Bun.file(join(cacheDir, "skia.linux-x64-gnu.node")).text()).toBe("not really a library");
    expect(existsSync(join(cacheDir, "main/README.md"))).toBe(false);
  });

  test("a second call uses the cache without fetching", async () => {
    const cacheDir = join(scratch(), "linux-x64-gnu");
    await ensureCanvas({ key: "linux-x64-gnu", cacheDir, fetch: fakeRegistry({ canvas: MAIN, "canvas-linux-x64-gnu": NATIVE }).fetch, pins, onDownload: quiet });
    const again = fakeRegistry({});
    const got = await ensureCanvas({ key: "linux-x64-gnu", cacheDir, fetch: again.fetch, pins, onDownload: quiet });
    expect({ calls: again.calls.length, got }).toEqual({ calls: 0, got: { mainDir: join(cacheDir, "main"), nodeFile: join(cacheDir, "skia.linux-x64-gnu.node") } });
  });

  test("a hash mismatch returns null and leaves no cache or temp folder behind", async () => {
    const parent = scratch();
    const cacheDir = join(parent, "linux-x64-gnu");
    const { fetch } = fakeRegistry({ canvas: MAIN, "canvas-linux-x64-gnu": tgz({ "skia.linux-x64-gnu.node": "tampered" }) });
    const got = await ensureCanvas({ key: "linux-x64-gnu", cacheDir, fetch, pins, onDownload: quiet });
    expect({ got, left: readdirSync(parent) }).toEqual({ got: null, left: [] });
  });

  test("offline returns null", async () => {
    const parent = scratch();
    const fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof globalThis.fetch;
    const got = await ensureCanvas({ key: "linux-x64-gnu", cacheDir: join(parent, "linux-x64-gnu"), fetch, pins, onDownload: quiet });
    expect({ got, left: readdirSync(parent) }).toEqual({ got: null, left: [] });
  });

  test("reports the downloaded size and destination once", async () => {
    const cacheDir = join(scratch(), "linux-x64-gnu");
    const seen: { bytes: number; dest: string }[] = [];
    const reg = { canvas: MAIN, "canvas-linux-x64-gnu": NATIVE };
    await ensureCanvas({ key: "linux-x64-gnu", cacheDir, fetch: fakeRegistry(reg).fetch, pins, onDownload: (i) => seen.push(i) });
    await ensureCanvas({ key: "linux-x64-gnu", cacheDir, fetch: fakeRegistry(reg).fetch, pins, onDownload: (i) => seen.push(i) });
    expect(seen).toEqual([{ bytes: MAIN.length + NATIVE.length, dest: cacheDir }]);
  });
});

describe("loadRendererBun", () => {
  test("returns null on an unsupported platform without fetching", async () => {
    const reg = fakeRegistry({});
    expect(await loadRendererBun({ cacheDir: scratch(), fetch: reg.fetch, platform: "sunos-x64" })).toBeNull();
    expect(reg.calls.length).toBe(0);
  });

  test("returns null when the download does not match the pinned hashes", async () => {
    const parent = scratch();
    const reg = fakeRegistry({ canvas: MAIN, "canvas-linux-x64-gnu": NATIVE });
    expect(await loadRendererBun({ cacheDir: join(parent, "c"), fetch: reg.fetch, platform: "linux-x64-gnu" })).toBeNull();
    expect(readdirSync(parent)).toEqual([]);
  });
});

/** Decodes an 8-bit gray or RGB PNG (any filter) to its size, colour type and pixel rows. */
function decodePng(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let w = 0;
  let h = 0;
  let type = -1;
  const idat: Uint8Array[] = [];
  for (let at = 8; at < png.length; ) {
    const len = view.getUint32(at);
    const name = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const body = png.subarray(at + 8, at + 8 + len);
    if (name === "IHDR") {
      w = view.getUint32(at + 8);
      h = view.getUint32(at + 12);
      type = body[9];
    }
    if (name === "IDAT") idat.push(body);
    at += len + 12;
  }
  const ch = type === 0 ? 1 : type === 2 ? 3 : 4;
  const raw = unzlibSync(Buffer.concat(idat));
  const stride = w * ch;
  const px = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? px[y * stride + i - ch] : 0;
      const b = y > 0 ? px[(y - 1) * stride + i] : 0;
      const c = y > 0 && i >= ch ? px[(y - 1) * stride + i - ch] : 0;
      const p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      const pred = [0, a, b, (a + b) >> 1, paeth][f];
      px[y * stride + i] = (raw[y * (stride + 1) + 1 + i] + pred) & 255;
    }
  }
  const at = (x: number, y: number) => px[(y * w + x) * ch];
  return { w, h, type, at, allWhite: px.every((v) => v === 255) };
}

/** 200 x 200 page with a black rectangle at x 50..150, y 50..100 (PDF points, origin bottom-left). */
async function boxPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([200, 200]);
  page.drawRectangle({ x: 50, y: 50, width: 100, height: 50, color: rgb(0, 0, 0) });
  return pdf.save();
}

// Downloads about 15 MB from registry.npmjs.org; PUBMY_OFFLINE=1 skips it.
describe.skipIf(process.env.PUBMY_OFFLINE === "1")("loadRendererBun with the real canvas", () => {
  const cacheDir = scratch();
  let renderer: Awaited<ReturnType<typeof loadRendererBun>> = null;

  test(
    "downloads the canvas and renders a crop at the dpi asked for",
    async () => {
      renderer = await loadRendererBun({ cacheDir });
      expect(renderer).not.toBeNull();
      const [png] = await renderer!.renderBoxes(await boxPdf(), [{ page: 1, x0: 40, y0: 40, x1: 160, y1: 110 }], 144);
      const img = decodePng(png!);
      // 120 x 70 points at 144 dpi (2 px per point).
      expect({ w: img.w, h: img.h, noAlpha: img.type === 0 || img.type === 2, allWhite: img.allWhite }).toEqual({ w: 240, h: 140, noAlpha: true, allWhite: false });
      // The rectangle starts 10 points in from the crop's left and top edges.
      expect({ corner: img.at(5, 5), inside: img.at(120, 70), below: img.at(120, 130) }).toEqual({ corner: 255, inside: 0, below: 255 });
    },
    180_000,
  );

  test("returns null for a box on a page the PDF does not have", async () => {
    expect(renderer).not.toBeNull();
    const out = await renderer!.renderBoxes(await boxPdf(), [{ page: 9, x0: 0, y0: 0, x1: 10, y1: 10 }, { page: 1, x0: 0, y0: 0, x1: 10, y1: 10 }], 72);
    expect(out.map((p) => (p ? "png" : null))).toEqual([null, "png"]);
    await renderer!.close();
  });

  test(
    "a corrupt cached library is downloaded again",
    async () => {
      const key = hostCanvasPlatform()!;
      const dir = scratch();
      cpSync(join(cacheDir, key), join(dir, key), { recursive: true });
      const nodeFile = join(dir, key, `skia.${key}.node`);
      writeFileSync(nodeFile, "truncated");
      const again = await loadRendererBun({ cacheDir: dir, onDownload: quiet });
      expect({ loaded: again !== null, restored: statSync(nodeFile).size > 1_000_000 }).toEqual({ loaded: true, restored: true });
      await again?.close();
    },
    180_000,
  );
});
