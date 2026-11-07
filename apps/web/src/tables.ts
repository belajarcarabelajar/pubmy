/** Class of the scroll box that holds one table; the reader's section styles size it. */
export const TABLE_HOST = "pubmy-table";

/**
 * Table styles inside the box: a table wider than the page (pubmy rebuilds an 18-column
 * correlation matrix from a sideways PDF table) keeps its rows on one line and scrolls.
 */
const TABLE_CSS =
  "table{border-collapse:collapse;font-size:.85em}" +
  "th,td{padding:.1em .4em;vertical-align:top;white-space:nowrap}caption{text-align:start}";

const TOUCH = ["touchstart", "touchmove", "touchend"] as const;

/**
 * Moves each top-level table of a section page into its own scroll box, behind a shadow root.
 *
 * foliate-js counts a section's pages from a Range over the body, and that Range also counts rows
 * hidden inside a scroll box: on a 320 px phone a 12-column table added two empty pages after the
 * last one. Rows behind a shadow root are not in the Range. foliate also turns the page on every
 * sideways swipe in the document, so a swipe on a table wider than its box stops at the box and
 * scrolls the table.
 */
export function isolateTables(doc: Document): void {
  const sheets = [...doc.head.querySelectorAll('link[rel~="stylesheet"], style')];
  for (const table of [...doc.body.querySelectorAll("table")]) {
    if (table.parentElement?.closest("table")) continue; // moves with the table around it
    const host = doc.createElement("div");
    host.className = TABLE_HOST;
    table.replaceWith(host);
    const style = doc.createElement("style");
    style.textContent = TABLE_CSS;
    host.attachShadow({ mode: "open" }).append(...sheets.map((s) => s.cloneNode(true)), style, table);
    for (const type of TOUCH)
      host.addEventListener(type, (e) => {
        if (host.scrollWidth > host.clientWidth) e.stopPropagation();
      });
  }
}
