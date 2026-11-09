import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { t } from "../src/i18n.ts";

// PUBMY_INDEX_HTML points the test at another copy of the page; it exists so a mutation proof can run
// against a scratch copy without touching the real file. The default is the shipped page.
const INDEX = process.env.PUBMY_INDEX_HTML ?? join(import.meta.dir, "..", "index.html");
const html = readFileSync(INDEX, "utf8");
const css = (/<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
const { document } = parseHTML(html);

interface Rule {
  sel: string;
  body: string;
  /** Enclosing at-rule preludes, outermost first, whitespace removed around punctuation. */
  ctx: string[];
}

function squash(s: string): string {
  return s
    .replace(/\s*([:;,{}()])\s*/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/;$/, "")
    .trim();
}

/** Flat list of style rules; at-rules are walked and recorded in `ctx`. */
function parse(text: string, ctx: string[]): Rule[] {
  const out: Rule[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open < 0) break;
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") depth--;
      j++;
    }
    const prelude = squash(text.slice(i, open));
    const inner = text.slice(open + 1, j - 1);
    if (prelude.startsWith("@")) out.push(...parse(inner, [...ctx, prelude]));
    else out.push({ sel: prelude, body: squash(inner), ctx });
    i = j;
  }
  return out;
}

const rules = parse(css, []);
const DRAWER = "@media(max-width:60rem)";
const HEADER = "@media(max-width:40rem)";

function declared(body: string, prop: string): string | undefined {
  return new RegExp(`(?:^|;)${prop}:([^;]+)`).exec(body)?.[1]?.trim();
}

/** Rules whose selector list holds exactly `sel` as one entry, in the given at-rule context (`null` = any). */
function find(sel: string, ctx: string | null): Rule[] {
  return rules.filter((r) => r.sel.split(",").includes(sel) && (ctx === null || r.ctx.join("|") === ctx));
}

const TAP_AWAY = ".pv-toc:not([hidden])~.pv-stage::after";

describe("preview drawer breakpoint", () => {
  test("the contents list is an absolute overlay at 60rem and above the tap-away layer", () => {
    const drawer = find(".pv-toc", DRAWER);
    expect(drawer).toHaveLength(1);
    expect(declared(drawer[0]!.body, "position")).toBe("absolute");
    const layer = find(TAP_AWAY, DRAWER);
    expect(layer).toHaveLength(1);
    const toc = Number(declared(drawer[0]!.body, "z-index"));
    const over = Number(declared(layer[0]!.body, "z-index"));
    expect(Number.isFinite(toc)).toBe(true);
    expect(Number.isFinite(over)).toBe(true);
    expect(toc).toBeGreaterThan(over);
  });

  test("no overlay rule for the contents list survives outside the 60rem query", () => {
    for (const r of find(".pv-toc", null)) {
      if (declared(r.body, "position") === "absolute") expect(r.ctx).toEqual([DRAWER]);
    }
    expect(find(".pv-toc", HEADER)).toHaveLength(0);
  });

  test("the header and language button rules stay in their own 40rem query", () => {
    const header = find("header", HEADER);
    expect(header).toHaveLength(1);
    expect(declared(header[0]!.body, "flex-direction")).toBe("column-reverse");
    expect(declared(header[0]!.body, "align-items")).toBe("stretch");
    const lang = find("#lang", HEADER);
    expect(lang).toHaveLength(1);
    expect(declared(lang[0]!.body, "align-self")).toBe("flex-end");
    // the same rules must not also apply from 60rem down
    expect(find("header", DRAWER)).toHaveLength(0);
    expect(find("#lang", DRAWER)).toHaveLength(0);
  });
});

describe("header row above 40rem", () => {
  // Above 40rem the header is always 38rem (608 px) wide: main is 40rem with 1rem padding. The English
  // title ("pubmy: turn files into EPUB") needs about 415 px beside the logo in a monospace system font, and
  // the button reads "Bahasa Indonesia". With 1rem of padding the two did not fit by about 7 px and the
  // button dropped to its own row (or the title broke before "EPUB"), so the button is slimmer instead.
  const rem = (v: string | undefined): number => Number.parseFloat(v ?? "NaN") * 16;
  const brand = find(".brand", "");
  const lang = find("#lang", "");

  test("the brand column keeps 26rem and the button hugs the right edge", () => {
    expect(brand).toHaveLength(1);
    expect(declared(brand[0]!.body, "flex")).toBe("1");
    expect(declared(brand[0]!.body, "min-width")).toBe("min(100%,26rem)");
    expect(lang).toHaveLength(1);
    expect(declared(lang[0]!.body, "margin-left")).toBe("auto");
    expect(declared(find("header", "")[0]!.body, "flex-wrap")).toBe("wrap");
  });

  test("beside the longest label the brand column still fits, so the button stays in the title row", () => {
    const min = /^min\(100%,([\d.]+rem)\)$/.exec(declared(brand[0]!.body, "min-width") ?? "")?.[1];
    const longest = Math.max(t("lang-toggle", "id").length, t("lang-toggle", "en").length);
    // monospace glyphs are 0.6em wide at the 1rem button font; border is 1px a side
    const button = longest * 0.6 * 16 + 2 * rem(declared(lang[0]!.body, "padding-inline")) + 2;
    const free = 38 * 16 - rem(declared(find("header", "")[0]!.body, "gap")) - button;
    expect(free).toBeGreaterThanOrEqual(rem(min));
  });

  test("the longest title fits the brand text column with 1rem to spare, so a slightly wider font does not break it", () => {
    const min = /^min\(100%,([\d.]+rem)\)$/.exec(declared(brand[0]!.body, "min-width") ?? "")?.[1];
    const h1 = find("h1", "");
    expect(h1).toHaveLength(1);
    const longest = Math.max(t("title", "id").length, t("title", "en").length);
    const title = longest * 0.6 * rem(declared(h1[0]!.body, "font-size"));
    // the logo is 40 px wide (index.html width attribute) and the brand gap is .75rem
    const column = rem(min) - 40 - rem(declared(brand[0]!.body, "gap"));
    expect(column - title).toBeGreaterThanOrEqual(16);
  });
});

