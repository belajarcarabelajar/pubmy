import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// main.ts runs against the live DOM at import, so these checks read it as text. Each one is anchored on
// the new call itself, so deleting that call turns the check red; the real-browser run proves the behaviour.
const WEB = join(import.meta.dir, "..");
const main = readFileSync(join(WEB, "src", "main.ts"), "utf8");
const html = readFileSync(join(WEB, "index.html"), "utf8");

/** A top-level function from its `function <name>(` line to the `}` at column 0; "" when absent. */
function fn(name: string): string {
  const start = main.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  if (start < 0) return "";
  const end = main.indexOf("\n}\n", start);
  return end < 0 ? "" : main.slice(start, end + 2);
}

/** A listener from its opening `<target>.addEventListener("<type>"` line to the closing `});` line. */
function listener(target: string, type: string): string {
  const start = main.indexOf(`${target}.addEventListener("${type}"`);
  if (start < 0) return "";
  const end = main.indexOf("\n});", start);
  return end < 0 ? "" : main.slice(start, end + "\n});".length);
}

const before = (text: string, first: string, second: string) => {
  const a = text.indexOf(first);
  const b = text.indexOf(second);
  return a >= 0 && b > a;
};

describe("opening an EPUB: the drop", () => {
  test("main.ts imports splitDrop and inspectEpub from open-epub.ts", () => {
    expect(main).toMatch(/^import \{[^}]*\binspectEpub\b[^}]*\} from "\.\/open-epub\.ts";$/m);
    expect(main).toMatch(/^import \{[^}]*\bsplitDrop\b[^}]*\} from "\.\/open-epub\.ts";$/m);
  });

  test("the file and size limits are constants used by both the queue and splitDrop", () => {
    expect(main).toContain("const MAX_FILES = 10;");
    expect(main).toContain("const MAX_BYTES = 50 * 1024 * 1024;");
    expect(main).toMatch(/createQueue<File>\(\{ maxFiles: MAX_FILES, maxBytes: MAX_BYTES,/);
    expect(main).not.toMatch(/maxFiles: 10/);
  });

  test("addFiles splits the drop with splitDrop over the whole list and the held count", () => {
    const body = fn("addFiles");
    expect(body).toMatch(/const \{ toQueue, toOpen, refused \} = splitDrop\(Array\.from\(list\), \{ maxBytes: MAX_BYTES, maxHeld: MAX_FILES, held: heldCount\(\) \}\);/);
  });

  test("the queue receives toQueue only, never the dropped list, so an EPUB is never converted", () => {
    const body = fn("addFiles");
    expect(body).toContain("queue.add(toQueue)");
    expect(body).not.toContain("queue.add(Array.from(list))");
    expect(main.match(/queue\.add\(/g)).toHaveLength(1);
  });

  test("the refusals shown are the queue's followed by the opener's", () => {
    expect(fn("addFiles")).toContain("lastRefusals = [...queue.add(toQueue), ...refused];");
  });

  test("the EPUBs of the drop are opened after the refusals are shown, and counted as being read", () => {
    const body = fn("addFiles");
    expect(body).toContain("opening += toOpen.length;");
    expect(before(body, "renderRefusals();", "void openEpubs(toOpen);")).toBe(true);
  });

  test("held counts opened rows that are ready and not expired, plus the files still being read", () => {
    expect(main).toContain("let opening = 0;");
    const body = fn("heldCount");
    expect(body).toContain('r.kind === "opened" && r.ready && !r.ready.expired');
    expect(body).toContain("+ opening");
  });
});

describe("opening an EPUB: one file", () => {
  const body = fn("openEpubs");

  test("the file is read and checked with inspectEpub", () => {
    expect(body).toContain("file.arrayBuffer()");
    expect(body).toContain("inspectEpub(");
    expect(before(body, "file.arrayBuffer()", "inspectEpub(")).toBe(true);
  });

  test("a file that cannot be read is a READ_FAILED read-failed result", () => {
    expect(body).toMatch(/code: "READ_FAILED", message: "read-failed"/);
  });

  test("a failed check makes a failed row that carries the result, so the row text is the failure text", () => {
    expect(body).toMatch(/status: "failed", result: check/);
    expect(main).toContain("failureText(item.result.code, item.result.message, lang)");
  });

  test("a passed check makes a ready row with no result", () => {
    expect(body).toMatch(/status: "ready" \}/);
  });

  test("every row from this path is an opened row", () => {
    expect(body).toContain('kind: "opened"');
  });

  test("a passed check starts the retention window over the bytes read", () => {
    expect(body).toMatch(/if \(read && check\.ok\) startRetention\(row, read\);/);
  });

  test("the result is announced with the row text, after the row exists", () => {
    expect(body).toContain("announce(`${file.name}: ${statusText(row)}`);");
    expect(before(body, "rows.set(", "announce(")).toBe(true);
  });

  test("ids come from a counter that starts at -1 and goes down, so they never meet a queue id", () => {
    expect(main).toContain("let nextOpenedId = -1;");
    expect(body).toContain("nextOpenedId--");
  });

  test("each file ends its open attempt by taking itself off the being-read count and the files-left count, whatever happened", () => {
    expect(body).toContain("let left = files.length;");
    expect(body).toMatch(/finally \{\s*opening--;\s*left--;\s*\}/);
  });

  // A throw out of one file's body must not leave the places of the files after it held for the life of the page.
  test("an unexpected throw gives back the places of the files never reached, and still propagates", () => {
    expect(body).toMatch(/\} finally \{\s*opening -= left;\s*\}\s*\}$/);
    // The outer try opens before the loop, and no catch swallows the exception.
    expect(before(body, "try {", "for (const file of files) {")).toBe(true);
    expect(body).not.toContain("catch (");
  });

  test("the files are opened one after another, in drop order", () => {
    expect(body).toMatch(/for \(const file of files\) \{/);
  });
});

