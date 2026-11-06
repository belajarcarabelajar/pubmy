// Generates a small ODT document with headings, a nested list, a table, an image and a footnote.
// Run: bun fixtures/make-odt.ts [outDir] to write <outDir>/sample.odt (default fixtures/out/gen/).
import { PNG_1X1 } from "./make-rtf.ts";

const strToU8 = (s: string) => new TextEncoder().encode(s);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

// A stored (uncompressed) zip writer, so the fixture needs no npm package at the repo root.
function storedZip(entries: [string, Uint8Array][]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const n = strToU8(name);
    const crc = crc32(data);
    const local = new Uint8Array(30 + n.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, n.length, true);
    local.set(n, 30);
    const cen = new Uint8Array(46 + n.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, n.length, true);
    cv.setUint32(42, offset, true);
    cen.set(n, 46);
    parts.push(local, data);
    central.push(cen);
    offset += local.length + data.length;
  }
  const size = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, size, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + size + 22);
  let at = 0;
  for (const p of [...parts, ...central, end]) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const NS = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
  'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"',
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"',
  'xmlns:xlink="http://www.w3.org/1999/xlink"',
  'xmlns:dc="http://purl.org/dc/elements/1.1/"',
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"',
].join(" ");

export const SAMPLE_BODY = [
  '<text:sequence-decls><text:sequence-decl text:display-outline-level="0" text:name="Illustration"/></text:sequence-decls>',
  '<text:h text:style-name="Heading_20_1" text:outline-level="1">Chapter One</text:h>',
  '<text:p text:style-name="P1">Plain <text:span text:style-name="T1">styled</text:span> text &amp; more<text:s text:c="2"/>spaced.<text:line-break/>Next line.</text:p>',
  "<text:list><text:list-item><text:p>First item</text:p></text:list-item>",
  "<text:list-item><text:p>Second item</text:p><text:list><text:list-item><text:p>Nested item</text:p></text:list-item></text:list></text:list-item></text:list>",
  '<text:h text:outline-level="1">Chapter Two</text:h>',
  '<text:h text:outline-level="2">Section Two A</text:h>',
  '<table:table table:name="T1"><table:table-column table:number-columns-repeated="2"/>',
  "<table:table-row><table:table-cell><text:p>Cell A</text:p></table:table-cell><table:table-cell><text:p>Cell B</text:p></table:table-cell></table:table-row></table:table>",
  '<text:p><draw:frame draw:name="Image1" svg:width="1cm" svg:height="1cm"><draw:image xlink:href="Pictures/dot.png" xlink:type="simple"/><svg:title>A dot</svg:title></draw:frame></text:p>',
  '<text:p>Noted<text:note text:id="n1" text:note-class="footnote"><text:note-citation>1</text:note-citation><text:note-body><text:p>Footnote body.</text:p></text:note-body></text:note>.</text:p>',
].join("\n");

/** The sample ODT plus `extra` zip entries appended after the standard ones. */
export const makeOdtWithEntries = (extra: [string, Uint8Array][], body: string = SAMPLE_BODY): Uint8Array =>
  makeOdt(body, "Fixture ODT", extra);

export function makeOdt(body: string = SAMPLE_BODY, title = "Fixture ODT", extra: [string, Uint8Array][] = []): Uint8Array {
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${NS} office:version="1.3">
<office:automatic-styles><style:style style:name="P1" style:family="paragraph"><style:text-properties fo:font-weight="bold"/></style:style></office:automatic-styles>
<office:body><office:text>
${body}
</office:text></office:body></office:document-content>`;
  const meta = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta ${NS} office:version="1.3"><office:meta><dc:title>${title}</dc:title></office:meta></office:document-meta>`;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>
<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="Pictures/dot.png" manifest:media-type="image/png"/>
</manifest:manifest>`;
  // The ODF spec requires "mimetype" as the first entry, stored without compression.
  return storedZip([
    ["mimetype", strToU8("application/vnd.oasis.opendocument.text")],
    ["META-INF/manifest.xml", strToU8(manifest)],
    ["content.xml", strToU8(content)],
    ["meta.xml", strToU8(meta)],
    ["Pictures/dot.png", PNG_1X1],
    ...extra,
  ]);
}

if (import.meta.main) {
  // Usage: bun fixtures/make-odt.ts [outDir]  (default fixtures/out/gen/); Bun.write creates the dir.
  const out = `${process.argv[2] ?? `${import.meta.dir}/out/gen`}/sample.odt`;
  await Bun.write(out, makeOdt());
  console.log(out);
}
