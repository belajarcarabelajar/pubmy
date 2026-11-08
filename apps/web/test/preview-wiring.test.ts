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
    expect(body).toMatch(/^\s*fullscreenBtn\.setAttribute\("aria-pressed", String\(document\.fullscreenElement === frame\)\);$/m);
  });

  test("closing the dialog leaves fullscreen", () => {
    const body = listener("dialog", "close");
    expect(body).toMatch(/^\s*if \(document\.fullscreenElement\) document\.exitFullscreen\(\)\.catch\(\(\) => \{\}\);$/m);
  });

  // A drawer left open when the preview closed would show, with its dark layer, while the next book still loads.
  test("closing the dialog also closes the contents list, so the next preview starts without a stale drawer", () => {
    const body = listener("dialog", "close");
    expect(body).toMatch(/^\s*readerUi\.toc\.hidden = true;$/m);
    expect(body).toMatch(/^\s*readerUi\.tocToggle\.setAttribute\("aria-expanded", "false"\);$/m);
  });

  test("a click on the stage closes the open drawer through the contents button, and only then", () => {
    const body = listener("readerUi.stage", "click");
    expect(body).toMatch(/^\s*if \(drawerOpen\(\)\) readerUi\.tocToggle\.click\(\);$/m);
    // nothing else may click or toggle outside that condition
    expect(body.match(/tocToggle\.click\(\)/g)).toHaveLength(1);
  });

  // Measured in Chromium 156: dialog.requestFullscreen() rejects with "TypeError: Dialog elements are invalid".
  test("fullscreen is requested on the .pv frame inside the dialog, never on the dialog itself", () => {
    expect(main).toMatch(/const frame = dialog\.querySelector<HTMLElement>\("\.pv"\)!/);
    expect(main).not.toMatch(/dialog\.requestFullscreen/);
  });

  test("the drawer is open exactly when the list is a drawer and not hidden", () => {
    expect(main).toMatch(/^const drawerOpen = \(\) => readerUi\.narrow\(\) && readerUi\.toc\.hidden === false;$/m);
  });

  // Esc inside the page frame goes through ui.escape (reader.ts); Esc with focus in the dialog is the native cancel event.
  test("Esc closes an open drawer first, from the page frame and from the dialog, and only then the preview", () => {
    expect(main).toMatch(/^\s*escape: \(\) => \(drawerOpen\(\) \? readerUi\.tocToggle\.click\(\) : dialog\.close\(\)\),$/m);
    const body = listener("dialog", "cancel");
    expect(body).toMatch(/^\s*if \(drawerOpen\(\)\) \{$/m);
    expect(body).toMatch(/^\s*e\.preventDefault\(\);$/m);
    expect(body).toMatch(/^\s*readerUi\.tocToggle\.click\(\);$/m);
  });

  // The layer over the page blocks the pointer only; the arrows and the book frame would stay in the tab order.
  test("while the drawer covers the page, the arrows and the page are inert, and this follows the list and the breakpoint", () => {
    const fn = /function syncCovered\(\) \{([\s\S]*?)\n\}/.exec(main)?.[1] ?? "";
    expect(fn).toMatch(/const covered = drawerOpen\(\);/);
    expect(fn).toMatch(/for \(const el of \[readerUi\.prev, readerUi\.next, readerUi\.page\]\) el\.inert = covered;/);
    expect(main).toMatch(/new MutationObserver\(syncCovered\)\.observe\(readerUi\.toc, \{ attributes: true, attributeFilter: \["hidden"\] \}\);/);
    expect(main).toMatch(/matchMedia\(PREVIEW_NARROW\)\.addEventListener\("change", syncCovered\);/);
  });
});
