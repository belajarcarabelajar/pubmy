import { formatClock } from "./countdown.ts";
import { t, type Lang } from "./i18n.ts";

/** What one queue row shows. */
export interface RowView {
  /** The original file name. */
  name: string;
  /** The queue status, used as the row's class. */
  status: string;
  statusText: string;
  /** Set once the EPUB is ready: its download link and countdown. */
  ready?: { url?: string; download: string; expired: boolean; remaining: number };
}

export interface RowActions {
  preview(): void;
  extend(): void;
  remove(): void;
}

const clockText = (remaining: number, lang: Lang) => `${t("expires-in", lang)} ${formatClock(remaining)}`;

function button(doc: Document, action: string, label: string, name: string, onClick: () => void): HTMLButtonElement {
  const b = doc.createElement("button");
  b.type = "button";
  b.className = "ghost";
  b.dataset.action = action;
  b.textContent = label;
  b.setAttribute("aria-label", `${label} ${name}`);
  b.addEventListener("click", onClick);
  return b;
}

/**
 * Builds the row's content. `focused` is the action of the control that had keyboard focus in
 * this row; the return value is the control that should take it now: its new copy, or Remove when
 * that control is gone or disabled (at expiry), so focus never falls back to the page.
 */
export function renderRow(li: HTMLLIElement, v: RowView, lang: Lang, actions: RowActions, focused?: string): HTMLElement | undefined {
  const doc = li.ownerDocument;
  li.className = v.status;
  li.replaceChildren();
  const name = doc.createElement("span");
  name.className = "name";
  name.textContent = v.name;
  const status = doc.createElement("span");
  status.className = "status";
  status.textContent = v.statusText;
  const row = doc.createElement("div");
  row.className = "row-actions";
  const { ready } = v;
  if (ready) {
    const a = doc.createElement("a");
    a.className = "btn";
    a.dataset.action = "download";
    a.textContent = t("download", lang);
    a.setAttribute("aria-label", `${t("download", lang)} ${v.name}`);
    a.download = ready.download;
    if (ready.url) a.href = ready.url;
    else a.setAttribute("aria-disabled", "true");
    const pv = button(doc, "preview", t("preview", lang), v.name, actions.preview);
    pv.disabled = ready.expired;
    row.append(a, pv);
    if (!ready.expired) {
      const clock = doc.createElement("span");
      clock.className = "clock";
      clock.textContent = clockText(ready.remaining, lang);
      row.append(clock, button(doc, "extend", t("extend", lang), v.name, actions.extend));
    }
  }
  const rm = button(doc, "remove", t("remove", lang), v.name, actions.remove);
  row.append(rm);
  li.append(name, status, row);
  if (!focused) return undefined;
  const again = li.querySelector<HTMLElement>(`[data-action="${focused}"]`);
  const usable = again && !(again as HTMLButtonElement).disabled && again.getAttribute("aria-disabled") !== "true";
  return usable ? again : rm;
}

/** Updates only the countdown text, so a screen reader keeps its place. False when the row has no countdown. */
export function updateClock(li: HTMLLIElement, remaining: number, lang: Lang): boolean {
  const clock = li.querySelector(".clock");
  if (!clock) return false;
  clock.textContent = clockText(remaining, lang);
  return true;
}
