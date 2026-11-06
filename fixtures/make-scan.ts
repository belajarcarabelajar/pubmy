// Builds an image-only (scanned-looking) two-page PDF from original Indonesian and English text.
// Run directly to write fixtures/out/scan.pdf; tests import makeScan() and SCAN_PAGES instead.
import { existsSync } from "node:fs";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";

/** Source text per page; paragraphs are separated by a blank line. Written for pubmy, no third-party text. */
export const SCAN_PAGES: string[] = [
  [
    "Perpustakaan kecil di ujung desa itu dibuka setiap hari Sabtu. Pengurusnya seorang guru pensiunan yang mencatat setiap buku dengan tangan, lalu menempelkan nomor rak pada punggung buku memakai lem kanji.",
    "Anak anak datang membawa buku pinjaman minggu lalu dan pulang dengan dua buku baru. Mereka paling suka cerita tentang laut, peta harta karun, dan hewan yang bisa berbicara.",
    "The library at the edge of the village opens every Saturday. Its keeper records each book by hand and writes the shelf number on a small paper label.",
  ].join("\n\n"),
  [
    "Pada musim hujan atap ruang baca sering bocor, sehingga buku yang paling tua dipindahkan ke lemari kayu di dekat jendela. Relawan dari kota membantu menyalin halaman yang mulai rapuh.",
    "Sekarang perpustakaan itu menyimpan lebih dari dua ribu judul, termasuk kamus, buku resep, dan majalah pertanian yang dibaca para petani setelah panen.",
    "Volunteers from the city now scan the oldest pages so that the stories survive the rain, and the children help sort the copies by color and size.",
  ].join("\n\n"),
];

const FONT_CANDIDATES = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
  "/usr/share/fonts/TTF/DejaVuSerif.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
  "/usr/share/fonts/liberation/LiberationSerif-Regular.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/TTF/DejaVuSans.ttf",
];

function registerFont(): string {
  for (const path of FONT_CANDIDATES) {
    if (existsSync(path) && GlobalFonts.registerFromPath(path, "PubmyScan")) return "PubmyScan";
  }
  throw new Error(`make-scan: no usable font, looked in ${FONT_CANDIDATES.join(", ")}`);
}

// Seeded so the fixture bytes and the OCR result repeat run to run.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A5 at 200 dpi.
const W = 1166;
const H = 1654;
const MARGIN = 100;
const FONT_PX = 30;
const LINE_PX = 44;
const TILT_DEG = 0.6;

async function renderPage(text: string, family: string, rand: () => number): Promise<Uint8Array> {
  const canvas = createCanvas(W, H);
  const g = canvas.getContext("2d");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, W, H);
  g.translate(W / 2, H / 2);
  g.rotate((TILT_DEG * Math.PI) / 180);
  g.translate(-W / 2, -H / 2);
  g.fillStyle = "#151515";
  g.font = `${FONT_PX}px ${family}`;
  let y = MARGIN + FONT_PX;
  for (const para of text.split("\n\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (g.measureText(next).width > W - 2 * MARGIN && line) {
        g.fillText(line, MARGIN, y);
        y += LINE_PX;
        line = word;
      } else line = next;
    }
    g.fillText(line, MARGIN, y);
    y += LINE_PX * 1.5;
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  const img = g.getImageData(0, 0, W, H);
  const px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    const r = rand();
    const v = r < 0.002 ? 90 + rand() * 120 : px[i] + (rand() - 0.5) * 24;
    px[i] = px[i + 1] = px[i + 2] = Math.max(0, Math.min(255, v));
  }
  g.putImageData(img, 0, 0);
  return new Uint8Array(await canvas.encode("jpeg", 80));
}

/** Returns the bytes of a PDF whose pages each hold one full-page JPEG and no text layer. */
export async function makeScan(): Promise<Uint8Array> {
  const family = registerFont();
  const rand = mulberry32(20261107);
  const doc = await PDFDocument.create();
  for (const text of SCAN_PAGES) {
    const jpg = await doc.embedJpg(await renderPage(text, family, rand));
    const page = doc.addPage([420, 595]);
    page.drawImage(jpg, { x: 0, y: 0, width: 420, height: 595 });
  }
  return doc.save({ useObjectStreams: false });
}

if (import.meta.main) {
  const out = `${import.meta.dir}/out/scan.pdf`;
  await Bun.write(out, await makeScan());
  console.log(`wrote ${out}`);
}
