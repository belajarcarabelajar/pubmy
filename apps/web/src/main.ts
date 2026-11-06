import { formatClock, startCountdown, type CountdownItem } from "./countdown.ts";
import { failureText, pickLang, t, type Key, type Lang } from "./i18n.ts";
import { createQueue, type QueueItem, type Refusal } from "./queue.ts";
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

const queue = createQueue<File>({ maxFiles: 10, maxBytes: 50 * 1024 * 1024, convert: client.convert, onChange });

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
