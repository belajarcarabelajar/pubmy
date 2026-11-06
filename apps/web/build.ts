import { copyFile, cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { BunPlugin } from "bun";
import { LIBARCHIVE_FILES } from "./src/libarchive-loader.ts";
import { OCR_FILES, ocrSource } from "./src/ocr-assets.ts";

const root = import.meta.dir;
// An optional output directory lets tests build without touching dist.
const out = process.argv[2] ? resolve(process.argv[2]) : join(root, "dist");

await rm(out, { recursive: true, force: true });

// Core's default comics loader names the Node build of libarchive.js. The worker registers the browser
// loader instead, so that path is dead here; blanking it keeps the Node module name out of the bundle.
const NODE_LIBARCHIVE = "libarchive.js/dist/libarchive-node.mjs";
const dropNodeLibarchive: BunPlugin = {
  name: "drop-node-libarchive",
  setup(build) {
    build.onLoad({ filter: /[\\/]core[\\/]src[\\/]adapters[\\/]comics\.ts$/ }, async ({ path }) => {
      const src = await Bun.file(path).text();
      if (!src.includes(NODE_LIBARCHIVE)) throw new Error(`${path} no longer names ${NODE_LIBARCHIVE}; review this plugin`);
      return { contents: src.replaceAll(NODE_LIBARCHIVE, "pubmy:node-only"), loader: "ts" };
    });
  },
};

const result = await Bun.build({
  plugins: [dropNodeLibarchive],
  entrypoints: [join(root, "src/main.ts"), join(root, "src/worker.ts")],
  outdir: out,
  target: "browser",
  format: "esm",
  splitting: true,
  minify: true,
  naming: { entry: "[name].js", chunk: "chunks/[name]-[hash].js", asset: "assets/[name]-[hash].[ext]" },
  // libxml2-wasm (under epubcheck-ts) runs `await import("module")` only when it detects Node;
  // left external, that dynamic import never executes in a browser.
  external: ["module"],
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// The CSP has no style-src 'unsafe-inline', so the authored <style> block ships as style.css.
const html = await Bun.file(join(root, "index.html")).text();
const style = /<style>([\s\S]*?)<\/style>/.exec(html);
if (!style) throw new Error("index.html has no <style> block");
await Bun.write(join(out, "style.css"), style[1]!.trim() + "\n");
await Bun.write(join(out, "index.html"), html.replace(style[0], '<link rel="stylesheet" href="./style.css">'));

// public/ holds files served as-is, such as the Workers _headers file.
await cp(join(root, "public"), out, { recursive: true }).catch((e: NodeJS.ErrnoException) => {
  if (e.code !== "ENOENT") throw e;
});

for (const f of OCR_FILES) {
  await mkdir(dirname(join(out, f.to)), { recursive: true });
  await copyFile(ocrSource(f, root), join(out, f.to));
}

// libarchive.js is a dependency of @pubmy/core, so it resolves from there; served same-origin for the CSP.
const libarchiveDist = dirname(Bun.resolveSync("libarchive.js", join(root, "..", "..", "packages", "core")));
await mkdir(join(out, "libarchive"), { recursive: true });
for (const f of LIBARCHIVE_FILES) await copyFile(join(libarchiveDist, f), join(out, "libarchive", f));

let total = 0;
for (const name of await readdir(out, { recursive: true })) {
  const s = await stat(join(out, name));
  if (!s.isFile()) continue;
  total += s.size;
  console.log(`${String(s.size).padStart(10)}  ${name}`);
}
console.log(`${String(total).padStart(10)}  total bytes`);