describe("tap-away layer", () => {
  test("an open drawer puts an inset-0 absolute layer over the page, and only inside the 60rem query", () => {
    const layer = find(TAP_AWAY, DRAWER);
    expect(layer).toHaveLength(1);
    expect(declared(layer[0]!.body, "position")).toBe("absolute");
    expect(declared(layer[0]!.body, "inset")).toBe("0");
    expect(declared(layer[0]!.body, "content")).toBe('""');
    // a wide screen shows the list beside the page, so no layer there
    expect(rules.filter((r) => r.sel.includes(".pv-stage::after") && r.ctx.join("|") !== DRAWER)).toEqual([]);
  });

  test("the layer is positioned against the stage, so the list itself is not covered", () => {
    const stage = find(".pv-toc:not([hidden])~.pv-stage", DRAWER);
    expect(stage).toHaveLength(1);
    expect(declared(stage[0]!.body, "position")).toBe("relative");
  });
});

describe("contents button", () => {
  const toggle = document.getElementById("pv-toc-toggle")!;

  test("it is a button that keeps aria-controls and aria-expanded", () => {
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.getAttribute("aria-controls")).toBe("pv-toc");
    expect(toggle.hasAttribute("aria-expanded")).toBe(true);
  });

  // applyLang sets textContent on a data-i18n element, which would erase an icon placed inside it
  test("it holds a hidden icon span and a separate, empty text span, and is not itself translated", () => {
    expect(toggle.hasAttribute("data-i18n")).toBe(false);
    const kids = [...toggle.children];
    expect(kids).toHaveLength(2);
    expect(kids[0]!.tagName).toBe("SPAN");
    expect(kids[0]!.getAttribute("aria-hidden")).toBe("true");
    expect(kids[0]!.textContent?.trim()).not.toBe("");
    expect(kids[1]!.tagName).toBe("SPAN");
    expect(kids[1]!.getAttribute("data-i18n")).toBe("preview-toc");
    expect(kids[1]!.textContent).toBe("");
  });
});

describe("preview bar targets", () => {
  test("every button rule in the bar sets a 44px minimum width and height and none sets less", () => {
    const bar = rules.filter((r) => r.sel.split(",").some((p) => /^\.pv-bar button(?![\w-])/.test(p)));
    expect(bar.length).toBeGreaterThan(0);
    const merged = bar.map((r) => r.body).join(";");
    expect(declared(merged, "min-width")).toBe("44px");
    expect(declared(merged, "min-height")).toBe("44px");
    for (const r of bar) {
      for (const prop of ["min-width", "min-height"]) {
        const v = declared(r.body, prop);
        if (v !== undefined) expect(parseFloat(v), `${r.sel} ${prop}`).toBeGreaterThanOrEqual(44);
      }
    }
  });
});

describe("Full screen button", () => {
  const fs = document.getElementById("pv-fullscreen");
  const bar = document.querySelector(".pv-bar")!;

  test("it is a hidden toggle button named through preview-fullscreen", () => {
    expect(fs).not.toBeNull();
    expect(fs!.tagName).toBe("BUTTON");
    expect(fs!.getAttribute("type")).toBe("button");
    expect(fs!.hasAttribute("hidden")).toBe(true);
    expect(fs!.getAttribute("aria-pressed")).toBe("false");
    expect(fs!.getAttribute("data-i18n-label")).toBe("preview-fullscreen");
  });

  // data-i18n would let applyLang replace the svg with text
  test("it carries an inline decorative svg and no data-i18n", () => {
    const svg = fs!.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("aria-hidden")).toBe("true");
    expect(fs!.hasAttribute("data-i18n")).toBe(false);
  });

  test("it sits in the bar after the title and before the close button", () => {
    const order = [...bar.children].map((el) => el.id);
    const at = order.indexOf("pv-fullscreen");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("pv-title")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("pv-close")).toBeGreaterThanOrEqual(0);
    expect(at).toBeGreaterThan(order.indexOf("pv-title"));
    expect(at).toBeLessThan(order.indexOf("pv-close"));
  });

  test("its label reads Layar penuh and Full screen", () => {
    expect(t("preview-fullscreen", "id")).toBe("Layar penuh");
    expect(t("preview-fullscreen", "en")).toBe("Full screen");
  });
});

describe("fullscreen frame", () => {
  test("the .pv frame fills the screen and keeps the preview colour when it is the fullscreen element", () => {
    expect(html).toMatch(/\.pv:fullscreen\{[^}]*width:100%[^}]*height:100%[^}]*background:#17181c/);
  });
});

describe("fullscreen button state", () => {
  // The label stays "Full screen" for screen readers, so sighted users need a visible pressed state.
  test("a pressed Full screen button looks different from an unpressed one", () => {
    expect(html).toMatch(/\.pv-bar button\[aria-pressed="true"\]\{[^}]*background:#[0-9a-f]{3,8}/i);
  });
});
