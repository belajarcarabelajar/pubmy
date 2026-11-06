// Writes fixtures/out/comic.cbz: three generated PNG pages plus a ComicInfo.xml that the
// comics adapter must ignore. Page names are stored out of order (p10, p1, p2) so natural
// sorting is exercised. No dependencies: fixtures/ sits outside the workspace packages, so
// fflate does not resolve here; PNG data uses zlib stored blocks and the zip uses method 0.
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** zlib stream made of stored (uncompressed) deflate blocks. */
function zlibStored(data: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [Uint8Array.of(0x78, 0x01)];
  for (let off = 0; off < data.length || off === 0; off += 0xffff) {
    const block = data.subarray(off, off + 0xffff);
    const last = off + 0xffff >= data.length ? 1 : 0;
    const head = Uint8Array.of(last, block.length & 0xff, block.length >> 8, ~block.length & 0xff, (~block.length >> 8) & 0xff);
    parts.push(head, block);
    if (data.length === 0) break;
  }
  let a = 1;
  let b = 0;
  for (const x of data) {
    a = (a + x) % 65521;
    b = (b + a) % 65521;
  }
  const adler = new Uint8Array(4);
  new DataView(adler.buffer).setUint32(0, ((b << 16) | a) >>> 0);
  return concat([...parts, adler]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A solid-colour 8-bit RGB PNG of the given size. */
export function makePng(width: number, height: number, rgb: [number, number, number]): Uint8Array {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8); // bit depth 8, colour type RGB, deflate, no filter, no interlace
  const row = 1 + width * 3;
  const raw = new Uint8Array(row * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) raw.set(rgb, y * row + 1 + x * 3); // filter byte 0 per row
  }
  return concat([
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlibStored(raw)),
    chunk("IEND", new Uint8Array()),
  ]);
}

/** A zip with every entry stored (method 0), in the given order. */
export function storedZip(files: Record<string, Uint8Array>): Uint8Array {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const n = new TextEncoder().encode(name);
    const crc = crc32(data);
    const lh = new Uint8Array(30 + n.length);
    const l = new DataView(lh.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, data.length, true);
    l.setUint32(22, data.length, true);
    l.setUint16(26, n.length, true);
    lh.set(n, 30);
    const ch = new Uint8Array(46 + n.length);
    const c = new DataView(ch.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, n.length, true);
    c.setUint32(42, offset, true);
    ch.set(n, 46);
    local.push(lh, data);
    central.push(ch);
    offset += lh.length + data.length;
  }
  const cd = concat(central);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, central.length, true);
  e.setUint16(10, central.length, true);
  e.setUint32(12, cd.length, true);
  e.setUint32(16, offset, true);
  return concat([...local, cd, end]);
}

/** The fixture comic: pages p1, p2, p10 (60x90 px), stored as p10, p1, p2, plus ComicInfo.xml. */
export function makeCbz(): Uint8Array {
  return storedZip({
    "pages/p10.png": makePng(60, 90, [0, 0, 200]),
    "pages/p1.png": makePng(60, 90, [200, 0, 0]),
    "pages/p2.png": makePng(60, 90, [0, 200, 0]),
    "ComicInfo.xml": new TextEncoder().encode(`<?xml version="1.0"?><ComicInfo><Title>Fixture</Title></ComicInfo>`),
  });
}

if (import.meta.main) {
  const out = join(import.meta.dir, "out");
  mkdirSync(out, { recursive: true });
  await Bun.write(join(out, "comic.cbz"), makeCbz());
  console.log(join(out, "comic.cbz"));
}
