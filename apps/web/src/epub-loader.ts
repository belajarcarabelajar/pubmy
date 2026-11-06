import { strFromU8, unzipSync } from "fflate";

/** The loader foliate-js's EPUB class reads a book through: entries of an EPUB held in memory, never the network. */
export interface EpubLoader {
  /** Paths inside the container, empty once closed. */
  readonly entries: string[];
  /** The entry as UTF-8 text, null when absent. */
  loadText(name: string): string | null;
  loadBlob(name: string): Blob | null;
  /** Uncompressed size in bytes, 0 when absent. */
  getSize(name: string): number;
  /** Drops the unzipped bytes; every later load returns null. */
  close(): void;
}

export function createEpubLoader(epub: Uint8Array): EpubLoader {
  let files: Record<string, Uint8Array> = unzipSync(epub);
  const get = (name: string) => (Object.hasOwn(files, name) ? files[name] : undefined);
  return {
    get entries() {
      return Object.keys(files);
    },
    loadText: (name) => {
      const bytes = get(name);
      return bytes ? strFromU8(bytes) : null;
    },
    loadBlob: (name) => {
      const bytes = get(name);
      return bytes ? new Blob([bytes as BlobPart]) : null;
    },
    getSize: (name) => get(name)?.length ?? 0,
    close() {
      files = {};
    },
  };
}
