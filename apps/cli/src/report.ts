import type { FailureCode } from "@pubmy/core";

export type Row =
  | { rel: string; status: "converted" | "skipped" | "unsupported" }
  | { rel: string; status: "failed"; code: FailureCode | "WRITE_FAILED" };

function statusText(r: Row): string {
  return r.status === "failed" ? `failed ${r.code}` : r.status;
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
