import { describe, expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { renderPage, siteFooter, siteHeader, SITE_LABELS } from "../site/layout.ts";
import { ROUTES, type RouteKey } from "../site/routes.ts";
import { SITE_CSS } from "../site/styles.ts";

// The site header and footer are shared by the converter page and every support page. They are pure strings,
// parsed here with linkedom; how the CSS looks in a browser is outside this seam.
const REPO = "https://github.com/belajarcarabelajar/pubmy";
const ROUTE_PATHS = new Set(ROUTES.filter((r) => r.key !== "notfound").flatMap((r) => [r.path.id, r.path.en]));
const doc = (fragment: string) => parseHTML(`<!doctype html><html><head></head><body>${fragment}</body></html>`).document;
const hrefs = (root: ParentNode) => [...root.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

/** A route path, a route path with #faq, or the GitHub repository and its pages. */
const allowedHref = (h: string) => ROUTE_PATHS.has(h) || (h.endsWith("#faq") && ROUTE_PATHS.has(h.slice(0, -4))) || h === REPO || h.startsWith(REPO + "/");

describe("site header", () => {
  for (const lang of ["id", "en"] as const) {
    const d = doc(siteHeader({ lang, current: "guide", converter: false }));
    const header = d.querySelector("header.site-header")!;

    test(`${lang}: the skip link is the first link and targets #content`, () => {
      const first = header.querySelector("a")!;
      expect(first.getAttribute("href")).toBe("#content");
      expect(first.classList.contains("skip")).toBe(true);
    });

    test(`${lang}: the brand links home with the logo and the name`, () => {
      const brand = [...header.querySelectorAll("a")].find((a) => a.querySelector('img[src="/icon.svg"]'))!;
      expect(brand.getAttribute("href")).toBe("/");
      expect(brand.querySelector("img")!.getAttribute("alt")).toBe("");
      expect(text(brand)).toBe("pubmy");
    });

    test(`${lang}: the navigation is a labelled landmark`, () => {
      const nav = header.querySelector("nav")!;
      expect(nav.getAttribute("aria-label")).toBe(lang === "id" ? "Navigasi utama" : "Main navigation");
    });

    test(`${lang}: the navigation sits in a details disclosure with a summary`, () => {
      const details = header.querySelector("nav details.nav-menu")!;
      expect(details).not.toBeNull();
      expect(details.hasAttribute("open")).toBe(false);
      expect(text(details.querySelector(":scope > summary"))).toBe("Menu");
      expect(details.querySelectorAll("a")).toHaveLength(5);
    });

    test(`${lang}: only the current page is marked aria-current="page"`, () => {
      const current = header.querySelectorAll('[aria-current]');
      expect(current).toHaveLength(1);
      expect(current[0]!.getAttribute("aria-current")).toBe("page");
      expect(current[0]!.getAttribute("href")).toBe(lang === "id" ? "/panduan/" : "/en/guide/");
    });

    test(`${lang}: the language switch links to the twin page in the other language`, () => {
      const sw = header.querySelector("a#lang")!;
      expect(sw.classList.contains("lang")).toBe(true);
      expect(sw.getAttribute("href")).toBe(lang === "id" ? "/en/guide/" : "/panduan/");
      expect(sw.getAttribute("hreflang")).toBe(lang === "id" ? "en" : "id");
      expect(sw.getAttribute("lang")).toBe(lang === "id" ? "en" : "id");
      expect(text(sw)).toBe(lang === "id" ? "English" : "Bahasa Indonesia");
      expect(sw.querySelector("svg")).not.toBeNull();
    });

    test(`${lang}: every link is the skip target or a route path`, () => {
      const hs = hrefs(header);
      expect(hs).toHaveLength(8);
      expect(hs.filter((h) => h !== "#content" && !allowedHref(h))).toEqual([]);
    });
  }

  test("nav links follow the header order in Indonesian", () => {
    const d = doc(siteHeader({ lang: "id", current: "home", converter: false }));
    const links = [...d.querySelectorAll("nav a")];
    expect(links.map(text)).toEqual(["Konversi", "Panduan", "Format", "Privasi", "CLI"]);
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/", "/panduan/", "/format/", "/privasi/", "/cli/"]);
  });

  test("nav links follow the header order in English", () => {
    const d = doc(siteHeader({ lang: "en", current: "home", converter: false }));
    const links = [...d.querySelectorAll("nav a")];
    expect(links.map(text)).toEqual(["Convert", "Guide", "Formats", "Privacy", "CLI"]);
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/", "/en/guide/", "/en/formats/", "/en/privacy/", "/en/cli/"]);
  });

  test("a page outside the header, such as DRM, marks no nav link current", () => {
    const d = doc(siteHeader({ lang: "id", current: "drm", converter: false }));
    expect(d.querySelectorAll("[aria-current]")).toHaveLength(0);
  });
});

describe("site footer", () => {
  for (const lang of ["id", "en"] as const) {
    const d = doc(siteFooter({ lang, version: "0.2.0", converter: false }));
    const footer = d.querySelector("footer.site-footer")!;

    test(`${lang}: three columns: product, help, legal`, () => {
      const heads = [...footer.querySelectorAll(".footer-cols h2")].map(text);
      expect(heads).toEqual(lang === "id" ? ["Produk", "Bantuan", "Legal"] : ["Product", "Help", "Legal"]);
    });

    test(`${lang}: the columns link the pages from the plan`, () => {
      const cols = [...footer.querySelectorAll(".footer-cols ul")].map((ul) => [...ul.querySelectorAll("a")].map((a) => a.getAttribute("href")));
      expect(cols).toEqual(
        lang === "id"
          ? [["/", "/format/", "/cli/", "/rilis/"], ["/panduan/", "/panduan/#faq", REPO + "/issues"], ["/privasi/", "/drm/", "/tentang/"]]
          : [["/", "/en/formats/", "/en/cli/", "/en/releases/"], ["/en/guide/", "/en/guide/#faq", REPO + "/issues"], ["/en/privacy/", "/en/drm/", "/en/about/"]],
      );
    });

    test(`${lang}: link labels read as written`, () => {
      const labels = [...footer.querySelectorAll(".footer-cols a")].map(text);
      expect(labels).toEqual(
        lang === "id"
          ? ["Konversi", "Format", "Skill & CLI", "Rilis", "Panduan", "FAQ", "Laporkan masalah", "Privasi", "DRM", "Tentang & lisensi"]
          : ["Convert", "Formats", "Skill & CLI", "Releases", "Guide", "FAQ", "Report an issue", "Privacy", "DRM", "About & licences"],
      );
    });

    test(`${lang}: the note and the bottom line with version, licence and source`, () => {
      expect(text(footer.querySelector(".footer-note"))).toBe(lang === "id" ? "Semua diproses di browser kamu." : "Everything runs in your browser.");
      const bottom = footer.querySelector(".footer-bottom")!;
      expect(text(bottom)).toBe(`pubmy v0.2.0 · MIT · ${lang === "id" ? "Kode sumber" : "Source code"}`);
      expect(bottom.querySelector("a")!.getAttribute("href")).toBe(REPO);
    });

    test(`${lang}: every link is a route path, its #faq anchor, or GitHub, and none is the 404 page`, () => {
      const hs = hrefs(footer);
      expect(hs).toHaveLength(11);
      expect(hs.filter((h) => !allowedHref(h))).toEqual([]);
      expect(hs.filter((h) => h.includes("404"))).toEqual([]);
    });

    test(`${lang}: external links carry rel="noopener"`, () => {
      const external = [...footer.querySelectorAll('a[href^="https:"]')];
      expect(external).toHaveLength(2);
      for (const a of external) expect((a.getAttribute("rel") ?? "").split(/\s+/)).toContain("noopener");
    });
  }
});

describe("converter variant", () => {
  const header = doc(siteHeader({ lang: "id", current: "home", converter: true }));
  const footer = doc(siteFooter({ lang: "id", version: "0.2.0", converter: true }));
  const NAV_KEYS = new Set(ROUTES.map((r) => `nav-${r.key}`));
  const known = (k: string) => Object.hasOwn(SITE_LABELS.id, k) || NAV_KEYS.has(k) || k === "lang-toggle";

  test("the language control is the existing button with its static Indonesian label", () => {
    const btn = header.querySelector("#lang")!;
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.getAttribute("type")).toBe("button");
    expect(btn.getAttribute("class")).toBe("ghost lang");
    expect(btn.querySelector("svg")).not.toBeNull();
    const label = btn.querySelector("span#lang-label")!;
    expect(label.getAttribute("data-i18n")).toBe("lang-toggle");
    expect(text(label)).toBe("English");
    expect(header.querySelectorAll("#lang")).toHaveLength(1);
  });

  test("Konversi is the current page", () => {
    const current = header.querySelectorAll("[aria-current]");
    expect(current).toHaveLength(1);
    expect(current[0]!.getAttribute("href")).toBe("/");
  });

  test("every nav link carries its Indonesian and English path", () => {
    const links = [...header.querySelectorAll("nav a")];
    expect(links.map((a) => [a.getAttribute("href"), a.getAttribute("data-href-id"), a.getAttribute("data-href-en")])).toEqual([
      ["/", "/", "/"],
      ["/panduan/", "/panduan/", "/en/guide/"],
      ["/format/", "/format/", "/en/formats/"],
      ["/privasi/", "/privasi/", "/en/privacy/"],
      ["/cli/", "/cli/", "/en/cli/"],
    ]);
    expect(links.map((a) => a.getAttribute("data-i18n"))).toEqual(["nav-home", "nav-guide", "nav-formats", "nav-privacy", "nav-cli"]);
  });

  test("every internal footer link carries its Indonesian and English path", () => {
    const links = [...footer.querySelectorAll(".footer-cols a")].filter((a) => !(a.getAttribute("href") ?? "").startsWith("https:"));
    expect(links).toHaveLength(9);
    expect(links.map((a) => a.getAttribute("data-href-en"))).toEqual([
      "/", "/en/formats/", "/en/cli/", "/en/releases/", "/en/guide/", "/en/guide/#faq", "/en/privacy/", "/en/drm/", "/en/about/",
    ]);
    for (const a of links) expect(a.getAttribute("data-href-id")).toBe(a.getAttribute("href"));
  });

  test("every visible header and footer string carries a known data-i18n key", () => {
    const nodes = [...header.querySelectorAll("[data-i18n]"), ...footer.querySelectorAll("[data-i18n]")];
    expect(nodes.length).toBeGreaterThanOrEqual(20);
    expect(nodes.map((n) => n.getAttribute("data-i18n")!).filter((k) => !known(k))).toEqual([]);
    const labels = [...header.querySelectorAll("[data-i18n-label]")].map((n) => n.getAttribute("data-i18n-label")!);
    expect(labels).toEqual(["nav-label"]);
    expect(labels.filter((k) => !known(k))).toEqual([]);
  });

  test("a data-i18n element holds only text, so replacing it keeps the markup", () => {
    for (const n of [...header.querySelectorAll("[data-i18n]"), ...footer.querySelectorAll("[data-i18n]")]) expect(n.children).toHaveLength(0);
  });

  test("the static text is the Indonesian label of each key", () => {
    for (const n of [...header.querySelectorAll("[data-i18n]"), ...footer.querySelectorAll("[data-i18n]")]) {
      const k = n.getAttribute("data-i18n")!;
      if (Object.hasOwn(SITE_LABELS.id, k)) expect(text(n)).toBe(SITE_LABELS.id[k as keyof typeof SITE_LABELS.id]);
    }
    expect(text(header.querySelector(".skip"))).toBe("Langsung ke konten");
  });
});

describe("SITE_LABELS", () => {
  test("both languages have the same keys", () => {
    expect(Object.keys(SITE_LABELS.en).sort()).toEqual(Object.keys(SITE_LABELS.id).sort());
    expect(Object.keys(SITE_LABELS.id).length).toBeGreaterThanOrEqual(11);
  });

  test("labels hold the briefed text", () => {
    expect(SITE_LABELS.id.skip).toBe("Langsung ke konten");
    expect(SITE_LABELS.en.skip).toBe("Skip to content");
    expect(SITE_LABELS.id["footer-about"]).toBe("Tentang & lisensi");
    expect(SITE_LABELS.en["footer-note"]).toBe("Everything runs in your browser.");
  });
});

describe("SITE_CSS", () => {
  const css = SITE_CSS.replace(/\s+/g, " ");

  test("the header is never sticky or fixed", () => {
    expect(css).not.toMatch(/sticky/);
    expect(css).not.toMatch(/position:\s*fixed/);
  });

  test("no 100vh", () => {
    expect(css).not.toContain("100vh");
  });

  test("the menu summary is at least 44px tall and wide", () => {
    const m = /\.nav-menu\s*>\s*summary\s*\{([^}]*)\}/.exec(css);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/min-height:\s*44px/);
    expect(m![1]).toMatch(/min-width:\s*44px/);
  });

  test("uses only the existing colour tokens and no literal colour", () => {
    const vars = new Set([...css.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]));
    expect([...vars].filter((v) => !["--accent", "--accent-ink", "--bg", "--surface", "--text", "--muted", "--border"].includes(v!))).toEqual([]);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
  });

  test("has no gradient and no uppercase tracking", () => {
    expect(css).not.toMatch(/gradient|text-transform:\s*uppercase/);
  });

  test("brings its own focus outline for support pages", () => {
    expect(css).toContain(":focus-visible{outline:3px solid var(--text);outline-offset:2px}");
  });

  test("page titles use a fluid size", () => {
    expect(css).toMatch(/\.page h1\{[^}]*font-size:clamp\(1\.5rem,\s*1\.2rem \+ 1\.5vw,\s*2rem\)/);
  });

  test("touches no bare element selector the converter page styles itself", () => {
    for (const sel of ["header", "main", "h1", "p", "#lang", "button"]) {
      expect(css).not.toMatch(new RegExp(`(^|[{},])\\s*${sel.replace("#", "\\#")}\\s*[{,]`));
    }
  });
});

