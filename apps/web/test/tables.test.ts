import { describe, expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { isolateTables, TABLE_HOST } from "../src/tables.ts";

/** A section page as foliate hands it over: the book's stylesheet in the head, two tables, one nested. */
function page() {
  const { document } = parseHTML(
    '<html><head><link rel="stylesheet" href="book.css"><style>td{color:red}</style></head><body>' +
      "<p>Before</p><table><tr><td>1</td><td><table><tr><td>inner</td></tr></table></td></tr></table>" +
      "<p>Between</p><table><tr><td>2</td></tr></table><p>After</p></body></html>",
  );
  return document as unknown as Document;
}

const hosts = (doc: Document) => [...doc.querySelectorAll<HTMLElement>(`.${TABLE_HOST}`)];

/** Makes a host report a table wider than its box, as layout would on a phone. */
function overflowing(host: HTMLElement, wide: boolean) {
  Object.defineProperty(host, "scrollWidth", { value: wide ? 667 : 213 });
  Object.defineProperty(host, "clientWidth", { value: 213 });
}

/** True when a touch event fired on the host reaches the page document, where foliate turns pages. */
function reachesPage(doc: Document, host: HTMLElement, type: string): boolean {
  let reached = false;
  const listener = () => (reached = true);
  doc.addEventListener(type, listener);
  host.dispatchEvent(new (doc.defaultView as unknown as typeof globalThis).Event(type, { bubbles: true }));
  doc.removeEventListener(type, listener);
  return reached;
}

describe("isolateTables", () => {
  test("moves each top-level table into a shadow root, so foliate's page count does not see its rows", () => {
    const doc = page();
    isolateTables(doc);
    expect(doc.body.querySelectorAll("table").length).toBe(0);
    const boxes = hosts(doc);
    expect(boxes.length).toBe(2);
    expect(boxes[0].shadowRoot?.querySelectorAll("table").length).toBe(2);
    expect(boxes[1].shadowRoot?.querySelector("td")?.textContent).toBe("2");
    expect([...doc.body.children].map((e) => e.tagName.toLowerCase())).toEqual(["p", "div", "p", "div", "p"]);
  });

  test("the table keeps the book's stylesheets and gets its own scroll styles", () => {
    const doc = page();
    isolateTables(doc);
    const root = hosts(doc)[0].shadowRoot!;
    expect(root.querySelector('link[rel="stylesheet"]')?.getAttribute("href")).toBe("book.css");
    const css = [...root.querySelectorAll("style")].map((s) => s.textContent).join("\n");
    expect(css).toContain("td{color:red}");
    expect(css).toContain("white-space:nowrap");
  });

  test("a sideways swipe on a table wider than its box scrolls the table instead of turning the page", () => {
    const doc = page();
    isolateTables(doc);
    const [wide, narrow] = hosts(doc);
    overflowing(wide, true);
    overflowing(narrow, false);
    for (const type of ["touchstart", "touchmove", "touchend"]) {
      expect(reachesPage(doc, wide, type)).toBe(false);
      expect(reachesPage(doc, narrow, type)).toBe(true);
    }
  });
});
