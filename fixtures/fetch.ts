// Downloads the pinned fixtures listed in fixtures/sources/*.json into fixtures/out/dl/
// and checks each sha256. Exit 1 when any download fails or a hash does not match.
// An entry with "uudecode": true is uudecoded after download; its sha256 is of the decoded bytes.
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

interface Source {
  name: string;
  url: string;
  sha256: string;
  uudecode?: boolean;
}

const sha256 = (b: Uint8Array) => new Bun.CryptoHasher("sha256").update(b).digest("hex");

/** Decodes the body of a uuencoded file (between the "begin" and "end" lines). */
export function uudecode(text: string): Uint8Array {
  const out: number[] = [];
  let begun = false;
  for (const line of text.split(/\r?\n/)) {
    if (!begun) {
      begun = /^begin\s/.test(line);
      continue;
    }
    if (line === "end") return Uint8Array.from(out);
    if (!line) continue;
    const n = (line.charCodeAt(0) - 32) & 63;
    const six = (i: number) => ((line.charCodeAt(i) || 32) - 32) & 63;
    const bytes: number[] = [];
    for (let i = 1; bytes.length < n; i += 4) {
      const [a, b, c, d] = [six(i), six(i + 1), six(i + 2), six(i + 3)];
      bytes.push((a << 2) | (b >> 4), ((b & 15) << 4) | (c >> 2), ((c & 3) << 6) | d);
    }
    out.push(...bytes.slice(0, n));
  }
  throw new Error(begun ? "uudecode: missing end line" : "uudecode: missing begin line");
}

export async function fetchFixtures(sourcesDir: string, outDir: string, fetchImpl: typeof fetch = fetch): Promise<number> {
  if (!existsSync(sourcesDir)) return 0;
  let failed = 0;
  for (const file of readdirSync(sourcesDir).filter((f) => f.endsWith(".json")).sort()) {
    const sources = [JSON.parse(readFileSync(join(sourcesDir, file), "utf8"))].flat() as Source[];
    for (const s of sources) {
      if (!s.name || basename(s.name) !== s.name) {
        console.error(`${file}: bad fixture name ${JSON.stringify(s.name)}`);
        failed++;
        continue;
      }
      const dest = join(outDir, s.name);
      const want = s.sha256.toLowerCase();
      if (existsSync(dest) && sha256(new Uint8Array(readFileSync(dest))) === want) continue;
      const res = await fetchImpl(s.url);
      if (!res.ok) {
        console.error(`${s.name}: HTTP ${res.status} from ${s.url}`);
        failed++;
        continue;
      }
      const raw = new Uint8Array(await res.arrayBuffer());
      let bytes: Uint8Array = raw;
      if (s.uudecode) {
        try {
          bytes = uudecode(new TextDecoder().decode(raw));
        } catch (e) {
          console.error(`${s.name}: ${(e as Error).message}`);
          failed++;
          continue;
        }
      }
      const got = sha256(bytes);
      if (got !== want) {
        console.error(`${s.name}: sha256 mismatch, expected ${want}, got ${got}`);
        failed++;
        continue;
      }
      mkdirSync(outDir, { recursive: true });
      await Bun.write(dest, bytes);
    }
  }
  return failed > 0 ? 1 : 0;
}

if (import.meta.main) {
  process.exit(await fetchFixtures(join(import.meta.dir, "sources"), join(import.meta.dir, "out", "dl")));
}
