import { describe, expect, test } from "bun:test";
import { browserLibarchiveLoader } from "../src/libarchive-loader.ts";

describe("browserLibarchiveLoader", () => {
  test("imports the libarchive.js copy served beside the worker", async () => {
    const asked: string[] = [];
    const mod = { Archive: { open: async () => Promise.reject(new Error("unused")) } };
    const load = browserLibarchiveLoader("https://pubmy.test/app/worker.js", async (url) => (asked.push(url), mod));
    expect(await load()).toBe(mod);
    expect(asked).toEqual(["https://pubmy.test/app/libarchive/libarchive.js"]);
  });
});
