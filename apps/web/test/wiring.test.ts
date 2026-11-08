import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// main.ts runs against the live DOM at import, so it cannot be loaded in a unit test.
// These checks read both files as text: a typo in an id would only show up in a browser otherwise.
const web = join(import.meta.dir, "..");
const main = readFileSync(join(web, "src", "main.ts"), "utf8");
const html = readFileSync(join(web, "index.html"), "utf8");

const idsInMain = () => [...main.matchAll(/\$(?:<[^>(]*>)?\("([\w-]+)"\)|getElementById\("([\w-]+)"\)/g)].map((m) => (m[1] ?? m[2])!);
const htmlHasId = (id: string) => new RegExp(`\\sid="${id}"`).test(html);

describe("main.ts and index.html agree", () => {
  test("every id main.ts reads exists in index.html", () => {
    const ids = idsInMain();
    expect(ids.length).toBeGreaterThan(10);
    expect(ids.filter((id) => !htmlHasId(id))).toEqual([]);
  });

  test("main.ts reads the batch bar and both batch buttons", () => {
    const ids = idsInMain();
    for (const id of ["batch", "download-all", "clear-all"]) expect(ids).toContain(id);
  });
});

describe("batch actions", () => {
  test("Download all uses the batch helpers and the fixed ZIP name", () => {
    expect(main).toMatch(/from "\.\/batch\.ts"/);
    expect(main).toContain("zipEpubs");
    expect(main).toContain("applyBatchBar");
    expect(main).toContain("pubmy-epub.zip");
  });

  // startRetention also calls revokeObjectURL, so the check anchors on the click inside the Download all handler.
  test("the ZIP link is revoked in a timer shortly after the click", () => {
    expect(main).toMatch(/a\.click\(\);[\s\S]{0,300}setTimeout\(\(\) => URL\.revokeObjectURL\(url\)/);
  });

  // Chrome drops focus from a control that is disabled or hidden and does not give it back.
  // The hidden case lives in applyBatchBar (batch-bar.test.ts proves it on a DOM); the disabled case stays in the handler.
  test("keyboard focus has a fallback when a batch button hides or the ZIP finishes", () => {
    const body = (re: RegExp) => re.exec(main)?.[1] ?? "";
    expect(body(/function refreshBatch\(\) \{([\s\S]*?)\n\}/)).toContain("applyBatchBar(");
    expect(body(/downloadAllBtn\.onclick = async \(\) => \{([\s\S]*?)\n\};/)).toMatch(/finally \{[\s\S]*\.focus\(\)/);
  });

  test("the row view carries the conversion progress", () => {
    expect(main).toMatch(/progress:\s*row\.progress|progress:\s*item\.status === "converting"/);
  });
});
