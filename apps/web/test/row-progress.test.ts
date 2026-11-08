import { describe, expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { renderRow, type RowView } from "../src/row.ts";

function li() {
  const { document } = parseHTML("<html><body><ul><li></li></ul></body></html>");
  return document.querySelector("li") as unknown as HTMLLIElement;
}

const converting = (progress?: number, statusText = "Converting 42%"): RowView => ({
  name: "tabel.md",
  status: "converting",
  statusText,
  progress,
});
const plain = (status: string, statusText: string): RowView => ({ name: "tabel.md", status, statusText });
const ready = (expired = false, statusText = expired ? "Deleted" : "Ready"): RowView => ({
  name: "tabel.md",
  status: "ready",
  statusText,
  ready: { url: expired ? undefined : "blob:x", download: "tabel.epub", expired, remaining: expired ? 0 : 180_000 },
});

const actions = { preview: () => {}, extend: () => {}, remove: () => {} };
const bars = (row: HTMLLIElement) => [...row.querySelectorAll("progress.bar")];

describe("progress bar", () => {
  // The badge right beside the bar already says "Converting 42%", so a labelled bar would be read twice per tick.
  test("a converting row with progress 0.42 shows one bar with value 0.42 and max 1, hidden from screen readers", () => {
    const row = li();
    renderRow(row, converting(0.42), "en", actions);
    const found = bars(row);
    expect(found).toHaveLength(1);
    expect(found[0]!.getAttribute("value")).toBe("0.42");
    expect(found[0]!.getAttribute("max")).toBe("1");
    expect(found[0]!.getAttribute("aria-hidden")).toBe("true");
    expect(found[0]!.hasAttribute("aria-label")).toBe(false);
    expect(row.querySelector(".badge")!.textContent).toContain("Converting 42%");
  });

  test("the bar sits directly in the row, between the status and the actions", () => {
    const row = li();
    renderRow(row, converting(0.5), "en", actions);
    expect([...row.children].map((c) => c.className)).toEqual(["name", "status", "bar", "row-actions"]);
  });

  test("progress 0 and undefined give an indeterminate bar (no value attribute)", () => {
    for (const p of [0, undefined]) {
      const row = li();
      renderRow(row, converting(p), "en", actions);
      expect(bars(row)).toHaveLength(1);
      expect(bars(row)[0]!.hasAttribute("value")).toBe(false);
      expect(bars(row)[0]!.getAttribute("max")).toBe("1");
    }
  });

  test("progress above 1 clamps to 1", () => {
    const row = li();
    renderRow(row, converting(1.7), "en", actions);
    expect(bars(row)[0]!.getAttribute("value")).toBe("1");
  });

  test("negative or NaN progress is indeterminate", () => {
    for (const p of [-1, Number.NaN]) {
      const row = li();
      renderRow(row, converting(p), "en", actions);
      expect(bars(row)).toHaveLength(1);
      expect(bars(row)[0]!.hasAttribute("value")).toBe(false);
    }
  });

  test("waiting, ready and failed rows have no bar, even when a progress value is passed", () => {
    for (const v of [plain("waiting", "Waiting"), ready(), plain("failed", "Failed")]) {
      const row = li();
      renderRow(row, { ...v, progress: 0.5 }, "en", actions);
      expect(row.querySelector("progress")).toBeNull();
    }
  });

  test("rendering the same row twice keeps one bar", () => {
    const row = li();
    renderRow(row, converting(0.2), "en", actions);
    renderRow(row, converting(0.4), "en", actions);
    expect(bars(row)).toHaveLength(1);
    expect(bars(row)[0]!.getAttribute("value")).toBe("0.4");
  });
});

describe("status badge", () => {
  const cases: [RowView, string, string][] = [
    [plain("waiting", "Waiting"), "o", "Waiting"],
    [converting(0.42, "Converting"), "~", "Converting"],
    [ready(), "+", "Ready"],
    [plain("failed", "Failed"), "x", "Failed"],
    [plain("deleted", "Deleted"), "-", "Deleted"],
    [plain("mystery", "Something"), "o", "Something"],
    [ready(true), "-", "Deleted"],
  ];

  test("the badge is status > badge > hidden icon, and its text is the glyph followed by the status text", () => {
    for (const [view, glyph, text] of cases) {
      const row = li();
      renderRow(row, view, "en", actions);
      const badge = row.querySelector(".status .badge");
      expect(badge).not.toBeNull();
      const icon = badge!.querySelector(".badge-icon");
      expect(icon?.getAttribute("aria-hidden")).toBe("true");
      expect(icon?.textContent).toBe(glyph);
      expect(badge!.textContent).toBe(glyph + text);
    }
  });

  test("without the icon the badge reads exactly the status text", () => {
    for (const [view, glyph, text] of cases) {
      const row = li();
      renderRow(row, view, "en", actions);
      const badge = row.querySelector(".badge")!;
      expect(badge.textContent!.slice(glyph.length)).toBe(text);
      expect(row.querySelector(".status")!.textContent!.slice(glyph.length)).toBe(text);
    }
  });

  // main.ts keeps the queue status "ready" at expiry; the row must still take the neutral "deleted" look, not the green one.
  test("an expired ready row takes the deleted class and the deleted glyph", () => {
    const row = li();
    renderRow(row, ready(true), "en", actions);
    expect(row.className).toBe("deleted");
    expect(row.querySelector(".badge-icon")!.textContent).toBe("-");
    renderRow(row, ready(false), "en", actions);
    expect(row.className).toBe("ready");
  });
});

describe("actions", () => {
  test("Download is the only filled button, every other action is ghost", () => {
    const row = li();
    renderRow(row, ready(), "en", actions);
    const btns = [...row.querySelectorAll(".btn")];
    expect(btns).toHaveLength(1);
    expect(btns[0]!.getAttribute("data-action")).toBe("download");
    const others = [...row.querySelectorAll("[data-action]")].filter((e) => e.getAttribute("data-action") !== "download");
    expect(others.map((e) => e.getAttribute("data-action"))).toEqual(["preview", "more", "extend", "remove"]);
    for (const e of others) expect(e.classList.contains("ghost")).toBe(true);
  });

  test("a failed row has Remove as a ghost and no filled button", () => {
    const row = li();
    renderRow(row, plain("failed", "Failed"), "en", actions);
    expect(row.querySelectorAll(".btn")).toHaveLength(0);
    expect(row.querySelector('[data-action="remove"]')!.classList.contains("ghost")).toBe(true);
  });
});

describe("re-render", () => {
  test("a second render replaces the badge instead of appending, and focus falls back to Remove when its control is gone", () => {
    const row = li();
    renderRow(row, ready(), "en", actions);
    const back = renderRow(row, ready(true), "en", actions, "extend");
    expect(row.querySelectorAll(".status")).toHaveLength(1);
    expect(row.querySelectorAll(".badge")).toHaveLength(1);
    expect(back).toBe(row.querySelector('[data-action="remove"]') as HTMLElement);
  });
});
