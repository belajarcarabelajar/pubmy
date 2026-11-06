import { createWorker } from "tesseract.js";
import { simd, relaxedSimd } from "wasm-feature-detect";
import { pages } from "./pages";

const dir = import.meta.dir;
const prefix = process.argv[2] ?? "page";

// Whitespace and line breaks differ by layout, not by recognition quality, so they are collapsed.
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

console.log(`bun ${Bun.version}; wasm simd=${await simd()} relaxedSimd=${await relaxedSimd()}`);
const t0 = performance.now();
const worker = await createWorker("ind+eng", 1, { cachePath: `${dir}/cache` });
const tInit = performance.now() - t0;
console.log(`createWorker(ind+eng): ${(tInit / 1000).toFixed(2)} s`);

let total = 0;
for (let i = 0; i < pages.length; i++) {
  const img = `${dir}/${prefix}${i + 1}.png`;
  const t = performance.now();
  const { data } = await worker.recognize(img);
  const dt = performance.now() - t;
  total += dt;
  await Bun.write(`${dir}/out-${prefix}${i + 1}.txt`, data.text);
  const ref = norm(pages[i]);
  const hyp = norm(data.text);
  const cer = levenshtein(ref, hyp) / ref.length;
  console.log(`${prefix}${i + 1}: ${(dt / 1000).toFixed(2)} s, conf ${data.confidence}, CER ${(cer * 100).toFixed(2)}% (${ref.length} ref chars)`);
}
await worker.terminate();
console.log(`recognize total: ${(total / 1000).toFixed(2)} s, mean ${(total / pages.length / 1000).toFixed(2)} s/page; wall incl. init ${((performance.now() - t0) / 1000).toFixed(2)} s`);
