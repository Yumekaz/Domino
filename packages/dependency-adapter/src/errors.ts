export type DependencyAdapterErrorCode =
  | "INVALID_ANALYZER_OUTPUT"
  | "ANALYZER_TIMEOUT"
  | "ANALYZER_FAILED"
  | "INVALID_ANALYZER_INPUT"
  | "INVALID_ANALYZER_METADATA";

export class DependencyAdapterError extends Error {
  readonly code: DependencyAdapterErrorCode;

  constructor(code: DependencyAdapterErrorCode, message: string) {
    super(message);
    this.name = "DependencyAdapterError";
    this.code = code;
  }
}
