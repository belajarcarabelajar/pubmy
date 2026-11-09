import { describe, expect, test } from "bun:test";
import { DOMParser } from "linkedom";
import { blockBookScripts, isBookMarkup, plainMarkupType } from "../src/book-csp.ts";

const XHTML = "application/xhtml+xml";
const HTML = "text/html";
const NS = "http://www.w3.org/1999/xhtml";
const POLICY = "script-src 'none'; object-src 'none'";

// Written out here, not imported, so a change to the policy in the module has to change the test too.
const META_XHTML = `<meta xmlns="${NS}" http-equiv="Content-Security-Policy" content="${POLICY}"/>`;
const META_HTML = `<meta http-equiv="Content-Security-Policy" content="${POLICY}">`;
const INERT_HTML = `<!DOCTYPE html><html><head>${META_HTML}</head><body></body></html>`;
const INERT_XML = `<html xmlns="${NS}"><head>${META_XHTML}</head><body/></html>`;

/** linkedom stands in for the browser's DOMParser; it reads XML well enough, HTML only for simple pages. */
type Parse = (text: string, type: string) => Document;
// linkedom types the second argument as three literals; it accepts the others (application/xml, application/xhtml+xml) at run time.
const parse: Parse = (text, type) => new DOMParser().parseFromString(text, type as "text/html") as unknown as Document;
const block = (text: string, type: string) => blockBookScripts(text, type, parse);

/** A parse that records what it was asked to read and answers with `answer`, a page of the shape a browser would build. */
function spy(answer: (text: string, type: string) => Document = parse) {
  const calls: { length: number; type: string; text: string }[] = [];
  const fn: Parse = (text, type) => {
    calls.push({ length: text.length, type, text });
    return answer(text, type);
  };
  return { calls, fn };
}

/** What a browser builds from a page whose head opens with `first` and carries the policy after it. */
const browserView = (first: string) =>
  parse(`<html><head>${first}<meta http-equiv="Content-Security-Policy" content="${POLICY}"></head><body></body></html>`, HTML);

/** True when the page parses to a head that opens with the policy: the check of the module, written again from the brief. */
function protectedShape(text: string, type: string): boolean {
  const root = parse(text, type).documentElement;
  const head = root?.firstElementChild;
  const meta = head?.firstElementChild;
  return (
    root?.localName === "html" &&
    head?.localName === "head" &&
    meta?.localName === "meta" &&
    meta.getAttribute("http-equiv")?.toLowerCase() === "content-security-policy" &&
    meta.getAttribute("content") === POLICY
  );
}

/** The output is the page with the policy first, or the inert page, and an inert page holds nothing of the book's markup. */
function expectSafe(out: string, type: string) {
  const xml = type !== HTML;
  if (out === (xml ? INERT_XML : INERT_HTML)) {
    expect(out).not.toContain("<script");
    return;
  }
  expect(protectedShape(out, type)).toBe(true);
}

describe("isBookMarkup", () => {
  test("is true for HTML and the three XML types, whatever the letter case, spaces or parameters", () => {
    for (const type of [
      HTML,
      XHTML,
      "application/xml",
      "text/xml",
      "text/html;charset=utf-8",
      "TEXT/HTML",
      "Application/XHTML+XML",
      " text/html ; charset=UTF-8",
      "text/xml;charset=x",
    ]) {
      expect(isBookMarkup(type)).toBe(true);
    }
  });

  test("is false for everything else, SVG included", () => {
    for (const other of ["text/css", "image/svg+xml", "text/javascript", "image/png", "", "text/htmlx", "xtext/html", "text/", undefined, null, 5]) {
      expect(isBookMarkup(other)).toBe(false);
    }
  });
});

describe("plainMarkupType", () => {
  test("a markup type loses its parameters (a charset above all), its spaces and its capitals", () => {
    for (const [type, plain] of [
      ["text/html;charset=utf-16le", HTML],
      ["TEXT/HTML", HTML],
      [" Application/XHTML+XML ; charset=x", XHTML],
      ["application/xml; charset=utf-8", "application/xml"],
      ["TEXT/XML;charset=iso-8859-1", "text/xml"],
      [HTML, HTML],
      [XHTML, XHTML],
    ]) {
      expect(plainMarkupType(type)).toBe(plain);
    }
  });

  test("any other type comes back exactly as it was written", () => {
    for (const other of ["image/svg+xml;charset=utf-8", "TEXT/CSS", "text/css; charset=x", "", "text/plain; charset=utf-16", " text/javascript ", "text/htmlx;a=b"]) {
      expect(plainMarkupType(other)).toBe(other);
    }
  });
});

