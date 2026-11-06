// Born-digital PDF to reflowable Book. Positions come from pdf.js getTextContent (unpdf drops
// rotation, spike P4); running heads and feet are dropped, then layoutPages turns the pages into
// heading and paragraph blocks. Raster figures become PNG assets, and a table printed sideways is
// rebuilt as an XHTML table (Kindle does not render SVG text, guidelines 11.4.11).
import { getDocumentProxy, inspectPages } from "unpdf";
import { PubmyError } from "../errors.ts";
import { extractPageImages, type PageImage } from "../pdf/images.ts";
import { bodySize, layoutPages, titleSizeOf, usableItems, type Block, type PageBlock, type PageFigure, type PageText, type TextItem } from "../pdf/layout.ts";
import { rotatedTable, tableHtml } from "../pdf/rotated.ts";
import { stripRunning } from "../pdf/running.ts";
import type { Adapter, Asset, Book, Chapter, Ctx, InputFile } from "../types.ts";
import { escAttr } from "../xml.ts";
import { isScannedPage, ocrScan } from "./scan.ts";

type Doc = Awaited<ReturnType<typeof getDocumentProxy>>;
interface RawItem {
  str?: string;
  width?: number;
  transform?: number[];
}

async function open(bytes: Uint8Array): Promise<Doc> {
  try {
    // pdf.js may transfer (detach) the buffer it gets, so it gets a copy. Without the two flags a
    // browser worker gets ImageBitmaps instead of the raw pixels extractPageImages encodes.
    return await getDocumentProxy(bytes.slice(), { isOffscreenCanvasSupported: false, isImageDecoderSupported: false });
  } catch (e) {
    if ((e as { name?: string })?.name === "PasswordException") throw new PubmyError("READ_FAILED", "encrypted-pdf");
    throw e;
  }
}

function toItem(r: RawItem): TextItem | null {
  const t = r.transform;
  if (typeof r.str !== "string" || !t) return null;
  return {
    str: r.str,
    x: t[4],
    y: t[5],
    width: r.width ?? 0,
    fontSize: Math.hypot(t[2], t[3]),
    rotated: Math.abs(t[1]) > 1e-6 || Math.abs(t[2]) > 1e-6,
  };
}

const esc = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/^\s*(\d+(\.\d+)*\.?|[ivxlc]+\.)\s+/, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const NUMBERED = /^\d+\.?\s+\p{L}/u;
/** The label that opens a figure caption, such as "Figure 1" or "Fig. 2b". */
const FIGURE_LABEL = /^\s*(fig(?:ure)?\.?\s*\d+[a-z]?)\b/i;

/** The caption label nearest below the image, else the nearest above it, as the image's alt text. */
function altFor(items: TextItem[], img: PageImage, height: number, page: number): string {
  const labels = items.flatMap((i) => {
    const m = FIGURE_LABEL.exec(i.str);
    return m ? [{ label: m[1].replace(/\s+/g, " "), top: height - i.y - i.fontSize }] : [];
  });
  const below = labels.filter((l) => l.top >= img.bottom - 2).sort((a, b) => a.top - b.top)[0];
  const above = labels.filter((l) => l.top < img.bottom - 2).sort((a, b) => b.top - a.top)[0];
  return (below ?? above)?.label ?? `Figure on page ${page}`;
}

/** Top-level outline entries with the 1-based page they point at; [] when the PDF has none. */
async function outlineOf(doc: Doc): Promise<{ title: string; page: number }[]> {
  const out: { title: string; page: number }[] = [];
  for (const o of (await doc.getOutline()) ?? []) {
    try {
      const dest = typeof o.dest === "string" ? await doc.getDestination(o.dest) : o.dest;
      const ref = dest?.[0];
      if (!ref || !o.title?.trim()) continue;
      const index = typeof ref === "number" ? ref : await doc.getPageIndex(ref);
      out.push({ title: o.title.trim(), page: index + 1 });
    } catch {
      // an outline entry with a broken destination is skipped
    }
  }
  return out;
}

/** Index of each chapter's first block, with its title. */
function boundaries(blocks: PageBlock[], outline: { title: string; page: number }[], titleBlock: number): { at: number; title: string }[] {
  if (outline.length > 0) {
    const out: { at: number; title: string }[] = [];
    let from = 0;
    for (const o of outline) {
      const onPage = blocks.findIndex((b, k) => k >= from && b.page >= o.page);
      if (onPage < 0) break;
      const match = blocks.findIndex((b, k) => k >= onPage && b.kind === "heading" && norm(b.text) === norm(o.title));
      const at = match >= 0 ? match : onPage;
      out.push({ at, title: o.title });
      from = at + 1;
    }
    if (out.length > 0) return out;
  }
  const heads = blocks.map((b, k) => ({ b, k })).filter(({ b, k }) => b.kind === "heading" && k !== titleBlock);
  const firstNumbered = heads.findIndex(({ b }) => NUMBERED.test(b.text));
  return (firstNumbered >= 0 ? heads.slice(firstNumbered) : heads).map(({ b, k }) => ({ at: k, title: b.text }));
}

