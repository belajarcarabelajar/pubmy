// Fetches the prebuilt @napi-rs/canvas 1.1.0 (MIT) for this machine into a cache folder, once.
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

export const CANVAS_VERSION = "1.1.0";

export type CanvasPlatform =
  | "linux-x64-gnu"
  | "linux-x64-musl"
  | "linux-arm64-gnu"
  | "linux-arm64-musl"
  | "darwin-x64"
  | "darwin-arm64"
  | "win32-x64-msvc";

const PLATFORMS: readonly CanvasPlatform[] = [
  "linux-x64-gnu",
  "linux-x64-musl",
  "linux-arm64-gnu",
  "linux-arm64-musl",
  "darwin-x64",
  "darwin-arm64",
  "win32-x64-msvc",
];

export function isCanvasPlatform(s: string): s is CanvasPlatform {
  return (PLATFORMS as readonly string[]).includes(s);
}

/**
 * sha512 SRI of each tarball, from `dist.integrity` at https://registry.npmjs.org/@napi-rs/<pkg>/1.1.0
 * (queried 2026-11-07). "canvas" is the JS wrapper; the rest hold one skia.<platform>.node each.
 */
export const CANVAS_PINS: Readonly<Record<string, string>> = {
  canvas: "sha512-k+ph/D8H9GS8ZZ48okvHrKeJynkqAA1kMUZRuzRWNlQUDHXngq7oRaWMZBdmSfd9ZhVy9bwNKei/7wMboI/uMg==",
  "canvas-linux-x64-gnu": "sha512-uQ9JuJlRhQdHyttcMWOiwLkfIqkqaB0YFUVe835LUe12THt2b51HXkTItq0fxWT1jdhUPX2ylWZ1walkJyD6GQ==",
  "canvas-linux-x64-musl": "sha512-has4CPPAkkCac/LZ13VAw5p+MJLdaKVoyrhumN/A7uJd6960xYkJNDZgUebyxiha82AFzXx6RV+QJg5qGG079g==",
  "canvas-linux-arm64-gnu": "sha512-dE/XthqYkiWcBVtKFlZbUXwAYfDuQGqDWixznipJNmevLGpprNnTVQZyftm1RZJudkIOn2EkzYZDMMETM08Row==",
  "canvas-linux-arm64-musl": "sha512-DqZ/CMcHlhU56pPjv9AP0h3U7MFQ5LzC1HzMyRMotL+PFsJmZJA/ziApPYVyyz78DaVLhI8t3So3ztqtijbYpg==",
  "canvas-darwin-x64": "sha512-jkeA8eVTxDum03LTvc32YJ28F6KB1U0gYwnWMfOAUQZvWWEh/kvONby4iWGJx3+Tw45UqMGMXjtw2GKNVZDhVg==",
  "canvas-darwin-arm64": "sha512-iqwST4g0oH+x8VCpBIYh+MYokv/mVvkM+v9oJGB0d9A3P2qBh42ogJlVyWq9SpPCrAjS7tplMb1D3OIfxl+utw==",
  "canvas-win32-x64-msvc": "sha512-08575bFk7iiadxap4h+JxgGut9xDCHAGum6wh0eInN53zEMImkmEHi5MushX2FOmNO7qRNX7BPiDC5ZYBwHeEg==",
};

export function canvasPlatform(os: string, arch: string, libc: "gnu" | "musl" = "gnu"): CanvasPlatform | null {
  const key = os === "linux" ? `linux-${arch}-${libc}` : os === "win32" ? `win32-${arch}-msvc` : `${os}-${arch}`;
  return isCanvasPlatform(key) ? key : null;
}

/**
 * Linux libc, by the rule the @napi-rs/canvas wrapper itself uses (js-binding.js isMusl): /usr/bin/ldd
 * mentioning musl means musl; when ldd cannot be read, a glibc version in process.report means glibc and
 * a loaded ld-musl/libc.musl object means musl; anything else counts as glibc.
 */
export function detectLibc(): "gnu" | "musl" {
  try {
    return readFileSync("/usr/bin/ldd", "utf8").includes("musl") ? "musl" : "gnu";
  } catch {}
  try {
    const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string }; sharedObjects?: string[] } | undefined;
    if (report?.header?.glibcVersionRuntime) return "gnu";
    if (report?.sharedObjects?.some((f) => f.includes("libc.musl-") || f.includes("ld-musl-"))) return "musl";
  } catch {}
  return "gnu";
}

/** Default cache root: ~/.cache/pubmy/canvas/1.1.0, one folder per platform below it (same root as the OCR data, see ocr/load.ts). */
export async function defaultCanvasCache(): Promise<string> {
  const { homedir } = await import("node:os");
  return `${homedir()}/.cache/pubmy/canvas/${CANVAS_VERSION}`;
}

const tarballUrl = (pkg: string) => `https://registry.npmjs.org/@napi-rs/${pkg}/-/${pkg}-${CANVAS_VERSION}.tgz`;

