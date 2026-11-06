// Builds small DOCX fixtures in memory so no binary test file is checked in.
// Run: bun fixtures/make-docx.ts [outDir] to write sample.docx and friends (default fixtures/out/gen/).
// Uses only node:zlib and a stored ZIP writer: fixtures/ is not a workspace, so packages like
// fflate do not resolve from here.
import { deflateSync } from "node:zlib";

const strToU8 = (s: string) => new TextEncoder().encode(s);
const zlibSync = (b: Uint8Array) => new Uint8Array(deflateSync(b));

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const RT = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function crc32(bytes: Uint8Array): number {
  let c = ~0;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(strToU8(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A valid 2x2 opaque red RGB PNG. */
export function makePng(): Uint8Array {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, 2);
  v.setUint32(4, 2);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = [0, 255, 0, 0, 255, 0, 0];
  const raw = new Uint8Array([...row, ...row]);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlibSync(raw)),
    chunk("IEND", new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// Stored (uncompressed) ZIP with a fixed 2026-01-01 timestamp so the bytes are deterministic.
function storeZip(entries: Record<string, Uint8Array>): Uint8Array {
  const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(entries)) {
    const n = strToU8(name);
    const crc = crc32(data);
    const local = new Uint8Array(30 + n.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, n.length, true);
    local.set(n, 30);
    local.set(data, 30 + n.length);
    const central = new Uint8Array(46 + n.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, n.length, true);
    cv.setUint32(42, offset, true);
    central.set(n, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const cdSize = centrals.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, end];
  const out = new Uint8Array(offset + cdSize + 22);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const para =(text: string, style?: string) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const bullet = (text: string) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

const cell = (text: string) => `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;

const IMAGE =
  `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="190500" cy="190500"/><wp:docPr id="1" name="Picture 1" descr="Red square"/>` +
  `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>` +
  `<pic:nvPicPr><pic:cNvPr id="1" name="image1.png"/><pic:cNvPicPr/></pic:nvPicPr>` +
  `<pic:blipFill><a:blip r:embed="rIdImg1"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic>` +
  `</wp:inline></w:drawing></w:r></w:p>`;

const SAMPLE_BODY =
  para("Introduction", "Heading1") +
  `<w:p><w:r><w:t xml:space="preserve">Opening paragraph with a note.</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p>` +
  bullet("First bullet") +
  bullet("Second bullet") +
  IMAGE +
  para("Details", "Heading1") +
  `<w:tbl><w:tr>${cell("Cell A1")}${cell("Cell B1")}</w:tr><w:tr>${cell("Cell A2")}${cell("Cell B2")}</w:tr></w:tbl>` +
  para("Closing paragraph.");

const PLAIN_BODY = para("Just a memo without any heading.") + para("Second line of the memo.");

const documentXml = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="${W}" xmlns:r="${R}" ` +
  `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
  `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
  `xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}<w:sectPr/></w:body></w:document>`;

const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="${W}">` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/></w:style>` +
  `</w:styles>`;

const NUMBERING =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering xmlns:w="${W}">` +
  `<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum>` +
  `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;

const FOOTNOTES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:footnotes xmlns:w="${W}">` +
  `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
  `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
  `<w:footnote w:id="1"><w:p><w:r><w:t>The footnote text.</w:t></w:r></w:p></w:footnote></w:footnotes>`;

const CONTENT_TYPES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
  `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>` +
  `<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>` +
  `</Types>`;

const ROOT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${REL}">` +
  `<Relationship Id="rId1" Type="${RT}/officeDocument" Target="word/document.xml"/></Relationships>`;

const DOC_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${REL}">` +
  `<Relationship Id="rId1" Type="${RT}/styles" Target="styles.xml"/>` +
  `<Relationship Id="rId2" Type="${RT}/numbering" Target="numbering.xml"/>` +
  `<Relationship Id="rId3" Type="${RT}/footnotes" Target="footnotes.xml"/>` +
  `<Relationship Id="rIdImg1" Type="${RT}/image" Target="media/image1.png"/></Relationships>`;

/**
 * A minimal valid DOCX: two Heading 1 sections, a bullet list, a 2x2 table, one footnote
 * and one embedded PNG. With `headings: false` it holds two plain paragraphs only.
 */
export function makeDocx(opts: { headings?: boolean } = {}): Uint8Array {
  return buildDocx({ body: opts.headings === false ? PLAIN_BODY : SAMPLE_BODY });
}

interface DocxParts {
  body: string;
  /** Extra <Relationship/> elements for word/_rels/document.xml.rels. */
  rels?: string;
  /** Extra <Default/> or <Override/> elements for [Content_Types].xml. */
  types?: string;
  /** Extra zip entries, written after the standard parts. */
  extra?: Record<string, Uint8Array>;
}

function buildDocx(p: DocxParts): Uint8Array {
  return storeZip({
    "[Content_Types].xml": strToU8(CONTENT_TYPES.replace("</Types>", `${p.types ?? ""}</Types>`)),
    "_rels/.rels": strToU8(ROOT_RELS),
    "word/document.xml": strToU8(documentXml(p.body)),
    "word/_rels/document.xml.rels": strToU8(DOC_RELS.replace("</Relationships>", `${p.rels ?? ""}</Relationships>`)),
    "word/styles.xml": strToU8(STYLES),
    "word/numbering.xml": strToU8(NUMBERING),
    "word/footnotes.xml": strToU8(FOOTNOTES),
    "word/media/image1.png": makePng(),
    ...p.extra,
  });
}

/** The sample DOCX plus `extra` zip entries (for archive cap tests). */
export const makeDocxWithEntries = (extra: Record<string, Uint8Array>): Uint8Array =>
  buildDocx({ body: SAMPLE_BODY, extra });

/** A DOCX with one external hyperlink, text "Click me", whose relationship Target is `target`. */
export const makeDocxWithHyperlink = (target: string): Uint8Array =>
  buildDocx({
    body: para("Links", "Heading1") +
      `<w:p><w:r><w:t xml:space="preserve">Before </w:t></w:r><w:hyperlink r:id="rIdLink"><w:r><w:t>Click me</w:t></w:r></w:hyperlink></w:p>`,
    rels: `<Relationship Id="rIdLink" Type="${RT}/hyperlink" Target="${target.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" TargetMode="External"/>`,
  });

/** A DOCX with one EMF picture (alt text "Vector chart"), a format no EPUB reader is required to show. */
export const makeDocxWithEmf = (): Uint8Array =>
  buildDocx({
    body: para("Chart", "Heading1") + para("Text before the chart.") +
      IMAGE.replace('r:embed="rIdImg1"', 'r:embed="rIdEmf"').replace('descr="Red square"', 'descr="Vector chart"'),
    rels: `<Relationship Id="rIdEmf" Type="${RT}/image" Target="media/chart.emf"/>`,
    types: `<Default Extension="emf" ContentType="image/x-emf"/>`,
    // An EMF header record (type 1) is enough: the converter never decodes the picture.
    extra: { "word/media/chart.emf": new Uint8Array([1, 0, 0, 0, 108, 0, 0, 0, ...new Uint8Array(100)]) },
  });

/** What Word writes for a password-protected file: a CFB container, not a ZIP. Header only. */
export function makeEncryptedDocx(): Uint8Array {
  const out = new Uint8Array(512);
  out.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  return out;
}

if (import.meta.main) {
  // Usage: bun fixtures/make-docx.ts [outDir]  (default fixtures/out/gen/)
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const dir = process.argv[2] ?? join(import.meta.dir, "out", "gen");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "sample.docx"), makeDocx());
  writeFileSync(join(dir, "memo.docx"), makeDocx({ headings: false }));
  writeFileSync(join(dir, "encrypted.docx"), makeEncryptedDocx());
  console.log(`wrote 3 DOCX fixtures to ${dir}`);
}