function render(blocks: Block[], headAt: number): string {
  return blocks
    .map((b, k) =>
      b.kind === "html" ? b.text : b.kind === "para" ? `<p>${esc(b.text)}</p>` : k === headAt ? `<h1>${esc(b.text)}</h1>` : `<h2>${esc(b.text)}</h2>`,
    )
    .join("\n");
}

async function read(f: InputFile, ctx: Ctx): Promise<Book> {
  const doc = await open(f.bytes);
  const { pages } = await inspectPages(doc);
  // scanned pages have no text items, so the text pass below yields nothing for them
  const scanned = pages.flatMap((p, i) => (isScannedPage(p) ? [i + 1] : []));

  const found: PageText[] = [];
  const assets: Asset[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    if (ctx.signal.aborted) throw new Error("aborted");
    const page = await doc.getPage(n);
    const [x0, y0, x1, y1] = page.view;
    const raw = (await page.getTextContent()).items as RawItem[];
    const items = raw.map(toItem).filter((i): i is TextItem => i !== null);
    const figures: PageFigure[] = [];
    // a scanned page is one full-page image; OCR reads it below
    if (!scanned.includes(n)) {
      for (const [k, img] of (await extractPageImages(page)).entries()) {
        const src = `img/p${n}-${k + 1}.png`;
        assets.push({ href: src, mediaType: "image/png", data: img.png });
        figures.push({ top: img.top, html: `<figure><img src="${src}" alt="${escAttr(altFor(items, img, y1 - y0, n))}"/></figure>` });
      }
    }
    // the table's own lines are rotated, so the layout below skips them; the grid stands in for them
    const grid = rotatedTable(raw, page.view);
    if (grid) figures.push({ top: 0, html: tableHtml(grid) });
    page.cleanup();
    found.push({ items, width: x1 - x0, height: y1 - y0, figures });
    ctx.progress((n / doc.numPages) * 0.8);
  }
  const raw = stripRunning(found);
  const all = raw.flatMap((p) => usableItems(p.items, p.height));
  const body = bodySize(all);
  const titleSize = titleSizeOf(all.filter((i) => i.fontSize > body * 1.03).map((i) => i.fontSize));
  const blocks: PageBlock[] = layoutPages(raw, { bodySize: body, titleSize });

  const info = ((await doc.getMetadata().catch(() => null))?.info ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const titleBlock = blocks.findIndex((b) => b.page === 1 && b.kind === "heading" && b.level === 1);
  const title = titleBlock >= 0 ? blocks[titleBlock].text : str(info.Title) || f.name.replace(/\.[^.]+$/, "");
  const cuts = boundaries(blocks, await outlineOf(doc), titleBlock);

  const placed: { page: number; chapter: Chapter }[] = [];
  const href = (n: number) => `ch${String(n).padStart(3, "0")}.xhtml`;
  if (cuts.length === 0 && (blocks.length > 0 || scanned.length === 0))
    placed.push({ page: blocks[0]?.page ?? 1, chapter: { href: href(1), title, body: render(blocks, titleBlock) } });
  cuts.forEach((c, k) => {
    // text before the first chapter heading (title page, authors, abstract) opens chapter 1
    const start = k === 0 ? 0 : c.at;
    const slice = blocks.slice(start, cuts[k + 1]?.at ?? blocks.length);
    placed.push({ page: blocks[start].page, chapter: { href: href(k + 1), title: c.title, body: render(slice, c.at - start) } });
  });

  let notes: Book["notes"];
  if (scanned.length > 0) {
    const scan = await ocrScan(f.bytes, scanned, ctx);
    scan.chapters.forEach((chapter, k) => placed.push({ page: scanned[k], chapter }));
    notes = {
      ocr: { pages: scan.pages, meanConfidence: scan.meanConfidence },
      warnings: scan.meanConfidence < 50 ? ["low-ocr-confidence"] : [],
    };
  }
  // stable sort: a scanned page lands after the text chapter that starts on an earlier page
  placed.sort((a, b) => a.page - b.page);
  return {
    meta: { title, creators: str(info.Author) ? [str(info.Author)] : [], language: str(info.Language) || "en" },
    chapters: placed.map((p) => p.chapter),
    assets,
    toc: [],
    layout: "reflow",
    direction: "ltr",
    ...(notes ? { notes } : {}),
  };
}

export const pdfAdapter: Adapter = { id: "pdf", accepts: (s) => s.format === "pdf", read };
