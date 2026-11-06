import { EpubCheck } from "@likecoin/epubcheck-ts";
import type { CheckResult } from "./types.ts";

/** Runs epubcheck-ts; `errors` counts fatal plus error messages. */
export async function validate(epub: Uint8Array): Promise<CheckResult> {
  const r = await EpubCheck.validate(epub, undefined, "book.epub");
  const messages = r.messages
    .filter((m) => m.severity === "fatal" || m.severity === "error" || m.severity === "warning")
    .map((m) => `${m.severity} ${m.id}: ${m.message}`);
  return { errors: r.fatalCount + r.errorCount, warnings: r.warningCount, messages };
}
