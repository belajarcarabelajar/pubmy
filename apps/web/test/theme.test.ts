import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHTML } from "linkedom";

const WEB = join(import.meta.dir, "..");
const html = readFileSync(join(WEB, "index.html"), "utf8");

/** Custom properties of the first :root rule in the authored style block. */
function tokens(): Record<string, string> {
  const rule = /:root\s*\{([^}]*)\}/.exec(html);
  const out: Record<string, string> = {};
  if (!rule) return out;
  for (const m of rule[1]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

// WCAG 2.x relative luminance, written out here so the test does not share code with the page.
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("theme tokens", () => {
  const t = tokens();

  test("the contract tokens exist as hex colours", () => {
    for (const k of ["--accent", "--bg", "--surface", "--text", "--muted", "--border", "--ok", "--err"]) {
      expect(t[k], k).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  test("the accent is the icon teal and the old blue is gone", () => {
    expect(t["--accent"]?.toLowerCase()).toBe("#0f5c63");
    expect(html.toLowerCase()).not.toContain("#2f4fd6");
  });

  const TEXT_PAIRS: [string, string][] = [
    ["--text", "--bg"],
    ["--text", "--surface"],
    ["--muted", "--bg"],
    ["--muted", "--surface"],
    ["--err", "--surface"],
    ["--ok", "--surface"],
  ];
  for (const [fg, bg] of TEXT_PAIRS) {
    test(`${fg} on ${bg} is at least 4.5:1`, () => {
      expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
    });
  }

  test("white button text on the accent is at least 4.5:1", () => {
    expect(contrast("#ffffff", t["--accent"]!)).toBeGreaterThanOrEqual(4.5);
  });

  test("the accent against the page background is at least 3:1", () => {
    expect(contrast(t["--accent"]!, t["--bg"]!)).toBeGreaterThanOrEqual(3);
  });
});

describe("identity", () => {
  test("the page links the SVG favicon and the file exists", () => {
    expect(html).toMatch(/<link\s+rel="icon"\s+href="\.\/icon\.svg"\s+type="image\/svg\+xml">/);
    expect(existsSync(join(WEB, "public", "icon.svg"))).toBe(true);
  });
});

describe("markup", () => {
  const { document } = parseHTML(html);
  const body = html.slice(html.indexOf("<body"));

  // Aliases of a listed extension and the types the page accepts but does not advertise as formats.
  const ALIASES = ["markdown", "htm", "azw"];
  const NOT_ADVERTISED = ["zip", "rar", "epub"];

  test("the format chips are the accepted extensions without aliases and archive types", () => {
    const accept = document.getElementById("file")!.getAttribute("accept")!;
    const expected = accept
      .split(",")
      .map((e) => e.replace(".", "").toLowerCase())
      .filter((e) => ![...ALIASES, ...NOT_ADVERTISED].includes(e));
    const chips = [...document.querySelectorAll("#drop .chips .chip")].map((c) => (c.textContent ?? "").trim().toLowerCase());
    expect(chips.sort()).toEqual(expected.sort());
    expect(chips).toHaveLength(11);
  });

  test("no inline style attribute in the page body", () => {
    expect(body).not.toMatch(/\sstyle\s*=/i);
  });

  test("a data-i18n element has no child elements, so applyLang cannot erase an icon", () => {
    const labelled = [...document.querySelectorAll("[data-i18n]")];
    expect(labelled.length).toBeGreaterThan(0);
    expect(labelled.filter((el) => el.children.length > 0).map((el) => el.outerHTML.slice(0, 60))).toEqual([]);
  });

  test("the privacy line is a badge whose lock icon is a sibling of the label", () => {
    const label = document.querySelector('[data-i18n="privacy"]')!;
    expect(label.parentElement?.classList.contains("privacy-badge")).toBe(true);
    expect(label.parentElement?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  test("the drop hint stays the text-bearing element the section is labelled by", () => {
    expect(document.getElementById("drop")!.getAttribute("aria-labelledby")).toBe("drop-hint");
    expect(document.getElementById("drop-hint")!.getAttribute("data-i18n")).toBe("drop-hint");
  });

  test("every inline icon is hidden from assistive tech and not focusable", () => {
    for (const svg of document.querySelectorAll("svg")) {
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.getAttribute("focusable")).toBe("false");
    }
  });

  test("the batch bar is hidden and holds the two actions", () => {
    const batch = document.getElementById("batch")!;
    expect(batch.hasAttribute("hidden")).toBe(true);
    expect(batch.classList.contains("batch")).toBe(true);
    expect(batch.querySelector("#download-all")?.getAttribute("data-i18n")).toBe("download-all");
    const clear = batch.querySelector("#clear-all")!;
    expect(clear.getAttribute("data-i18n")).toBe("clear-all");
    expect(clear.classList.contains("ghost")).toBe(true);
  });

  test("the batch bar sits above the queue list", () => {
    expect(document.getElementById("batch")!.compareDocumentPosition(document.getElementById("queue")!) & 4).toBeTruthy();
  });

  test("the authored CSS styles the classes row.ts and main.ts emit", () => {
    const css = /<style>([\s\S]*?)<\/style>/.exec(html)![1]!;
    for (const sel of ["li .badge", ".badge-icon", "progress.bar", ".row-actions button.ghost", ".chips", ".chip", ".batch"]) {
      expect(css, sel).toContain(sel);
    }
  });
});
