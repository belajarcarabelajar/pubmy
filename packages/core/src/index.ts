// Bun/Node entry ("@pubmy/core"): the browser entry plus a comics adapter that reads RAR with the Node build of
// libarchive.js. Web code imports "@pubmy/core/browser" so the Node loader never reaches its bundle.
import { type ComicsOptions, createComicsAdapter as createComicsAdapterWith } from "./adapters/comics.ts";
import { loadNodeLibarchive } from "./adapters/libarchive-node.ts";
import { registerAdapter } from "./browser.ts";
import type { Adapter } from "./types.ts";

export * from "./browser.ts";
export { loadNodeLibarchive } from "./adapters/libarchive-node.ts";

/** Comics adapter for Bun/Node; RAR goes through the Node build of libarchive.js unless a loader is given. */
export function createComicsAdapter(opts: Partial<ComicsOptions> = {}): Adapter {
  return createComicsAdapterWith({ ...opts, loadLibarchive: opts.loadLibarchive ?? loadNodeLibarchive });
}

registerAdapter(createComicsAdapter());
