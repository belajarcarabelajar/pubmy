import { describe, expect, test } from "bun:test";
import { convert, domFor, PubmyError, registerAdapter } from "../src/index.ts";
import type { Ctx, InputFile } from "../src/index.ts";

const ctx: Ctx = {
  dom: domFor("bun"),
  loadOcr: () => Promise.reject(new Error("no ocr in this test")),
  progress: () => {},
  signal: new AbortController().signal,
};

const file = (name: string, text: string): InputFile => ({ name, bytes: new TextEncoder().encode(text) });

describe("adapter failures keep their code", () => {
  test("an adapter throwing PubmyError DRM yields code DRM with its message key", async () => {
    registerAdapter({
      id: "test-drm",
      accepts: (s) => s.ext === "drmtest",
      read: () => {
        throw new PubmyError("DRM", "drm-protected");
      },
    });
    const r = await convert(file("book.drmtest", "x"), ctx);
    expect(r).toEqual({ ok: false, code: "DRM", message: "drm-protected" });
  });

  test("an ordinary exception still yields READ_FAILED", async () => {
    registerAdapter({
      id: "test-boom",
      accepts: (s) => s.ext === "boomtest",
      read: () => {
        throw new Error("boom");
      },
    });
    const r = await convert(file("book.boomtest", "x"), ctx);
    expect(r).toEqual({ ok: false, code: "READ_FAILED", message: "read-failed" });
  });
});

describe("validation failures", () => {
  test("a validator that throws yields INVALID_EPUB instead of a rejected promise", async () => {
    const throwing = () => Promise.reject(new Error("epubcheck crashed"));
    const r = await convert(file("note.txt", "plain words"), ctx, { validate: throwing });
    expect(r).toEqual({ ok: false, code: "INVALID_EPUB", message: "invalid-epub" });
  });
});

describe("adapter order", () => {
  test("a registered adapter wins over the text adapter for the same input", async () => {
    const unregister = registerAdapter({
      id: "test-txt-override",
      accepts: (s) => s.format === "txt",
      read: () => {
        throw new PubmyError("UNSUPPORTED", "override-was-used");
      },
    });
    try {
      const r = await convert(file("note.txt", "plain words"), ctx);
      expect(r).toEqual({ ok: false, code: "UNSUPPORTED", message: "override-was-used" });
    } finally {
      unregister();
    }
    const after = await convert(file("note.txt", "plain words"), ctx);
    expect(after.ok).toBe(true);
  });

  test("unregistering a replacement puts the built-in adapter it replaced back", async () => {
    const unregister = registerAdapter({
      id: "text",
      accepts: (s) => s.format === "txt",
      read: () => {
        throw new PubmyError("UNSUPPORTED", "replacement-was-used");
      },
    });
    try {
      const r = await convert(file("note.txt", "plain words"), ctx);
      expect(r).toEqual({ ok: false, code: "UNSUPPORTED", message: "replacement-was-used" });
    } finally {
      unregister();
    }
    // No validator: this asks only whether a text adapter is still registered after the replacement left.
    const after = await convert(file("note.txt", "plain words"), ctx, { validate: async () => ({ errors: 0, warnings: 0, messages: [] }) });
    expect(after.ok).toBe(true);
  });
});
