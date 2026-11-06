import { describe, expect, test } from "bun:test";
import { failureText, KEYS, pickLang, t, type Key } from "../src/i18n.ts";

// Independent copy of the core FailureCode union and the message keys the page must explain.
const FAILURE_CODES = ["DRM", "UNSUPPORTED", "TOO_LARGE", "READ_FAILED", "INVALID_EPUB"];
const MESSAGE_KEYS = [
  "already-epub",
  "encrypted-office",
  "encrypted-pdf",
  "scanned-pdf",
  "ocr-unavailable",
  "no-images",
  "archive-too-large",
  "browser-unsupported",
  "empty-file",
  "unsupported-format",
  "read-failed",
  "invalid-epub",
];
const UI_KEYS = ["title", "drop-hint", "choose-files", "queue-label", "lang-toggle", "waiting", "converting", "ready", "failed", "deleted", "download", "remove", "LIMIT_10", "privacy"];
const PREVIEW_KEYS = ["preview", "preview-close", "preview-prev", "preview-next", "preview-toc", "preview-failed"];

describe("i18n", () => {
  test("every required key is known", () => {
    for (const k of [...FAILURE_CODES, ...MESSAGE_KEYS, ...UI_KEYS]) expect(KEYS).toContain(k as Key);
  });

  test("every preview key is known", () => {
    for (const k of PREVIEW_KEYS) expect(KEYS).toContain(k as Key);
  });

  test("the preview button reads Pratinjau and Preview", () => {
    expect(t("preview" as Key, "id")).toBe("Pratinjau");
    expect(t("preview" as Key, "en")).toBe("Preview");
  });

  test("every key has a non-empty string in both languages", () => {
    const missing: string[] = [];
    for (const k of KEYS) for (const lang of ["id", "en"] as const) if (!t(k, lang)?.trim()) missing.push(`${lang}:${k}`);
    expect(missing).toEqual([]);
  });

  test("the deleted state reads Dihapus and Deleted", () => {
    expect(t("deleted", "id")).toBe("Dihapus");
    expect(t("deleted", "en")).toBe("Deleted");
  });

  test("ID and EN strings differ for the failure codes", () => {
    for (const k of FAILURE_CODES) expect(t(k as Key, "id")).not.toBe(t(k as Key, "en"));
  });
});

describe("failureText", () => {
  test("prefers the specific message when it is known", () => {
    expect(failureText("UNSUPPORTED", "already-epub", "en")).toBe(t("already-epub", "en"));
  });

  test("falls back to the code when the message is unknown", () => {
    expect(failureText("READ_FAILED", "something odd", "id")).toBe(t("READ_FAILED", "id"));
  });
});

describe("pickLang", () => {
  test("a stored choice wins over the browser language", () => {
    expect(pickLang("en", "id-ID")).toBe("en");
  });

  test("an Indonesian browser gets id", () => {
    expect(pickLang(null, "id-ID")).toBe("id");
  });

  test("any other browser language gets en, and junk in storage is ignored", () => {
    expect(pickLang("fr", "de-DE")).toBe("en");
  });
});
