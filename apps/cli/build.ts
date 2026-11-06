// Builds the self-contained skill script: skills/pubmy/scripts/pubmy.js (plus the OCR worker when tesseract.js is installed).
// Run: bun run --cwd apps/cli build   (or: bun apps/cli/build.ts)
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

const repo = join(import.meta.dir, "../..");
const outDir = join(repo, "skills/pubmy/scripts");

function tryResolve(spec: string, from: string): string | undefined {
  try {
    return Bun.resolveSync(spec, from);
  } catch {
    return undefined;
  }
}

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

// css-tree (used by the EPUB validator) loads its data through createRequire(import.meta.url) at run time,
// which Bun.build leaves as a runtime lookup of files that do not exist beside pubmy.js.
const inlineCssTreeJson: Bun.BunPlugin = {
  name: "inline-css-tree-json",
  setup(b) {
    b.onLoad({ filter: /[\\/]css-tree[\\/]lib[\\/].*\.js$/ }, async (args) => ({
      contents: inlineJsonRequires(await Bun.file(args.path).text()),
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
    plugins: [inlineCssTreeJson],
    // Files the bundler cannot inline (wasm and similar) are emitted beside the script, so the skill folder stays self-contained.
    loader: { ".wasm": "file", ".traineddata": "file" },
  });
  if (!res.success) {
    for (const log of res.logs) console.error(log);
    throw new Error(`build failed for ${entry}`);
  }
}

export async function build(): Promise<string[]> {
  // Stale chunks from an earlier build would otherwise ship inside the skill folder.
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  await bundle(join(repo, "apps/cli/src/main.ts"), "pubmy.js");

  // tesseract.js starts its OCR worker from a separate file at run time, so it cannot live inside pubmy.js.
  const worker = tryResolve("tesseract.js/src/worker-script/node/index.js", join(repo, "packages/core"));
  if (worker) await bundle(worker, "tesseract-worker.js");

  const files = (await readdir(outDir)).sort();
  for (const f of files) console.log(`${f}\t${(await stat(join(outDir, f))).size} B`);
  return files;
}

if (import.meta.main) {
  await build();
}
