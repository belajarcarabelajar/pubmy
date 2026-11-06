/** Escapes text content for XHTML: ampersand, lt and gt. */
export const escText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Escapes a double-quoted attribute value; every ampersand is escaped, entity or not. */
export const escAttr = (s: string) => escText(s).replace(/"/g, "&quot;");

/** Decodes the five predefined XML entities and numeric references in one pass; other named entities stay. */
export const decode = (t: string) =>
  t.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, e: string) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      // Untrusted input: a code point past U+10FFFF or a lone surrogate must not fail the whole book.
      return cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? "\uFFFD" : String.fromCodePoint(cp);
    }
    return { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" }[e.toLowerCase()]!;
  });
