import type { BookNotes, FailureCode } from "@pubmy/core";

export type Row =
  | { rel: string; status: "converted"; notes?: BookNotes }
  | { rel: string; status: "skipped" | "unsupported" }
  | { rel: string; status: "failed"; code: FailureCode | "WRITE_FAILED" };

function notesText(n: BookNotes | undefined): string {
  const parts: string[] = [];
  if (n?.ocr) {
    const conf = Number.isFinite(n.ocr.meanConfidence) ? `, ${Math.round(n.ocr.meanConfidence)}%` : "";
    parts.push(`OCR ${n.ocr.pages} pages${conf}`);
  }
  for (const w of n?.warnings ?? []) parts.push(`warning: ${w}`);
  return parts.length ? ` (${parts.join("; ")})` : "";
}

function statusText(r: Row): string {
  if (r.status === "failed") return `failed ${r.code}`;
  if (r.status === "converted") return `converted${notesText(r.notes)}`;
  return r.status;
}

/** A two-column table, one line per file. */
export function formatReport(rows: Row[]): string {
  const width = Math.max(4, ...rows.map((r) => r.rel.length));
  const line = (a: string, b: string) => `${a.padEnd(width)}  ${b}\n`;
  return line("file", "status") + rows.map((r) => line(r.rel, statusText(r))).join("");
}

export function exitCode(rows: Row[]): number {
  return rows.some((r) => r.status === "failed") ? 1 : 0;
}
