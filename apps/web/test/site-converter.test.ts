import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { KEYS, t, type Key } from "../src/i18n.ts";
import { applySiteLinks } from "../src/site-links.ts";
import { ROUTES } from "../site/routes.ts";

// The converter page carries the same site header and footer as the support pages, filled in Indonesian at build
// time; main.js switches their text and link targets with the rest of the page.
const web = join(import.meta.dir, "..");
const main = readFileSync(join(web, "src", "main.ts"), "utf8");
const out = mkdtempSync(join(tmpdir(), "pubmy-site-converter-"));
afterAll(() => rmSync(out, { recursive: true, force: true }));
const proc = Bun.spawnSync([process.execPath, join(web, "build.ts"), out], { stdout: "pipe", stderr: "pipe" });
if (proc.exitCode !== 0) console.error(proc.stderr.toString());
const built = proc.exitCode === 0 ? readFileSync(join(out, "index.html"), "utf8") : "";
const { document } = parseHTML(built);
const ROUTE_PATHS = new Set(ROUTES.filter((r) => r.key !== "notfound").flatMap((r) => [r.path.id, r.path.en]));
const isRoutePath = (h: string | null) => !!h && (ROUTE_PATHS.has(h) || (h.endsWith("#faq") && ROUTE_PATHS.has(h.slice(0, -4))));

describe("the built converter page", () => {
  test("the build exits 0", () => {
    expect(proc.exitCode).toBe(0);
  });

  test("has one site header before main and one site footer after it", () => {
    expect(document.querySelectorAll(".site-header")).toHaveLength(1);
    expect(document.querySelectorAll(".site-footer")).toHaveLength(1);
    const h = built.indexOf('<header class="site-header"');
    const m = built.indexOf("<main");
    const mEnd = built.indexOf("</main>");
    const f = built.indexOf('<footer class="site-footer"');
    expect(h).toBeGreaterThan(0);
    expect(h).toBeLessThan(m);
    expect(f).toBeGreaterThan(mEnd);
    expect(built).not.toContain("<!--site-header-->");
    expect(built).not.toContain("<!--site-footer-->");
  });

  test("the language button sits in the site header with its static label English", () => {
    const btn = document.querySelector(".site-header #lang")!;
    expect(btn).not.toBeNull();
    expect(btn.tagName).toBe("BUTTON");
    expect(document.querySelectorAll("#lang")).toHaveLength(1);
    expect(btn.querySelector("#lang-label")!.textContent).toBe("English");
  });

  test("the hero keeps the page's only h1 and no button", () => {
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(document.querySelector("main .hero h1")).not.toBeNull();
    expect(document.querySelector(".hero button")).toBeNull();
  });

  test("main is the skip link target", () => {
    expect(document.querySelector("main")!.id).toBe("content");
    expect(document.querySelector(".site-header a.skip")!.getAttribute("href")).toBe("#content");
  });

  test("every switchable link has an Indonesian and an English route path", () => {
    const links = [...document.querySelectorAll("[data-href-id]")];
    expect(links).toHaveLength(14);
    for (const a of links) {
      expect(isRoutePath(a.getAttribute("data-href-id"))).toBe(true);
      expect(isRoutePath(a.getAttribute("data-href-en"))).toBe(true);
      expect(a.getAttribute("href")).toBe(a.getAttribute("data-href-id"));
    }
    const nav = [...document.querySelectorAll(".site-header nav a")];
    expect(nav).toHaveLength(5);
    expect(nav.filter((a) => !a.hasAttribute("data-href-en"))).toEqual([]);
  });

  test("every data-i18n and data-i18n-label key exists in the i18n table", () => {
    const keys = [
      ...[...document.querySelectorAll("[data-i18n]")].map((e) => e.getAttribute("data-i18n")!),
      ...[...document.querySelectorAll("[data-i18n-label]")].map((e) => e.getAttribute("data-i18n-label")!),
    ];
    expect(keys).toContain("nav-guide");
    expect(keys).toContain("footer-note");
    expect(keys.filter((k) => !(KEYS as string[]).includes(k))).toEqual([]);
  });

  test("no element carries two aria-label attributes", () => {
    const tags = [...built.matchAll(/<[a-z][^>]*>/g)].map((m) => m[0]);
    expect(tags.filter((t) => (t.match(/\saria-label=/g) ?? []).length > 1)).toEqual([]);
  });

  test("the hide rule covers the site header and footer, inline in the one style block", () => {
    const styles = [...built.matchAll(/<style>([\s\S]*?)<\/style>/g)];
    expect(styles).toHaveLength(1);
    expect(styles[0]![1]).toContain(
      "html:not(.ready) main,html:not(.ready) .site-header,html:not(.ready) .site-footer{visibility:hidden;animation:reveal 0s 1.5s forwards}",
    );
    expect(styles[0]![1]).toContain(".nav-menu>summary{");
    expect(built).not.toMatch(/rel="stylesheet"/);
  });
});

describe("site labels in the i18n table", () => {
  test("hold the English text in English and the Indonesian text in Indonesian", () => {
    expect([t("nav-home", "en"), t("nav-guide", "en"), t("footer-issues", "en"), t("skip", "en"), t("nav-label", "en")]).toEqual([
      "Convert", "Guide", "Report an issue", "Skip to content", "Main navigation",
    ]);
    expect([t("nav-home", "id"), t("nav-guide", "id"), t("footer-issues", "id"), t("skip", "id"), t("nav-label", "id")]).toEqual([
      "Konversi", "Panduan", "Laporkan masalah", "Langsung ke konten", "Navigasi utama",
    ]);
  });

  test("the built header and footer text is the Indonesian text of each key, so main.js changes nothing for id", () => {
    const nodes = [...document.querySelectorAll(".site-header [data-i18n], .site-footer [data-i18n]")];
    expect(nodes.length).toBeGreaterThanOrEqual(20);
    expect(nodes.filter((n) => n.textContent !== t(n.getAttribute("data-i18n") as Key, "id")).map((n) => n.getAttribute("data-i18n"))).toEqual([]);
  });
});

describe("applySiteLinks", () => {
  const page = () =>
    parseHTML(
      '<!doctype html><html><body><a id="a" href="/panduan/" data-href-id="/panduan/" data-href-en="/en/guide/">x</a>' +
        '<a id="b" href="/panduan/#faq" data-href-id="/panduan/#faq" data-href-en="/en/guide/#faq">y</a><a id="c" href="https://example.com/">z</a></body></html>',
    ).document;

  test("points every switchable link at its English path, and back to Indonesian", () => {
    const d = page();
    applySiteLinks(d, "en");
    expect([d.getElementById("a")!.getAttribute("href"), d.getElementById("b")!.getAttribute("href")]).toEqual(["/en/guide/", "/en/guide/#faq"]);
    applySiteLinks(d, "id");
    expect([d.getElementById("a")!.getAttribute("href"), d.getElementById("b")!.getAttribute("href")]).toEqual(["/panduan/", "/panduan/#faq"]);
  });

  test("leaves other links alone", () => {
    const d = page();
    applySiteLinks(d, "en");
    expect(d.getElementById("c")!.getAttribute("href")).toBe("https://example.com/");
  });
});

describe("main.ts", () => {
  test("imports applySiteLinks and calls it inside applyLang", () => {
    expect(main).toMatch(/^import \{ applySiteLinks \} from "\.\/site-links\.ts";$/m);
    const body = /^function applyLang\(\) \{\n([\s\S]*?)^\}$/m.exec(main)?.[1] ?? "";
    expect(body).toMatch(/^\s+applySiteLinks\(document, lang\);$/m);
  });
});