describe("blockBookScripts: the media type as the OPF wrote it", () => {
  test("every spelling of an HTML type gets the policy after the head, and the parser is asked for the plain type", () => {
    for (const type of ["text/html;charset=utf-8", "TEXT/HTML", " Text/Html ; charset=UTF-8", "text/html"]) {
      const { calls, fn } = spy();
      expect(blockBookScripts("<html><head><title>T</title></head><body></body></html>", type, fn)).toBe(
        `<html><head>${META_HTML}<title>T</title></head><body></body></html>`,
      );
      expect(calls.map((c) => c.type)).toEqual([HTML]);
    }
  });

  test("every spelling of an XML type gets the policy after the head, and the parser is asked for the plain type", () => {
    const doc = `<html xmlns="${NS}"><head><title>T</title></head><body/></html>`;
    for (const [type, plain] of [
      ["Application/XHTML+XML", XHTML],
      ["application/xml", "application/xml"],
      ["text/xml", "text/xml"],
      ["application/xml; charset=utf-8", "application/xml"],
      ["TEXT/XML", "text/xml"],
    ]) {
      const { calls, fn } = spy();
      expect(blockBookScripts(doc, type, fn)).toBe(`<html xmlns="${NS}"><head>${META_XHTML}<title>T</title></head><body/></html>`);
      expect(calls.map((c) => c.type)).toEqual([plain]);
    }
  });

  test("any other type comes back as the same string, even with a head in it, and is never parsed", () => {
    const text = `<html><head></head><script>x()</script></html>`;
    for (const type of ["image/svg+xml", "text/css", "text/javascript", "application/octet-stream", "text/plain", ""]) {
      const { calls, fn } = spy();
      expect(blockBookScripts(text, type, fn)).toBe(text);
      expect(calls).toHaveLength(0);
    }
  });
});