describe("opening an EPUB: auto-open and the reading hold", () => {
  const body = fn("openEpubs");

  test("only the first file of a drop that passes is opened, and only while no reader is open", () => {
    expect(body).toMatch(/if \(check\.ok && firstOpen\) \{\s*firstOpen = false;\s*if \(!dialog\.open\) void openPreview\(row\);\s*\}/);
    expect(body.match(/openPreview\(/g)).toHaveLength(1);
  });

  test("opening an opened row's reader pauses its countdown right after the dialog is shown", () => {
    const open = fn("openPreview");
    expect(open).toMatch(/dialog\.showModal\(\);\n(?:\s*\/\/[^\n]*\n)?\s*if \(row\.kind === "opened"\) row\.stop\?\.pause\(\);/);
  });

  test("closing the reader gives an opened row a fresh window, before focus returns to the row", () => {
    const close = listener("dialog", "close");
    expect(close).toContain('if (row?.kind === "opened") row.stop?.extend();');
    expect(before(close, "const row = previewRow;", 'if (row?.kind === "opened") row.stop?.extend();')).toBe(true);
    expect(before(close, 'if (row?.kind === "opened") row.stop?.extend();', ".focus();")).toBe(true);
  });

  // Anchored on the guard of each line, not on how many calls exist, so a harmless extra guarded call does not break it.
  test("the reader pauses and restarts the countdown of an opened row only, never of a converted one", () => {
    const pauses = main.split("\n").filter((l) => l.includes(".stop?.pause()"));
    expect(pauses.length).toBeGreaterThan(0);
    for (const line of pauses) expect(line).toContain('kind === "opened"');
    const restarts = listener("dialog", "close").split("\n").filter((l) => l.includes(".stop?.extend()"));
    expect(restarts.length).toBeGreaterThan(0);
    for (const line of restarts) expect(line).toContain('kind === "opened"');
  });
});

// An EPUB that passed inspectEpub but that foliate cannot mount would stay "Ready to read" with a Read button
// that can never work, so the catch branch of openPreview turns an opened row into a failed one and drops its bytes.
describe("opening an EPUB: a book the reader cannot mount", () => {
  const open = fn("openPreview");
  const caught = open.includes("} catch {") ? open.slice(open.indexOf("} catch {")) : "";
  const failed = fn("failOpened");

  test("a mount failure is told apart by kind: an opened row is failed after the dialog closes", () => {
    expect(caught).toMatch(/dialog\.close\(\);\s*if \(row\.kind === "opened"\) failOpened\(row\);/);
  });

  test("a converted row keeps the generic preview-failed announcement, and an opened row does not get it", () => {
    expect(caught).toMatch(/else announce\(`\$\{row\.item\.name\}: \$\{t\("preview-failed", lang\)\}`\);/);
    expect(failed).not.toContain("preview-failed");
  });

  test("the failed row carries a READ_FAILED read-failed result, so its text is the failure text", () => {
    expect(failed).toContain('row.item.status = "failed";');
    expect(failed).toContain('row.item.result = { ok: false, code: "READ_FAILED", message: "read-failed" };');
  });

  test("the countdown is called first, which drops the bytes, and only then are the ready item and the countdown cleared", () => {
    expect(failed).toContain("row.stop?.();");
    expect(failed).toContain("row.ready = undefined;");
    expect(failed).toContain("row.stop = undefined;");
    expect(before(failed, "row.stop?.();", "row.ready = undefined;")).toBe(true);
    expect(before(failed, "row.stop?.();", "row.stop = undefined;")).toBe(true);
  });

  test("the failure is announced with the row text and the row is rendered, after the row has changed", () => {
    expect(failed).toContain("announce(`${row.item.name}: ${statusText(row)}`);");
    expect(failed).toContain("render(row);");
    expect(before(failed, "row.stop = undefined;", "announce(")).toBe(true);
    expect(before(failed, "announce(", "render(row);")).toBe(true);
  });

  // Pins that already held: the close handler runs after failOpened cleared the countdown and has no Read button to focus.
  test("the close handler's focus call is optional on a row with no Read button, and a false from open only closes the dialog", () => {
    expect(listener("dialog", "close")).toContain(`row?.li.querySelector<HTMLElement>('[data-action="preview"]:not(:disabled)')?.focus();`);
    expect(open).toContain("if (!(await preview.open(row.ready))) dialog.close();");
  });
});

describe("opened rows beside converted rows", () => {
  test("a row is a converted or an opened one", () => {
    expect(main).toMatch(/interface Row \{[\s\S]*?kind: "converted" \| "opened";[\s\S]*?\n\}/);
  });

  test("a row built by the queue is a converted row", () => {
    expect(fn("onChange")).toContain('row = { li, item, progress: 0, kind: "converted" };');
  });

  test("render passes the row's kind to the row view", () => {
    expect(fn("render")).toContain("kind: row.kind,");
  });

  test("an opened row has no object URL; a converted row keeps its own", () => {
    const body = fn("startRetention");
    expect(body.match(/URL\.createObjectURL\(/g)).toHaveLength(1);
    expect(body).toContain('row.kind === "converted" ? URL.createObjectURL(');
  });

  test("the status text of an opened ready row is Ready to read, after the expired check", () => {
    const body = fn("statusText");
    expect(body).toContain('if (row.kind === "opened" && item.status === "ready") return t("opened", lang);');
    expect(before(body, "row.ready?.expired", 'row.kind === "opened"')).toBe(true);
  });

  test("Download all takes converted rows only", () => {
    const start = main.indexOf("downloadAllBtn.onclick = async () => {");
    const entries = main.slice(start, main.indexOf("if (entries.length < 2) return;", start));
    expect(start).toBeGreaterThan(0);
    expect(entries).toContain('r.kind === "converted" && r.ready?.epub && !r.ready.expired');
  });

  test("the Kindle hint and the Download all count use converted rows only, while Clear all still sees every row", () => {
    const body = fn("refreshBatch");
    expect(body).toContain('filter((r) => r.kind === "converted" && r.ready && !r.ready.expired).length');
    expect(body).toContain("rows.size, ready)");
  });
});

describe("limits that hold for the whole change", () => {
  test("main.ts stays under 500 lines", () => {
    expect(main.split("\n").length).toBeLessThan(500);
  });

  test("main.ts never imports the converter's runtime", () => {
    expect(main).not.toContain("@pubmy/core");
  });

  test("the opener and the loader load only the zip-caps entry of core at run time", () => {
    for (const file of ["open-epub.ts", "epub-loader.ts"]) {
      const src = readFileSync(join(WEB, "src", file), "utf8");
      const runtime = [...src.matchAll(/^import (?!type\b)[^\n]*from "(@pubmy\/core[^"]*)";$/gm)].map((m) => m[1]);
      expect(runtime.filter((m) => m !== "@pubmy/core/zip-caps")).toEqual([]);
    }
  });
});

describe("the page", () => {
  test("EPUB is the last format chip", () => {
    expect(html).toMatch(/<li class="chip">CBR<\/li>\s*<li class="chip">EPUB<\/li>\s*<\/ul>/);
  });

  test("the file picker still accepts .epub", () => {
    expect(html).toContain(".cbz,.cbr,.zip,.rar,.epub");
  });

  test("the static description says an EPUB can be opened to read", () => {
    const meta = /<meta name="description" content="([^"]*)">/.exec(html)?.[1];
    expect(meta).toBe("Ubah TXT, Markdown, HTML, DOCX, PDF, MOBI/AZW3, CBZ/CBR jadi EPUB 3 langsung di browser, atau buka EPUB untuk dibaca.");
  });
});
