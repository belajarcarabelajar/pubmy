import type { Lang } from "../src/i18n.ts";
import type { RouteKey } from "./routes.ts";

// The visible words of the site header and footer. The converter bundle imports this module through i18n.ts, so it
// holds strings only: no CSS, no page titles or descriptions, no runtime import.
export const SITE_LABELS = {
  id: {
    skip: "Langsung ke konten",
    menu: "Menu",
    "nav-label": "Navigasi utama",
    "lang-short": "EN",
    "footer-tagline": "Ubah dokumen, e-book, dan komik jadi EPUB 3 yang lolos Send to Kindle.",
    "footer-product": "Produk",
    "footer-help": "Bantuan",
    "footer-legal": "Legal",
    "footer-cli": "Skill & CLI",
    "footer-faq": "FAQ",
    "footer-issues": "Laporkan masalah",
    "footer-about": "Tentang & lisensi",
    "footer-note": "Semua diproses di browser kamu.",
    "footer-source": "Kode sumber",
  },
  en: {
    skip: "Skip to content",
    menu: "Menu",
    "nav-label": "Main navigation",
    "lang-short": "ID",
    "footer-tagline": "Turn documents, e-books and comics into EPUB 3 that passes Send to Kindle.",
    "footer-product": "Product",
    "footer-help": "Help",
    "footer-legal": "Legal",
    "footer-cli": "Skill & CLI",
    "footer-faq": "FAQ",
    "footer-issues": "Report an issue",
    "footer-about": "About & licences",
    "footer-note": "Everything runs in your browser.",
    "footer-source": "Source code",
  },
} as const;

export const NAV_LABELS: Record<RouteKey, Record<Lang, string>> = {
  home: { id: "Konversi", en: "Convert" },
  guide: { id: "Panduan", en: "Guide" },
  formats: { id: "Format", en: "Formats" },
  privacy: { id: "Privasi", en: "Privacy" },
  drm: { id: "DRM", en: "DRM" },
  cli: { id: "CLI", en: "CLI" },
  about: { id: "Tentang", en: "About" },
  releases: { id: "Rilis", en: "Releases" },
  notfound: { id: "Tidak ditemukan", en: "Not found" },
};
