import { formatClock, startCountdown, type Countdown, type CountdownItem } from "./countdown.ts";
import { dropHintKey, failureText, pickLang, t, type Key, type Lang } from "./i18n.ts";
import { applyBatchBar, zipEpubs } from "./batch.ts";
import { placeMenu, scrolledAway } from "./menu-position.ts";
import { createPreview } from "./preview-session.ts";
import { createQueue, type QueueItem, type Refusal } from "./queue.ts";
import type { ReaderUi } from "./reader.ts";
import { refusalRow, renderRow, updateClock } from "./row.ts";
import { createWorkerClient, type WorkerLike } from "./worker-client.ts";

const RETENTION_MS = 180_000;
const ZIP_NAME = "pubmy-epub.zip";
// A variable keeps the bundler from trying to resolve the built worker file at build time.
const WORKER_URL = "./worker.js";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const queueEl = $<HTMLUListElement>("queue");
const refusalsEl = $<HTMLUListElement>("refusals");
const liveEl = $<HTMLParagraphElement>("live");
const fileInput = $<HTMLInputElement>("file");
const drop = $<HTMLElement>("drop");
const batchEl = $<HTMLElement>("batch");
const downloadAllBtn = $<HTMLButtonElement>("download-all");
const clearAllBtn = $<HTMLButtonElement>("clear-all");

let lang: Lang = pickLang(localStorage.getItem("pubmy.lang"), navigator.language);

interface Row {
  li: HTMLLIElement;
  item: QueueItem<File>;
  progress: number;
  ready?: CountdownItem;
  stop?: Countdown;
}
const rows = new Map<number, Row>();
let lastRefusals: Refusal[] = [];

// terminate() is the only way to stop a conversion mid-way, so the client rebuilds the worker after a cancel or crash.
const client = createWorkerClient<File>({
  create: () => new Worker(WORKER_URL, { type: "module" }) as WorkerLike,
  onProgress: (file, p) => {
    const row = [...rows.values()].find((r) => r.item.file === file);
    if (!row) return;
    row.progress = p;
    render(row);
  },
});

const epubName = (name: string) => `${name.replace(/\.[^.]+$/, "") || name}.epub`;

function announce(text: string) {
  liveEl.textContent = text;
}

function onChange(item: QueueItem<File>) {
  let row = rows.get(item.id);
  if (!row) {
    const li = document.createElement("li");
    queueEl.append(li);
    row = { li, item, progress: 0 };
    rows.set(item.id, row);
  }
  if (item.status === "ready" && item.result?.ok && !row.ready) {
    startRetention(row, item.result.epub);
    // The countdown now owns the bytes and drops them at expiry; the queue item must not keep them alive.
    delete item.result;
  }
  if (item.status === "ready" || item.status === "failed") {
    announce(`${item.name}: ${statusText(row)}`);
    // A finished row no longer counts against the 10-file limit.
    queue.remove(item.id);
  }
  render(row);
}

function startRetention(row: Row, epub: Uint8Array) {
  const url = URL.createObjectURL(new Blob([epub as BlobPart], { type: "application/epub+zip" }));
  const ready: CountdownItem = { url, epub, remaining: RETENTION_MS, expired: false };
  row.ready = ready;
  row.stop = startCountdown(ready, {
    ms: RETENTION_MS,
    now: () => Date.now(),
    setTimer: (fn, ms) => {
      const h = setTimeout(fn, ms);
      return () => clearTimeout(h);
    },
    revoke: (u) => URL.revokeObjectURL(u),
    onTick: (it) => {
      // An open preview of this row closes and frees what it holds before the row shows Deleted.
      preview.onTick(it);
      if (it.expired) announce(`${row.item.name}: ${t("deleted", lang)}`);
      // A tick only changes the clock; rebuilding the row every second loses a screen reader's place.
      if (it.expired || !updateClock(row.li, it.remaining, lang)) render(row);
    },
  });
}

const dialog = $<HTMLDialogElement>("preview");
// Must equal the drawer breakpoint in the page CSS, or the list starts open on a width where it is a drawer.
const PREVIEW_NARROW = "(max-width: 60rem)";
const readerUi: ReaderUi = {
  stage: $("pv-stage"),
  page: $("pv-page"),
  toc: $("pv-toc"),
  tocList: $<HTMLOListElement>("pv-toc-list"),
  tocToggle: $<HTMLButtonElement>("pv-toc-toggle"),
  prev: $<HTMLButtonElement>("pv-prev"),
  next: $<HTMLButtonElement>("pv-next"),
  keys: dialog,
  narrow: () => matchMedia(PREVIEW_NARROW).matches,
  escape: () => dialog.close(),
};
const preview = createPreview({
  // The reader and foliate-js load on the first preview, as separate chunks.
  mount: async (loader) => (await import("./reader.ts")).mountReader(loader, readerUi),
  onClose: () => {
    if (dialog.open) dialog.close();
  },
});
let previewRow: Row | null = null;
// Esc, the close button, and expiry all end here, so the reader is always torn down.
dialog.addEventListener("close", () => {
  // Fullscreen belongs to the frame inside the dialog; leaving it open would keep the page covered after the reader is gone.
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  preview.close();
  const row = previewRow;
  previewRow = null;
  row?.li.querySelector<HTMLElement>('[data-action="preview"]:not(:disabled)')?.focus();
});
$<HTMLButtonElement>("pv-close").onclick = () => dialog.close();

