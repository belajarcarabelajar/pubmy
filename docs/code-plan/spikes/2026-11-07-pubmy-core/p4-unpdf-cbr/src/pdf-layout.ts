// Question (a): does unpdf under Bun give text items with enough geometry/font info to rebuild two-column reading order and detect headings by size, and does inspectPages flag an image-only page?
// Usage: bun src/pdf-layout.ts <two-column.pdf> <scanned.pdf>
import { extractTextItems, getDocumentProxy, inspectPages } from "unpdf";
import { bodyFontSize, headings, readingOrder, type Line } from "./layout";

const [pdfPath, scanPath] = process.argv.slice(2);
if (!pdfPath || !scanPath) throw new Error("usage: pdf-layout.ts <two-column.pdf> <scanned.pdf>");

const doc = await getDocumentProxy(new Uint8Array(await Bun.file(pdfPath).arrayBuffer()));
const { items } = await extractTextItems(doc);
const all: Line[] = [];
for (const p of [1, 2]) {
  const page = await doc.getPage(p);
  const [, , w] = page.view;
  // unpdf's StructuredTextItem drops the transform, so rotation comes from raw pdf.js getTextContent
  const rotatedKeys = new Set<string>();
  for (const r of (await page.getTextContent()).items as { str?: string; transform?: number[] }[])
    if (r.transform && (r.transform[1] !== 0 || r.transform[2] !== 0)) rotatedKeys.add(`${r.str}|${r.transform[4]}|${r.transform[5]}`);
  const pageItems = items[p - 1].map((i) => ({ ...i, rotated: rotatedKeys.has(`${i.str}|${i.x}|${i.y}`) }));
  console.log(`  rotated items dropped: ${pageItems.filter((i) => i.rotated).map((i) => i.str).join(" | ") || "none"}`);
  const fams = new Map<string, number>();
  for (const i of pageItems) fams.set(`${i.fontFamily}@${i.fontSize.toFixed(2)}`, (fams.get(`${i.fontFamily}@${i.fontSize.toFixed(2)}`) ?? 0) + i.str.length);
  console.log(`page ${p}: width=${w} items=${pageItems.length} dirs=${[...new Set(pageItems.map((i) => i.dir))]}`);
  console.log(`  family@size -> chars: ${[...fams].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  console.log(`  sample item: ${JSON.stringify(pageItems.find((i) => i.str.length > 20))}`);
  all.push(...readingOrder(pageItems, w));
}
console.log(`\nbody font size (char-weighted median): ${bodyFontSize(all)}`);
console.log("\n--- first 40 reconstructed lines ---");
all.slice(0, 40).forEach((l, n) => console.log(`${String(n + 1).padStart(2)} [${l.region[0]} ${l.fontSize.toFixed(1)}] ${l.text}`));
console.log("\n--- headings (size > median*1.2) ---");
for (const h of headings(all)) console.log(`[${h.fontSize.toFixed(1)}] ${h.text}`);
console.log("\n--- lines at size 11.5-14 (candidates the 1.2 rule may miss) ---");
for (const l of all.filter((l) => l.fontSize >= 11.5 && l.fontSize <= 14 && l.text.length < 60)) console.log(`[${l.fontSize.toFixed(1)}] ${l.text}`);

for (const [label, path] of [["born-digital", pdfPath], ["scanned", scanPath]] as const) {
  const r = await inspectPages(new Uint8Array(await Bun.file(path).arrayBuffer()));
  console.log(`\ninspectPages ${label}: totalPages=${r.totalPages} first pages=${JSON.stringify(r.pages.slice(0, 2))}`);
}
