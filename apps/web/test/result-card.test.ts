import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { batchView } from "../src/batch.ts";
import { t } from "../src/i18n.ts";
import { refusalRow, renderRow, updateClock, type RowView } from "../src/row.ts";

// The result card after the UI review: a tick on ready rows, honest countdown copy, framed secondary actions
// with the menu trigger at the right end, a muted Clear all that waits for two rows.
// Expected values come from the review brief, not from reading row.ts or index.html back.
const html = readFileSync(join(import.meta.dir, "..", "index.html"), "utf8");
const css = /<style>([\s\S]*?)<\/style>/.exec(html)![1]!.replace(/\/\*[\s\S]*?\*\//g, "");

/** Declarations of every rule whose selector list contains `selector`, merged in source order. */
function rule(selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!m[1]!.split(",").map((s) => s.trim()).includes(selector)) continue;
    for (const d of m[2]!.split(";")) {
      const i = d.indexOf(":");
      if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    }
  }
  return out;
}
const flat = (selector: string) => Object.entries(rule(selector)).map(([k, v]) => `${k}:${v}`).join(";");
const rem = (v: string | undefined) => Number(/^([\d.]+)rem$/.exec(v ?? "")?.[1] ?? Number.NaN);

function li() {
  const { document } = parseHTML("<html><body><ul><li></li></ul></body></html>");
  return document.querySelector("li") as unknown as HTMLLIElement;
}
const ready = (expired = false): RowView => ({
  name: "tabel.md",
  status: "ready",
  statusText: expired ? "Deleted" : "Ready",
  ready: { url: expired ? undefined : "blob:x", download: "tabel.epub", expired, remaining: expired ? 0 : 180_000 },
});
const plain = (status: string, statusText: string): RowView => ({ name: "tabel.md", status, statusText });
const actions = { preview: () => {}, extend: () => {}, remove: () => {} };
const glyphOf = (v: RowView) => {
  const row = li();
  renderRow(row, v, "en", actions);
  return row.querySelector(".badge-icon");
};

describe("the status glyph", () => {
  test("a ready row shows a tick, hidden from assistive tech", () => {
    const icon = glyphOf(ready());
    expect(icon?.textContent).toBe("✓");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    const row = li();
    renderRow(row, ready(), "en", actions);
    expect(row.querySelector(".badge")?.textContent).toBe("✓Ready");
  });

  test("the other glyphs are unchanged", () => {
    expect(glyphOf(plain("waiting", "Waiting"))?.textContent).toBe("o");
    expect(glyphOf(plain("converting", "Converting"))?.textContent).toBe("~");
    expect(glyphOf(plain("failed", "Failed"))?.textContent).toBe("x");
    expect(glyphOf(plain("deleted", "Deleted"))?.textContent).toBe("-");
    expect(glyphOf(ready(true))?.textContent).toBe("-");
    expect(refusalRow(li().ownerDocument as unknown as Document, "a.exe", "no", "en").querySelector(".badge-icon")?.textContent).toBe("x");
  });
});

describe("the countdown says what really happens", () => {
  test("the expires-in strings read as written and promise no deletion", () => {
    expect(t("expires-in", "id")).toBe("Hasil dihapus dari memori dalam");
    expect(t("expires-in", "en")).toBe("Cleared from memory in");
    for (const lang of ["id", "en"] as const) expect(/delet|hapus otomatis/i.test(t("expires-in", lang)), lang).toBe(false);
  });

  test("the clock is the sentence followed by mm:ss, and a tick keeps that shape", () => {
    const row = li();
    renderRow(row, ready(), "en", actions);
    expect(row.querySelector(".clock")?.textContent).toBe("Cleared from memory in 03:00");
    updateClock(row, 59_000, "en");
    expect(row.querySelector(".clock")?.textContent).toBe("Cleared from memory in 00:59");
    renderRow(row, ready(), "id", actions);
    expect(row.querySelector(".clock")?.textContent).toBe("Hasil dihapus dari memori dalam 03:00");
  });
});

describe("the actions of a ready row", () => {
  test("they read Download, Preview, countdown, menu trigger, menu", () => {
    const row = li();
    renderRow(row, ready(), "en", actions);
    const bar = row.querySelector(".row-actions")!;
    expect([...bar.children].map((c) => c.getAttribute("data-action") ?? c.className)).toEqual(["download", "preview", "clock", "more", "menu"]);
  });

  test("the countdown takes the free space, which pushes the trigger to the right end", () => {
    expect(rule(".row-actions .clock")["margin-left"]).toBe("auto");
  });

  test("Preview, the trigger and an inline Remove have a visible frame and no link underline", () => {
    const ghost = rule(".row-actions button.ghost");
    expect(Object.keys(ghost).length).toBeGreaterThan(0);
    expect(ghost["border"]).toBe("1px solid var(--border)");
    expect(flat(".row-actions button.ghost")).not.toContain("transparent");
    expect((ghost["text-decoration"] ?? "none").includes("underline"), "text-decoration").toBe(false);
  });

  test("the framed buttons stay 44px tall and the trigger 44px wide", () => {
    expect(rule("button")["min-height"]).toBe("44px");
    for (const p of ["min-height", "height", "max-height"]) expect(rule(".row-actions button.ghost")[p], p).toBeUndefined();
    expect(rule(".row-actions button.more")["min-width"]).toBe("44px");
  });

  test("items inside the menu stay frameless, so the popover is not a stack of boxes", () => {
    expect(rule(".row-actions .menu button")["border-color"]).toBe("transparent");
  });

  test("no rule hard-codes a colour", () => {
    for (const sel of [".row-actions button.ghost", ".row-actions .clock", ".row-actions .menu button", "#clear-all"]) {
      expect(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(flat(sel)), sel).toBe(false);
    }
  });
});

describe("Clear all", () => {
  test("it is a small muted button, not the accent colour, and still 44px tall", () => {
    const clear = rule("#clear-all");
    expect(Object.keys(clear).length).toBeGreaterThan(0);
    expect(clear["color"]).toBe("var(--muted)");
    expect(clear["border-color"]).toBe("var(--border)");
    expect(clear["font-size"]).toBe(".9rem");
    const [vertical, horizontal] = (clear["padding"] ?? "").split(/\s+/);
    expect(rem(vertical)).toBeLessThan(0.5);
    expect(rem(horizontal ?? vertical)).toBeLessThan(1);
    for (const p of ["min-height", "height", "max-height"]) expect(clear[p], p).toBeUndefined();
  });

  test("it waits for a second row", () => {
    expect(batchView(1, 0).clearAll).toBe(false);
    expect(batchView(1, 1).clearAll).toBe(false);
    expect(batchView(2, 0).clearAll).toBe(true);
    expect(batchView(2, 2).clearAll).toBe(true);
  });

  test("Download all is unchanged: it needs two ready rows", () => {
    expect(batchView(1, 1).downloadAll).toBe(false);
    expect(batchView(2, 1).downloadAll).toBe(false);
    expect(batchView(2, 2).downloadAll).toBe(true);
    expect(batchView(10, 10).downloadAll).toBe(true);
  });
});