describe("blockBookScripts: XHTML", () => {
  test("puts the policy right after the opening head tag, ahead of everything the head holds", () => {
    const doc = `<html xmlns="${NS}" xml:lang="en"><head id="h" profile="p"><title>T</title><script>x()</script></head><body><p>a</p></body></html>`;
    expect(block(doc, XHTML)).toBe(
      `<html xmlns="${NS}" xml:lang="en"><head id="h" profile="p">${META_XHTML}<title>T</title><script>x()</script></head><body><p>a</p></body></html>`,
    );
  });

  test("a > inside a quoted attribute value does not end the head tag early", () => {
    const doc = `<html xmlns="${NS}"><head data-x="a>b" data-y='c>d'><title>T</title></head></html>`;
    expect(block(doc, XHTML)).toBe(`<html xmlns="${NS}"><head data-x="a>b" data-y='c>d'>${META_XHTML}<title>T</title></head></html>`);
  });

  // linkedom keeps the prefix in localName ("h:html"), which a browser does not, so for a prefixed page the stand-in
  // answers the page a browser builds from it: html, head, then the policy, all in the XHTML namespace.
  const prefixedAsBrowser = () => parse(`<html xmlns="${NS}"><head>${META_XHTML}<title>T</title></head><body/></html>`, XHTML);

  test("a prefixed root and head keep working: the policy carries its own namespace", () => {
    const doc = `<h:html xmlns:h="${NS}"><h:head><h:title>T</h:title></h:head><h:body/></h:html>`;
    expect(blockBookScripts(doc, XHTML, prefixedAsBrowser)).toBe(
      `<h:html xmlns:h="${NS}"><h:head>${META_XHTML}<h:title>T</h:title></h:head><h:body/></h:html>`,
    );
  });

  test("a self-closing head is expanded around the policy, keeping its attributes", () => {
    expect(block(`<html xmlns="${NS}"><head/><body/></html>`, XHTML)).toBe(`<html xmlns="${NS}"><head>${META_XHTML}</head><body/></html>`);
    expect(block(`<html xmlns="${NS}"><head id="x" /><body/></html>`, XHTML)).toBe(
      `<html xmlns="${NS}"><head id="x" >${META_XHTML}</head><body/></html>`,
    );
  });

  test("no head: a head holding the policy goes right after the root tag, in the XHTML namespace", () => {
    expect(block(`<html xmlns="${NS}"><body><p>a</p></body></html>`, XHTML)).toBe(
      `<html xmlns="${NS}"><head xmlns="${NS}">${META_XHTML}</head><body><p>a</p></body></html>`,
    );
    expect(blockBookScripts(`<h:html xmlns:h="${NS}"><h:body/></h:html>`, XHTML, prefixedAsBrowser)).toBe(
      `<h:html xmlns:h="${NS}"><head xmlns="${NS}">${META_XHTML}</head><h:body/></h:html>`,
    );
  });

  test("an XML declaration and a doctype before the root are left where they are", () => {
    const doc =
      `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">\n` +
      `<html xmlns="${NS}">\n<head><title>T</title></head><body/></html>`;
    const out = block(doc, XHTML);
    expect(out).toBe(doc.replace("<head>", `<head>${META_XHTML}`));
    expect(out.startsWith('<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE')).toBe(true);
  });

  test("a head written inside a comment, a doctype subset or a processing instruction is not the head", () => {
    const doc =
      `<?pi <head> ?><!DOCTYPE html [ <!ENTITY h "<head>"> <!-- <head> --> ]><!-- <head> -->` +
      `<html xmlns="${NS}"><!-- <head> --><head><title>T</title></head></html>`;
    const out = block(doc, XHTML);
    expect(out).toBe(doc.replace("--><head><title>", `--><head>${META_XHTML}<title>`));
    expect(out.match(/Content-Security-Policy/g)).toHaveLength(1);
  });

  test("a policy the book already carries stays, behind ours", () => {
    const own = `<meta http-equiv="Content-Security-Policy" content="script-src *"/>`;
    const out = block(`<html xmlns="${NS}"><head>${own}<title>T</title></head></html>`, XHTML);
    expect(out).toBe(`<html xmlns="${NS}"><head>${META_XHTML}${own}<title>T</title></head></html>`);
    expect(out.indexOf(META_XHTML)).toBeLessThan(out.indexOf(own));
  });

  test("the result is well formed: the policy is the first element of the one head, inside the root", () => {
    const docs = [
      `<html xmlns="${NS}"><head id="h"><title>T</title></head><body><p>a</p></body></html>`,
      `<html xmlns="${NS}"><head/><body/></html>`,
      `<html xmlns="${NS}"><body><p>a</p></body></html>`,
    ];
    for (const doc of docs) {
      const parsed = parse(block(doc, XHTML), "text/xml");
      const metas = [...parsed.querySelectorAll("meta")];
      expect(metas).toHaveLength(1);
      expect(metas[0].getAttribute("http-equiv")).toBe("Content-Security-Policy");
      expect(metas[0].getAttribute("content")).toBe(POLICY);
      expect(metas[0].getAttribute("xmlns")).toBe(NS);
      const head = metas[0].parentNode as Element;
      expect(head.nodeName).toBe("head");
      expect(head.firstElementChild).toBe(metas[0]);
      // linkedom's node types do not overlap with the DOM ones, so the two are compared as plain objects
      expect((head.parentNode as unknown) === (parsed.documentElement as unknown)).toBe(true);
      expect(parsed.querySelectorAll("head")).toHaveLength(1);
    }
  });
});

