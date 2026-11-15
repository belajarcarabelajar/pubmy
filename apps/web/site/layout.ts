import type { Lang } from "../src/i18n.ts";
import { SITE_LABELS } from "./labels.ts";
import { ROUTES, type Route, type RouteKey } from "./routes.ts";
import { SITE_CSS } from "./styles.ts";

export { SITE_LABELS };

type LabelKey = keyof typeof SITE_LABELS.id;

const SITE = "https://pubmy.belajarcarabelajar.com";
const REPO = "https://github.com/belajarcarabelajar/pubmy";
const GLOBE =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a4 9 0 1 0 0 18a4 9 0 1 0 0-18z"/></svg>';

const other = (lang: Lang): Lang => (lang === "id" ? "en" : "id");
// The language control names the other language, as the converter's "lang-toggle" text does. A local copy keeps
// this module free of runtime imports from i18n.ts, which reads SITE_LABELS from labels.ts.
const OTHER_NAME: Record<Lang, string> = { id: "English", en: "Bahasa Indonesia" };

function esc(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function route(key: RouteKey): Route {
  return ROUTES.find((r) => r.key === key)!;
}

/** On the converter page main.js swaps text by data-i18n and link targets by data-href-<lang>. */
const i18n = (converter: boolean, key: string) => (converter ? ` data-i18n="${key}"` : "");
const hrefPair = (converter: boolean, id: string, en: string) => (converter ? ` data-href-id="${esc(id)}" data-href-en="${esc(en)}"` : "");

/** An internal link to a route, optionally to an anchor on it. */
function routeLink(o: { lang: Lang; converter: boolean; key: RouteKey; label: string; labelKey: string; hash?: string; current?: boolean }): string {
  const r = route(o.key);
  const hash = o.hash ?? "";
  const href = r.path[o.lang] + hash;
  const cur = o.current ? ' aria-current="page"' : "";
  return `<a href="${esc(href)}"${hrefPair(o.converter, r.path.id + hash, r.path.en + hash)}${cur}${i18n(o.converter, o.labelKey)}>${esc(o.label)}</a>`;
}

function label(lang: Lang, key: LabelKey): string {
  return SITE_LABELS[lang][key];
}

export function siteHeader(opts: { lang: Lang; current: RouteKey; converter: boolean }): string {
  const { lang, current, converter } = opts;
  const links = ROUTES.filter((r) => r.inHeader)
    .map((r) => `<li>${routeLink({ lang, converter, key: r.key, label: r.nav[lang], labelKey: `nav-${r.key}`, current: r.key === current })}</li>`)
    .join("");
  const navLabel = converter ? ` data-i18n-label="nav-label"` : "";
  // A phone shows only the code; the full name stays the accessible name, visually hidden by the CSS.
  const short = `<span class="lang-short" aria-hidden="true"${i18n(converter, "lang-short")}>${label(lang, "lang-short")}</span>`;
  const switcher = converter
    ? `<button type="button" id="lang" class="ghost lang">${GLOBE}<span id="lang-label" class="lang-long" data-i18n="lang-toggle">${OTHER_NAME[lang]}</span>${short}</button>`
    : `<a id="lang" class="lang" href="${esc(route(current).path[other(lang)])}" hreflang="${other(lang)}" lang="${other(lang)}">${GLOBE}<span class="lang-long">${OTHER_NAME[lang]}</span>${short}</a>`;
  return (
    `<header class="site-header"><div class="site-header-inner">` +
    `<a class="skip" href="#content"${i18n(converter, "skip")}>${esc(label(lang, "skip"))}</a>` +
    `<a class="site-brand" href="/"><img src="/icon.svg" alt="" width="32" height="32"><span>pubmy</span></a>` +
    `<nav class="site-nav" aria-label="${esc(label(lang, "nav-label"))}"${navLabel}>` +
    `<details class="nav-menu"><summary${i18n(converter, "menu")}>${esc(label(lang, "menu"))}</summary><ul>${links}</ul></details>` +
    `</nav>${switcher}</div></header>`
  );
}

export function siteFooter(opts: { lang: Lang; version: string; converter: boolean }): string {
  const { lang, converter } = opts;
  const nav = (key: RouteKey) => routeLink({ lang, converter, key, label: route(key).nav[lang], labelKey: `nav-${key}` });
  const named = (key: RouteKey, labelKey: LabelKey, hash?: string) => routeLink({ lang, converter, key, label: label(lang, labelKey), labelKey, hash });
  const external = (href: string, labelKey: LabelKey) => `<a href="${href}" rel="noopener"${i18n(converter, labelKey)}>${esc(label(lang, labelKey))}</a>`;
  const col = (headKey: LabelKey, items: string[]) =>
    `<div><h2${i18n(converter, headKey)}>${esc(label(lang, headKey))}</h2><ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul></div>`;
  return (
    `<footer class="site-footer"><div class="site-footer-inner"><div class="footer-cols">` +
    `<div class="footer-brand"><p class="footer-name"><img src="/icon.svg" alt="" width="32" height="32"><span>pubmy</span></p>` +
    `<p class="footer-tagline"${i18n(converter, "footer-tagline")}>${esc(label(lang, "footer-tagline"))}</p></div>` +
    col("footer-product", [nav("home"), nav("formats"), named("cli", "footer-cli"), nav("releases")]) +
    col("footer-help", [nav("guide"), named("guide", "footer-faq", "#faq"), external(`${REPO}/issues`, "footer-issues")]) +
    col("footer-legal", [nav("privacy"), nav("drm"), named("about", "footer-about")]) +
    `</div><p class="footer-note"${i18n(converter, "footer-note")}>${esc(label(lang, "footer-note"))}</p>` +
    `<p class="footer-bottom">pubmy v${esc(opts.version)} · MIT · ${external(REPO, "footer-source")}</p>` +
    `</div></footer>`
  );
}

export function renderPage(opts: { route: Route; lang: Lang; bodyHtml: string; version: string; tokensCss: string }): string {
  const { route: r, lang } = opts;
  const title = r.key === "home" ? "pubmy" : `${r.title[lang]} · pubmy`;
  // A not-found page answers for any missing URL, so it names no address of its own.
  const seo =
    r.key === "notfound"
      ? `<meta name="robots" content="noindex">`
      : `<link rel="canonical" href="${esc(SITE + r.path[lang])}">` +
        `<link rel="alternate" hreflang="id" href="${esc(SITE + r.path.id)}">` +
        `<link rel="alternate" hreflang="en" href="${esc(SITE + r.path.en)}">` +
        `<link rel="alternate" hreflang="x-default" href="${esc(SITE + r.path.id)}">`;
  return (
    `<!doctype html>\n<html lang="${lang}">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>${esc(title)}</title>\n<meta name="description" content="${esc(r.description[lang])}">\n` +
    `<link rel="icon" href="/icon.svg" type="image/svg+xml">\n${seo}\n` +
    `<style>${opts.tokensCss}${SITE_CSS}</style>\n</head>\n<body class="site-page">\n` +
    siteHeader({ lang, current: r.key, converter: false }) +
    `\n<main id="content" class="page"><h1>${esc(r.title[lang])}</h1>${opts.bodyHtml}</main>\n` +
    siteFooter({ lang, version: opts.version, converter: false }) +
    `\n<script type="module" src="/site.js"></script>\n</body>\n</html>\n`
  );
}
