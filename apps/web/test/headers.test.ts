import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HEADERS_FILE = join(import.meta.dir, "..", "public", "_headers");
const LIVE_URL = "https://pubmy.belajarcarabelajar.com";
const BEACON = "https://cloudflareinsights.com";
const EXPECTED_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; img-src 'self' blob: data:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'";

// Cloudflare _headers format: an unindented URL pattern, then indented "Name: value" lines.
function parseHeadersFile(text: string): Map<string, Map<string, string>> {
  const rules = new Map<string, Map<string, string>>();
  let current: Map<string, string> | undefined;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === "" || raw.trim().startsWith("#")) continue;
    if (!/^\s/.test(raw)) {
      current = new Map();
      rules.set(raw.trim(), current);
      continue;
    }
    const colon = raw.indexOf(":");
    if (!current || colon < 0) throw new Error(`bad _headers line: ${raw}`);
    current.set(raw.slice(0, colon).trim().toLowerCase(), raw.slice(colon + 1).trim());
  }
  return rules;
}

function directive(csp: string, name: string): string[] {
  const found = csp
    .split(";")
    .map((part) => part.trim().split(/\s+/))
    .find(([key]) => key === name);
  if (!found) throw new Error(`CSP has no ${name}`);
  return found.slice(1);
}

function siteHeaders(): Map<string, string> {
  const rule = parseHeadersFile(readFileSync(HEADERS_FILE, "utf8")).get("/*");
  if (!rule) throw new Error("_headers has no /* rule");
  return rule;
}

describe("_headers", () => {
  test("connect-src allows only the site and the analytics beacon", () => {
    const csp = siteHeaders().get("content-security-policy") ?? "";
    expect(directive(csp, "connect-src").sort()).toEqual(["'self'", BEACON].sort());
  });

  test("CSP matches the approved policy", () => {
    expect(siteHeaders().get("content-security-policy")).toBe(EXPECTED_CSP);
  });

  test("sets nosniff", () => {
    expect(siteHeaders().get("x-content-type-options")).toBe("nosniff");
  });

  test("sets no-referrer", () => {
    expect(siteHeaders().get("referrer-policy")).toBe("no-referrer");
  });
});

describe("live", () => {
  test.skipIf(process.env.PUBMY_LIVE !== "1")("live site connect-src allows only the site and the analytics beacon", async () => {
    const res = await fetch(LIVE_URL);
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(directive(csp, "connect-src").sort()).toEqual(["'self'", BEACON].sort());
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    // The zone rule security-headers-baseline sets Referrer-Policy for every host on
    // belajarcarabelajar.com (owner decision 2026-11-07: keep it); the site makes no
    // cross-origin requests except the analytics beacon, so this stays private enough.
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });
});