describe("blockBookScripts: HTML", () => {
  test("puts the policy right after the opening head tag, whatever the letter case", () => {
    expect(block("<html><head><title>T</title></head><body></body></html>", HTML)).toBe(
      `<html><head>${META_HTML}<title>T</title></head><body></body></html>`,
    );
    expect(block("<HTML><HEAD lang=en><TITLE>T</TITLE></HEAD></HTML>", HTML)).toBe(
      `<HTML><HEAD lang=en>${META_HTML}<TITLE>T</TITLE></HEAD></HTML>`,
    );
    expect(block("<html><Head><title>T</title></Head></html>", HTML)).toBe(`<html><Head>${META_HTML}<title>T</title></Head></html>`);
  });

  test("a self-closing head is expanded around the policy", () => {
    expect(block("<html><head/><body></body></html>", HTML)).toBe(`<html><head>${META_HTML}</head><body></body></html>`);
  });

  test("no head: a plain head holding the policy goes right after the html tag", () => {
    expect(block('<html lang="en"><body><p>a</p></body></html>', HTML)).toBe(
      `<html lang="en"><head>${META_HTML}</head><body><p>a</p></body></html>`,
    );
  });

  test("a tag that only starts with head or html is not one", () => {
    expect(block("<html><header>x</header><body></body></html>", HTML)).toBe(
      `<html><head>${META_HTML}</head><header>x</header><body></body></html>`,
    );
  });

  test("text between the html tag and the head would end the head early, so the policy gets a head of its own first", () => {
    expect(block("<html>junk<head><title>T</title></head></html>", HTML)).toBe(
      `<html><head>${META_HTML}</head>junk<head><title>T</title></head></html>`,
    );
  });

  test("whitespace and comments between the html tag and the head do not hide the head", () => {
    expect(block("<!DOCTYPE html>\n<html>\n <!-- c -->\n<head><title>T</title></head></html>", HTML)).toBe(
      `<!DOCTYPE html>\n<html>\n <!-- c -->\n<head>${META_HTML}<title>T</title></head></html>`,
    );
  });

  test("an unfinished comment after the html tag still gets the head in front of it", () => {
    expect(block("<html><!-- never closed <head>", HTML)).toBe(`<html><head>${META_HTML}</head><!-- never closed <head>`);
  });

  test("the only difference from the input is the policy, and the head tag it follows", () => {
    const doc = `<html xmlns="${NS}"><head id="h"><title>T</title></head><body><p>a &amp; b</p><!-- <head> --></body></html>`;
    expect(block(doc, XHTML).replace(META_XHTML, "")).toBe(doc);
    const page = "<html><head><title>T</title></head><body><p>a</p></body></html>";
    expect(block(page, HTML).replace(META_HTML, "")).toBe(page);
  });
});

describe("blockBookScripts: a page the policy cannot be placed in is replaced by the inert page", () => {
  test("text with no html and no head, and an unfinished prolog, give the inert page of its kind, with no parse", () => {
    for (const text of ["", "plain text", "<p>hello</p>", "<header>x</header><script>x()</script>", "<headline>y</headline>", "<head", '<head id="a>', "<!-- never closed <head>", "<!DOCTYPE html [ <head>"]) {
      for (const [type, inert] of [[XHTML, INERT_XML], [HTML, INERT_HTML]] as const) {
        const { calls, fn } = spy();
        expect(blockBookScripts(text, type, fn)).toBe(inert);
        expect(calls).toHaveLength(0);
      }
    }
  });

  test("an XHTML page whose root is not html: a div, an svg, a root in another namespace", () => {
    const pages = [
      `<div xmlns="${NS}"><script>x()</script></div>`,
      `<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>`,
      `<?xml version="1.0"?><!-- c --><body xmlns="${NS}"><script>x()</script></body>`,
      `<htmlx xmlns="${NS}"><head></head><script>x()</script></htmlx>`,
    ];
    for (const type of [XHTML, "application/xml", "text/xml", "Application/XHTML+XML"]) {
      for (const page of pages) {
        const out = block(page, type);
        expect(out).toBe(INERT_XML);
        expect(out).not.toContain("<script");
        expectSafe(out, type);
      }
    }
  });

  test("an empty root has nothing to protect and gives the inert page", () => {
    expect(block(`<html xmlns="${NS}"/>`, XHTML)).toBe(INERT_XML);
  });

  test("the inert pages carry the policy first, so they are what the check accepts", () => {
    expect(protectedShape(INERT_XML, XHTML)).toBe(true);
    expect(protectedShape(INERT_HTML, HTML)).toBe(true);
  });
});

