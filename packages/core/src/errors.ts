import type { FailureCode } from "./types.ts";

/** Thrown by an adapter to fail with a specific code and message key instead of READ_FAILED. */
export class PubmyError extends Error {
  constructor(
    readonly code: FailureCode,
    message: string,
  ) {
    super(message);
    this.name = "PubmyError";
  }
}
