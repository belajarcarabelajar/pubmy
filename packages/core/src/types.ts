export interface InputFile {
  name: string;
  bytes: Uint8Array;
}

export type Format =
  | "txt" | "markdown" | "html" | "epub" | "zip" | "odt" | "docx" | "cbz" | "pdf" | "mobi" | "rtf" | "rar" | "unknown";

/** What detect() learned from the magic bytes and the file name. */
export interface Sniff {
  format: Format;
  /** Lower-case extension without the dot, "" when the name has none. */
  ext: string;
}

export interface TocEntry {
  title: string;
  href: string;
  children?: TocEntry[];
}

export interface Chapter {
  /** File name inside OEBPS, for example "ch001.xhtml". */
  href: string;
  title: string;
  /** Inner markup of <body>, XHTML or HTML-ish; the packager applies the Kindle fixes. */
  body: string;
}

export interface Asset {
  href: string;
  mediaType: string;
  data: Uint8Array;
}

export interface BookMeta {
  title: string;
  creators: string[];
  language: string;
  identifier?: string;
  /** ISO timestamp for dcterms:modified; now when absent. */
  modified?: string;
  /** href of the asset used as cover image. */
  cover?: string;
}

/** The format-neutral book every adapter produces and the packager consumes. */
export interface Book {
  meta: BookMeta;
  chapters: Chapter[];
  assets: Asset[];
  /** Nested TOC; when empty the packager lists the chapters. */
  toc: TocEntry[];
  layout: "reflow" | "fixed";
  direction: "ltr" | "rtl";
  /** Facts for the per-file report (OCR summary, non-fatal warnings); not written into the EPUB. */
  notes?: BookNotes;
}

export interface BookNotes {
  ocr?: { pages: number; meanConfidence: number };
  warnings?: string[];
}

export interface DomAdapter {
  parseHTML(markup: string): Document;
}

export interface Ocr {
  recognize(image: Uint8Array, signal?: AbortSignal): Promise<string>;
}

export interface Ctx {
  dom: DomAdapter;
  loadOcr(): Promise<Ocr>;
  progress(p: number): void;
  signal: AbortSignal;
}

export interface Adapter {
  id: string;
  accepts(s: Sniff): boolean;
  read(f: InputFile, ctx: Ctx): Promise<Book>;
}

export type FailureCode = "DRM" | "UNSUPPORTED" | "TOO_LARGE" | "READ_FAILED" | "INVALID_EPUB";

export type Result =
  | { ok: true; epub: Uint8Array; check: { errors: 0; warnings: number }; notes?: BookNotes }
  | { ok: false; code: FailureCode; message: string };

export interface CheckResult {
  errors: number;
  warnings: number;
  messages: string[];
}
