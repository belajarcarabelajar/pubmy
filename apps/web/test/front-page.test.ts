import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { KEYS, t, type Key } from "../src/i18n.ts";

// The front page after the UI review: formats are named once (the chips), the chips are passive text,
// the privacy badge matches the drop zone, and the language toggle carries a globe icon.
// index.html and main.ts are read as text (main.ts runs against the live DOM at import).
const WEB = join(import.meta.dir, "..");
const html = readFileSync(join(WEB, "index.html"), "utf8");
const main = readFileSync(join(WEB, "src", "main.ts"), "utf8");
const { document } = parseHTML(html);
const css = /<style>([\s\S]*?)<\/style>/.exec(html)![1]!.replace(/\/\*[\s\S]*?\*\//g, "");

/** Declarations of every rule whose selector list contains `selector`, merged in source order. */
function rule(selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!m[1]!.split(",").map((s) => s.trim()).includes(selector)) continue;
    for (const d of m[2]!.split(";")) {
      const i = d.indexOf(":");
      if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    }
  }
  return out;
}

/** Declaration text of a rule as one string, for "does any value mention X" checks. */
const flat = (selector: string) => Object.entries(rule(selector)).map(([k, v]) => `${k}:${v}`).join(";");

const FORMAT_WORDS = ["TXT", "MD", "Markdown", "HTML", "DOCX", "ODT", "RTF", "PDF", "MOBI", "AZW3", "CBZ", "CBR"];
const formatWordsIn = (text: string) => FORMAT_WORDS.filter((w) => new RegExp(`\\b${w}\\b`, "i").test(text));

describe("formats are listed once, by the chips", () => {
  test("the Indonesian tagline names no format and reads as written", () => {
    expect(t("tagline", "id")).toBe("Ubah dokumen, e-book, dan komik jadi EPUB 3 yang lolos Send to Kindle.");
    expect(formatWordsIn(t("tagline", "id"))).toEqual([]);
  });

  test("the English tagline names no format and reads as written", () => {
    expect(t("tagline", "en")).toBe("Turn documents, e-books and comics into EPUB 3 that passes Send to Kindle.");
    expect(formatWordsIn(t("tagline", "en"))).toEqual([]);
  });

  test("the meta description names no format but still says what the page does", () => {
    const meta = document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "";
    expect(meta).toMatch(/EPUB/);
    expect(formatWordsIn(meta)).toEqual([]);
  });

  test("the chips still list every format", () => {
    const chips = [...document.querySelectorAll(".chips .chip")].map((c) => (c.textContent ?? "").trim());
    for (const w of ["TXT", "MD", "HTML", "DOCX", "ODT", "RTF", "PDF", "MOBI", "AZW3", "CBZ", "CBR"]) expect(chips).toContain(w);
    expect(chips).toHaveLength(11);
  });
});

describe("the chips sit under a visible label", () => {
  test("the label strings exist in both languages", () => {
    expect(KEYS).toContain("formats-label" as Key);
    expect(t("formats-label" as Key, "id")).toBe("Format yang didukung");
    expect(t("formats-label" as Key, "en")).toBe("Supported formats");
  });

  test("#formats-label is an empty, visible p filled by data-i18n", () => {
    const label = document.getElementById("formats-label");
    expect(label).not.toBeNull();
    expect(label?.tagName.toLowerCase()).toBe("p");
    expect(label?.getAttribute("data-i18n")).toBe("formats-label");
    expect(label?.classList.contains("formats-label")).toBe(true);
    expect(label?.classList.contains("sr-only")).toBe(false);
    expect((label?.textContent ?? "").trim()).toBe("");
  });

  test("the chips list is named by the label and follows it", () => {
    const list = document.querySelector("ul.chips");
    expect(list?.getAttribute("aria-labelledby")).toBe("formats-label");
    expect(list?.previousElementSibling?.id).toBe("formats-label");
  });
});

