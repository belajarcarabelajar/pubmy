import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { KEYS, t } from "../src/i18n.ts";

const web = join(import.meta.dir, "..");
const main = readFileSync(join(web, "src", "main.ts"), "utf8");
const html = readFileSync(join(web, "index.html"), "utf8");

describe("Send to Kindle hint", () => {
  test("it is an empty, hidden paragraph that build.ts fills, placed after the queue", () => {
    expect(html).toMatch(/<p id="kindle-hint" class="muted" data-i18n="kindle-hint" hidden><\/p>/);
    expect(html.indexOf('id="kindle-hint"')).toBeGreaterThan(html.indexOf('id="queue"'));
  });

  test("the text exists in both languages and names Send to Kindle", () => {
    expect(KEYS).toContain("kindle-hint" as never);
    for (const lang of ["id", "en"] as const) expect(t("kindle-hint" as never, lang)).toContain("Send to Kindle");
  });

  test("it shows only while a ready, unexpired file exists", () => {
    const fn = /function refreshBatch\(\) \{([\s\S]*?)\n\}/.exec(main)?.[1] ?? "";
    expect(fn).toMatch(/\$<HTMLElement>\("kindle-hint"\)\.hidden = ready === 0/);
  });
});
