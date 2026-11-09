const XHTML = "application/xhtml+xml";
const HTML = "text/html";
const NS = "http://www.w3.org/1999/xhtml";
const POLICY = "script-src 'none'; object-src 'none'";
const META_XHTML = `<meta xmlns="${NS}" http-equiv="Content-Security-Policy" content="${POLICY}"/>`;
const META_HTML = `<meta http-equiv="Content-Security-Policy" content="${POLICY}">`;

/** True for the two types foliate gives a page of the book; the other types are not documents that run scripts through a head. */
export function isBookMarkup(type: unknown): boolean {
  return type === XHTML || type === HTML;
}

// Sticky, so a run of white space is measured from a given index without looking at what follows it.
const SPACE = /[ \t\n\r\f]*/y;

function skipSpace(text: string, from: number): number {
  // Most tags follow each other directly, and a regex call costs more than the rest of the step.
  const c = text.charCodeAt(from);
  if (c !== 32 && c !== 9 && c !== 10 && c !== 13 && c !== 12) return from;
  SPACE.lastIndex = from;
  SPACE.exec(text);
  return SPACE.lastIndex;
}

/** The index of the `>` that ends the start tag whose name ended at `from`, skipping quoted values; -1 when there is none. */
function tagEnd(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 62) return i;
    if (c === 34 || c === 39) {
      i = text.indexOf(text[i], i + 1);
      if (i < 0) return -1;
    }
  }
  return -1;
}

/** The index of the `>` that ends a doctype whose keyword ended at `from`; quoted text and an internal subset in [ ] may hold a `>`. */
function doctypeEnd(text: string, from: number): number {
  let subset = false;
  for (let i = from; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 34 || c === 39) {
      i = text.indexOf(text[i], i + 1);
      if (i < 0) return -1;
    } else if (subset && text.startsWith("<!--", i)) {
      i = text.indexOf("-->", i + 4);
      if (i < 0) return -1;
      i += 2;
    } else if (c === 91) subset = true;
    else if (c === 93) subset = false;
    else if (c === 62 && !subset) return i;
  }
  return -1;
}

/** The index just past the comment or doctype that starts at `lt` (`<!`); -1 for any other `<!` or when it never ends. */
function declarationEnd(text: string, lt: number): number {
  if (text.startsWith("<!--", lt)) {
    // From lt + 2, so the empty comment <!--> that HTML allows ends where it should.
    const end = text.indexOf("-->", lt + 2);
    return end < 0 ? -1 : end + 3;
  }
  if (text.slice(lt + 2, lt + 9).toLowerCase() !== "doctype") return -1;
  const end = doctypeEnd(text, lt + 9);
  return end < 0 ? -1 : end + 1;
}

/** True when the tag name, less its namespace prefix in XHTML, is `want` in any letter case. */
function isNamed(name: string, want: string, xhtml: boolean): boolean {
  const local = xhtml ? name.slice(name.lastIndexOf(":") + 1) : name;
  return local.length === want.length && local.toLowerCase() === want;
}

/**
 * Puts a Content Security Policy that forbids scripts at the top of the head of one page of a book, so it
 * comes before any script the page holds (a policy in a meta tag covers only what follows it). The page has
 * a head, or gets one right after its html tag; text with neither comes back as the same string.
 *
 * The scan walks the prolog (declarations, comments, doctype) and the html tag, and stops at the first
 * thing that is neither, so it reads each character at most once and never backtracks: a book is
 * untrusted, and a page of it can be tens of megabytes. Nothing else in the text is changed.
 */
export function blockBookScripts(text: string, type: string): string {
  if (!isBookMarkup(type)) return text;
  const xhtml = type === XHTML;
  const meta = xhtml ? META_XHTML : META_HTML;
  let at = 0;
  let htmlEnd = -1; // just past the opening html tag, once it is seen
  for (;;) {
    const lt = skipSpace(text, at);
    // Anything but white space before the next tag is page content, and a head cannot follow it.
    if (text.charCodeAt(lt) !== 60) break;
    const next = text.charCodeAt(lt + 1);
    if (next === 33) {
      const end = declarationEnd(text, lt);
      if (end < 0) break;
      at = end;
      continue;
    }
    if (next === 63) {
      // In HTML a processing instruction is a comment that ends at the first >.
      const close = xhtml ? "?>" : ">";
      const end = text.indexOf(close, lt + 2);
      if (end < 0) break;
      at = end + close.length;
      continue;
    }
    // Not a letter: a closing tag, a stray <, or a CDATA section, so page content.
    if (!((next >= 65 && next <= 90) || (next >= 97 && next <= 122))) break;
    let nameStop = lt + 2;
    for (;;) {
      const c = text.charCodeAt(nameStop);
      if (!(c > 32 && c !== 47 && c !== 62)) break;
      nameStop++;
    }
    const name = text.slice(lt + 1, nameStop);
    const head = isNamed(name, "head", xhtml);
    if (!head && (htmlEnd >= 0 || !isNamed(name, "html", xhtml))) break;
    const gt = tagEnd(text, nameStop);
    if (gt < 0) break;
    const selfClosing = text.charCodeAt(gt - 1) === 47;
    if (head) {
      return selfClosing
        ? `${text.slice(0, gt - 1)}>${meta}</${name}>${text.slice(gt + 1)}`
        : text.slice(0, gt + 1) + meta + text.slice(gt + 1);
    }
    if (selfClosing) return text; // an empty root holds no script
    htmlEnd = at = gt + 1;
  }
  if (htmlEnd < 0) return text;
  // The head the page lacks, or the one that only comes after content. A prefixed root has no default namespace, so the head names it.
  const added = xhtml ? `<head xmlns="${NS}">${meta}</head>` : `<head>${meta}</head>`;
  return text.slice(0, htmlEnd) + added + text.slice(htmlEnd);
}
