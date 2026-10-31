export type HistoryErrorCode =
  | "INVALID_REMOTE"
  | "INVALID_PATH"
  | "UNSUPPORTED_REMOTE"
  | "CHECKOUT_TIMEOUT"
  | "CHECKOUT_TOO_LARGE"
  | "GIT_FAILED"
  | "SHA_NOT_FOUND"
  | "GITHUB_RATE_LIMITED"
  | "GITHUB_UNAVAILABLE"
  | "GITHUB_AUTH_REQUIRED"
  | "REPO_NOT_PUBLIC"
  | "COLLECTION_CANCELLED"
  | "COLLECTION_TIME_BUDGET"
  | "NO_EVIDENCE"
  | "LLM_UNAVAILABLE"
  | "LLM_TIMEOUT"
  | "LLM_RATE_LIMITED"
  | "LLM_BAD_OUTPUT"
  | "INVALID_CITATION"
  | "UNSUPPORTED_CLAIM"
  | "STORE_FAILED"
  | "SNAPSHOT_NOT_FOUND"
  | "REPOSITORY_NOT_FOUND"
  | "INVALID_REQUEST";

export class HistoryError extends Error {
  readonly code: HistoryErrorCode;
  readonly recoverable: boolean;
  readonly details: Readonly<Record<string, string | number | boolean | null>>;

  constructor(
    code: HistoryErrorCode,
    message: string,
    options?: {
      recoverable?: boolean;
      details?: Record<string, string | number | boolean | null>;
      cause?: unknown;
    },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "HistoryError";
    this.code = code;
    this.recoverable = options?.recoverable ?? false;
    this.details = Object.freeze({ ...(options?.details ?? {}) });
  }
}

export function isHistoryError(error: unknown): error is HistoryError {
  return error instanceof HistoryError;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
