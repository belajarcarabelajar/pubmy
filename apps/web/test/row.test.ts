import { describe, expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { renderRow, updateClock, type RowView } from "../src/row.ts";

function li() {
  const { document } = parseHTML("<html><body><ul><li></li></ul></body></html>");
  return document.querySelector("li") as unknown as HTMLLIElement;
}

const ready = (over: Partial<NonNullable<RowView["ready"]>> = {}): RowView => ({
  name: "tabel.md",
  status: "ready",
  statusText: "Ready",
  ready: { url: "blob:x", download: "tabel.epub", expired: false, remaining: 180_000, ...over },
});
const expired: RowView = { ...ready(), ready: { download: "tabel.epub", expired: true, remaining: 0 } };

const calls: string[] = [];
const actions = { preview: () => calls.push("preview"), extend: () => calls.push("extend"), remove: () => calls.push("remove") };
const control = (row: HTMLLIElement, action: string) => row.querySelector<HTMLElement>(`[data-action="${action}"]`)!;
const name = (e: HTMLElement) => e.getAttribute("aria-label") ?? e.textContent;

describe("renderRow", () => {
  test("every control of a ready row names the file, the download link included", () => {
    const row = li();
    renderRow(row, ready(), "en", actions);
    expect(name(control(row, "download"))).toBe("Download EPUB tabel.md");
    expect(control(row, "download").getAttribute("href")).toBe("blob:x");
    expect(control(row, "download").getAttribute("download")).toBe("tabel.epub");
    expect(name(control(row, "preview"))).toBe("Preview tabel.md");
    expect(name(control(row, "extend"))).toBe("Extend tabel.md");
    expect(name(control(row, "remove"))).toBe("Remove tabel.md");
    expect(row.querySelector(".clock")?.textContent).toBe("Deleted in 03:00");
  });

  test("the extend button asks for more time", () => {
    const row = li();
    calls.length = 0;
    renderRow(row, ready(), "en", actions);
    control(row, "extend").dispatchEvent(new (row.ownerDocument.defaultView as unknown as typeof globalThis).Event("click"));
    expect(calls).toEqual(["extend"]);
  });

  test("an expired row has no extend button and no clock", () => {
    const row = li();
    renderRow(row, expired, "en", actions);
    expect(row.querySelector('[data-action="extend"]')).toBeNull();
    expect(row.querySelector(".clock")).toBeNull();
  });

  test("focus goes back to the copy of the control the user was on", () => {
    const row = li();
    renderRow(row, ready(), "en", actions);
    // Compared by identity as booleans: a failing toBe on linkedom elements dumps the whole DOM.
    expect(renderRow(row, ready({ remaining: 120_000 }), "en", actions, "preview") === control(row, "preview")).toBe(true);
    // Extend now lives in a closed popover, which cannot take focus, so the More actions button gets it.
    expect(renderRow(row, ready({ remaining: 120_000 }), "en", actions, "extend") === control(row, "more")).toBe(true);
    expect(renderRow(row, ready(), "en", actions)).toBeUndefined();
  });

  test("when the focused control is disabled at expiry, focus moves to Remove instead of the page", () => {
    const row = li();
    renderRow(row, ready(), "en", actions);
    for (const was of ["preview", "download", "extend"]) {
      expect(renderRow(row, expired, "en", actions, was)).toBe(control(row, "remove"));
    }
  });
});

describe("updateClock", () => {
  test("a countdown tick changes only the clock text, so a screen reader keeps its place in the row", () => {
    const row = li();
    renderRow(row, ready(), "en", actions);
    const before = [...row.querySelectorAll("*")];
    expect(updateClock(row, 59_000, "en")).toBe(true);
    expect([...row.querySelectorAll("*")]).toEqual(before);
    expect(row.querySelector(".clock")?.textContent).toBe("Deleted in 00:59");
  });

  test("a row without a countdown needs a full render", () => {
    const row = li();
    renderRow(row, expired, "en", actions);
    expect(updateClock(row, 59_000, "en")).toBe(false);
  });
});
