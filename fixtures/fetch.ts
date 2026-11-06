// Downloads the pinned fixtures listed in fixtures/sources/*.json into fixtures/out/dl/
// and checks each sha256. Exit 1 when any download fails or a hash does not match.
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

interface Source {
  name: string;
  url: string;
  sha256: string;
}

const sha256 = (b: Uint8Array) => new Bun.CryptoHasher("sha256").update(b).digest("hex");

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
      const bytes = new Uint8Array(await res.arrayBuffer());
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
