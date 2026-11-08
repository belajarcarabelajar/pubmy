import { describe, expect, test } from "bun:test";
import { placeMenu } from "../src/menu-position";

// Every expected position is worked out by hand in the comment above its case.
const MENU = { width: 160, height: 96 };

describe("placeMenu", () => {
  test("desktop: opens below the trigger with its right edge on the trigger's right edge", () => {
    // right 1228 - 160 = 1068; bottom 144 + 4 = 148; 148 + 96 = 244 fits in 800.
    const trigger = { left: 1180, top: 100, right: 1228, bottom: 144 };
    expect(placeMenu(trigger, MENU, { width: 1280, height: 800 })).toEqual({ left: 1068, top: 148 });
  });

  test("narrow 320 px viewport: right-aligned position already inside stays put", () => {
    // right 288 - 160 = 128 (>= 4, and <= 320 - 160 - 4 = 156); top 244 + 4 = 248.
    const trigger = { left: 240, top: 200, right: 288, bottom: 244 };
    expect(placeMenu(trigger, MENU, { width: 320, height: 700 })).toEqual({ left: 128, top: 248 });
  });

  test("320 px viewport, trigger at the far left: negative left is clamped to 4", () => {
    // right 56 - 160 = -104, clamped up to 4; top 248.
    const trigger = { left: 8, top: 200, right: 56, bottom: 244 };
    expect(placeMenu(trigger, MENU, { width: 320, height: 700 })).toEqual({ left: 4, top: 248 });
  });

  test("trigger near the bottom: flips above, 4 px over the trigger top", () => {
    // below would be 760 + 4 = 764 and 764 + 96 = 860 > 796; above: 716 - 4 - 96 = 616 >= 4.
    const trigger = { left: 1180, top: 716, right: 1228, bottom: 760 };
    expect(placeMenu(trigger, MENU, { width: 1280, height: 800 })).toEqual({ left: 1068, top: 616 });
  });

  test("a menu that ends exactly on the bottom margin does not flip", () => {
    // 696 + 4 = 700; 700 + 96 = 796 = 800 - 4, not past it.
    const trigger = { left: 1180, top: 652, right: 1228, bottom: 696 };
    expect(placeMenu(trigger, MENU, { width: 1280, height: 800 })).toEqual({ left: 1068, top: 700 });
  });

  test("flips when the space above is exactly the 4 px margin", () => {
    // 148 + 4 = 152; 152 + 96 = 248 > 196; above: 104 - 4 - 96 = 4 >= 4, so top 4.
    const trigger = { left: 1180, top: 104, right: 1228, bottom: 148 };
    expect(placeMenu(trigger, MENU, { width: 1280, height: 200 })).toEqual({ left: 1068, top: 4 });
  });

  test("no room above either: stays below and is clamped up to the bottom margin", () => {
    // below: 104 + 4 = 108, 108 + 700 = 808 > 796; above: 60 - 4 - 700 = -644 < 4, no flip;
    // clamp top to 800 - 700 - 4 = 96.
    const trigger = { left: 1180, top: 60, right: 1228, bottom: 104 };
    expect(placeMenu(trigger, { width: 160, height: 700 }, { width: 1280, height: 800 })).toEqual({
      left: 1068,
      top: 96,
    });
  });

  test("no room above and the menu fills the viewport minus margins: top 4", () => {
    // 64 + 4 = 68; 68 + 792 = 860 > 796; above: 20 - 4 - 792 < 4, no flip; clamp top to 800 - 792 - 4 = 4.
    const trigger = { left: 1180, top: 20, right: 1228, bottom: 64 };
    expect(placeMenu(trigger, { width: 160, height: 792 }, { width: 1280, height: 800 })).toEqual({
      left: 1068,
      top: 4,
    });
  });

  test("a menu taller than the viewport sticks to the top margin", () => {
    // 900 > 800 - 8, so top = 4; left 1228 - 160 = 1068.
    const trigger = { left: 1180, top: 100, right: 1228, bottom: 144 };
    expect(placeMenu(trigger, { width: 160, height: 900 }, { width: 1280, height: 800 })).toEqual({
      left: 1068,
      top: 4,
    });
  });

  test("a menu wider than the viewport sticks to the left margin", () => {
    // 288 - 400 = -112; max left would be 320 - 400 - 4 = -84, so left = 4; top 248.
    const trigger = { left: 240, top: 200, right: 288, bottom: 244 };
    expect(placeMenu(trigger, { width: 400, height: 96 }, { width: 320, height: 700 })).toEqual({
      left: 4,
      top: 248,
    });
  });

  test("a trigger beyond the viewport's right edge is clamped to 4 px inside it", () => {
    // 378 - 160 = 218 > 320 - 160 - 4 = 156, so left = 156; top 248.
    const trigger = { left: 330, top: 200, right: 378, bottom: 244 };
    expect(placeMenu(trigger, MENU, { width: 320, height: 700 })).toEqual({ left: 156, top: 248 });
  });

  test("gap is honoured below the trigger", () => {
    // 500 - 160 = 340; 144 + 10 = 154.
    const trigger = { left: 452, top: 100, right: 500, bottom: 144 };
    expect(placeMenu(trigger, MENU, { width: 1280, height: 800 }, 10)).toEqual({ left: 340, top: 154 });
  });

  test("gap is honoured above the trigger when flipped", () => {
    // below: 760 + 10 = 770, 770 + 96 = 866 > 796; above: 716 - 10 - 96 = 610 >= 4.
    const trigger = { left: 1180, top: 716, right: 1228, bottom: 760 };
    expect(placeMenu(trigger, MENU, { width: 1280, height: 800 }, 10)).toEqual({ left: 1068, top: 610 });
  });
});