const fullscreenBtn = $<HTMLButtonElement>("pv-fullscreen");
// A dialog cannot be the fullscreen element (Chromium: "Dialog elements are invalid"), so the frame inside it is.
const frame = dialog.querySelector<HTMLElement>(".pv")!;
// Hidden in the markup; shown only where the browser exposes the Fullscreen API on elements.
fullscreenBtn.hidden = typeof frame.requestFullscreen !== "function";
fullscreenBtn.addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else frame.requestFullscreen().catch(() => {});
});
// Esc and the close button also change fullscreen, so the state comes from the event, not from the click.
document.addEventListener("fullscreenchange", () => {
  fullscreenBtn.setAttribute("aria-pressed", String(document.fullscreenElement === frame));
});

// The drawer covers the page with a tap-away layer; the reader's own toggle handler keeps aria-expanded right.
readerUi.stage.addEventListener("click", () => {
  if (readerUi.narrow() && readerUi.toc.hidden === false) readerUi.tocToggle.click();
});

async function openPreview(row: Row) {
  if (!row.ready) return;
  previewRow = row;
  $("pv-title").textContent = row.item.name;
  dialog.showModal();
  try {
    if (!(await preview.open(row.ready))) dialog.close();
  } catch {
    dialog.close();
    announce(`${row.item.name}: ${t("preview-failed", lang)}`);
  }
}

function statusText(row: Row): string {
  const { item } = row;
  if (row.ready?.expired) return t("deleted", lang);
  if (item.status === "failed" && item.result && !item.result.ok) return failureText(item.result.code, item.result.message, lang);
  if (item.status === "converting" && row.progress > 0) return `${t("converting", lang)} ${Math.round(row.progress * 100)}%`;
  return t(item.status, lang);
}

function render(row: Row) {
  const { li, item, ready } = row;
  // Keyboard focus moves to the new copy of the focused control, or to Remove when that one is gone.
  const active = document.activeElement;
  const focused = active instanceof HTMLElement && li.contains(active) ? active.dataset.action : undefined;
  const view = {
    name: item.name,
    status: item.status,
    statusText: statusText(row),
    progress: row.progress,
    ready: ready && { url: ready.url, download: epubName(item.name), expired: ready.expired, remaining: ready.remaining },
  };
  renderRow(li, view, lang, { preview: () => void openPreview(row), extend: () => extend(row), remove: () => removeRow(row) }, focused)?.focus();
  refreshBatch();
}

/** Shows the batch bar and its buttons from the rows that exist now; an expired row no longer counts as ready. */
function refreshBatch() {
  const ready = [...rows.values()].filter((r) => r.ready && !r.ready.expired).length;
  $<HTMLElement>("kindle-hint").hidden = ready === 0;
  applyBatchBar(document, { batch: batchEl, downloadAll: downloadAllBtn, clearAll: clearAllBtn, choose: $<HTMLButtonElement>("choose") }, rows.size, ready);
}