// linkedom is not a faithful HTML parser, so the pages below are given to a stand-in that answers what a browser's
// parser builds from them (a script first in the head). That the real parser agrees is shown by the browser run
// of the parent on a copy of the page without the page's own CSP, not here.
describe("blockBookScripts: a scan and a parser that read the same page differently", () => {
  const scriptFirst = () => browserView("<script>x()</script>");
  const readers: [string, string][] = [
    ["a comment closed by --!> (HTML ends it there, the scan reads on to -->)", "<!-- x --!><script>x()</script><!-- --><html><head></head></html>"],
    ['a quote in a tag name (<html x">: HTML ends the tag at the first >)', '<html x"><head></head><script>x()</script></html><!-- " -->'],
    ["a doctype that HTML ends at the first > (the scan waits for the end of the [ ] subset)", "<!DOCTYPE html [ > <script>x()</script> ]><head>"],
  ];

  test("each page gets a candidate with the policy behind the script, and the check turns it into the inert page", () => {
    for (const [name, page] of readers) {
      const { calls, fn } = spy(scriptFirst);
      const out = blockBookScripts(page, HTML, fn);
      expect(calls, name).toHaveLength(1);
      // the scan alone would have put the policy behind the script, which is what the check is for
      const candidate = calls[0].text;
      expect(candidate.indexOf("Content-Security-Policy"), name).toBeGreaterThan(candidate.indexOf("<script"));
      expect(out, name).toBe(INERT_HTML);
      expect(out, name).not.toContain("<script");
      expectSafe(out, HTML);
    }
  });

  test("an html tag with a slash is not self-closing in HTML: no candidate, the inert page, and no parse", () => {
    const { calls, fn } = spy(scriptFirst);
    expect(blockBookScripts("<html/><script>x()</script>", HTML, fn)).toBe(INERT_HTML);
    expect(calls).toHaveLength(0);
  });

  test("the page comes back only when the parser shows the policy first: a script first, no head, a wrong or missing policy", () => {
    const page = "<html><head><title>T</title></head></html>";
    const meta = (attrs: string) => parse(`<html><head><meta ${attrs}><script>x()</script></head></html>`, HTML);
    const answers: [string, Document][] = [
      ["a script before the policy", scriptFirst()],
      ["a head that opens with something else", browserView("<title>T</title>")],
      ["a different policy", meta(`http-equiv="Content-Security-Policy" content="script-src *"`)],
      ["a policy with more in it", meta(`http-equiv="Content-Security-Policy" content="${POLICY}; img-src *"`)],
      ["another http-equiv", meta(`http-equiv="refresh" content="${POLICY}"`)],
      ["no content", meta(`http-equiv="Content-Security-Policy"`)],
      ["no head at all", parse("<html></html>", HTML)],
    ];
    for (const [name, doc] of answers) expect(blockBookScripts(page, HTML, () => doc), name).toBe(INERT_HTML);
    // the same page with a parser that shows the policy first, and the http-equiv in capitals, is accepted
    const capitals = meta(`http-equiv="CONTENT-SECURITY-POLICY" content="${POLICY}"`);
    expect(blockBookScripts(page, HTML, () => capitals)).toBe(`<html><head>${META_HTML}<title>T</title></head></html>`);
  });

  test("an XML page that parses with an error is not accepted", () => {
    const page = `<html xmlns="${NS}"><head><title>T</title></head><body/></html>`;
    const withError = parse(`<html xmlns="${NS}"><head>${META_XHTML}</head><body><parsererror/></body></html>`, XHTML);
    expect(blockBookScripts(page, XHTML, () => withError)).toBe(INERT_XML);
  });

  // linkedom does not read xmlns, so the namespace a browser would report is set on the stand-in's elements.
  test("an XML page is accepted only when the root, the head and the policy are all in the XHTML namespace", () => {
    const page = `<html xmlns="${NS}"><head><title>T</title></head><body/></html>`;
    const accepted = `<html xmlns="${NS}"><head>${META_XHTML}<title>T</title></head><body/></html>`;
    const answer = (which: "root" | "head" | "meta", ns: string) => () => {
      const doc = parse(accepted, XHTML);
      const root = doc.documentElement;
      const el = which === "root" ? root : which === "head" ? root.firstElementChild! : root.firstElementChild!.firstElementChild!;
      Object.defineProperty(el, "namespaceURI", { value: ns });
      return doc;
    };
    expect(blockBookScripts(page, XHTML, answer("root", NS))).toBe(accepted);
    for (const which of ["root", "head", "meta"] as const) {
      expect(blockBookScripts(page, XHTML, answer(which, "urn:other")), which).toBe(INERT_XML);
      expect(blockBookScripts(page, XHTML, answer(which, null as unknown as string)), which).toBe(INERT_XML);
    }
  });

  test("a parse that throws, as a missing DOMParser does, gives the inert page", () => {
    const boom: Parse = () => {
      throw new Error("no parser");
    };
    expect(blockBookScripts("<html><head></head></html>", HTML, boom)).toBe(INERT_HTML);
    expect(blockBookScripts(`<html xmlns="${NS}"><head/></html>`, XHTML, boom)).toBe(INERT_XML);
    // the default parser needs a browser; under Bun there is none, so no page is returned unchecked
    expect(blockBookScripts("<html><head></head><script>x()</script></html>", HTML)).toBe(INERT_HTML);
  });
});

