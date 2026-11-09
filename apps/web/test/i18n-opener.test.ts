import { describe, expect, test } from "bun:test";
import { failureText, KEYS, t, type Key } from "../src/i18n.ts";

describe("the opener strings", () => {
  test("read, opened and epub-drm are known keys", () => {
    for (const k of ["read", "opened", "epub-drm"]) expect(KEYS).toContain(k as Key);
  });

  test("the Read button reads Baca and Read", () => {
    expect(t("read", "id")).toBe("Baca");
    expect(t("read", "en")).toBe("Read");
  });

  test("the opened status reads Siap dibaca and Ready to read", () => {
    expect(t("opened", "id")).toBe("Siap dibaca");
    expect(t("opened", "en")).toBe("Ready to read");
  });

  test("the DRM refusal for an EPUB says it cannot be opened, not converted", () => {
    expect(t("epub-drm", "id")).toBe("EPUB ini dilindungi DRM, jadi tidak bisa dibuka.");
    expect(t("epub-drm", "en")).toBe("This EPUB is DRM-protected, so it cannot be opened.");
  });

  test("already-epub keeps its text, since core and the CLI still use it", () => {
    expect(t("already-epub", "id")).toBe("File ini sudah EPUB.");
    expect(t("already-epub", "en")).toBe("This file is already an EPUB.");
  });
});

describe("the tagline", () => {
  test("keeps the old text and ends with the opener sentence", () => {
    expect(t("tagline", "id")).toContain("TXT, Markdown, HTML, DOCX, PDF, MOBI/AZW3, CBZ/CBR ke EPUB 3 yang lolos Send to Kindle.");
    expect(t("tagline", "id").endsWith(" File EPUB dibuka untuk dibaca.")).toBe(true);
    expect(t("tagline", "en")).toContain("TXT, Markdown, HTML, DOCX, PDF, MOBI/AZW3, CBZ/CBR to EPUB 3 that passes Send to Kindle.");
    expect(t("tagline", "en").endsWith(" EPUB files open for reading.")).toBe(true);
  });

  test("stays plain text, because build.ts writes it into the HTML", () => {
    for (const lang of ["id", "en"] as const) expect(t("tagline", lang)).not.toMatch(/[<>&]/);
  });
});

describe("failureText for an EPUB that cannot be opened", () => {
  test("maps the epub-drm message to its own text", () => {
    expect(failureText("DRM", "epub-drm", "id")).toBe("EPUB ini dilindungi DRM, jadi tidak bisa dibuka.");
    expect(failureText("DRM", "epub-drm", "en")).toBe("This EPUB is DRM-protected, so it cannot be opened.");
  });

  test("an unknown message still gives the plain DRM text", () => {
    expect(failureText("DRM", "unknown-x", "en")).toBe("This file is DRM-protected, so it cannot be converted.");
    expect(failureText("DRM", "unknown-x", "id")).toBe("File ini dilindungi DRM, jadi tidak bisa dikonversi.");
  });
});
