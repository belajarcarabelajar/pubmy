import type { FailureCode } from "@pubmy/core";

export type Lang = "id" | "en";

const id = {
  title: "pubmy: ubah file jadi EPUB",
  tagline: "TXT, Markdown, HTML, DOCX, PDF, MOBI/AZW3, CBZ/CBR ke EPUB 3 yang lolos Send to Kindle.",
  privacy: "Semua diproses di browser kamu. Tidak ada file yang diunggah.",
  "drop-hint": "Tarik file ke sini (maksimal 10 file, masing-masing 50 MB)",
  "drop-hint-touch": "Maksimal 10 file, masing-masing 50 MB",
  "choose-files": "Pilih file",
  "queue-label": "Antrean konversi",
  "lang-toggle": "English",
  "lang-toggle-label": "Ganti bahasa ke English",
  waiting: "Menunggu",
  converting: "Mengonversi",
  ready: "Siap",
  failed: "Gagal",
  deleted: "Dihapus",
  download: "Unduh EPUB",
  remove: "Hapus",
  "expires-in": "Dihapus dalam",
  refused: "Ditolak",
  LIMIT_10: "Antrean penuh: maksimal 10 file.",
  DRM: "File ini dilindungi DRM, jadi tidak bisa dikonversi.",
  UNSUPPORTED: "Format file ini tidak didukung.",
  TOO_LARGE: "File lebih dari 50 MB.",
  READ_FAILED: "File tidak bisa dibaca.",
  INVALID_EPUB: "EPUB hasil konversi tidak valid, jadi tidak diberikan.",
  "already-epub": "File ini sudah EPUB.",
  "encrypted-office": "Dokumen Office ini dikunci kata sandi.",
  "encrypted-pdf": "PDF ini dikunci kata sandi.",
  "scanned-pdf": "PDF ini hasil pindaian dan perlu OCR.",
  "ocr-unavailable": "OCR tidak tersedia di sini.",
  "no-images": "Arsip komik ini tidak berisi gambar.",
  "archive-too-large": "Isi arsip terlalu besar setelah dibuka.",
  "browser-unsupported": "Browser ini terlalu lama untuk membaca PDF. Coba versi terbaru Chrome, Firefox, atau Safari.",
  "empty-file": "File kosong.",
  "unsupported-format": "Format file ini tidak didukung.",
  "read-failed": "File tidak bisa dibaca.",
  "invalid-epub": "EPUB hasil konversi tidak valid, jadi tidak diberikan.",
  preview: "Pratinjau",
  "preview-close": "Tutup pratinjau",
  "preview-prev": "Halaman sebelumnya",
  "preview-next": "Halaman berikutnya",
  "preview-toc": "Daftar isi",
  "preview-failed": "Pratinjau tidak bisa dibuka.",
};

export type Key = keyof typeof id;

const en: Record<Key, string> = {
  title: "pubmy: turn files into EPUB",
  tagline: "TXT, Markdown, HTML, DOCX, PDF, MOBI/AZW3, CBZ/CBR to EPUB 3 that passes Send to Kindle.",
  privacy: "Everything runs in your browser. No file is uploaded.",
  "drop-hint": "Drop files here (up to 10 files, 50 MB each)",
  "drop-hint-touch": "Up to 10 files, 50 MB each",
  "choose-files": "Choose files",
  "queue-label": "Conversion queue",
  "lang-toggle": "Bahasa Indonesia",
  "lang-toggle-label": "Switch language to Bahasa Indonesia",
  waiting: "Waiting",
  converting: "Converting",
  ready: "Ready",
  failed: "Failed",
  deleted: "Deleted",
  download: "Download EPUB",
  remove: "Remove",
  "expires-in": "Deleted in",
  refused: "Refused",
  LIMIT_10: "Queue full: 10 files at most.",
  DRM: "This file is DRM-protected, so it cannot be converted.",
  UNSUPPORTED: "This file format is not supported.",
  TOO_LARGE: "The file is over 50 MB.",
  READ_FAILED: "The file could not be read.",
  INVALID_EPUB: "The converted EPUB was invalid, so it was withheld.",
  "already-epub": "This file is already an EPUB.",
  "encrypted-office": "This Office document is password-protected.",
  "encrypted-pdf": "This PDF is password-protected.",
  "scanned-pdf": "This PDF is a scan and needs OCR.",
  "ocr-unavailable": "OCR is not available here.",
  "no-images": "This comic archive contains no images.",
  "archive-too-large": "The archive is too large once unpacked.",
  "browser-unsupported": "This browser is too old to read PDFs. Try a current Chrome, Firefox, or Safari.",
  "empty-file": "The file is empty.",
  "unsupported-format": "This file format is not supported.",
  "read-failed": "The file could not be read.",
  "invalid-epub": "The converted EPUB was invalid, so it was withheld.",
  preview: "Preview",
  "preview-close": "Close preview",
  "preview-prev": "Previous page",
  "preview-next": "Next page",
  "preview-toc": "Contents",
  "preview-failed": "The preview could not be opened.",
};

const dict: Record<Lang, Record<Key, string>> = { id, en };

export const KEYS = Object.keys(id) as Key[];

export function t(key: Key, lang: Lang): string {
  return dict[lang][key];
}

const isKey = (k: string): k is Key => Object.hasOwn(id, k);

/** A phone or tablet cannot drag files onto the page, so its hint only gives the limits. */
export function dropHintKey(touch: boolean): Key {
  return touch ? "drop-hint-touch" : "drop-hint";
}

/** The specific core message when the page knows it, otherwise the failure code's text. */
export function failureText(code: FailureCode, message: string, lang: Lang): string {
  return t(isKey(message) ? message : code, lang);
}

/** A stored "id"/"en" wins; otherwise an Indonesian browser gets "id" and every other one "en". */
export function pickLang(stored: string | null, browser: string): Lang {
  if (stored === "id" || stored === "en") return stored;
  return browser.toLowerCase().startsWith("id") ? "id" : "en";
}