// A stylesheet instruction in an XML page can make the browser transform the page with XSLT, from a stylesheet that
// is the book's own file. The result is a new document without the policy of the old one.
// linkedom does not expose a processing instruction as a node of type 7 with a target and data (measured), so the
// stand-in below adds the instructions of the page text to the childNodes of the document, as a browser's
// DOMParser lists them: before the root when they stand before it, after it when they stand after it.
function withPis(doc: Document, text: string): Document {
  const root = text.indexOf("<html");
  const node = (m: RegExpMatchArray) => ({ nodeType: 7, target: m[1], data: m[2], before: (m.index ?? 0) < root });
  // the XML declaration is not a node of the document
  const pis = [...text.matchAll(/<\?([\w-]+)\s+([^?]*)\?>/g)].filter((m) => m[1] !== "xml").map(node);
  return new Proxy(doc, {
    get(target, prop) {
      if (prop === "childNodes") {
        return [...pis.filter((n) => n.before), ...target.childNodes, ...pis.filter((n) => !n.before)];
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
const blockPi = (text: string, type: string) => blockBookScripts(text, type, (t, ty) => withPis(parse(t, ty), t));

describe("blockBookScripts: a stylesheet instruction in an XML page", () => {
  const withPi = (pi: string) => `<?xml version="1.0"?>${pi}<html xmlns="${NS}"><head><title>T</title></head><body><p>a</p></body></html>`;
  const XSL = [
    `<?xml-stylesheet type="text/xsl" href="s.xsl"?>`,
    `<?xml-stylesheet type="application/xslt+xml" href="s"?>`,
    `<?xml-stylesheet href="style.XSLT" type="text/css"?>`,
    `<?xml-stylesheet type='text/xsl' href='s'?>`,
    `<?XML-Stylesheet type="text/xsl" href="s.xsl"?>`,
  ];

  test("an instruction that names XSLT gives the inert page, for every XML type and spelling", () => {
    for (const type of [XHTML, "application/xml", "text/xml", "Application/XHTML+XML"]) {
      for (const pi of XSL) expect(blockPi(withPi(pi), type), pi).toBe(INERT_XML);
    }
  });

  test("an instruction after the root counts too, since a browser does not ask where it stands", () => {
    const page = `<html xmlns="${NS}"><head><title>T</title></head><body/></html><?xml-stylesheet type="text/xsl" href="s.xsl"?>`;
    expect(blockPi(page, XHTML)).toBe(INERT_XML);
  });

  test("a CSS stylesheet instruction is kept, and the page is returned with the policy", () => {
    for (const pi of [`<?xml-stylesheet type="text/css" href="style.css"?>`, `<?xml-stylesheet href="a.css" type="text/css" media="screen"?>`]) {
      const page = withPi(pi);
      expect(blockPi(page, XHTML), pi).toBe(page.replace("<head>", `<head>${META_XHTML}`));
    }
  });

  test("an instruction of another target that mentions xsl is not a stylesheet", () => {
    const page = withPi(`<?pi xsl?>`);
    expect(blockPi(page, XHTML)).toBe(page.replace("<head>", `<head>${META_XHTML}`));
  });

  test("the stand-in lists the instructions of the page, in order, around the root", () => {
    const doc = withPis(parse(withPi(XSL[0]) + `<?xml-stylesheet type="text/css" href="a.css"?>`, XHTML), withPi(XSL[0]) + `<?xml-stylesheet type="text/css" href="a.css"?>`);
    const nodes = [...doc.childNodes] as unknown as { nodeType: number; target?: string }[];
    expect(nodes.filter((n) => n.nodeType === 7).map((n) => n.target)).toEqual(["xml-stylesheet", "xml-stylesheet"]);
    expect(nodes[0].nodeType).toBe(7);
    expect(nodes.at(-1)?.nodeType).toBe(7);
  });
});

describe("blockBookScripts: time", () => {
  const MB = 1024 * 1024;
  // One pass over 7 MB takes tens of milliseconds, 40 MB 100 to 200 ms on a loaded shared machine. A rescan per
  // character would take minutes, so 1 s still tells the two apart.
  const LINEAR_MS = 1000;
  const CAP = 8 * MB;
  /** The parser is a stand-in that answers at once, so the time measured is the scan and the checks around it. */
  const protectedAnswer = (type: string) =>
    type === HTML
      ? parse(`<html><head>${META_HTML}</head></html>`, HTML)
      : parse(`<html xmlns="${NS}"><head>${META_XHTML}</head></html>`, type);
  const timed = (text: string, type: string) => {
    const { calls, fn } = spy((_text, ty) => protectedAnswer(ty));
    const t0 = performance.now();
    const out = blockBookScripts(text, type, fn);
    return { out, ms: performance.now() - t0, calls };
  };

  test("a page over 8 MB is the inert page at once and is never parsed, whatever it holds", () => {
    const body = "<p>x</p>".repeat((40 * MB) / 8);
    for (const page of [
      `<html xmlns="${NS}"><head><title>T</title></head><body>${body}</body></html>`,
      body,
      `<!--${"x".repeat(40 * MB)}--><html xmlns="${NS}"><head></head></html>`,
    ]) {
      const { out, ms, calls } = timed(page, XHTML);
      expect(out).toBe(INERT_XML);
      expect(calls).toHaveLength(0);
      expect(ms).toBeLessThan(LINEAR_MS);
    }
    const { out, calls } = timed(`<html><head></head><body>${"y".repeat(CAP)}</body></html>`, HTML);
    expect(out).toBe(INERT_HTML);
    expect(calls).toHaveLength(0);
  });

  test("a page of exactly 8 MB is still placed and parsed once, on the changed text, and one character more is not", () => {
    const start = `<html xmlns="${NS}"><head></head><body>`;
    const end = "</body></html>";
    const exact = start + "a".repeat(CAP - start.length - end.length) + end;
    expect(exact.length).toBe(CAP);
    const atCap = timed(exact, XHTML);
    expect(atCap.out).toBe(exact.replace("<head>", `<head>${META_XHTML}`));
    expect(atCap.calls.map((c) => c.length)).toEqual([CAP + META_XHTML.length]);
    expect(timed("a" + exact, XHTML).out).toBe(INERT_XML);
  });

  test("8 MB with no head or html is refused quickly in every shape, and never parsed", () => {
    for (const text of ["<p>x</p>".repeat(CAP / 8), "x".repeat(CAP), "<".repeat(CAP)]) {
      const { out, ms, calls } = timed(text, XHTML);
      expect(out).toBe(INERT_XML);
      expect(calls).toHaveLength(0);
      expect(ms).toBeLessThan(LINEAR_MS);
    }
  });

  test("a large page with the head at the start is placed and parsed once, on the changed text", () => {
    const body = "<p>x</p>".repeat((7 * MB) / 8);
    const page = `<html xmlns="${NS}"><head><title>T</title></head><body>${body}</body></html>`;
    const { out, ms, calls } = timed(page, XHTML);
    expect(ms).toBeLessThan(LINEAR_MS);
    expect(out.slice(0, 200)).toContain(`<head>${META_XHTML}<title>`);
    expect(calls.map((c) => c.length)).toEqual([page.length + META_XHTML.length]);
  });

  test("a large comment before the root is skipped in one step, and the page is parsed once", () => {
    const { out, ms, calls } = timed(`<!--${"x".repeat(7 * MB)}--><html xmlns="${NS}"><head></head></html>`, XHTML);
    expect(ms).toBeLessThan(LINEAR_MS);
    expect(out.endsWith(`<head>${META_XHTML}</head></html>`)).toBe(true);
    expect(calls).toHaveLength(1);
  });

  // Every one of the 7 million characters is read here.
  test("a large run of white space and a head that never comes is read once, and the page is parsed once", () => {
    const { out, ms, calls } = timed(`<html xmlns="${NS}">${" ".repeat(7 * MB)}<body/></html>`, XHTML);
    expect(ms).toBeLessThan(LINEAR_MS);
    expect(out.slice(0, 400)).toContain(`<html xmlns="${NS}"><head xmlns="${NS}">${META_XHTML}</head>`);
    expect(calls).toHaveLength(1);
  });
});
