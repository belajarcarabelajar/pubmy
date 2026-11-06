import type { Result } from "@pubmy/core";
import { formatClock, startCountdown, type CountdownItem } from "./countdown.ts";
import { failureText, pickLang, t, type Key, type Lang } from "./i18n.ts";
import { createQueue, type QueueItem, type Refusal } from "./queue.ts";
import type { FromWorker, ToWorker } from "./worker.ts";

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

// One worker, rebuilt after a cancel: terminate() is the only way to stop a conversion mid-way.
let worker: Worker | null = null;
let jobSeq = 0;
const pending = new Map<number, { file: File; resolve: (r: Result) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(WORKER_URL, { type: "module" });
  w.onmessage = (e: MessageEvent<FromWorker>) => {
    const m = e.data;
    const job = pending.get(m.id);
    if (!job) return;
    if (m.type === "progress") {
      const row = [...rows.values()].find((r) => r.item.file === job.file);
      if (row) row.progress = m.p;
      if (row) render(row);
      return;
    }
    pending.delete(m.id);
    job.resolve(m.result);
  };
  worker = w;
  return w;
}

async function convertInWorker(file: File, signal: AbortSignal): Promise<Result> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (signal.aborted) return { ok: false, code: "READ_FAILED", message: "cancelled" };
  const id = ++jobSeq;
  return new Promise<Result>((resolve) => {
    pending.set(id, { file, resolve });
    signal.addEventListener("abort", () => {
      worker?.terminate();
      worker = null;
      for (const [k, j] of pending) j.resolve({ ok: false, code: "READ_FAILED", message: "cancelled" }), pending.delete(k);
    });
    const msg: ToWorker = { type: "convert", id, name: file.name, bytes };
    getWorker().postMessage(msg, [bytes.buffer]);
  });
}

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
  if (item.status === "ready" && item.result?.ok && !row.ready) startRetention(row, item.result.epub);
  if (item.status === "ready" || item.status === "failed") {
    announce(`${item.name}: ${statusText(row)}`);
    // A finished row no longer counts against the 10-file limit.
    queue.remove(item.id);
  }
  render(row);
}

function startRetention(row: Row, epub: Uint8Array) {
  const url = URL.createObjectURL(new Blob([epub as BlobPart], { type: "application/epub+zip" }));
  const ready: CountdownItem = { url, remaining: RETENTION_MS, expired: false };
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
      if (it.expired) announce(`${row.item.name}: ${t("deleted", lang)}`);
      render(row);
    },
  });
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
    a.textContent = t("download", lang);
    a.download = epubName(item.name);
    if (ready.url) a.href = ready.url;
    else a.setAttribute("aria-disabled", "true");
    actions.append(a);
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
  rm.onclick = () => removeRow(row);
  actions.append(rm);
  li.append(name, status, actions);
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

const queue = createQueue<File>({ maxFiles: 10, maxBytes: 50 * 1024 * 1024, convert: convertInWorker, onChange });

function addFiles(list: FileList | null) {
  if (!list?.length) return;
  lastRefusals = queue.add(Array.from(list));
  renderRefusals();
}

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
