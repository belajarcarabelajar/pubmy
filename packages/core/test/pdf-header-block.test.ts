import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { strFromU8, unzipSync } from "fflate";
import { makeHeaderBlockPdf } from "../../../fixtures/make-pdf-header-block.ts";
import { pdfAdapter } from "../src/adapters/pdf.ts";
import { convert, domFor, registerAdapter, type Ctx, type Result } from "../src/index.ts";

const ctx: Ctx = {
  dom: domFor("bun"),
  loadOcr: () => Promise.reject(new Error("no OCR in pdf tests")),
  progress: () => {},
  signal: new AbortController().signal,
};

type Ok = Extract<Result, { ok: true }>;
function expectOk(r: Result): Ok {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
}
const files = (r: Ok) => unzipSync(r.epub);
/** The visible text of every chapter file, one block per line, without the nav document. */
const bookText = (r: Ok) =>
  Object.entries(files(r))
    .filter(([p]) => p.endsWith(".xhtml") && !p.endsWith("nav.xhtml"))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, b]) => strFromU8(b).replace(/^[\s\S]*<body[^>]*>/, "").replace(/<[^>]+>/g, "\n"))
    .join("\n");

interface NavPoint {
  title: string;
  children: NavPoint[];
}
/** The navPoint tree of toc.ncx, nested as the file nests it. */
function navTree(ncx: string): NavPoint[] {
  const roots: NavPoint[] = [];
  const open: NavPoint[] = [];
  for (const m of ncx.matchAll(/<(\/?)navPoint\b[^>]*>|<navLabel>\s*<text>([^<]*)<\/text>/g)) {
    if (m[2] !== undefined) open.at(-1)!.title = m[2];
    else if (m[1]) open.pop();
    else {
      const node: NavPoint = { title: "", children: [] };
      (open.at(-1)?.children ?? roots).push(node);
      open.push(node);
    }
  }
  return roots;
}

let unregister = () => {};
beforeAll(() => {
  unregister = registerAdapter(pdfAdapter);
});
afterAll(() => unregister());

describe("pdf adapter: a template header table on pages 2 to 9, page 2 drawn twice", () => {
  let r: Ok;
  beforeAll(async () => {
    r = expectOk(await convert({ name: "header-block.pdf", bytes: await makeHeaderBlockPdf() }, ctx));
  });

  test("no header text and no doubled token reaches any chapter", () => {
    // One heading of the manual says "lebih dari satu"; it is cut out so that every other "dari" counts.
    const text = bookText(r).replace("Punya lebih dari satu program studi?", "");
    expect(text.match(/\b([A-Za-z]{4,})\1\b/g)).toBeNull();
    for (const header of ["dari", "Halaman", "DIREKTORAT", "No. Dokumen", "Klasifikasi", "Tanggal Terbit", "USER MANUAL", "(DTD)"]) {
      expect(text.includes(header), header).toBe(false);
    }
  });

  test("the nav lists the numbered chapters and the trailing unnumbered one", () => {
    expect(navTree(strFromU8(files(r)["OEBPS/toc.ncx"])).map((n) => n.title)).toEqual([
      "1. Masuk ke sistem",
      "2. Melihat data lulusan",
      "3. Melengkapi data",
      "4. Submit data",
      "5. Memantau status",
      "6. Mengunduh dokumen",
      "7. Punya lebih dari satu program studi?",
      "Pertanyaan umum",
    ]);
  });

  test("the 11 pt unnumbered heading is a nested navPoint under chapter 3", () => {
    const roots = navTree(strFromU8(files(r)["OEBPS/toc.ncx"]));
    const three = roots.find((n) => n.title === "3. Melengkapi data");
    expect(three?.children.map((n) => n.title)).toEqual(["Data yang wajib terpenuhi sebelum submit"]);
    expect(roots.map((n) => n.title)).not.toContain("Data yang wajib terpenuhi sebelum submit");
  });

  test("the cover text of page 1 is still in the book", () => {
    const text = bookText(r);
    expect(text).toContain("User Manual");
    expect(text).toContain("Panduan Mahasiswa");
  });
});
