import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { renderPage } from "./layout.ts";
import { renderContent, siteTokens } from "./render.ts";
import { ROUTES, type Route } from "./routes.ts";

const SITE = "https://pubmy.belajarcarabelajar.com";

/**
 * The first plain :root rule and the dark-scheme :root block of index.html, verbatim. The theme tests read those two
 * as the only colour tokens, so support pages copy them instead of keeping a second set.
 */
export function tokensCssFrom(indexHtml: string): string {
  const css = /<style>([\s\S]*?)<\/style>/.exec(indexHtml)?.[1] ?? "";
  const light = /:root\{[^}]*\}/.exec(css)?.[0];
  const dark = /@media \(prefers-color-scheme:dark\)\{:root\{[^}]*\}\}/.exec(css)?.[0];
  if (!light) throw new Error("build: index.html has no :root rule to copy the colour tokens from");
  if (!dark) throw new Error("build: index.html has no prefers-color-scheme:dark :root block to copy");
  return light + dark;
}

/** Where a route path is written under the output directory: folders get index.html. */
export function outputFile(out: string, path: string): string {
  return join(out, path.endsWith("/") ? path + "index.html" : path);
}

/** Renders every route but the converter in both languages; returns the files written. */
export async function writeSupportPages(o: { out: string; contentDir: string; indexHtml: string; version: string }): Promise<string[]> {
  const tokensCss = tokensCssFrom(o.indexHtml);
  const tokens = siteTokens(o.version);
  const written: string[] = [];
  for (const route of ROUTES.filter((r) => r.key !== "home")) {
    for (const lang of ["id", "en"] as const) {
      const md = await readFile(join(o.contentDir, lang, `${route.key}.md`), "utf8");
      const html = renderPage({ route, lang, bodyHtml: renderContent(md, tokens), version: o.version, tokensCss });
      const file = outputFile(o.out, route.path[lang]);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, html);
      written.push(file);
    }
  }
  for (const file of written) {
    if ((await readFile(file, "utf8")).includes("{{")) throw new Error(`build: ${file} still holds a {{ token`);
  }
  return written;
}

const alt = (hreflang: string, path: string) => `    <xhtml:link rel="alternate" hreflang="${hreflang}" href="${SITE}${path}"/>\n`;
const url = (path: string, alternates: string) => `  <url>\n    <loc>${SITE}${path}</loc>\n${alternates}  </url>\n`;

/** sitemap.xml from the route table: the root once, then each support page in both languages with its twin pair. */
export function sitemapXml(routes: readonly Route[] = ROUTES): string {
  let body = url("/", alt("id", "/") + alt("x-default", "/"));
  for (const r of routes.filter((r) => r.key !== "home" && r.key !== "notfound")) {
    const alternates = alt("id", r.path.id) + alt("en", r.path.en) + alt("x-default", r.path.id);
    body += url(r.path.id, alternates) + url(r.path.en, alternates);
  }
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
    body +
    "</urlset>\n"
  );
}
