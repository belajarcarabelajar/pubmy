import { formatClock, startCountdown, type CountdownItem } from "./countdown.ts";
import { dropHintKey, failureText, pickLang, t, type Key, type Lang } from "./i18n.ts";
import { createPreview } from "./preview-session.ts";
import { createQueue, type QueueItem, type Refusal } from "./queue.ts";
import type { ReaderUi } from "./reader.ts";
import { createWorkerClient, type WorkerLike } from "./worker-client.ts";

const RETENTION_MS = 180_000;
// A variable keeps the bundler from trying to resolve the built worker file at build time.
const WORKER_URL = "./worker.js";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const queueEl = $<HTMLUListElement>("queue");
const refusalsEl = $<HTMLUListElement>("refusals");
const liveEl = $<HTMLParagraphElement>("live");
const fileInput = $<HTMLInputElement>("file");
const drop = $<HTMLElement>("drop");

let lang: Lang = pickLang(localStorage.getItem("pubmy.lang"), navigator.language);

interface Row {
  li: HTMLLIElement;
  item: QueueItem<File>;
  progress: number;
  ready?: CountdownItem;
  stop?: () => void;
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
      render(row);
    },
  });
}

const dialog = $<HTMLDialogElement>("preview");
const readerUi: ReaderUi = {
  stage: $("pv-stage"),
  page: $("pv-page"),
  toc: $("pv-toc"),
  tocList: $<HTMLOListElement>("pv-toc-list"),
  tocToggle: $<HTMLButtonElement>("pv-toc-toggle"),
  prev: $<HTMLButtonElement>("pv-prev"),
  next: $<HTMLButtonElement>("pv-next"),
  keys: dialog,
  narrow: () => matchMedia("(max-width: 40rem)").matches,
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
  preview.close();
  const row = previewRow;
  previewRow = null;
  row?.li.querySelector<HTMLElement>('[data-action="preview"]:not(:disabled)')?.focus();
});
$<HTMLButtonElement>("pv-close").onclick = () => dialog.close();

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
  // The countdown rebuilds the row every second, so keyboard focus moves to the new copy of the focused control.
  const active = document.activeElement;
  const focused = active instanceof HTMLElement && li.contains(active) ? active.dataset.action : undefined;
  li.className = item.status;
  li.replaceChildren();
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = item.name;
  const status = document.createElement("span");
  status.className = "status";
  status.textContent = statusText(row);
  const actions = document.createElement("div");
  actions.className = "row-actions";
  if (ready) {
    const a = document.createElement("a");
    a.className = "btn";
    a.dataset.action = "download";
    a.textContent = t("download", lang);
    a.download = epubName(item.name);
    if (ready.url) a.href = ready.url;
    else a.setAttribute("aria-disabled", "true");
    const pv = document.createElement("button");
    pv.type = "button";
    pv.className = "ghost";
    pv.dataset.action = "preview";
    pv.textContent = t("preview", lang);
    pv.setAttribute("aria-label", `${t("preview", lang)} ${item.name}`);
    pv.disabled = ready.expired;
    pv.onclick = () => void openPreview(row);
    actions.append(a, pv);
    if (!ready.expired) {
      const clock = document.createElement("span");
      clock.className = "clock";
      clock.textContent = `${t("expires-in", lang)} ${formatClock(ready.remaining)}`;
      actions.append(clock);
    }
  }
  const rm = document.createElement("button");
  rm.type = "button";
  rm.className = "ghost";
  rm.textContent = t("remove", lang);
  rm.setAttribute("aria-label", `${t("remove", lang)} ${item.name}`);
  rm.dataset.action = "remove";
  rm.onclick = () => removeRow(row);
  actions.append(rm);
  li.append(name, status, actions);
  if (focused) li.querySelector<HTMLElement>(`[data-action="${focused}"]`)?.focus();
}

function removeRow(row: Row) {
  queue.remove(row.item.id);
  row.stop?.();
  row.li.remove();
  rows.delete(row.item.id);
}

function renderRefusals() {
  refusalsEl.replaceChildren(
    ...lastRefusals.map((r) => {
      const li = document.createElement("li");
      li.textContent = `${r.name}: ${t(r.code, lang)}`;
      return li;
    }),
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
