// Bun/Node only. The browser entry (browser.ts) never imports this file, so web bundles stay free of the Node build.
import type { LibarchiveLoader, LibarchiveModule } from "./comics.ts";

const NODE_BUILD = "libarchive.js/dist/libarchive-node.mjs";
export const loadNodeLibarchive: LibarchiveLoader = () => import(/* @vite-ignore */ NODE_BUILD) as Promise<LibarchiveModule>;
