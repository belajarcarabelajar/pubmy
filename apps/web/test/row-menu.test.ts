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
const plain = (status: string): RowView => ({ name: "tabel.md", status, statusText: status });

const order: string[] = [];
const actions = { preview: () => order.push("preview"), extend: () => order.push("extend"), remove: () => order.push("remove") };
const control = (row: HTMLLIElement, action: string) => row.querySelector<HTMLElement>(`[data-action="${action}"]`)!;
const click = (row: HTMLLIElement, el: HTMLElement) => el.dispatchEvent(new (row.ownerDocument.defaultView as unknown as typeof globalThis).Event("click"));

describe("the overflow menu of a ready row", () => {
  test("the More actions button points at the menu popover and names the file", () => {
    const row = li();
    renderRow(row, ready(), "en", actions);
    const more = row.querySelector<HTMLElement>(".more")!;
    const menu = row.querySelector<HTMLElement>(".menu")!;
    expect(more.tagName).toBe("BUTTON");
    expect(more.getAttribute("type")).toBe("button");
    expect(more.getAttribute("data-action")).toBe("more");
    expect(more.getAttribute("aria-label")).toBe("More actions tabel.md");
    expect(more.getAttribute("popovertarget")).toBe(menu.id);
    expect(menu.id).toMatch(/^menu-\d+$/);
    expect(menu.hasAttribute("popover")).toBe(true);
    expect(more.textContent).toBe("…");
    expect(more.querySelector('[aria-hidden="true"]')?.textContent).toBe("…");
    renderRow(row, ready(), "id", actions);
    expect(row.querySelector(".more")!.getAttribute("aria-label")).toBe("Aksi lainnya tabel.md");
  });

  test("Extend and Remove sit inside the menu; Download and Preview stay outside", () => {
    const row = li();
    renderRow(row, ready(), "en", actions);
    expect(control(row, "extend").closest(".menu")).not.toBeNull();
    expect(control(row, "remove").closest(".menu")).not.toBeNull();
    expect(control(row, "download").closest(".menu")).toBeNull();
    expect(control(row, "preview").closest(".menu")).toBeNull();
    expect(control(row, "extend").getAttribute("aria-label")).toBe("Extend tabel.md");
    expect(control(row, "remove").getAttribute("aria-label")).toBe("Remove tabel.md");
    expect(control(row, "download").getAttribute("aria-label")).toBe("Download EPUB tabel.md");
  });
});

describe("rows with fewer than two menu items", () => {
  test("waiting, converting, failed and expired rows keep Remove inline with no menu", () => {
    for (const v of [plain("waiting"), plain("converting"), plain("failed"), expired]) {
      const row = li();
      renderRow(row, v, "en", actions);
      expect(row.querySelector(".more")).toBeNull();
      expect(row.querySelector(".menu")).toBeNull();
      const remove = control(row, "remove");
      expect(remove.closest(".row-actions")).not.toBeNull();
      expect(remove.getAttribute("aria-label")).toBe("Remove tabel.md");
    }
  });
});

test("menu ids are unique across renders of two rows", () => {
  const a = li();
  const b = li();
  renderRow(a, ready(), "en", actions);
  renderRow(b, ready(), "en", actions);
  const first = a.querySelector(".menu")!.id;
  renderRow(a, ready(), "en", actions);
  const ids = [first, a.querySelector(".menu")!.id, b.querySelector(".menu")!.id];
  expect(new Set(ids).size).toBe(3);
});

describe("choosing an item closes the menu first", () => {
  test("Extend hides the popover, then extends once", () => {
    const row = li();
    order.length = 0;
    renderRow(row, ready(), "en", actions);
    (row.querySelector(".menu") as unknown as { hidePopover: () => void }).hidePopover = () => order.push("hide");
    click(row, control(row, "extend"));
    expect(order).toEqual(["hide", "extend"]);
  });

  test("Remove hides the popover, then removes once", () => {
    const row = li();
    order.length = 0;
    renderRow(row, ready(), "en", actions);
    (row.querySelector(".menu") as unknown as { hidePopover: () => void }).hidePopover = () => order.push("hide");
    click(row, control(row, "remove"));
    expect(order).toEqual(["hide", "remove"]);
  });

  test("without the Popover API the action still runs", () => {
    const row = li();
    order.length = 0;
    renderRow(row, ready(), "en", actions);
    expect(typeof (row.querySelector(".menu") as unknown as { hidePopover?: unknown }).hidePopover).not.toBe("function");
    click(row, control(row, "extend"));
    click(row, control(row, "remove"));
    expect(order).toEqual(["extend", "remove"]);
  });
});

describe("focus after a re-render", () => {
  // Compared by identity as booleans: a failing toBe on linkedom elements dumps the whole DOM.
  const same = (a: unknown, b: unknown) => a === b;

  test("a control that was inside the menu hands focus to the More actions button", () => {
    const row = li();
    expect(same(renderRow(row, ready(), "en", actions, "remove"), row.querySelector(".more"))).toBe(true);
    expect(same(renderRow(row, ready(), "en", actions, "extend"), row.querySelector(".more"))).toBe(true);
  });

  test("More actions keeps focus on its new copy", () => {
    const row = li();
    expect(same(renderRow(row, ready(), "en", actions, "more"), row.querySelector(".more"))).toBe(true);
  });

  test("Download keeps focus on its new copy", () => {
    const row = li();
    expect(same(renderRow(row, ready(), "en", actions, "download"), control(row, "download"))).toBe(true);
  });

  test("a row that just expired has no menu, so Extend focus falls to the inline Remove", () => {
    const row = li();
    const got = renderRow(row, expired, "en", actions, "extend");
    expect(got?.getAttribute("data-action")).toBe("remove");
    expect(same(got, control(row, "remove"))).toBe(true);
  });
});

test("updateClock still updates the clock of a ready row", () => {
  const row = li();
  renderRow(row, ready(), "en", actions);
  expect(updateClock(row, 59_000, "en")).toBe(true);
  expect(row.querySelector(".clock")?.textContent).toBe("Auto-deleted in 00:59");
});
