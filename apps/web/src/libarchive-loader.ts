import type { LibarchiveLoader } from "@pubmy/core/browser";

/**
 * Files build.ts copies from libarchive.js/dist into dist/libarchive/. They must stay side by side:
 * libarchive.js starts worker-bundle.js from its own URL, and that worker fetches libarchive.wasm from its own URL.
 */
export const LIBARCHIVE_FILES = ["libarchive.js", "worker-bundle.js", "libarchive.wasm"] as const;

/** Loads the browser build of libarchive.js served same-origin from dist, never the Node build (Bun/Node only). */
export function browserLibarchiveLoader(
  base: string,
  importModule: (url: string) => Promise<unknown> = (url) => import(/* @vite-ignore */ url),
): LibarchiveLoader {
  const url = new URL("libarchive/libarchive.js", base).href;
  return () => importModule(url) as ReturnType<LibarchiveLoader>;
}
