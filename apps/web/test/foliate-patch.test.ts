import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// The vendored foliate paginator cannot run under Bun (it is a custom element), so its one local patch is pinned as text,
// and the behavior is measured in the browser (the plan records the error counts before and after).
const dir = new URL("../vendor/foliate/", import.meta.url);
const paginator = readFileSync(new URL("paginator.js", dir), "utf8");
const patches = readFileSync(new URL("PATCHES.md", dir), "utf8");

/** The text of one method of the View class, from its signature to the next method at the same indent. */
function method(source: string, signature: string): string {
  const start = source.indexOf(signature);
  if (start === -1) return "";
  const rest = source.slice(start + signature.length);
  const end = rest.search(/\n {4}\S/);
  return signature + (end === -1 ? rest : rest.slice(0, end));
}

describe("foliate paginator patch: no render before the section has a body", () => {
  const render = method(paginator, "    render(layout) {");

  test("View.render exists in the form this test anchors on", () => {
    expect(render).toContain("this.columnize(layout)");
    expect(render).toContain("this.scrolled(layout)");
  });

  // The paginator's resize observer and attribute changes call render() as soon as the view exists, while the section
  // is still loading and has no body; columnize then throws "Cannot destructure property 'style' of 't' as it is null".
  test("it returns before touching the layout when the document has no body yet", () => {
    expect(render).toMatch(/if \(!this\.document\?\.body\) return/);
    expect(render.indexOf("if (!this.document?.body) return")).toBeLessThan(render.indexOf("this.#column = "));
  });

  test("the load handler still renders once the body exists, so the skipped render is not lost", () => {
    const load = method(paginator, "    async load(src, afterLoad, beforeRender) {");
    expect(load).toContain("this.#contentRange.selectNodeContents(doc.body)");
    expect(load.indexOf("this.#contentRange.selectNodeContents(doc.body)")).toBeLessThan(load.indexOf("this.render(layout)"));
  });

  test("the patch is marked in the source and listed in PATCHES.md", () => {
    expect(render).toContain("pubmy patch");
    expect(patches).toContain("paginator.js");
    expect(patches).toContain("View.render");
  });
});
