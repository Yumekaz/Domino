import type { Clock, Sleep } from "../../core/history/src/source.ts";
import type { GithubRetryPolicy } from "../../core/history/src/source.ts";
import { HistoryError } from "../../core/history/src/errors.ts";

export class GithubApiError extends Error {
  readonly status: number;
  readonly headers: Record<string, string | number | undefined>;
  readonly retryAt: string | null;

  constructor(
    status: number,
    message: string,
    headers: Record<string, string | number | undefined> = {},
    retryAt: string | null = null,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GithubApiError";
    this.status = status;
    this.headers = headers;
    this.retryAt = retryAt;
  }
}

export function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

export function headerValue(
  headers: Record<string, string | number | undefined> | undefined,
  name: string,
): string | null {
  if (headers === undefined) {
    return null;
  }
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower && value !== undefined) {
      return String(value);
    }
  }
  return null;
}

export function headerNumber(
  headers: Record<string, string | number | undefined> | undefined,
  name: string,
): number | null {
  const value = headerValue(headers, name);
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface RetryDeps {
  clock: Clock;
  sleep: Sleep;
  random?: () => number;
  onRetry?: (input: {
    attempt: number;
    waitMs: number;
    status: number | null;
    reason: "backoff" | "rate_limit";
  }) => void;
}

export interface RetryResult<T> {
  value: T;
  attempts: number;
}

export async function withGithubRetry<T>(
  operation: (attempt: number) => Promise<T>,
  policy: GithubRetryPolicy,
  deps: RetryDeps,
  signal: AbortSignal | undefined,
): Promise<RetryResult<T>> {
  const maxRetries = clampInt(policy.maxRetries, 0, 10);
  const baseDelayMs = clampInt(policy.baseDelayMs, 0, 60_000);
  const maxDelayMs = clampInt(policy.maxDelayMs, 0, 300_000);
  const maxRateLimitWaitMs = clampInt(policy.maxRateLimitWaitMs, 0, 300_000);
  const random = deps.random ?? Math.random;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (signal?.aborted === true) {
      throw new HistoryError("COLLECTION_CANCELLED", "GitHub collection was cancelled", {
        recoverable: true,
      });
    }
    try {
      const value = await operation(attempt);
      return { value, attempts: attempt + 1 };
    } catch (error) {
      lastError = error;
      const status = error instanceof GithubApiError ? error.status : null;
      if (error instanceof GithubApiError && status === 401) {
        throw new HistoryError("GITHUB_AUTH_REQUIRED", "GitHub authentication was rejected", {
          recoverable: true,
          details: { status },
        });
      }
      if (error instanceof GithubApiError && status === 404) {
        throw error;
      }
      const rateWait =
        error instanceof GithubApiError ? rateLimitWaitMs(error, deps.clock.now()) : null;
      const retryable =
        error instanceof GithubApiError
          ? status === 429 ||
            (status === 403 && rateWait !== null) ||
            (status !== null && status >= 500 && status <= 599) ||
            status === 0
          : true;
      if (!retryable) {
        throw error;
      }
      if (attempt >= maxRetries) {
        break;
      }
      let waitMs: number;
      let reason: "backoff" | "rate_limit";
      if (rateWait !== null) {
        if (rateWait > maxRateLimitWaitMs) {
          const retryAt =
            error instanceof GithubApiError && error.retryAt !== null
              ? error.retryAt
              : new Date(deps.clock.now() + rateWait).toISOString();
          throw new HistoryError(
            "GITHUB_RATE_LIMITED",
            "GitHub rate limit requires a wait longer than the configured maximum",
            {
              recoverable: true,
              details: { retryAt, waitMs: rateWait, status },
            },
          );
        }
        waitMs = rateWait;
        reason = "rate_limit";
      } else {
        const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
        waitMs = Math.min(maxDelayMs, Math.round(exponential * (1 + random() * 0.25)));
        reason = "backoff";
      }
      deps.onRetry?.({ attempt: attempt + 1, waitMs, status, reason });
      if (waitMs > 0) {
        await deps.sleep(waitMs, signal);
      }
      if (isSignalAborted(signal)) {
        throw new HistoryError("COLLECTION_CANCELLED", "GitHub collection was cancelled", {
          recoverable: true,
        });
      }
    }
  }

  if (lastError instanceof HistoryError) {
    throw lastError;
  }
  if (lastError instanceof GithubApiError) {
    const exhaustedRateWait = rateLimitWaitMs(lastError, deps.clock.now());
    if (lastError.status === 429 || (lastError.status === 403 && exhaustedRateWait !== null)) {
      throw new HistoryError("GITHUB_RATE_LIMITED", "GitHub rate limit prevented collection", {
        recoverable: true,
        details: {
          status: lastError.status,
          retryAt: lastError.retryAt,
        },
      });
    }
    throw new HistoryError("GITHUB_UNAVAILABLE", "GitHub API request failed", {
      recoverable: true,
      details: { status: lastError.status },
    });
  }
  throw new HistoryError("GITHUB_UNAVAILABLE", "GitHub API request failed", {
    recoverable: true,
    cause: lastError,
  });
}

export function rateLimitWaitMs(error: GithubApiError, nowMs: number): number | null {
  const retryAfter = headerValue(error.headers, "retry-after");
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.ceil(seconds * 1000);
    }
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) {
      return Math.max(0, date - nowMs);
    }
  }
  const remaining = headerNumber(error.headers, "x-ratelimit-remaining");
  const reset = headerNumber(error.headers, "x-ratelimit-reset");
  if (remaining === 0 && reset !== null) {
    return Math.max(0, reset * 1000 - nowMs + 1_000);
  }
  if (error.status === 429) {
    return 1_000;
  }
  if (error.status === 403 && /rate limit/i.test(error.message)) {
    return 1_000;
  }
  return null;
}

export const realClock: Clock = {
  now: () => Date.now(),
  isoNow: () => new Date().toISOString(),
};

export const realSleep: Sleep = async (ms, signal) => {
  if (ms <= 0) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(
        new HistoryError("COLLECTION_CANCELLED", "GitHub collection was cancelled", {
          recoverable: true,
        }),
      );
    };
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    };
    if (signal?.aborted === true) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
};

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
