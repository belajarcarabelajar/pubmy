// Question: can the official pandoc WASM build turn HTML plus one embedded PNG into a valid EPUB 3 under Bun, and how big is the .wasm?
import { deflateSync } from "node:zlib";
import { EpubCheck } from "@likecoin/epubcheck-ts";
import { htmlToEpub, type PandocConvert } from "./convert.ts";

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

// 16x16 RGB gradient, built by hand so no image dependency is needed.
function makePng(w = 16, h = 16): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const raw = new Uint8Array(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    for (let x = 0; x < w; x++) {
      const i = y * (1 + w * 3) + 1 + x * 3;
      raw[i] = x * 16;
      raw[i + 1] = y * 16;
      raw[i + 2] = 128;
    }
  }
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { png.set(p, o); o += p.length; }
  return png;
}

const html = `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8"><title>Buku Uji</title></head>
<body>
<h1>Bab Satu</h1>
<p>Paragraf pertama dengan catatan kaki.<a href="#fn1" class="footnote-ref" id="fnref1" role="doc-noteref"><sup>1</sup></a></p>
<p>Paragraf kedua.</p>
<h2>Subbab Gambar</h2>
<p><img src="img.png" alt="Gradien uji"></p>
<h2>Subbab Tabel</h2>
<table><thead><tr><th>Nama</th><th>Nilai</th></tr></thead>
<tbody><tr><td>A</td><td>1</td></tr><tr><td>B</td><td>2</td></tr></tbody></table>
<h1>Bab Dua</h1>
<p>Penutup.</p>
<section class="footnotes" role="doc-endnotes"><hr><ol>
<li id="fn1"><p>Isi catatan kaki.<a href="#fnref1" class="footnote-back" role="doc-backlink">↩</a></p></li>
</ol></section>
</body></html>`;

const tLoad = performance.now();
const { convert } = (await import("pandoc-wasm")) as { convert: PandocConvert };
const loadMs = performance.now() - tLoad;

const t0 = performance.now();
const res = await htmlToEpub(convert, {
  html,
  title: "Buku Uji",
  lang: "id",
  resources: { "img.png": new Blob([makePng()], { type: "image/png" }) },
});
const convMs = performance.now() - t0;

await Bun.write(new URL("./out.epub", import.meta.url), res.epub);

const check = await EpubCheck.validate(res.epub, undefined, "out.epub");
console.log(JSON.stringify({
  wasmLoadAndInstantiateMs: Math.round(loadMs),
  conversionMs: Math.round(convMs),
  epubBytes: res.epub.length,
  pandocStderr: res.stderr,
  pandocWarnings: res.warnings,
  epubcheck: {
    valid: check.valid,
    fatal: check.fatalCount,
    errors: check.errorCount,
    warnings: check.warningCount,
    info: check.infoCount,
  },
}, null, 2));
for (const m of check.messages) {
  if (m.severity !== "info" && m.severity !== "usage") console.log(`${m.severity} ${m.id}: ${m.message}`);
}
