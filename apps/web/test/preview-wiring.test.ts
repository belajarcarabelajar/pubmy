import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// main.ts runs against the live DOM at import, so these checks read it as text. Each one is anchored on
// the new call itself, so deleting that call turns the check red; the real-browser run proves the behaviour.
const main = readFileSync(join(import.meta.dir, "..", "src", "main.ts"), "utf8");

/** A listener from its opening `<target>.addEventListener("<type>"` line to the closing `});` line. */
function listener(target: string, type: string): string {
  const start = main.indexOf(`${target}.addEventListener("${type}"`);
  if (start < 0) return "";
  const end = main.indexOf("\n});", start);
  return end < 0 ? "" : main.slice(start, end + "\n});".length);
}

describe("preview wiring in main.ts", () => {
  // reader.ts only reads ui.narrow(); the CSS drawer rule uses the same 60rem, so the two must not drift apart
  test("narrow() uses the same 60rem breakpoint as the drawer CSS", () => {
    expect(main).toContain('const PREVIEW_NARROW = "(max-width: 60rem)"');
    expect(main).toContain("narrow: () => matchMedia(PREVIEW_NARROW).matches");
  });

  test("the old 40rem breakpoint is gone from main.ts", () => {
    expect(main).not.toContain("(max-width: 40rem)");
  });

  test("the Full screen button is hidden where the frame cannot go fullscreen", () => {
    expect(main).toContain('$<HTMLButtonElement>("pv-fullscreen")');
    expect(main).toMatch(/\.hidden\s*=\s*typeof frame\.requestFullscreen !== "function"/);
  });

  test("clicking Full screen leaves fullscreen when it is on, else requests it on the frame inside the dialog and swallows a rejection", () => {
    const body = listener("fullscreenBtn", "click");
    expect(body).toContain("document.fullscreenElement");
    const leave = body.indexOf("document.exitFullscreen()");
    const enter = body.indexOf("frame.requestFullscreen()");
    expect(leave).toBeGreaterThanOrEqual(0);
    expect(enter).toBeGreaterThan(leave);
    expect(body.slice(enter)).toContain(".catch(");
  });

  test("fullscreenchange keeps aria-pressed in step with the frame being the fullscreen element", () => {
    const body = listener("document", "fullscreenchange");
    expect(body).toContain("aria-pressed");
    expect(body).toContain("document.fullscreenElement === frame");
  });

  test("closing the dialog leaves fullscreen", () => {
    const body = listener("dialog", "close");
    expect(body).toContain("document.fullscreenElement");
    expect(body).toContain("document.exitFullscreen()");
  });

  test("a click on the stage closes the open drawer through the contents button, and only then", () => {
    const body = listener("readerUi.stage", "click");
    const narrow = body.indexOf("readerUi.narrow()");
    const open = body.indexOf("readerUi.toc.hidden === false");
    const toggle = body.indexOf("readerUi.tocToggle.click()");
    expect(narrow).toBeGreaterThanOrEqual(0);
    expect(open).toBeGreaterThanOrEqual(0);
    expect(toggle).toBeGreaterThan(narrow);
    expect(toggle).toBeGreaterThan(open);
  });

  // Measured in Chromium 156: dialog.requestFullscreen() rejects with "TypeError: Dialog elements are invalid".
  test("fullscreen is requested on the .pv frame inside the dialog, never on the dialog itself", () => {
    expect(main).toMatch(/const frame = dialog\.querySelector<HTMLElement>\("\.pv"\)!/);
    expect(main).not.toMatch(/dialog\.requestFullscreen/);
  });
});
