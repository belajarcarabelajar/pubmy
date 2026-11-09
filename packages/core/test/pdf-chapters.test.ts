import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { strFromU8, unzipSync } from "fflate";
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
const text = (r: Ok, path: string) => strFromU8(files(r)[path]);

interface Point {
  title: string;
  src: string;
  depth: number;
}

/** The NCX navPoints in document order with their nesting depth (1 = top level). */
function navPoints(r: Ok): Point[] {
  const ncx = text(r, "OEBPS/toc.ncx");
  const map = ncx.slice(ncx.indexOf("<navMap>"));
  const out: Point[] = [];
  const open: Point[] = [];
  for (const m of map.matchAll(/<navPoint\b[^>]*>|<\/navPoint>|<text>([^<]*)<\/text>|<content src="([^"]*)"\/>/g)) {
    if (m[0].startsWith("<navPoint")) {
      const p = { title: "", src: "", depth: open.length + 1 };
      open.push(p);
      out.push(p);
    } else if (m[0] === "</navPoint>") open.pop();
    else if (m[1] !== undefined) open.at(-1)!.title = m[1];
    else open.at(-1)!.src = m[2];
  }
  return out;
}
const topLevel = (r: Ok) => navPoints(r).filter((p) => p.depth === 1).map((p) => p.title);
const chapterFiles = (r: Ok) => Object.keys(files(r)).filter((p) => /OEBPS\/ch\d+\.xhtml$/.test(p)).sort();

const BODY = 10;
interface Line {
  text: string;
  size: number;
}
const head = (text: string, size: number): Line => ({ text, size });
const body = (n: string): Line[] =>
  [1, 2, 3].map((k) => ({ text: `This is plain body text number ${k} of the part called ${n}, set at ten points.`, size: BODY }));

/** A single-column A4-ish document: lines run down from y 700, headings bold, a new page when the foot band is near. */
async function makePdf(lines: Line[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([600, 800]);
  let y = 700;
  for (const l of lines) {
    const heading = l.size > BODY;
    if (y < 130) {
      page = pdf.addPage([600, 800]);
      y = 700;
    }
    if (heading) y -= 12;
    page.drawText(l.text, { x: 50, y, size: l.size, font: heading ? bold : font });
    y -= heading ? l.size + 10 : 14;
  }
  return pdf.save();
}

let unregister = () => {};
beforeAll(() => {
  unregister = registerAdapter(pdfAdapter);
});
afterAll(() => unregister());

const run = async (bytes: Uint8Array) => expectOk(await convert({ name: "chapters.pdf", bytes }, ctx));

describe("pdf adapter: an unnumbered sub-heading smaller than the numbered sections", () => {
  let r: Ok;
  beforeAll(async () => {
    r = await run(
      await makePdf([
        head("Sample Handbook", 18),
        ...body("intro"),
        head("1 Alpha", 13),
        ...body("alpha"),
        head("2 Beta", 13),
        ...body("beta"),
        head("3 Gamma", 13),
        ...body("gamma"),
        head("Gamma extras", 11),
        ...body("extras"),
        head("4 Delta", 13),
        ...body("delta"),
        head("Questions", 13),
        ...body("questions"),
      ]),
    );
  });

  test("the nav lists the numbered sections and the trailing 13 pt heading as chapters, not the sub-heading", () => {
    expect(topLevel(r)).toEqual(["1 Alpha", "2 Beta", "3 Gamma", "4 Delta", "Questions"]);
  });

  test("the sub-heading is a nested navPoint under 3 Gamma in the NCX", () => {
    const points = navPoints(r);
    const at = points.findIndex((p) => p.title === "3 Gamma");
    expect(points[at + 1]).toMatchObject({ title: "Gamma extras", depth: 2 });
    expect(points.filter((p) => p.depth === 2)).toHaveLength(1);
    expect(points[at].src).toBe("ch003.xhtml");
  });

  test("the nested entry points at an anchor on that heading inside chapter 3", () => {
    const child = navPoints(r).find((p) => p.title === "Gamma extras")!;
    const [file, id] = child.src.split("#");
    expect(file).toBe("ch003.xhtml");
    expect(id).toMatch(/^s\d+$/);
    const xhtml = text(r, `OEBPS/${file}`);
    expect(xhtml).toContain(`<h2 id="${id}">Gamma extras</h2>`);
    expect(xhtml).toContain("3 Gamma");
    expect(xhtml).not.toContain("4 Delta");
  });

  test("the EPUB 3 nav document nests it too", () => {
    expect(text(r, "OEBPS/nav.xhtml")).toMatch(/3 Gamma<\/a><ol><li><a href="ch003\.xhtml#s\d+">Gamma extras<\/a><\/li><\/ol><\/li>/);
  });

  test("there are five chapter files, one per chapter", () => {
    expect(chapterFiles(r)).toHaveLength(5);
  });
});

describe("pdf adapter: numbered sections of different sizes", () => {
  let r: Ok;
  beforeAll(async () => {
    r = await run(
      await makePdf([
        head("Sample Handbook", 18),
        ...body("intro"),
        head("1 Alpha", 14),
        ...body("alpha"),
        head("2 Beta", 11),
        ...body("beta"),
        head("Notes", 11),
        ...body("notes"),
        head("3 Gamma", 14),
        ...body("gamma"),
      ]),
    );
  });

  test("an unnumbered heading as small as the smallest numbered one stays a chapter and nothing is nested", () => {
    expect(navPoints(r).map((p) => [p.title, p.depth])).toEqual([
      ["1 Alpha", 1],
      ["2 Beta", 1],
      ["Notes", 1],
      ["3 Gamma", 1],
    ]);
    for (const p of chapterFiles(r)) expect(text(r, p)).not.toContain('id="s');
  });
});

describe("pdf adapter: dotted sub-section numbers smaller than the numbered sections", () => {
  let r: Ok;
  beforeAll(async () => {
    r = await run(
      await makePdf([
        head("Sample Handbook", 18),
        ...body("intro"),
        head("1 Alpha", 14),
        ...body("alpha"),
        head("1.1 Sub", 11),
        ...body("sub"),
        head("2 Beta", 14),
        ...body("beta"),
      ]),
    );
  });

  test("a dotted heading is a chapter like any numbered one: nothing is demoted or nested", () => {
    expect(navPoints(r).map((p) => [p.title, p.depth])).toEqual([
      ["1 Alpha", 1],
      ["1.1 Sub", 1],
      ["2 Beta", 1],
    ]);
    for (const p of chapterFiles(r)) expect(text(r, p)).not.toContain('id="s');
  });
});

describe("pdf adapter: no numbered headings", () => {
  let r: Ok;
  beforeAll(async () => {
    r = await run(
      await makePdf([
        head("Sample Handbook", 18),
        ...body("intro"),
        head("Overview", 13),
        ...body("overview"),
        head("Details", 13),
        ...body("details"),
        head("Notes", 11),
        ...body("notes"),
      ]),
    );
  });

  test("every heading after the title stays a chapter, whatever its size", () => {
    expect(navPoints(r).map((p) => [p.title, p.depth])).toEqual([
      ["Overview", 1],
      ["Details", 1],
      ["Notes", 1],
    ]);
    for (const p of chapterFiles(r)) expect(text(r, p)).not.toContain('id="s');
  });
});
