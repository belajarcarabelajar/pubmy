import { describe, expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { applyBatchBar, type BatchBar } from "../src/batch.ts";

function setup() {
  const { document } = parseHTML(
    '<html><body><div id="batch" hidden><button id="download-all"></button><button id="clear-all"></button></div><button id="choose"></button><button id="row-btn"></button></body></html>',
  );
  const get = (id: string) => document.getElementById(id) as unknown as HTMLButtonElement;
  const bar: BatchBar = { batch: get("batch"), downloadAll: get("download-all"), clearAll: get("clear-all"), choose: get("choose") };
  // linkedom has no focus tracking: `document.activeElement` is always undefined and `focus()` changes nothing (probed).
  // So the test sets the active element on the document itself and records calls to Choose's `focus`, both at the DOM boundary.
  let active: unknown = document.body;
  Object.defineProperty(document, "activeElement", { get: () => active, configurable: true });
  const focused: string[] = [];
  bar.choose.focus = () => void focused.push("choose");
  return { document: document as unknown as Document, bar, row: get("row-btn"), focused, setActive: (el: unknown) => (active = el) };
}

const shown = (bar: BatchBar) => ({ batch: !bar.batch.hidden, downloadAll: !bar.downloadAll.hidden, clearAll: !bar.clearAll.hidden });

describe("applyBatchBar visibility", () => {
  test.each([
    [0, 0, { batch: false, downloadAll: false, clearAll: false }],
    [1, 0, { batch: true, downloadAll: false, clearAll: true }],
    [2, 1, { batch: true, downloadAll: false, clearAll: true }],
    [2, 2, { batch: true, downloadAll: true, clearAll: true }],
    [10, 10, { batch: true, downloadAll: true, clearAll: true }],
  ])("%i rows, %i ready", (rows, ready, expected) => {
    const { document, bar } = setup();
    applyBatchBar(document, bar, rows, ready);
    expect(shown(bar)).toEqual(expected);
  });

  test("the bar hides again after it was shown", () => {
    const { document, bar } = setup();
    applyBatchBar(document, bar, 2, 2);
    applyBatchBar(document, bar, 0, 0);
    expect(shown(bar)).toEqual({ batch: false, downloadAll: false, clearAll: false });
  });
});

describe("applyBatchBar focus", () => {
  test("Clear all hiding while focused hands focus to Choose", () => {
    const { document, bar, focused, setActive } = setup();
    applyBatchBar(document, bar, 1, 0);
    setActive(bar.clearAll);
    applyBatchBar(document, bar, 0, 0);
    expect(focused).toEqual(["choose"]);
  });

  test("Download all hiding while focused hands focus to Choose", () => {
    const { document, bar, focused, setActive } = setup();
    applyBatchBar(document, bar, 2, 2);
    setActive(bar.downloadAll);
    applyBatchBar(document, bar, 2, 1);
    expect(focused).toEqual(["choose"]);
  });

  test("Clear all staying visible keeps its focus", () => {
    const { document, bar, focused, setActive } = setup();
    applyBatchBar(document, bar, 1, 0);
    setActive(bar.clearAll);
    applyBatchBar(document, bar, 2, 2);
    expect(focused).toEqual([]);
  });

  test("a focused control that is not a batch button is left alone", () => {
    const { document, bar, row, focused, setActive } = setup();
    setActive(row);
    applyBatchBar(document, bar, 0, 0);
    expect(focused).toEqual([]);
  });
});
