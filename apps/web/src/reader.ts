import { EPUB, type Resolved, type TocItem } from "../vendor/foliate/epub.js";
import type { EpubLoader } from "./epub-loader.ts";
import type { Reader } from "./preview-session.ts";
import { isolateTables, TABLE_HOST } from "./tables.ts";

/** The parts of the preview dialog the reader fills and listens to. */
export interface ReaderUi {
  /** Holds the arrows and the page; its direction follows the book so the next arrow sits on the reading side. */
  stage: HTMLElement;
  page: HTMLElement;
  toc: HTMLElement;
  tocList: HTMLOListElement;
  tocToggle: HTMLButtonElement;
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
  /** Receives Left/Right while focus is outside the page frames. */
  keys: HTMLElement;
  /** True when the contents list covers the page, so picking an entry hides it again. */
  narrow(): boolean;
  /** Esc pressed inside a page frame, where the dialog's own Esc handling does not reach. */
  escape(): void;
}

/**
 * Styles for every section of a reflowable book: each table sits in a scroll box (isolateTables)
 * that scrolls inside the page instead of being cut off. A shadow on the left or right edge shows
 * that more columns lie that way; it fades once the table is scrolled to that end.
 */
const SECTION_CSS =
  `.${TABLE_HOST}{display:block;max-width:100%;max-height:85vh;overflow:auto;` +
  "background:linear-gradient(to right,#fff 30%,#fff0),linear-gradient(to left,#fff 30%,#fff0) 100% 0," +
  "radial-gradient(farthest-side at 0 50%,#0003,#0000),radial-gradient(farthest-side at 100% 50%,#0003,#0000) 100% 0;" +
  "background-repeat:no-repeat;background-size:2.5em 100%,2.5em 100%,.9em 100%,.9em 100%;" +
  "background-attachment:local,local,scroll,scroll}";

/** The surface <foliate-paginator> and <foliate-fxl> share; only the paginator takes styles. */
interface Renderer extends HTMLElement {
  open(book: EPUB): void;
  setStyles?(styles: string): void;
  goTo(target: Resolved): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;
  destroy(): void;
}

/** Opens the book with foliate-js and shows its first page in ui.page. */
export async function mountReader(loader: EpubLoader, ui: ReaderUi): Promise<Reader> {
  const book = await new EPUB(loader).init();
  const fixed = book.rendition?.layout === "pre-paginated";
  // Importing a renderer registers its custom element; a book needs only one of the two.
  await (fixed ? import("../vendor/foliate/fixed-layout.js") : import("../vendor/foliate/paginator.js"));
  const renderer = document.createElement(fixed ? "foliate-fxl" : "foliate-paginator") as Renderer;
  ui.page.dir = "ltr";
  ui.page.replaceChildren(renderer);
  renderer.open(book);
  renderer.setStyles?.(SECTION_CSS);

  const rtl = book.dir === "rtl";
  ui.stage.dir = rtl ? "rtl" : "ltr";
  const turn = (forward: boolean) => void (forward ? renderer.next() : renderer.prev());
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") turn(rtl);
    else if (e.key === "ArrowRight") turn(!rtl);
    else if (e.key === "Escape" && e.currentTarget !== ui.keys) ui.escape();
    else return;
    e.preventDefault();
  };

  const setToc = (open: boolean) => {
    ui.toc.hidden = !open;
    ui.tocToggle.setAttribute("aria-expanded", String(open));
  };
  const entries: { button: HTMLButtonElement; index: number }[] = [];
  const fill = (items: TocItem[], list: HTMLOListElement) => {
    for (const item of items) {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = item.label?.trim() || item.href || "";
      const target = item.href ? book.resolveHref(item.href) : null;
      if (target) entries.push({ button, index: target.index });
      button.onclick = () => {
        if (target) void renderer.goTo(target);
        if (ui.narrow()) setToc(false);
      };
      li.append(button);
      if (item.subitems?.length) {
        const sub = document.createElement("ol");
        fill(item.subitems, sub);
        li.append(sub);
      }
      list.append(li);
    }
  };
  ui.tocList.replaceChildren();
  fill(book.toc ?? [], ui.tocList);
  ui.tocToggle.hidden = entries.length === 0;
  setToc(entries.length > 0 && !ui.narrow());
  ui.tocToggle.onclick = () => setToc(ui.toc.hidden !== false);

  const onRelocate = (e: Event) => {
    const { index } = (e as CustomEvent<{ index: number }>).detail;
    const current = entries.filter((x) => x.index <= index).at(-1);
    for (const x of entries) {
      if (x === current) x.button.setAttribute("aria-current", "true");
      else x.button.removeAttribute("aria-current");
    }
  };
  const docs = new Set<Document>();
  const onLoad = (e: Event) => {
    const { doc } = (e as CustomEvent<{ doc: Document }>).detail;
    // foliate fires "load" before it lays out and counts the section's pages
    if (!fixed) isolateTables(doc);
    docs.add(doc);
    doc.addEventListener("keydown", onKey);
    // Focus inside the book's frame is invisible to the page's CSS, so the page area shows it.
    doc.defaultView?.addEventListener("focus", () => ui.page.classList.add("focused"));
    doc.defaultView?.addEventListener("blur", () => ui.page.classList.remove("focused"));
  };
  renderer.addEventListener("relocate", onRelocate);
  renderer.addEventListener("load", onLoad);
  ui.keys.addEventListener("keydown", onKey);
  ui.prev.onclick = () => turn(false);
  ui.next.onclick = () => turn(true);

  const reader: Reader = {
    destroy() {
      ui.keys.removeEventListener("keydown", onKey);
      for (const doc of docs) doc.removeEventListener("keydown", onKey);
      renderer.removeEventListener("relocate", onRelocate);
      renderer.removeEventListener("load", onLoad);
      ui.prev.onclick = ui.next.onclick = ui.tocToggle.onclick = null;
      ui.tocList.replaceChildren();
      try {
        renderer.destroy();
      } catch {
        // Paginator.destroy() throws when no section was shown yet; book.destroy() below still frees the URLs.
      }
      renderer.remove();
      ui.page.classList.remove("focused");
      book.destroy();
    },
  };
  try {
    const start = book.sections.findIndex((s) => s.linear !== "no");
    await renderer.goTo({ index: Math.max(0, start), anchor: () => 0 });
  } catch (e) {
    reader.destroy();
    throw e;
  }
  return reader;
}
