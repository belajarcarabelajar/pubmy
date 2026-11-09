const HTML = "text/html";
// foliate hands over the media type of the OPF item as written, and its own parsing accepts all three XML types.
const XML_TYPES = new Set(["application/xhtml+xml", "application/xml", "text/xml"]);
const NS = "http://www.w3.org/1999/xhtml";
const POLICY = "script-src 'none'; object-src 'none'";
const META_XHTML = `<meta xmlns="${NS}" http-equiv="Content-Security-Policy" content="${POLICY}"/>`;
const META_HTML = `<meta http-equiv="Content-Security-Policy" content="${POLICY}">`;

// What a page becomes when the policy cannot be placed and checked: a blank page that carries the policy and nothing of the book.
const INERT_HTML = `<!DOCTYPE html><html><head>${META_HTML}</head><body></body></html>`;
const INERT_XML = `<html xmlns="${NS}"><head>${META_XHTML}</head><body/></html>`;

/**
 * Pages longer than this many characters are not checked but replaced by the inert page: checking parses the
 * whole page once more, and no real chapter is this long. A judgment call, not measured in a browser.
 */
const MAX_PAGE_CHARS = 8 * 1024 * 1024;

type Parse = (text: string, type: string) => Document;

/** Only in a browser; tests give their own. */
const browserParse: Parse = (text, type) => new DOMParser().parseFromString(text, type as DOMParserSupportedType);

/** The media type without its parameters, in lower case, the way a browser reads it; "" for anything that is not a string. */
function mimeOf(type: unknown): string {
  return typeof type === "string" ? type.split(";", 1)[0].trim().toLowerCase() : "";
}

/** True for the types of a page that the browser parses as a document with a head: HTML and the three XML types foliate may meet. */
export function isBookMarkup(type: unknown): boolean {
  const mime = mimeOf(type);
  return mime === HTML || XML_TYPES.has(mime);
}

/**
 * The type of a page for the blob that carries it: a markup type without its parameters, spaces and capitals,
 * any other type exactly as it was written. A charset in the type of a blob overrides everything the page says
 * about itself, so a book could make a browser read the checked page, which is text, in an encoding of its choice.
 */
export function plainMarkupType(type: string): string {
  return isBookMarkup(type) ? mimeOf(type) : type;
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
 * The page with a Content Security Policy that forbids scripts at the top of its head, so it comes before any
 * script the page holds (a policy in a meta tag covers only what follows it). The page has a head, or gets one
 * right after its html tag; null when the scan finds neither.
 *
 * The scan walks the prolog (declarations, comments, doctype) and the html tag, and stops at the first
 * thing that is neither, so it reads each character at most once and never backtracks: a book is
 * untrusted. It is a guess at where a browser's parser puts the head, and never agrees with every parser
 * (an HTML comment may end in --!>, a quote may sit in a tag name), so blockBookScripts checks its result.
 */
function place(text: string, xhtml: boolean): string | null {
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
    if (selfClosing) return null; // an empty root in XML; in HTML the slash means nothing, so the tag is not what it seems
    htmlEnd = at = gt + 1;
  }
  if (htmlEnd < 0) return null;
  // The head the page lacks, or the one that only comes after content. A prefixed root has no default namespace, so the head names it.
  const added = xhtml ? `<head xmlns="${NS}">${meta}</head>` : `<head>${meta}</head>`;
  return text.slice(0, htmlEnd) + added + text.slice(htmlEnd);
}

/**
 * True when nothing that runs can come before the policy: the root is html, its first element is a head, and the
 * first element of that head is the policy meta. Prolog nodes and a doctype cannot run. An XML page must also be
 * well formed, have every one of the three elements in the XHTML namespace (or a browser would not take the meta
 * for a policy), and carry no instruction that asks for an XSLT stylesheet: the browser would build a new document
 * from the book's own stylesheet, one that has none of this page's meta. A CSS stylesheet instruction is fine.
 */
function isProtected(doc: Document, xml: boolean): boolean {
  const root = doc.documentElement;
  if (!root || root.localName !== "html") return false;
  if (xml && (root.namespaceURI !== NS || doc.getElementsByTagName("parsererror").length > 0)) return false;
  // Every node of the document, not only those before the root: a browser takes the instruction wherever it stands.
  if (xml) {
    for (const node of doc.childNodes) {
      if (node.nodeType !== 7) continue;
      const pi = node as ProcessingInstruction;
      if (pi.target.toLowerCase() === "xml-stylesheet" && /xsl/i.test(pi.data)) return false;
    }
  }
  const head = root.firstElementChild;
  if (head?.localName !== "head") return false;
  const meta = head.firstElementChild;
  if (meta?.localName !== "meta") return false;
  if (xml && (head.namespaceURI !== NS || meta.namespaceURI !== NS)) return false;
  return meta.getAttribute("http-equiv")?.toLowerCase() === "content-security-policy" && meta.getAttribute("content") === POLICY;
}

/**
 * One page of a book with a Content Security Policy that forbids scripts at the top of its head, or, when that
 * cannot be shown, an inert blank page that carries the policy. A book is untrusted and its frame allows scripts.
 *
 * The scan (place) proposes the page; `parse` is a real parser (a browser's DOMParser) and decides: the page is
 * returned only when parsing it gives a head that opens with the policy. Anything else (no html, a root that is
 * not html, a page the scan and the parser read differently, a parse that throws, a page over MAX_PAGE_CHARS)
 * gives the inert page, so the book's text is never shown without the policy. Types that are not markup come
 * back as the same string. Each page is parsed at most once, and never when nothing was placed.
 */
export function blockBookScripts(text: string, type: string, parse: Parse = browserParse): string {
  const mime = mimeOf(type);
  const xml = XML_TYPES.has(mime);
  if (!xml && mime !== HTML) return text;
  const inert = xml ? INERT_XML : INERT_HTML;
  if (text.length > MAX_PAGE_CHARS) return inert;
  const candidate = place(text, xml);
  if (candidate === null) return inert;
  try {
    return isProtected(parse(candidate, mime), xml) ? candidate : inert;
  } catch {
    return inert;
  }
}