describe("the chips are passive text", () => {
  test("a chip has no border, no pill radius and no filled background", () => {
    const chip = rule(".chip");
    expect(Object.keys(chip).length).toBeGreaterThan(0);
    expect(Object.keys(chip).filter((p) => p.startsWith("border"))).toEqual([]);
    expect(flat(".chip")).not.toContain("999px");
    expect(Object.keys(chip).filter((p) => p.startsWith("background"))).toEqual([]);
  });

  test("a chip is small muted semibold text", () => {
    const chip = rule(".chip");
    expect(chip["color"]).toBe("var(--muted)");
    expect(chip["font-size"]).toBe(".75rem");
    expect(chip["font-weight"]).toBe("600");
  });

  // A dot generated before each chip would start the second line whenever the chips wrap (11 chips wrap at 320 px).
  test("no pseudo-element decorates a chip, so a wrapped line never starts with a separator", () => {
    const selectors = [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap((m) => m[1]!.split(",").map((s) => s.trim()));
    expect(selectors.filter((s) => /\.chip\b/.test(s) && /::?(?:before|after)/.test(s))).toEqual([]);
  });

  test("the chips are told apart by spacing: the column gap is at least .75rem", () => {
    const chips = rule(".chips");
    const parts = (chips["gap"] ?? "").split(/\s+/).filter(Boolean);
    const column = chips["column-gap"] ?? parts[1] ?? parts[0] ?? "";
    const rem = /^([\d.]+)rem$/.exec(column);
    expect(rem, `column gap "${column}" in rem`).not.toBeNull();
    expect(Number(rem![1])).toBeGreaterThanOrEqual(0.75);
  });

  test("the label rule hides nothing", () => {
    expect(Object.keys(rule(".formats-label")).length).toBeGreaterThan(0);
    expect(flat(".formats-label")).not.toMatch(/display:\s*none|clip|visibility/);
  });
});

describe("the privacy badge is as wide as the drop zone", () => {
  test("it is a centred flex block with the drop zone's radius", () => {
    const badge = rule(".privacy-badge");
    expect(badge["display"]).toBe("flex");
    expect(badge["justify-content"]).toBe("center");
    expect(badge["text-align"]).toBe("center");
    expect(badge["align-items"]).toBe("center");
    expect(badge["border-radius"]).toBe(".75rem");
    expect(badge["border-radius"]).toBe(rule(".drop")["border-radius"]);
  });

  test("the lock stays a sibling of the label span", () => {
    const label = document.querySelector('[data-i18n="privacy"]')!;
    expect(label.tagName.toLowerCase()).toBe("span");
    expect(label.previousElementSibling?.tagName.toLowerCase()).toBe("svg");
  });
});

describe("the drop zone border", () => {
  test("is 1px dashed in the accent ink, and solid while dragging over", () => {
    expect(rule(".drop")["border"]).toBe("1px dashed var(--accent-ink)");
    expect(rule(".drop.over")["border-style"]).toBe("solid");
  });
});

describe("the header", () => {
  test("the logo is top-aligned with the title block by a small top margin", () => {
    expect(rule(".brand")["align-items"]).toBe("flex-start");
    const top = /^([\d.]+)rem$/.exec(rule(".logo")["margin-top"] ?? "");
    expect(top).not.toBeNull();
    expect(Number(top![1])).toBeGreaterThan(0);
    expect(Number(top![1])).toBeLessThanOrEqual(0.5);
  });

  test("the narrow-screen rule still stacks the header with the toggle at the end", () => {
    expect(/@media \(max-width:40rem\)\{[^@]*header\{flex-direction:column-reverse;align-items:stretch\}/.test(css)).toBe(true);
    expect(rule("#lang")["align-self"]).toBe("flex-end");
  });
});

describe("the language toggle", () => {
  const toggle = document.getElementById("lang");

  test("holds a hidden globe icon that is a sibling of the label span", () => {
    expect(toggle).not.toBeNull();
    const label = document.getElementById("lang-label");
    expect(label).not.toBeNull();
    expect(label?.tagName.toLowerCase()).toBe("span");
    expect(label?.parentElement?.id).toBe("lang");
    const icon = toggle?.querySelector('svg[aria-hidden="true"]');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("focusable")).toBe("false");
    expect(icon?.parentElement?.id).toBe("lang");
    expect(icon?.getAttribute("stroke")).toBe("currentColor");
  });

  test("the globe is a circle of radius 9 plus an equator and a meridian", () => {
    const icon = toggle?.querySelector("svg") ?? null;
    expect(icon, "an svg inside #lang").not.toBeNull();
    expect(icon?.querySelector('circle[r="9"]')).not.toBeNull();
    expect(icon?.querySelectorAll("path, line, ellipse").length ?? 0).toBeGreaterThanOrEqual(2);
  });

  test("the toggle has no text of its own and the label span is empty in source", () => {
    const own = [...(toggle?.childNodes ?? [])].filter((n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== "");
    expect(toggle).not.toBeNull();
    expect(own).toHaveLength(0);
    expect((document.getElementById("lang-label")?.textContent ?? "x").trim()).toBe("");
  });

  test("it is compact, framed and 1rem-iconed, and does not lower the 44px target", () => {
    const lang = rule("#lang");
    expect(lang["font-size"]).toBe(".9rem");
    expect(lang["padding"]).toBe(".25rem .75rem");
    expect(lang["gap"]).toBe(".4rem");
    expect(`${lang["border"] ?? ""} ${lang["border-color"] ?? ""}`).toContain("var(--border)");
    for (const p of ["min-height", "height", "max-height"]) expect(lang[p], p).toBeUndefined();
    expect(rule("button")["min-height"]).toBe("44px");
    expect(rule("#lang svg")["width"]).toBe("1rem");
    expect(rule("#lang svg")["height"]).toBe("1rem");
  });

  test("main.ts writes the label span and never the button's own text", () => {
    // Booleans, not toMatch: a failing toMatch would print all of main.ts.
    expect(/\$(?:<[^>(]*>)?\("lang-label"\)\.textContent\s*=\s*t\("lang-toggle",\s*lang\)/.test(main), "writes #lang-label").toBe(true);
    expect(/\$(?:<[^>(]*>)?\("lang"\)\.(?:textContent|innerHTML|innerText)\s*=/.test(main), "writes $(\"lang\") directly").toBe(false);
    for (const m of main.matchAll(/(?:const|let)\s+(\w+)\s*=\s*\$(?:<[^>(]*>)?\("lang"\)/g)) {
      expect(new RegExp(`\\b${m[1]}\\.(?:textContent|innerHTML|innerText)\\s*=`).test(main), `writes ${m[1]} directly`).toBe(false);
    }
  });

  test("main.ts still sets the button's aria-label and lang", () => {
    expect(/setAttribute\("aria-label",\s*t\("lang-toggle-label",\s*lang\)\)/.test(main), "aria-label").toBe(true);
    expect(/\.lang\s*=\s*lang === "id" \? "en" : "id"/.test(main), "lang").toBe(true);
  });
});

describe("colours come from the tokens", () => {
  test("none of the rules this page change touches hard-codes a colour", () => {
    for (const sel of [".chip", ".chip+.chip::before", ".formats-label", ".privacy-badge", ".drop", ".brand", ".logo", "#lang", "#lang svg"]) {
      expect(flat(sel), sel).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    }
  });
});
