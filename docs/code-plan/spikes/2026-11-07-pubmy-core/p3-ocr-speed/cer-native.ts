// Usage: bun cer-native.ts; CER of native tesseract outputs against the same reference text.
import { pages } from "./pages";
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const lev = (a: string, b: string) => { let p = [...Array(b.length + 1).keys()]; for (let i = 1; i <= a.length; i++) { const c = [i]; for (let j = 1; j <= b.length; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; } return p[b.length]; };
for (let i = 0; i < 3; i++) { const r = norm(pages[i]); const h = norm(await Bun.file(`${import.meta.dir}/native-page${i + 1}.txt`).text()); console.log(`native page${i + 1} CER ${(lev(r, h) / r.length * 100).toFixed(2)}%`); }
