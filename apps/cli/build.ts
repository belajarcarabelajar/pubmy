// Builds the self-contained skill: skills/pubmy/scripts/pubmy.js, tesseract-worker.js, the OCR wasm files and
// the ind+eng language data (tesseract-lang/).
// Run: bun run --cwd apps/cli build   (or: bun apps/cli/build.ts)
import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { OCR_FILES, ocrSource } from "../web/src/ocr-assets.ts";

const repo = join(import.meta.dir, "../..");
const outDir = join(repo, "skills/pubmy/scripts");

const JSON_REQUIRE = /\brequire\((["'])([^"']+\.json)\1\)/g;

/** Rewrites `require('<x>.json')` into static JSON imports so the bundler can inline the data. */
export function inlineJsonRequires(src: string): string {
  const imports: string[] = [];
  const body = src.replace(JSON_REQUIRE, (_m, _q, spec: string) => {
    const id = `__pubmy_json_${imports.length}`;
    imports.push(`import ${id} from ${JSON.stringify(spec)} with { type: "json" };`);
    return id;
  });
  return imports.length ? `${imports.join("\n")}\n${body}` : src;
}

// Every bundle starts with this line, so rewritten modules can find the folder that holds the bundled scripts.
const BANNER = "const __PUBMY_DIR__ = import.meta.dir;";

function replaceOnce(src: string, from: string, to: string, file: string): string {
  if (!src.includes(from)) throw new Error(`build: expected text not found in ${file}; tesseract.js changed, update apps/cli/build.ts`);
  return src.split(from).join(to);
}

const plugin: Bun.BunPlugin = {
  name: "pubmy-skill-paths",
  setup(b) {
    // css-tree (used by the EPUB validator) loads its data through createRequire(import.meta.url) at run time,
    // which Bun.build leaves as a lookup of files that do not exist beside pubmy.js.
    b.onLoad({ filter: /[\\/]css-tree[\\/]lib[\\/].*\.js$/ }, async (args) => ({
      contents: inlineJsonRequires(await Bun.file(args.path).text()),
      loader: "js",
    }));
    // tesseract.js spawns its worker from a path next to its own source file, which does not exist in the bundle.
    b.onLoad({ filter: /[\\/]tesseract\.js[\\/]src[\\/]worker[\\/]node[\\/]defaultOptions\.js$/ }, async (args) => ({
      contents: replaceOnce(
        await Bun.file(args.path).text(),
        "path.join(__dirname, '..', '..', 'worker-script', 'node', 'index.js')",
        "path.join(__PUBMY_DIR__, 'tesseract-worker.js')",
        args.path,
      ),
      loader: "js",
    }));
    // The tesseract core reads its .wasm from its own folder; the build copies the wasm files beside the worker.
    b.onLoad({ filter: /[\\/]tesseract\.js-core[\\/]tesseract-core[^\\/]*\.js$/ }, async (args) => ({
      contents: replaceOnce(await Bun.file(args.path).text(), "__dirname", "__PUBMY_DIR__", args.path),
      loader: "js",
    }));
  },
};

async function bundle(entry: string, naming: string): Promise<void> {
  const res = await Bun.build({
    entrypoints: [entry],
    outdir: outDir,
    naming,
    target: "bun",
    format: "esm",
    minify: true,
    banner: BANNER,
    plugins: [plugin],
  });
  if (!res.success) {
    for (const log of res.logs) console.error(log);
    throw new Error(`build failed for ${entry}`);
  }
}

export async function build(): Promise<string[]> {
  // Stale files from an earlier build would otherwise ship inside the skill folder.
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  await bundle(join(repo, "apps/cli/src/main.ts"), "pubmy.js");

  // tesseract.js runs OCR in a worker thread loaded from a separate file, so it cannot live inside pubmy.js.
  const worker = Bun.resolveSync("tesseract.js/src/worker-script/node/index.js", join(repo, "packages/core"));
  await bundle(worker, "tesseract-worker.js");

  // The worker picks its core by CPU SIMD support and OEM at run time (a probe loaded the non-LSTM
  // tesseract-core-relaxedsimd.wasm), so every core wasm ships.
  const coreDir = dirname(Bun.resolveSync("tesseract.js-core/package.json", dirname(worker)));
  for (const f of (await readdir(coreDir)).filter((n) => n.endsWith(".wasm"))) {
    await copyFile(join(coreDir, f), join(outDir, f));
  }

  // Bundled so the skill never fetches language data from a CDN without a checksum; the same lockfile-pinned
  // @tesseract.js-data files the web build serves. scripts/pack-skill.test.ts pins their sha256.
  await mkdir(join(outDir, "tesseract-lang"), { recursive: true });
  for (const f of OCR_FILES.filter((x) => x.to.startsWith("tesseract/lang/"))) {
    await copyFile(ocrSource(f, join(repo, "apps/web")), join(outDir, "tesseract-lang", basename(f.to)));
  }

  const files = (await readdir(outDir, { recursive: true })).sort();
  for (const f of files) console.log(`${f}\t${(await stat(join(outDir, f))).size} B`);
  return files;
}

if (import.meta.main) {
  await build();
}
