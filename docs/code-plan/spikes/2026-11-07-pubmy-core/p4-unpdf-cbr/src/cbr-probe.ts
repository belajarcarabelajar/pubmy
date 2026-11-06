// Question (b): does libarchive.js (npm) open and extract comic archives (CBR = RAR, CBZ = ZIP) under Bun 1.4.4?
// Usage: bun src/cbr-probe.ts <archive> [<archive> ...]
const mod: Record<string, unknown> = await import("libarchive.js/dist/libarchive-node.mjs");
console.log("node build exports:", Object.keys(mod));
const Archive = (mod.Archive ?? (mod.default as Record<string, unknown>)?.Archive ?? mod.default) as {
  open(f: File): Promise<{ getFilesArray(): Promise<{ file: { name: string; size: number }; path: string }[]>; extractFiles(): Promise<unknown>; close?(): Promise<void> }>;
};
for (const path of process.argv.slice(2)) {
  try {
    const bytes = await Bun.file(path).arrayBuffer();
    const archive = await Archive.open(new File([bytes], path.split("/").pop()!));
    const list = await archive.getFilesArray();
    console.log(`${path}: ${list.length} entries -> ${list.map((e) => `${e.path}${e.file.name}(${e.file.size})`).join(", ")}`);
    const extracted = (await archive.extractFiles()) as Record<string, File>;
    for (const [name, f] of Object.entries(extracted)) {
      const head = new Uint8Array(await f.arrayBuffer()).slice(0, 4);
      console.log(`  extracted ${name}: ${f.size} bytes, magic ${[...head].map((b) => b.toString(16).padStart(2, "0")).join("")}`);
    }
    await archive.close?.();
  } catch (e) {
    console.log(`${path}: FAILED ${(e as Error).message}`);
  }
}
process.exit(0);
