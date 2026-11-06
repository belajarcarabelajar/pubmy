// Types for the parts of foliate-js epub.js that apps/web uses. Written for pubmy, not part of upstream.

/** Reads entries of the EPUB container by their path inside it; null means the entry is absent. */
export interface FoliateLoader {
  loadText(name: string): string | null | Promise<string | null>;
  loadBlob(name: string): Blob | null | Promise<Blob | null>;
  getSize(name: string): number;
}

export interface TocItem {
  label: string;
  href: string | null;
  subitems?: TocItem[] | null;
}

export interface Section {
  /** The section's path inside the container, for example "OEBPS/ch001.xhtml". */
  id: string;
  linear?: string;
  load(): Promise<string>;
  unload(): void;
}

/** A spine index plus where to scroll in that section's document. */
export interface Resolved {
  index: number;
  anchor: (doc: Document) => Element | number | null;
}

export declare class EPUB {
  constructor(loader: FoliateLoader);
  init(): Promise<this>;
  sections: Section[];
  toc?: TocItem[] | null;
  /** Page progression direction, "rtl" for manga. */
  dir?: string;
  rendition?: { layout?: string };
  resolveHref(href: string): Resolved | null;
  /** Revokes every blob URL the book's loader still holds. */
  destroy(): void;
}
