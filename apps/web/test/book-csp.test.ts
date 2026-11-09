import { describe, expect, test } from "bun:test";
import { DOMParser } from "linkedom";
import { blockBookScripts, isBookMarkup } from "../src/book-csp.ts";

const XHTML = "application/xhtml+xml";
const HTML = "text/html";
const NS = "http://www.w3.org/1999/xhtml";

// Written out here, not imported, so a change to the policy in the module has to change the test too.
const META_XHTML = `<meta xmlns="${NS}" http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'"/>`;
const META_HTML = `<meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'">`;

describe("isBookMarkup", () => {
  test("is true for the two page types foliate hands over, and for nothing else", () => {
    expect(isBookMarkup(XHTML)).toBe(true);
    expect(isBookMarkup(HTML)).toBe(true);
    for (const other of ["text/css", "image/svg+xml", "text/javascript", "image/png", "", undefined, null]) {
      expect(isBookMarkup(other)).toBe(false);
    }
  });
});

describe("blockBookScripts: XHTML", () => {
  test("puts the policy right after the opening head tag, ahead of everything the head holds", () => {
    const doc = `<html xmlns="${NS}" xml:lang="en"><head id="h" profile="p"><title>T</title><script>x()</script></head><body><p>a</p></body></html>`;
    expect(blockBookScripts(doc, XHTML)).toBe(
      `<html xmlns="${NS}" xml:lang="en"><head id="h" profile="p">${META_XHTML}<title>T</title><script>x()</script></head><body><p>a</p></body></html>`,
    );
  });

  test("a > inside a quoted attribute value does not end the head tag early", () => {
    const doc = `<html xmlns="${NS}"><head data-x="a>b" data-y='c>d'><title>T</title></head></html>`;
    expect(blockBookScripts(doc, XHTML)).toBe(
      `<html xmlns="${NS}"><head data-x="a>b" data-y='c>d'>${META_XHTML}<title>T</title></head></html>`,
    );
  });

  test("a prefixed root and head keep working: the policy carries its own namespace", () => {
    const doc = `<h:html xmlns:h="${NS}"><h:head><h:title>T</h:title></h:head><h:body/></h:html>`;
    const out = blockBookScripts(doc, XHTML);
    expect(out).toBe(`<h:html xmlns:h="${NS}"><h:head>${META_XHTML}<h:title>T</h:title></h:head><h:body/></h:html>`);
  });

  test("a self-closing head is expanded around the policy, keeping its attributes", () => {
    expect(blockBookScripts(`<html xmlns="${NS}"><head/><body/></html>`, XHTML)).toBe(
      `<html xmlns="${NS}"><head>${META_XHTML}</head><body/></html>`,
    );
    expect(blockBookScripts(`<html xmlns="${NS}"><head id="x" /><body/></html>`, XHTML)).toBe(
      `<html xmlns="${NS}"><head id="x" >${META_XHTML}</head><body/></html>`,
    );
  });

  test("no head: a head holding the policy goes right after the root tag, in the XHTML namespace", () => {
    expect(blockBookScripts(`<html xmlns="${NS}"><body><p>a</p></body></html>`, XHTML)).toBe(
      `<html xmlns="${NS}"><head xmlns="${NS}">${META_XHTML}</head><body><p>a</p></body></html>`,
    );
    expect(blockBookScripts(`<h:html xmlns:h="${NS}"><h:body/></h:html>`, XHTML)).toBe(
      `<h:html xmlns:h="${NS}"><head xmlns="${NS}">${META_XHTML}</head><h:body/></h:html>`,
    );
  });

  test("an XML declaration and a doctype before the root are left where they are", () => {
    const doc =
      `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">\n` +
      `<html xmlns="${NS}">\n<head><title>T</title></head><body/></html>`;
    const out = blockBookScripts(doc, XHTML);
    expect(out).toBe(doc.replace("<head>", `<head>${META_XHTML}`));
    expect(out.startsWith('<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE')).toBe(true);
  });

  test("a head written inside a comment, a doctype subset or a processing instruction is not the head", () => {
    const doc =
      `<?pi <head> ?><!DOCTYPE html [ <!ENTITY h "<head>"> <!-- <head> --> ]><!-- <head> -->` +
      `<html xmlns="${NS}"><!-- <head> --><head><title>T</title></head></html>`;
    const out = blockBookScripts(doc, XHTML);
    expect(out).toBe(doc.replace("--><head><title>", `--><head>${META_XHTML}<title>`));
    expect(out.match(/Content-Security-Policy/g)).toHaveLength(1);
  });

  test("a policy the book already carries stays, behind ours", () => {
    const own = `<meta http-equiv="Content-Security-Policy" content="script-src *"/>`;
    const out = blockBookScripts(`<html xmlns="${NS}"><head>${own}<title>T</title></head></html>`, XHTML);
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
      const parsed = new DOMParser().parseFromString(blockBookScripts(doc, XHTML), "text/xml");
      const metas = [...parsed.querySelectorAll("meta")];
      expect(metas).toHaveLength(1);
      expect(metas[0].getAttribute("http-equiv")).toBe("Content-Security-Policy");
      expect(metas[0].getAttribute("content")).toBe("script-src 'none'; object-src 'none'");
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
    expect(blockBookScripts("<html><head><title>T</title></head><body></body></html>", HTML)).toBe(
      `<html><head>${META_HTML}<title>T</title></head><body></body></html>`,
    );
    expect(blockBookScripts("<HTML><HEAD lang=en><TITLE>T</TITLE></HEAD></HTML>", HTML)).toBe(
      `<HTML><HEAD lang=en>${META_HTML}<TITLE>T</TITLE></HEAD></HTML>`,
    );
    expect(blockBookScripts("<html><Head><title>T</title></Head></html>", HTML)).toBe(
      `<html><Head>${META_HTML}<title>T</title></Head></html>`,
    );
  });

  test("a self-closing head is expanded around the policy", () => {
    expect(blockBookScripts("<html><head/><body></body></html>", HTML)).toBe(`<html><head>${META_HTML}</head><body></body></html>`);
  });

  test("no head: a plain head holding the policy goes right after the html tag", () => {
    expect(blockBookScripts('<html lang="en"><body><p>a</p></body></html>', HTML)).toBe(
      `<html lang="en"><head>${META_HTML}</head><body><p>a</p></body></html>`,
    );
  });

  test("a tag that only starts with head or html is not one", () => {
    expect(blockBookScripts("<html><header>x</header><body></body></html>", HTML)).toBe(
      `<html><head>${META_HTML}</head><header>x</header><body></body></html>`,
    );
    expect(blockBookScripts("<htmlx><head>a</head></htmlx>", HTML)).toBe("<htmlx><head>a</head></htmlx>");
  });

  test("text between the html tag and the head would end the head early, so the policy gets a head of its own first", () => {
    expect(blockBookScripts("<html>junk<head><title>T</title></head></html>", HTML)).toBe(
      `<html><head>${META_HTML}</head>junk<head><title>T</title></head></html>`,
    );
  });

  test("whitespace and comments between the html tag and the head do not hide the head", () => {
    expect(blockBookScripts("<!DOCTYPE html>\n<html>\n <!-- c -->\n<head><title>T</title></head></html>", HTML)).toBe(
      `<!DOCTYPE html>\n<html>\n <!-- c -->\n<head>${META_HTML}<title>T</title></head></html>`,
    );
  });
});

