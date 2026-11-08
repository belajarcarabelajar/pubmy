import { formatClock } from "./countdown.ts";
import { t, type Lang } from "./i18n.ts";

/** What one queue row shows. */
export interface RowView {
  /** The original file name. */
  name: string;
  /** The queue status, used as the row's class. */
  status: string;
  statusText: string;
  /** 0 to 1, only read while converting; 0, missing or invalid shows an indeterminate bar. */
  progress?: number;
  /** Set once the EPUB is ready: its download link and countdown. */
  ready?: { url?: string; download: string; expired: boolean; remaining: number };
}

export interface RowActions {
  preview(): void;
  extend(): void;
  remove(): void;
}

const clockText = (remaining: number, lang: Lang) => `${t("expires-in", lang)} ${formatClock(remaining)}`;

const GLYPHS: Record<string, string> = { waiting: "o", converting: "~", ready: "+", failed: "x", deleted: "-" };

/** Determinate when progress is above 0; otherwise no `value`, which makes the bar indeterminate. */
function progressBar(doc: Document, v: RowView): HTMLProgressElement {
  const bar = doc.createElement("progress");
  bar.className = "bar";
  bar.setAttribute("max", "1");
  // The badge beside the bar already reads the percentage, so the bar stays out of the accessibility tree.
  bar.setAttribute("aria-hidden", "true");
  const p = v.progress;
  if (p !== undefined && p > 0) bar.setAttribute("value", String(Math.min(p, 1)));
  return bar;
}

/** Ids must stay unique inside one page, so the counter is never reset. */
let menuSeq = 0;

/** `menu` is the popover the button lives in: it closes first, since the row is not re-rendered by every action. */
function button(doc: Document, action: string, label: string, name: string, onClick: () => void, menu?: HTMLElement): HTMLButtonElement {
  const b = doc.createElement("button");
  b.type = "button";
  b.className = "ghost";
  b.dataset.action = action;
  b.textContent = label;
  b.setAttribute("aria-label", `${label} ${name}`);
  b.addEventListener("click", () => {
    if (menu && typeof menu.hidePopover === "function") menu.hidePopover();
    onClick();
  });
  return b;
}

/** A refused file never enters the queue, so its row has no actions: name, Refused badge and the reason. */
export function refusalRow(doc: Document, fileName: string, reason: string, lang: Lang): HTMLLIElement {
  const li = doc.createElement("li");
  li.className = "failed refused";
  const name = doc.createElement("span");
  name.className = "name";
  name.textContent = fileName;
  const status = doc.createElement("span");
  status.className = "status";
  const badge = doc.createElement("span");
  badge.className = "badge";
  const icon = doc.createElement("span");
  icon.className = "badge-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = GLYPHS.failed!;
  badge.append(icon, t("refused", lang));
  status.append(badge);
  const why = doc.createElement("span");
  why.className = "reason";
  why.textContent = reason;
  li.append(name, status, why);
  return li;
}

/**
 * Builds the row's content. `focused` is the action of the control that had keyboard focus in
 * this row; the return value is the control that should take it now: its new copy, or Remove when
 * that control is gone or disabled (at expiry), so focus never falls back to the page.
 */
export function renderRow(li: HTMLLIElement, v: RowView, lang: Lang, actions: RowActions, focused?: string): HTMLElement | undefined {
  const doc = li.ownerDocument;
  // main.ts keeps status "ready" while the text says "Deleted" at expiry, so the row class and glyph follow ready.expired.
  const shown = v.ready?.expired ? "deleted" : v.status;
  li.className = shown;
  li.replaceChildren();
  const name = doc.createElement("span");
  name.className = "name";
  name.textContent = v.name;
  const glyph = GLYPHS[shown] ?? "o";
  const status = doc.createElement("span");
  status.className = "status";
  const badge = doc.createElement("span");
  badge.className = "badge";
  const icon = doc.createElement("span");
  icon.className = "badge-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = glyph;
  badge.append(icon, v.statusText);
  status.append(badge);
  const row = doc.createElement("div");
  row.className = "row-actions";
  const { ready } = v;
  let menu: HTMLElement | undefined;
  let more: HTMLButtonElement | undefined;
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
      const id = `menu-${++menuSeq}`;
      menu = doc.createElement("div");
      menu.className = "menu";
      menu.id = id;
      menu.setAttribute("popover", "");
      more = doc.createElement("button");
      more.type = "button";
      more.className = "ghost more";
      more.dataset.action = "more";
      more.setAttribute("popovertarget", id);
      more.setAttribute("aria-label", `${t("more-actions", lang)} ${v.name}`);
      const dots = doc.createElement("span");
      dots.setAttribute("aria-hidden", "true");
      dots.textContent = "…";
      more.append(dots);
      menu.append(button(doc, "extend", t("extend", lang), v.name, actions.extend, menu));
      row.append(clock, more, menu);
    }
  }
  const rm = button(doc, "remove", t("remove", lang), v.name, actions.remove, menu);
  (menu ?? row).append(rm);
  li.append(name, status);
  if (v.status === "converting") li.append(progressBar(doc, v));
  li.append(row);
  if (!focused) return undefined;
  // The rebuilt menu is closed, and a control inside a closed popover cannot take focus.
  if (more && (focused === "more" || focused === "extend" || focused === "remove")) return more;
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
