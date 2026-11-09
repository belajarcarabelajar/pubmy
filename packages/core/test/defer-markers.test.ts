import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The deliberate shortcuts of the two PDF modules live in source as `// defer: <ceiling>, <upgrade-trigger>`
// so a search for "defer:" finds them. The counts are exact: a dropped marker fails here.
const src = (name: string) => readFileSync(join(import.meta.dir, "..", "src", "pdf", name), "utf8");
const markers = (text: string) => text.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("// defer:"));

const files = [
  { name: "overprint.ts", patterns: [/bucket by rounded baseline/, /scale the start tolerance/] },
  { name: "running.ts", patterns: [/rounding edge/, /limit the reach/] },
];

for (const { name, patterns } of files) {
  const found = markers(src(name));

  test(`${name} carries exactly ${patterns.length} defer markers`, () => {
    expect(found).toHaveLength(patterns.length);
  });

  test(`every defer marker in ${name} names a ceiling and an upgrade trigger after a comma`, () => {
    for (const line of found) expect(line).toMatch(/^\/\/ defer: [^,]+, \S/);
  });

  for (const pattern of patterns) {
    test(`${name} has a defer marker matching ${pattern}`, () => {
      expect(found.some((l) => pattern.test(l))).toBe(true);
    });
  }
}
