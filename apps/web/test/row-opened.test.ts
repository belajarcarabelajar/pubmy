import { describe, expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { renderRow, updateClock, type RowView } from "../src/row.ts";

function li() {
  const { document } = parseHTML("<html><body><ul><li></li></ul></body></html>");
  return document.querySelector("li") as unknown as HTMLLIElement;
}

const opened = (over: Partial<NonNullable<RowView["ready"]>> = {}): RowView => ({
  name: "buku.epub",
  status: "ready",
  statusText: "Ready to read",
  kind: "opened",
  ready: { download: "buku.epub", expired: false, remaining: 180_000, ...over },
});
const openedExpired: RowView = { ...opened(), ready: { download: "buku.epub", expired: true, remaining: 0 } };
const converted = (): RowView => ({
  name: "tabel.md",
  status: "ready",
  statusText: "Ready",
  ready: { url: "blob:x", download: "tabel.epub", expired: false, remaining: 180_000 },
});

const calls: string[] = [];
const actions = { preview: () => calls.push("preview"), extend: () => calls.push("extend"), remove: () => calls.push("remove") };
const control = (row: HTMLLIElement, action: string) => row.querySelector<HTMLElement>(`[data-action="${action}"]`)!;
const click = (row: HTMLLIElement, el: HTMLElement) => el.dispatchEvent(new (row.ownerDocument.defaultView as unknown as typeof globalThis).Event("click"));
// Compared by identity as booleans: a failing toBe on linkedom elements dumps the whole DOM.
const same = (a: unknown, b: unknown) => a === b;
const has = (row: HTMLLIElement, selector: string) => row.querySelector(selector) !== null;

describe("an opened row", () => {
  test("has no download control at all, whatever ready.download or ready.url say", () => {
    const row = li();
    renderRow(row, { ...opened(), ready: { url: "blob:x", download: "buku.epub", expired: false, remaining: 180_000 } }, "en", actions);
    expect(has(row, '[data-action="download"]')).toBe(false);
    expect(has(row, "a")).toBe(false);
    expect(has(row, "[download]")).toBe(false);
    expect(has(row, "[href]")).toBe(false);
  });

  test("the preview button reads Read in English and names the file", () => {
    const row = li();
    renderRow(row, opened(), "en", actions);
    const pv = control(row, "preview");
    expect(pv.tagName).toBe("BUTTON");
    expect(pv.textContent).toBe("Read");
    expect(pv.getAttribute("aria-label")).toBe("Read buku.epub");
  });

  test("the preview button reads Baca in Indonesian and names the file", () => {
    const row = li();
    renderRow(row, opened(), "id", actions);
    const pv = control(row, "preview");
    expect(pv.textContent).toBe("Baca");
    expect(pv.getAttribute("aria-label")).toBe("Baca buku.epub");
  });

  test("the Read button runs the preview action", () => {
    const row = li();
    calls.length = 0;
    renderRow(row, opened(), "en", actions);
    click(row, control(row, "preview"));
    expect(calls).toEqual(["preview"]);
  });

  test("keeps the clock, the More actions button, the Extend entry and Remove", () => {
    const row = li();
    renderRow(row, opened(), "en", actions);
    expect(row.querySelector(".clock")?.textContent).toBe("Cleared from memory in 03:00");
    expect(control(row, "more").getAttribute("aria-label")).toBe("More actions buku.epub");
    expect(control(row, "extend").closest(".menu") !== null).toBe(true);
    expect(control(row, "extend").getAttribute("aria-label")).toBe("Extend buku.epub");
    expect(control(row, "remove").closest(".menu") !== null).toBe(true);
    expect(control(row, "remove").getAttribute("aria-label")).toBe("Remove buku.epub");
    expect(control(row, "preview").closest(".menu") === null).toBe(true);
  });

  test("shows the status text it is given and the ready glyph", () => {
    const row = li();
    renderRow(row, opened(), "en", actions);
    expect(row.className).toBe("ready");
    expect(row.querySelector(".badge")?.textContent).toBe("✓Ready to read");
  });

  test("the countdown tick updates only the clock text", () => {
    const row = li();
    renderRow(row, opened(), "en", actions);
    const before = [...row.querySelectorAll("*")];
    expect(updateClock(row, 59_000, "en")).toBe(true);
    const after = [...row.querySelectorAll("*")];
    expect(after.length === before.length && after.every((e, i) => e === before[i])).toBe(true);
    expect(row.querySelector(".clock")?.textContent).toBe("Cleared from memory in 00:59");
  });
});

describe("an expired opened row", () => {
  test("has a disabled Read button, no clock, no menu and only Remove", () => {
    const row = li();
    renderRow(row, openedExpired, "en", actions);
    expect(row.className).toBe("deleted");
    const pv = control(row, "preview") as HTMLButtonElement;
    expect(pv.disabled).toBe(true);
    expect(pv.textContent).toBe("Read");
    expect(has(row, ".clock")).toBe(false);
    expect(has(row, ".more")).toBe(false);
    expect(has(row, ".menu")).toBe(false);
    expect(has(row, '[data-action="extend"]')).toBe(false);
    expect(has(row, '[data-action="download"]')).toBe(false);
    expect(control(row, "remove").closest(".row-actions") !== null).toBe(true);
  });
});

describe("a row that is not opened", () => {
  test("with no kind keeps its download link and the Preview button", () => {
    const row = li();
    renderRow(row, converted(), "en", actions);
    const a = control(row, "download");
    expect(a.tagName).toBe("A");
    expect(a.getAttribute("href")).toBe("blob:x");
    expect(a.getAttribute("download")).toBe("tabel.epub");
    expect(a.getAttribute("aria-label")).toBe("Download EPUB tabel.md");
    expect(control(row, "preview").textContent).toBe("Preview");
    expect(control(row, "preview").getAttribute("aria-label")).toBe("Preview tabel.md");
  });

  test("kind converted renders the same markup as no kind, menu ids aside", () => {
    const plain = li();
    const tagged = li();
    renderRow(plain, converted(), "en", actions);
    renderRow(tagged, { ...converted(), kind: "converted" }, "en", actions);
    const markup = (row: HTMLLIElement) => row.innerHTML.replace(/menu-\d+/g, "menu-N");
    expect(markup(tagged)).toBe(markup(plain));
  });
});

describe("focus after a re-render of an opened row", () => {
  test("Read keeps focus on its new copy", () => {
    const row = li();
    renderRow(row, opened(), "en", actions);
    expect(same(renderRow(row, opened({ remaining: 120_000 }), "en", actions, "preview"), control(row, "preview"))).toBe(true);
  });

  test("a control that was inside the menu hands focus to the More actions button", () => {
    const row = li();
    expect(same(renderRow(row, opened(), "en", actions, "remove"), control(row, "more"))).toBe(true);
    expect(same(renderRow(row, opened(), "en", actions, "extend"), control(row, "more"))).toBe(true);
  });

  test("with no focus to restore nothing is returned", () => {
    const row = li();
    expect(renderRow(row, opened(), "en", actions)).toBeUndefined();
  });

  test("a focus on the download link that no longer exists falls back to Remove, not to the page", () => {
    const row = li();
    const got = renderRow(row, opened(), "en", actions, "download");
    expect(got?.getAttribute("data-action")).toBe("remove");
    expect(same(got, control(row, "remove"))).toBe(true);
  });

  test("when the row expires under focus, focus moves to the inline Remove", () => {
    const row = li();
    renderRow(row, opened(), "en", actions);
    for (const was of ["preview", "download", "extend", "more"]) {
      const got = renderRow(row, openedExpired, "en", actions, was);
      expect(got?.getAttribute("data-action")).toBe("remove");
      expect(same(got, control(row, "remove"))).toBe(true);
    }
  });
});
