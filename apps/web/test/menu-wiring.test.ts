import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// main.ts runs against the live DOM at import, so these checks read it as text. Each one is anchored on
// the new call itself, so deleting that call turns the check red; the real-browser run proves the behaviour.
const main = readFileSync(join(import.meta.dir, "..", "src", "main.ts"), "utf8");

/** A capture-phase listener on the queue: from its opening line to the closing `}, true);` line. */
function queueListener(type: string): string {
  const start = main.indexOf(`queueEl.addEventListener("${type}"`);
  if (start < 0) return "";
  const end = main.indexOf("\n}, true);", start);
  return end < 0 ? "" : main.slice(start, end + "\n}, true);".length);
}

describe("overflow menu wiring in main.ts", () => {
  test("it imports the placement helper", () => {
    expect(main).toMatch(/import \{ placeMenu \} from "\.\/menu-position\.ts"/);
  });

  // toggle does not bubble, so without the capture flag a listener on the list never runs
  test("a capture-phase toggle listener on the queue places an opening menu", () => {
    const body = queueListener("toggle");
    expect(body).toContain('"open"');
    expect(body).toContain("placeMenu(");
    expect(body).toContain("menu.style.left");
    expect(body).toContain("menu.style.top");
  });

  test("the menu stays hidden until it is placed, so no frame paints at the default position", () => {
    expect(queueListener("beforetoggle")).toMatch(/style\.visibility\s*=\s*"hidden"/);
    expect(queueListener("toggle")).toMatch(/style\.visibility\s*=\s*""/);
  });

  test("scrolling or resizing closes every open menu", () => {
    expect(main).toMatch(/window\.addEventListener\("scroll", closeMenus/);
    expect(main).toMatch(/window\.addEventListener\("resize", closeMenus/);
    const fn = /function closeMenus\(\) \{([\s\S]*?)\n\}/.exec(main)?.[1] ?? "";
    expect(fn).toContain(":popover-open");
    expect(fn).toContain("hidePopover");
  });
});