describe("blockBookScripts: what it leaves alone", () => {
  test("text with no html and no head comes back as the same string", () => {
    for (const text of ["", "plain text", "<p>hello</p>", "<header>x</header>", "<headline>y</headline>", "<svg><head/></svg>"]) {
      expect(blockBookScripts(text, XHTML)).toBe(text);
      expect(blockBookScripts(text, HTML)).toBe(text);
    }
  });

  test("an empty root, and an unfinished tag, comment or doctype before any html tag, are returned as they came", () => {
    for (const text of [`<html xmlns="${NS}"/>`, "<head", '<head id="a>', "<!-- never closed <head>", "<!DOCTYPE html [ <head>"]) {
      expect(blockBookScripts(text, XHTML)).toBe(text);
      expect(blockBookScripts(text, HTML)).toBe(text);
    }
  });

  test("an unfinished comment after the html tag still gets the head in front of it", () => {
    expect(blockBookScripts("<html><!-- never closed <head>", HTML)).toBe(`<html><head>${META_HTML}</head><!-- never closed <head>`);
  });

  test("any other type comes back as the same string, even with a head in it", () => {
    const text = `<html><head></head></html>`;
    for (const type of ["image/svg+xml", "text/css", "text/javascript", "application/octet-stream", ""]) {
      expect(blockBookScripts(text, type)).toBe(text);
    }
  });

  test("the only difference from the input is the policy, and the head tag it follows", () => {
    const doc = `<html xmlns="${NS}"><head id="h"><title>T</title></head><body><p>a &amp; b</p><!-- <head> --></body></html>`;
    expect(blockBookScripts(doc, XHTML).replace(META_XHTML, "")).toBe(doc);
    const page = "<html><head><title>T</title></head><body><p>a</p></body></html>";
    expect(blockBookScripts(page, HTML).replace(META_HTML, "")).toBe(page);
  });
});

describe("blockBookScripts: time", () => {
  const MB = 1024 * 1024;
  // One pass over 40 MB takes 100 to 200 ms on a loaded shared machine (a run measured 180 ms against an earlier bound of
  // 100 ms). A rescan per character would take minutes, so 1 s still tells the two apart.
  const LINEAR_MS = 1000;
  const timed = (text: string, type: string) => {
    const t0 = performance.now();
    const out = blockBookScripts(text, type);
    return { out, ms: performance.now() - t0 };
  };

  test("40 MB of markup with no head or html is refused quickly, whatever its shape", () => {
    for (const text of ["<p>x</p>".repeat((40 * MB) / 8), "x".repeat(40 * MB), "<".repeat(40 * MB)]) {
      const { out, ms } = timed(text, XHTML);
      expect(out).toBe(text);
      expect(ms).toBeLessThan(LINEAR_MS);
    }
  });

  test("40 MB with the head at the start is done quickly, and the policy sits at the start", () => {
    const body = "<p>x</p>".repeat((40 * MB) / 8);
    const { out, ms } = timed(`<html xmlns="${NS}"><head><title>T</title></head><body>${body}</body></html>`, XHTML);
    expect(ms).toBeLessThan(LINEAR_MS);
    expect(out.slice(0, 200)).toContain(`<head>${META_XHTML}<title>`);
  });

  test("40 MB of comment before the root is skipped in one step", () => {
    const { out, ms } = timed(`<!--${"x".repeat(40 * MB)}--><html xmlns="${NS}"><head></head></html>`, XHTML);
    expect(ms).toBeLessThan(LINEAR_MS);
    expect(out.endsWith(`<head>${META_XHTML}</head></html>`)).toBe(true);
  });

  // Every one of the 40 million characters is read here (about 100 ms measured).
  test("40 MB of white space and a head that never comes is read once", () => {
    const { out, ms } = timed(`<html xmlns="${NS}">${" ".repeat(40 * MB)}<body/></html>`, XHTML);
    expect(ms).toBeLessThan(LINEAR_MS);
    expect(out.slice(0, 400)).toContain(`<html xmlns="${NS}"><head xmlns="${NS}">${META_XHTML}</head>`);
  });
});
