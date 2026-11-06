// Generates a small RTF document with headings, a list, a table and a PNG picture.
// Run: bun fixtures/make-rtf.ts <out.rtf>

/** A valid 1x1 PNG. */
export const PNG_1X1 = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export function makeRtfText(): string {
  return [
    String.raw`{\rtf1\ansi\ansicpg1252\deff0`,
    String.raw`{\fonttbl{\f0\froman Times New Roman;}}`,
    String.raw`{\colortbl;\red0\green0\blue0;}`,
    String.raw`{\*\generator Pubmy fixture;}`,
    String.raw`{\info{\title Fixture RTF}{\author Pubmy}}`,
    String.raw`\pard\outlinelevel0\b Chapter One\b0\par`,
    String.raw`\pard Plain text with \b bold\b0 and \i italic\i0 words, caf\'e9 and 荤?uro.\par`,
    String.raw`\pard{\listtext\'95\tab}\ls1 First item\par`,
    String.raw`\pard{\listtext\'95\tab}\ls1 Second item\par`,
    String.raw`\pard\outlinelevel0 Chapter Two\par`,
    String.raw`\pard\outlinelevel1 Section Two A\par`,
    String.raw`\trowd\cellx2000\cellx4000\pard\intbl Cell A\cell Cell B\cell\row`,
    String.raw`\pard{\*\shppict{\pict\pngblip\picw1\pich1 ` + hex(PNG_1X1) + String.raw`}}{\nonshppict{\pict\wmetafile8 0102}}\par`,
    String.raw`\pard Last paragraph.\par`,
    "}",
  ].join("\n");
}

export function makeRtf(): Uint8Array {
  return new TextEncoder().encode(makeRtfText());
}

if (import.meta.main) {
  const out = process.argv[2] ?? "fixtures/out/sample.rtf";
  await Bun.write(out, makeRtf());
  console.log(out);
}