describe("renderPage", () => {
  const route = (key: RouteKey) => ROUTES.find((r) => r.key === key)!;
  const page = (key: RouteKey, lang: "id" | "en") =>
    renderPage({ route: route(key), lang, bodyHtml: "<p>Isi</p><h2 id=\"faq\">FAQ</h2>", version: "0.2.0", tokensCss: ":root{--accent:#0f5c63}" });

  test("a support page is a full document in its language", () => {
    const html = page("guide", "en");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    const { document } = parseHTML(html);
    expect(document.documentElement.getAttribute("lang")).toBe("en");
    expect(document.querySelector('meta[charset]')!.getAttribute("charset")?.toLowerCase()).toBe("utf-8");
    expect(document.querySelector('meta[name="viewport"]')!.getAttribute("content")).toBe("width=device-width, initial-scale=1");
    expect(document.querySelector('link[rel="icon"]')!.getAttribute("href")).toBe("/icon.svg");
    expect(document.querySelector('meta[name="description"]')!.getAttribute("content")).toBe(route("guide").description.en);
  });

  test("the title is the page title followed by pubmy", () => {
    const { document } = parseHTML(page("guide", "id"));
    expect(document.querySelector("title")!.textContent).toBe(`${route("guide").title.id} · pubmy`);
  });

  test("an ampersand in the title is escaped in the markup and reads back as written", () => {
    const html = page("cli", "id");
    expect(html).toContain("<title>Skill &amp; CLI · pubmy</title>");
    expect(html).not.toMatch(/Skill & CLI/);
    const { document } = parseHTML(html);
    expect(document.querySelector("h1")!.textContent).toBe("Skill & CLI");
  });

  test("has one h1, the main landmark the skip link targets, and the body inside it", () => {
    const { document } = parseHTML(page("guide", "id"));
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    const main = document.querySelector("main#content")!;
    expect(main.classList.contains("page")).toBe(true);
    expect(main.querySelector("h1")!.textContent).toBe(route("guide").title.id);
    expect(main.querySelector("h2#faq")).not.toBeNull();
    expect(document.querySelector(".skip")!.getAttribute("href")).toBe("#content");
  });

  test("header comes before main and the footer after it", () => {
    const html = page("guide", "id");
    const h = html.indexOf('class="site-header"');
    const m = html.indexOf('<main id="content"');
    const f = html.indexOf('class="site-footer"');
    expect(h).toBeGreaterThan(0);
    expect(h).toBeLessThan(m);
    expect(m).toBeLessThan(f);
  });

  test("canonical and the three alternates point at the live site", () => {
    const { document } = parseHTML(page("formats", "en"));
    expect(document.querySelector('link[rel="canonical"]')!.getAttribute("href")).toBe("https://pubmy.belajarcarabelajar.com/en/formats/");
    const alt = [...document.querySelectorAll('link[rel="alternate"]')].map((l) => [l.getAttribute("hreflang"), l.getAttribute("href")]);
    expect(alt).toEqual([
      ["id", "https://pubmy.belajarcarabelajar.com/format/"],
      ["en", "https://pubmy.belajarcarabelajar.com/en/formats/"],
      ["x-default", "https://pubmy.belajarcarabelajar.com/format/"],
    ]);
  });

  test("the home page title is just pubmy", () => {
    const { document } = parseHTML(page("home", "id"));
    expect(document.querySelector("title")!.textContent).toBe("pubmy");
  });

  for (const lang of ["id", "en"] as const) {
    test(`${lang}: the not-found page is noindex with no canonical or alternates`, () => {
      const { document } = parseHTML(page("notfound", lang));
      expect(document.querySelector('meta[name="robots"]')!.getAttribute("content")).toBe("noindex");
      expect(document.querySelectorAll('link[rel="canonical"]')).toHaveLength(0);
      expect(document.querySelectorAll('link[rel="alternate"]')).toHaveLength(0);
    });
  }

  test("one inline style made of the tokens and SITE_CSS, and no stylesheet link", () => {
    const { document } = parseHTML(page("privacy", "id"));
    const styles = document.querySelectorAll("style");
    expect(styles).toHaveLength(1);
    expect(styles[0]!.textContent).toBe(":root{--accent:#0f5c63}" + SITE_CSS);
    expect(document.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(0);
  });

  test("no inline script: the only script is the module /site.js", () => {
    const { document } = parseHTML(page("privacy", "id"));
    const scripts = [...document.querySelectorAll("script")];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]!.getAttribute("type")).toBe("module");
    expect(scripts[0]!.getAttribute("src")).toBe("/site.js");
    expect(scripts[0]!.textContent).toBe("");
  });

  test("support pages use the link language switch and the version in the footer", () => {
    const { document } = parseHTML(page("drm", "id"));
    expect(document.querySelector("a#lang")!.getAttribute("href")).toBe("/en/drm/");
    expect(document.querySelector("button#lang")).toBeNull();
    expect(document.querySelector(".footer-bottom")!.textContent).toContain("pubmy v0.2.0");
  });

  test("the not-found page links to its twin not-found page", () => {
    const { document } = parseHTML(page("notfound", "en"));
    expect(document.querySelector("a#lang")!.getAttribute("href")).toBe("/404.html");
  });
});
