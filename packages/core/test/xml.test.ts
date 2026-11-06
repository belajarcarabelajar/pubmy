import { describe, expect, test } from "bun:test";
import { decode, escAttr, escText } from "../src/xml.ts";

describe("escText", () => {
  test("escapes ampersand, lt and gt but leaves quotes", () => {
    expect(escText(`"x" & <y> 'z'`)).toBe(`"x" &amp; &lt;y&gt; 'z'`);
  });
});

describe("escAttr", () => {
  test("escapes double quotes, ampersand, lt and gt, leaves single quotes", () => {
    expect(escAttr(`a "b" & <c> 'd'`)).toBe(`a &quot;b&quot; &amp; &lt;c&gt; 'd'`);
  });

  test("escapes an ampersand even when it already starts an entity", () => {
    expect(escAttr("&amp;")).toBe("&amp;amp;");
  });
});

describe("decode", () => {
  test("decodes the five predefined XML entities", () => {
    expect(decode("&lt;p&gt; &amp; &quot;q&quot; &apos;s&apos;")).toBe(`<p> & "q" 's'`);
  });

  test("decodes decimal and hexadecimal numeric entities", () => {
    expect(decode("&#65;&#x42;&#X43;&#39;&#x1F600;")).toBe("ABC'\u{1F600}");
  });

  test("decodes in one pass, so an escaped entity stays literal", () => {
    expect(decode("&amp;lt;")).toBe("&lt;");
  });

  test("leaves unknown named entities alone", () => {
    expect(decode("&nbsp; &bogus;")).toBe("&nbsp; &bogus;");
  });

  test("an out-of-range or surrogate numeric reference becomes U+FFFD instead of throwing", () => {
    expect(decode("a&#99999999;b")).toBe("a\uFFFDb");
    expect(decode("a&#x110000;b")).toBe("a\uFFFDb");
    expect(decode("a&#xD800;b")).toBe("a\uFFFDb");
  });
});
