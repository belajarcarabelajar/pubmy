import { describe, expect, test } from "bun:test";
import { ROUTES, routeByPath, twinPath, type RouteKey } from "../site/routes.ts";

// The route table is the only list of pages: header, footer, sitemap and twin links all read it.
// Expected paths and labels are written out here from the spec, not read back from the table.
const PATHS: Record<RouteKey, { id: string; en: string }> = {
  home: { id: "/", en: "/" },
  guide: { id: "/panduan/", en: "/en/guide/" },
  formats: { id: "/format/", en: "/en/formats/" },
  privacy: { id: "/privasi/", en: "/en/privacy/" },
  drm: { id: "/drm/", en: "/en/drm/" },
  cli: { id: "/cli/", en: "/en/cli/" },
  about: { id: "/tentang/", en: "/en/about/" },
  releases: { id: "/rilis/", en: "/en/releases/" },
  notfound: { id: "/404.html", en: "/en/404.html" },
};
const ORDER: RouteKey[] = ["home", "guide", "formats", "privacy", "drm", "cli", "about", "releases", "notfound"];

describe("route table", () => {
  test("lists the nine pages in order", () => {
    expect(ROUTES.map((r) => r.key)).toEqual(ORDER);
  });

  test("every route has the Indonesian and English path from the spec", () => {
    expect(ROUTES).toHaveLength(9);
    for (const r of ROUTES) expect(r.path).toEqual(PATHS[r.key]);
  });

  test("paths are unique across routes and languages, home aside", () => {
    const all = ROUTES.flatMap((r) => (r.key === "home" ? [r.path.id] : [r.path.id, r.path.en]));
    expect(all).toHaveLength(17);
    expect(new Set(all).size).toBe(all.length);
  });

  test("English paths live under /en/ except home", () => {
    for (const r of ROUTES.filter((r) => r.key !== "home")) {
      expect(r.path.en.startsWith("/en/")).toBe(true);
      expect(r.path.id.startsWith("/en/")).toBe(false);
    }
  });

  test("every route has a nav label, title and description in both languages", () => {
    for (const r of ROUTES) {
      for (const lang of ["id", "en"] as const) {
        expect(r.nav[lang].trim().length).toBeGreaterThan(0);
        expect(r.title[lang].trim().length).toBeGreaterThan(0);
        expect(r.description[lang].trim().length).toBeGreaterThan(20);
        expect(r.description[lang].length).toBeLessThanOrEqual(155);
      }
    }
  });

  test("descriptions quote no limit, so a changed limit cannot leave them stale", () => {
    for (const r of ROUTES) for (const lang of ["id", "en"] as const) expect(r.description[lang].replaceAll("EPUB 3", "EPUB")).not.toMatch(/\d/);
  });

  test("no route text has an em dash", () => {
    expect(JSON.stringify(ROUTES)).not.toContain("\u2014");
  });

  test("nav labels match the spec", () => {
    expect(ROUTES.map((r) => r.nav.id)).toEqual(["Konversi", "Panduan", "Format", "Privasi", "DRM", "CLI", "Tentang", "Rilis", "Tidak ditemukan"]);
    expect(ROUTES.map((r) => r.nav.en)).toEqual(["Convert", "Guide", "Formats", "Privacy", "DRM", "CLI", "About", "Releases", "Not found"]);
  });

  test("the Skill and CLI page is titled Skill & CLI", () => {
    const cli = ROUTES.find((r) => r.key === "cli")!;
    expect(cli.title).toEqual({ id: "Skill & CLI", en: "Skill & CLI" });
  });

  test("the header holds Convert, Guide, Formats, Privacy and CLI, in that order", () => {
    expect(ROUTES.filter((r) => r.inHeader).map((r) => r.key)).toEqual(["home", "guide", "formats", "privacy", "cli"]);
  });
});

describe("routeByPath", () => {
  test("finds a page with a trailing slash, without one, and with index.html", () => {
    for (const p of ["/panduan/", "/panduan", "/panduan/index.html"]) expect(routeByPath(p)).toMatchObject({ route: { key: "guide" }, lang: "id" });
    for (const p of ["/en/guide/", "/en/guide", "/en/guide/index.html"]) expect(routeByPath(p)).toMatchObject({ route: { key: "guide" }, lang: "en" });
  });

  test("resolves the root and /index.html to the Indonesian converter", () => {
    expect(routeByPath("/")).toMatchObject({ route: { key: "home" }, lang: "id" });
    expect(routeByPath("/index.html")).toMatchObject({ route: { key: "home" }, lang: "id" });
  });

  test("finds both not-found pages", () => {
    expect(routeByPath("/404.html")).toMatchObject({ route: { key: "notfound" }, lang: "id" });
    expect(routeByPath("/en/404.html")).toMatchObject({ route: { key: "notfound" }, lang: "en" });
  });

  test("returns undefined for an unknown path and for /en/, which is not a page", () => {
    expect(routeByPath("/nope/")).toBeUndefined();
    expect(routeByPath("/en/")).toBeUndefined();
    expect(routeByPath("/en/panduan/")).toBeUndefined();
    expect(routeByPath("")).toBeUndefined();
  });
});

describe("twinPath", () => {
  test("maps every page to its twin page and back", () => {
    for (const key of ORDER) {
      const { id, en } = PATHS[key];
      expect(twinPath(id)).toBe(en);
      if (key !== "home") expect(twinPath(en)).toBe(id);
    }
  });

  test("the root is its own twin", () => {
    expect(twinPath("/")).toBe("/");
  });

  test("accepts the same path variants as routeByPath", () => {
    expect(twinPath("/privasi")).toBe("/en/privacy/");
    expect(twinPath("/en/privacy/index.html")).toBe("/privasi/");
  });

  test("returns undefined for an unknown path", () => {
    expect(twinPath("/nope/")).toBeUndefined();
  });
});
