import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { refusalRow } from "../src/row.ts";
import { t } from "../src/i18n.ts";

const doc = () => parseHTML("<html><body></body></html>").document as unknown as Document;
const main = readFileSync(join(import.meta.dir, "..", "src", "main.ts"), "utf8");
const html = readFileSync(join(import.meta.dir, "..", "index.html"), "utf8");

describe("refusalRow", () => {
  test("a refused file is a failed-looking row: name, a Refused badge with the x glyph, and the reason", () => {
    const li = refusalRow(doc(), "buku.pdf", "This PDF is password-protected.", "en");
    expect(li.className).toBe("failed refused");
    expect(li.querySelector(".name")?.textContent).toBe("buku.pdf");
    expect(li.querySelector(".status .badge")?.textContent).toBe("xRefused");
    expect(li.querySelector(".badge-icon")?.getAttribute("aria-hidden")).toBe("true");
    expect(li.querySelector(".reason")?.textContent).toBe("This PDF is password-protected.");
  });

  test("it has no buttons, since a refused file is not in the queue and there is nothing to act on", () => {
    expect(refusalRow(doc(), "a.pdf", "x", "en").querySelectorAll("button")).toHaveLength(0);
  });

  test("the badge follows the language", () => {
    expect(refusalRow(doc(), "a.pdf", "x", "id").querySelector(".badge")?.textContent).toBe("xDitolak");
  });

  test("main.ts renders every refusal through it, and the card look covers #refusals rows", () => {
    const fn = /function renderRefusals\(\) \{([\s\S]*?)\n\}/.exec(main)?.[1] ?? "";
    expect(fn).toContain("refusalRow(");
    expect(fn).toContain("t(r.code, lang)");
    expect(html).toMatch(/#queue li,#refusals li\{[^}]*border:1px solid var\(--border\)/);
  });

  test("the reason text of a refusal is part of the live announcement text", () => {
    expect(t("refused", "en")).toBe("Refused");
  });
});