downloadAllBtn.onclick = async () => {
  // Taken before the await: a row that expires while the ZIP builds has already been counted or skipped.
  const entries = [...rows.values()].flatMap((r) => (r.ready?.epub && !r.ready.expired ? [{ name: epubName(r.item.name), epub: r.ready.epub }] : []));
  if (entries.length < 2) return;
  downloadAllBtn.disabled = true;
  try {
    const url = URL.createObjectURL(new Blob([(await zipEpubs(entries)) as BlobPart], { type: "application/zip" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = ZIP_NAME;
    a.click();
    // Revoking at once can cancel the download in some browsers, so the link lives a little longer.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    announce(`${t("download-all", lang)}: ${entries.length}`);
  } catch {
    announce(`${t("download-all", lang)}: ${t("failed", lang)}`);
  } finally {
    downloadAllBtn.disabled = false;
    // Disabling the button made the browser drop focus from it: give it back, or to Choose if the button is gone.
    if (document.activeElement === document.body) (downloadAllBtn.hidden ? $<HTMLButtonElement>("choose") : downloadAllBtn).focus();
  }
};

clearAllBtn.onclick = () => {
  for (const row of [...rows.values()]) removeRow(row);
  announce(t("clear-all", lang));
  $<HTMLButtonElement>("choose").focus();
};

function extend(row: Row) {
  row.stop?.extend();
  if (row.ready && !row.ready.expired) announce(`${row.item.name}: ${t("expires-in", lang)} ${formatClock(RETENTION_MS)}`);
}

function removeRow(row: Row) {
  // Hiding the menu hands focus back to its trigger, which goes with the row: keep it on the page.
  const heldFocus = row.li.contains(document.activeElement);
  queue.remove(row.item.id);
  row.stop?.();
  row.li.remove();
  rows.delete(row.item.id);
  refreshBatch();
  if (heldFocus) $<HTMLButtonElement>("choose").focus();
}

// A row's menu opens in the top layer at the browser's default spot. It stays hidden from the moment it opens
// until placeMenu has set its position, so no frame paints in the wrong place. toggle does not bubble: capture.
const menuOf = (e: Event) => (e.target instanceof HTMLElement && e.target.classList.contains("menu") ? e.target : null);
queueEl.addEventListener("beforetoggle", (e) => {
  const menu = menuOf(e);
  if (menu && (e as ToggleEvent).newState === "open") {
    menu.style.visibility = "hidden";
    // beforetoggle, not toggle: a menu closed in the same task never gets its toggle:open event (measured).
    openedAtY = scrollY;
  }
}, true);
function placeMenuFor(menu: HTMLElement) {
  const trigger = queueEl.querySelector<HTMLElement>(`[popovertarget="${menu.id}"]`);
  if (!trigger) return;
  const m = menu.getBoundingClientRect();
  const pos = placeMenu(trigger.getBoundingClientRect(), { width: m.width, height: m.height }, { width: innerWidth, height: innerHeight });
  menu.style.left = `${pos.left}px`;
  menu.style.top = `${pos.top}px`;
}
queueEl.addEventListener("toggle", (e) => {
  const menu = menuOf(e);
  if (!menu || (e as ToggleEvent).newState !== "open") return;
  placeMenuFor(menu);
  menu.style.visibility = "";
}, true);

// A fixed menu would stay behind while the page moves, so scrolling or resizing closes it. Focusing the trigger
// scrolls it into view and that scroll event can land just after the menu opened, so only a scroll that moved the
// page away from where it was at opening counts.
let openedAtY = 0;
function closeMenus() {
  try {
    for (const m of queueEl.querySelectorAll<HTMLElement>(".menu:popover-open")) m.hidePopover();
  } catch {
    // no Popover API: `:popover-open` is an invalid selector there, and no menu was ever open
  }
}
function closeMenusOnScroll() {
  if (scrolledAway(scrollY, openedAtY)) closeMenus();
}
window.addEventListener("scroll", closeMenusOnScroll, { passive: true });
window.addEventListener("resize", closeMenus);

// A row above an open menu can change height (it finishes converting and drops its bar): that moves the trigger
// without a scroll or resize, so the menu is placed again.
function placeOpenMenus() {
  try {
    for (const m of queueEl.querySelectorAll<HTMLElement>(".menu:popover-open")) placeMenuFor(m);
  } catch {
    // no Popover API: nothing is open
  }
}
if (typeof ResizeObserver === "function") new ResizeObserver(placeOpenMenus).observe(queueEl);

function renderRefusals() {
  refusalsEl.replaceChildren(
    ...lastRefusals.map((r) => refusalRow(document, r.name, t(r.code, lang), lang)),
  );
}

const queue = createQueue<File>({ maxFiles: 10, maxBytes: 50 * 1024 * 1024, convert: client.convert, onChange });

function addFiles(list: FileList | null) {
  if (!list?.length) return;
  lastRefusals = queue.add(Array.from(list));
  renderRefusals();
}

// A phone or tablet has no mouse to drag files with.
$("drop-hint").dataset.i18n = dropHintKey(matchMedia("(hover: none) and (pointer: coarse)").matches);

function applyLang() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n]")) el.textContent = t(el.dataset.i18n as Key, lang);
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n-label]")) el.setAttribute("aria-label", t(el.dataset.i18nLabel as Key, lang));
  const toggle = $<HTMLButtonElement>("lang");
  toggle.textContent = t("lang-toggle", lang);
  toggle.setAttribute("aria-label", t("lang-toggle-label", lang));
  toggle.lang = lang === "id" ? "en" : "id";
  document.title = t("title", lang);
  for (const row of rows.values()) render(row);
  renderRefusals();
}

$<HTMLButtonElement>("lang").onclick = () => {
  lang = lang === "id" ? "en" : "id";
  localStorage.setItem("pubmy.lang", lang);
  applyLang();
};
$<HTMLButtonElement>("choose").onclick = () => fileInput.click();
fileInput.onchange = () => {
  addFiles(fileInput.files);
  fileInput.value = "";
};
drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("over");
});
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  addFiles(e.dataTransfer?.files ?? null);
});
// A file dropped outside the zone would otherwise make the browser navigate away from the page.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

applyLang();
