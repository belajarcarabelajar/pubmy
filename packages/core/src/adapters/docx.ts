import mammoth from "mammoth";
import { PubmyError } from "../errors.ts";
import type { Adapter, Asset, Book, Chapter, InputFile } from "../types.ts";
import { decode } from "../xml.ts";
import { checkZipCaps } from "../zip-caps.ts";

// Word saves a password-protected document as an encrypted CFB container instead of a ZIP.
const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

const EXT_OF: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/svg+xml": "svg", "image/webp": "webp",
};

const isCfb = (b: Uint8Array) => CFB_MAGIC.every((m, i) => b[i] === m);

const textOf = (html: string) => decode(html.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();

// Only web and mail links survive, as in the other adapters; internal "#id" anchors stay too.
const SAFE_HREF = /^(https?:|mailto:|#)/i;

function dropUnsafeHrefs(html: string): string {
  return html.replace(/<a\b([^>]*)>/g, (tag, attrs: string) => {
    const href = /\shref="([^"]*)"/.exec(attrs);
    return href && !SAFE_HREF.test(decode(href[1])) ? `<a${attrs.replace(href[0], "")}>` : tag;
  });
}

// EPUB core media types only; any other picture (EMF, WMF, TIFF, BMP) makes epubcheck fail the book.
const DROPPED_IMAGE = "pubmy:dropped-image";

/** Replaces each dropped picture with its alt text, which mammoth has already escaped. */
const altForDroppedImages = (html: string) =>
  html.replace(/<img\b[^>]*>/g, (tag) =>
    tag.includes(`src="${DROPPED_IMAGE}"`) ? (/\salt="([^"]*)"/.exec(tag)?.[1] ?? "") : tag);

const baseName = (name: string) => name.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "") || "Untitled";

const chapterHref = (i: number) => `ch${String(i + 1).padStart(3, "0")}.xhtml`;

/** Splits mammoth HTML at each h1; text before the first h1 becomes a chapter titled from the file name. */
function split(html: string, fallbackTitle: string): Chapter[] {
  const parts = html.split(/(?=<h1[\s>])/);
  const chapters: Chapter[] = [];
  for (const part of parts) {
    const heading = /^<h1[^>]*>([\s\S]*?)<\/h1>/.exec(part);
    if (!heading && !textOf(part) && !/<img\b/.test(part)) continue;
    const title = (heading && textOf(heading[1])) || fallbackTitle;
    chapters.push({ href: chapterHref(chapters.length), title, body: part });
  }
  if (!chapters.length) chapters.push({ href: chapterHref(0), title: fallbackTitle, body: "<p></p>" });
  return chapters;
}

// After splitting, a footnote reference and its note can sit in different files, so "#id" links
// must name the file that holds the id.
function relinkAnchors(chapters: Chapter[]): void {
  const home = new Map<string, string>();
  for (const c of chapters) for (const [, id] of c.body.matchAll(/\sid="([^"]+)"/g)) home.set(id, c.href);
  for (const c of chapters) {
    c.body = c.body.replace(/href="#([^"]+)"/g, (m, id: string) => {
      const file = home.get(id);
      return file && file !== c.href ? `href="${file}#${id}"` : m;
    });
  }
}

export const docxAdapter: Adapter = {
  id: "docx",
  accepts: (s) => s.ext === "docx",
  async read(f: InputFile): Promise<Book> {
    if (isCfb(f.bytes)) throw new PubmyError("READ_FAILED", "encrypted-office");
    // mammoth inflates every part itself, so the declared sizes are checked before it sees the bytes.
    checkZipCaps(f.bytes);
    const assets: Asset[] = [];
    let imageCount = 0;
    const arrayBuffer = f.bytes.buffer.slice(f.bytes.byteOffset, f.bytes.byteOffset + f.bytes.byteLength) as ArrayBuffer;
    // The browser build reads `arrayBuffer`; the Node build (what Bun loads) reads only `buffer`,
    // and its JSZip accepts an ArrayBuffer there too.
    const input = { arrayBuffer, buffer: arrayBuffer } as unknown as { arrayBuffer: ArrayBuffer };
    const { value } = await mammoth.convertToHtml(
      input,
      {
        convertImage: mammoth.images.imgElement(async (image) => {
          const ext = EXT_OF[image.contentType];
          if (!ext) return { src: DROPPED_IMAGE };
          // Numbered before the await: mammoth may convert several images concurrently.
          const href = `images/image${++imageCount}.${ext}`;
          assets.push({ href, mediaType: image.contentType, data: new Uint8Array(await image.readAsArrayBuffer()) });
          return { src: href };
        }),
      },
    );
    const title = baseName(f.name);
    const chapters = split(altForDroppedImages(dropUnsafeHrefs(value)), title);
    relinkAnchors(chapters);
    return {
      meta: { title, creators: [], language: "id" },
      chapters,
      assets,
      toc: [],
      layout: "reflow",
      direction: "ltr",
    };
  },
};
