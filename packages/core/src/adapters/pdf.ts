// Born-digital PDF to reflowable Book. Positions come from pdf.js getTextContent (unpdf drops
// rotation, spike P4); layoutPage turns each page into heading and paragraph blocks.
import { getDocumentProxy, inspectPages } from "unpdf";
import { PubmyError } from "../errors.ts";
import { bodySize, layoutPage, titleSizeOf, usableItems, type Block, type TextItem } from "../pdf/layout.ts";
import type { Adapter, Book, Chapter, Ctx, InputFile } from "../types.ts";

type Doc = Awaited<ReturnType<typeof getDocumentProxy>>;
interface PageBlock extends Block {
  page: number;
}
interface RawItem {
  str?: string;
  width?: number;
  transform?: number[];
}

async function open(bytes: Uint8Array): Promise<Doc> {
  try {
    // pdf.js may transfer (detach) the buffer it gets, so it gets a copy
    return await getDocumentProxy(bytes.slice());
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
    .map((b, k) => (b.kind === "para" ? `<p>${esc(b.text)}</p>` : k === headAt ? `<h1>${esc(b.text)}</h1>` : `<h2>${esc(b.text)}</h2>`))
    .join("\n");
}

async function read(f: InputFile, ctx: Ctx): Promise<Book> {
  const doc = await open(f.bytes);
  const { pages } = await inspectPages(doc);
  if (pages.some((p) => p.textLength === 0 && p.imageCoverage > 0)) throw new PubmyError("UNSUPPORTED", "scanned-pdf");

  const raw: { items: TextItem[]; width: number; height: number }[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    if (ctx.signal.aborted) throw new Error("aborted");
    const page = await doc.getPage(n);
    const [x0, y0, x1, y1] = page.view;
    const items = ((await page.getTextContent()).items as RawItem[]).map(toItem).filter((i): i is TextItem => i !== null);
    raw.push({ items, width: x1 - x0, height: y1 - y0 });
    ctx.progress((n / doc.numPages) * 0.8);
  }
  const all = raw.flatMap((p) => usableItems(p.items, p.height));
  const body = bodySize(all);
  const titleSize = titleSizeOf(all.filter((i) => i.fontSize > body * 1.03).map((i) => i.fontSize));

  const blocks: PageBlock[] = [];
  raw.forEach((p, k) => {
    for (const b of layoutPage(p.items, { width: p.width, height: p.height, bodySize: body, titleSize })) {
      const last = blocks.at(-1);
      // a paragraph that runs over the page break continues in lower case
      if (b.kind === "para" && last?.kind === "para" && last.page === k && /^[a-z]/.test(b.text)) last.text += ` ${b.text}`;
      else blocks.push({ ...b, page: k + 1 });
    }
  });

  const info = ((await doc.getMetadata().catch(() => null))?.info ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const titleBlock = blocks.findIndex((b) => b.page === 1 && b.kind === "heading" && b.level === 1);
  const title = titleBlock >= 0 ? blocks[titleBlock].text : str(info.Title) || f.name.replace(/\.[^.]+$/, "");
  const cuts = boundaries(blocks, await outlineOf(doc), titleBlock);

  const chapters: Chapter[] = [];
  const href = (n: number) => `ch${String(n).padStart(3, "0")}.xhtml`;
  if (cuts.length === 0) chapters.push({ href: href(1), title, body: render(blocks, titleBlock) });
  cuts.forEach((c, k) => {
    // text before the first chapter heading (title page, authors, abstract) opens chapter 1
    const start = k === 0 ? 0 : c.at;
    const slice = blocks.slice(start, cuts[k + 1]?.at ?? blocks.length);
    chapters.push({ href: href(k + 1), title: c.title, body: render(slice, c.at - start) });
  });
  return {
    meta: { title, creators: str(info.Author) ? [str(info.Author)] : [], language: str(info.Language) || "en" },
    chapters,
    assets: [],
    toc: [],
    layout: "reflow",
    direction: "ltr",
  };
}

export const pdfAdapter: Adapter = { id: "pdf", accepts: (s) => s.format === "pdf", read };