/** Regular files under "package/" whose path matches `keep`, from an uncompressed tar (ustar or v7). */
export function untar(tar: Uint8Array, keep: RegExp): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const dec = new TextDecoder();
  const field = (h: Uint8Array, at: number, len: number) => dec.decode(h.subarray(at, at + len)).replace(/\0.*$/s, "");
  for (let off = 0; off + 512 <= tar.length; ) {
    const h = tar.subarray(off, off + 512);
    if (h[0] === 0) break;
    const prefix = field(h, 257, 6) === "ustar" ? field(h, 345, 155) : "";
    const name = prefix ? `${prefix}/${field(h, 0, 100)}` : field(h, 0, 100);
    const size = parseInt(field(h, 124, 12).trim() || "0", 8);
    const type = h[156];
    off += 512;
    if ((type === 48 || type === 0) && name.startsWith("package/")) {
      const rel = name.slice("package/".length);
      const safe = rel.split("/").every((p) => p !== "" && p !== "." && p !== "..");
      if (safe && keep.test(rel)) out.set(rel, tar.slice(off, off + size));
    }
    off += Math.ceil(size / 512) * 512;
  }
  return out;
}

/** Total time for both tarballs; past it the download counts as offline. */
export const DOWNLOAD_TIMEOUT_MS = 180_000;

/** Settles like `p`, or rejects once `signal` aborts, so a fetch that ignores the signal cannot hold the caller. */
function bounded<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    p.then(resolve, reject);
  });
}

async function fetchVerified(fetchFn: typeof fetch, pkg: string, pin: string, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const res = await bounded(fetchFn(tarballUrl(pkg), { signal }), signal);
    if (!res.ok) return null;
    const gz = new Uint8Array(await bounded(res.arrayBuffer(), signal));
    const got = `sha512-${new Bun.CryptoHasher("sha512").update(gz).digest("base64")}`;
    return got === pin ? gz : null;
  } catch {
    return null;
  }
}

export interface CanvasFiles {
  /** Folder holding the wrapper's index.js. */
  mainDir: string;
  /** The skia.<platform>.node library. */
  nodeFile: string;
}

export interface EnsureCanvasOptions {
  key: CanvasPlatform;
  cacheDir: string;
  fetch?: typeof fetch;
  /** Overrides CANVAS_PINS (tests). */
  pins?: Readonly<Record<string, string>>;
  /** Time allowed for both tarballs together; default DOWNLOAD_TIMEOUT_MS. */
  downloadTimeoutMs?: number;
  /** Called once, after a fresh download is verified and in place. */
  onDownload?: (info: { bytes: number; dest: string }) => void;
}

/**
 * The cached canvas files, downloading and verifying them first if needed. Null when offline, on a
 * hash mismatch, or when the files cannot be written. The cache folder only ever appears complete: the
 * files go to a sibling temp folder that is renamed into place after every hash matched.
 */
export async function ensureCanvas(o: EnsureCanvasOptions): Promise<CanvasFiles | null> {
  const files: CanvasFiles = { mainDir: join(o.cacheDir, "main"), nodeFile: join(o.cacheDir, `skia.${o.key}.node`) };
  const complete = () => existsSync(join(files.mainDir, "index.js")) && existsSync(files.nodeFile);
  if (complete()) return files;
  const pins = o.pins ?? CANVAS_PINS;
  const fetchFn = o.fetch ?? fetch;
  const nativePkg = `canvas-${o.key}`;
  const signal = AbortSignal.timeout(o.downloadTimeoutMs ?? DOWNLOAD_TIMEOUT_MS);
  const [main, native] = await Promise.all([
    fetchVerified(fetchFn, "canvas", pins.canvas ?? "", signal),
    fetchVerified(fetchFn, nativePkg, pins[nativePkg] ?? "", signal),
  ]);
  if (!main || !native) return null;
  const tmp = `${o.cacheDir}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  try {
    const entries: [string, Uint8Array][] = [
      ...[...untar(Bun.gunzipSync(main), /^[^/]+\.js$/)].map(([rel, b]): [string, Uint8Array] => [join("main", rel), b]),
      ...untar(Bun.gunzipSync(native), /^[^/]+\.node$/),
    ];
    if (!entries.some(([rel]) => rel === join("main", "index.js")) || !entries.some(([rel]) => rel === `skia.${o.key}.node`)) return null;
    for (const [rel, bytes] of entries) {
      await mkdir(dirname(join(tmp, rel)), { recursive: true });
      await Bun.write(join(tmp, rel), bytes);
    }
    await mkdir(dirname(o.cacheDir), { recursive: true });
    try {
      await rename(tmp, o.cacheDir);
    } catch {
      // Another process may have finished the same download first; its copy is as good as ours. A folder
      // left incomplete by a crash or a manual delete would block the rename for good, so it is replaced once.
      if (!complete()) {
        await rm(o.cacheDir, { recursive: true, force: true });
        await rename(tmp, o.cacheDir).catch(() => {});
        if (!complete()) return null;
      }
    }
    o.onDownload?.({ bytes: main.length + native.length, dest: o.cacheDir });
    return files;
  } catch {
    return null;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
