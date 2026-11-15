import type { Lang } from "../src/i18n.ts";
import { NAV_LABELS } from "./labels.ts";

export type RouteKey = "home" | "guide" | "formats" | "privacy" | "drm" | "cli" | "about" | "releases" | "notfound";

export interface Route {
  key: RouteKey;
  path: Record<Lang, string>;
  nav: Record<Lang, string>;
  title: Record<Lang, string>;
  description: Record<Lang, string>;
  inHeader: boolean;
}

// Descriptions quote no limit or version: those live in code and the Markdown content quotes them through tokens.
export const ROUTES: readonly Route[] = [
  {
    key: "home",
    path: { id: "/", en: "/" },
    nav: NAV_LABELS.home,
    title: { id: "Ubah file jadi EPUB", en: "Turn files into EPUB" },
    description: {
      id: "Ubah dokumen, e-book, dan komik jadi EPUB 3 langsung di browser, atau buka EPUB untuk dibaca.",
      en: "Turn documents, e-books and comics into EPUB 3 right in your browser, or open an EPUB to read it.",
    },
    inHeader: true,
  },
  {
    key: "guide",
    path: { id: "/panduan/", en: "/en/guide/" },
    nav: NAV_LABELS.guide,
    title: { id: "Panduan dan FAQ", en: "Guide and FAQ" },
    description: {
      id: "Cara memilih file, mengubahnya jadi EPUB, dan mengirim hasilnya ke Kindle, plus jawaban untuk pertanyaan yang sering muncul.",
      en: "How to choose files, turn them into EPUB and send the result to your Kindle, with answers to common questions.",
    },
    inHeader: true,
  },
  {
    key: "formats",
    path: { id: "/format/", en: "/en/formats/" },
    nav: NAV_LABELS.formats,
    title: { id: "Format yang didukung", en: "Supported formats" },
    description: {
      id: "Format apa saja yang bisa diubah pubmy jadi EPUB, dan apa yang terjadi pada kolom, PDF hasil pindaian, dan komik.",
      en: "Which formats pubmy turns into EPUB, and what happens to columns, scanned PDFs and comics.",
    },
    inHeader: true,
  },
  {
    key: "privacy",
    path: { id: "/privasi/", en: "/en/privacy/" },
    nav: NAV_LABELS.privacy,
    title: { id: "Privasi", en: "Privacy" },
    description: {
      id: "File kamu diproses di browser dan tidak pernah diunggah. Hasilnya hanya disimpan sebentar di memori tab, lalu dihapus.",
      en: "Your files are processed in your browser and never uploaded. Results stay only briefly in the tab's memory, then are wiped.",
    },
    inHeader: true,
  },
  {
    key: "drm",
    path: { id: "/drm/", en: "/en/drm/" },
    nav: NAV_LABELS.drm,
    title: { id: "Kebijakan DRM", en: "DRM policy" },
    description: {
      id: "Kenapa pubmy menolak e-book yang dilindungi DRM, dan file apa saja yang tetap bisa diubah.",
      en: "Why pubmy refuses e-books that are protected by DRM, and which files it still converts.",
    },
    inHeader: false,
  },
  {
    key: "cli",
    path: { id: "/cli/", en: "/en/cli/" },
    nav: NAV_LABELS.cli,
    title: { id: "Skill & CLI", en: "Skill & CLI" },
    description: {
      id: "Pasang skill pubmy agar agen coding kamu bisa mengubah satu folder penuh jadi EPUB dengan struktur folder tetap.",
      en: "Install the pubmy skill so your coding agent can convert a whole folder to EPUB, keeping the folder layout.",
    },
    inHeader: true,
  },
  {
    key: "about",
    path: { id: "/tentang/", en: "/en/about/" },
    nav: NAV_LABELS.about,
    title: { id: "Tentang dan lisensi", en: "About and licences" },
    description: {
      id: "Tentang pubmy, lisensi MIT-nya, dan lisensi pustaka pihak ketiga yang dipakai di dalamnya.",
      en: "About pubmy, its MIT licence and the licences of the third-party libraries it uses.",
    },
    inHeader: false,
  },
  {
    key: "releases",
    path: { id: "/rilis/", en: "/en/releases/" },
    nav: NAV_LABELS.releases,
    title: { id: "Catatan rilis", en: "Release notes" },
    description: {
      id: "Apa saja yang berubah di tiap versi pubmy, dari situs web sampai skill untuk agen coding.",
      en: "What changed in each version of pubmy, from the website to the skill for coding agents.",
    },
    inHeader: false,
  },
  {
    key: "notfound",
    path: { id: "/404.html", en: "/en/404.html" },
    nav: NAV_LABELS.notfound,
    title: { id: "Halaman tidak ditemukan", en: "Page not found" },
    description: {
      id: "Halaman yang kamu cari tidak ada. Kembali ke pengubah EPUB atau buka panduan.",
      en: "The page you are looking for does not exist. Go back to the EPUB converter or open the guide.",
    },
    inHeader: false,
  },
];

/** Folder pages are served with a trailing slash; "/panduan" and "/panduan/index.html" name the same page. */
function normalize(path: string): string {
  if (path.endsWith("/index.html")) return path.slice(0, -"index.html".length);
  if (path === "" || path.endsWith("/") || path.endsWith(".html")) return path;
  return path + "/";
}

export function routeByPath(path: string): { route: Route; lang: Lang } | undefined {
  const p = normalize(path);
  if (p === "") return undefined;
  for (const lang of ["id", "en"] as const) {
    const route = ROUTES.find((r) => r.path[lang] === p);
    if (route) return { route, lang };
  }
  return undefined;
}

export function twinPath(path: string): string | undefined {
  const found = routeByPath(path);
  if (!found) return undefined;
  return found.route.path[found.lang === "id" ? "en" : "id"];
}
