import { Octokit } from "@octokit/rest";
import type { GithubApi, GithubResponse } from "../../core/history/src/source.ts";
import { GithubApiError } from "./http.ts";

export interface OctokitApiOptions {
  token?: string | null;
  userAgent?: string;
  requestTimeoutMs?: number;
  baseUrl?: string;
}

type OctokitRequest = (
  route: string,
  parameters?: Record<string, unknown>,
) => Promise<{
  status: number;
  headers: Record<string, string>;
  data: unknown;
}>;

export function createOctokitApi(options: OctokitApiOptions = {}): GithubApi {
  const token = options.token?.trim() ?? "";
  const octokit = new Octokit({
    ...(token.length > 0 ? { auth: token } : {}),
    userAgent: options.userAgent ?? "domino-history/0.1",
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    request: {
      timeout: Math.max(1_000, options.requestTimeoutMs ?? 20_000),
    },
  });
  const request = octokit.request.bind(octokit) as unknown as OctokitRequest;

  return {
    async request(
      route: string,
      params: Record<string, unknown>,
      signal: AbortSignal | undefined,
    ): Promise<GithubResponse> {
      try {
        const response = await request(route, {
          ...params,
          headers: {
            accept: "application/vnd.github+json",
            "x-github-api-version": "2022-11-28",
          },
          ...(signal === undefined ? {} : { request: { signal } }),
        });
        return {
          status: response.status,
          headers: normalizeHeaders(response.headers),
          data: response.data,
        };
      } catch (error) {
        throw toGithubApiError(error);
      }
    },
  };
}

export function createOctokitApiFromEnv(options: Omit<OctokitApiOptions, "token"> = {}): GithubApi {
  const token = process.env.DOMINO_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? null;
  return createOctokitApi({ ...options, token });
}

function normalizeHeaders(
  headers: Record<string, unknown> | undefined,
): Record<string, string | number | undefined> {
  if (headers === undefined) {
    return {};
  }
  const normalized: Record<string, string | number | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string" || typeof value === "number" || value === undefined) {
      normalized[key.toLowerCase()] = value;
    }
  }
  return normalized;
}

function toGithubApiError(error: unknown): GithubApiError {
  if (error instanceof GithubApiError) {
    return error;
  }
  const candidate = error as {
    status?: unknown;
    message?: unknown;
    response?: { headers?: Record<string, unknown>; data?: { message?: unknown } };
  };
  const status = typeof candidate.status === "number" ? candidate.status : 0;
  const headers = normalizeHeaders(candidate.response?.headers);
  const apiMessage =
    typeof candidate.response?.data?.message === "string"
      ? candidate.response.data.message
      : typeof candidate.message === "string"
        ? candidate.message
        : "GitHub request failed";
  const retryAt = retryAtFromHeaders(headers);
  return new GithubApiError(
    status,
    apiMessage.replace(/\s+/g, " ").slice(0, 500),
    headers,
    retryAt,
    error,
  );
}

function retryAtFromHeaders(
  headers: Record<string, string | number | undefined>,
): string | null {
  const retryAfter = headers["retry-after"];
  if (retryAfter !== undefined) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) {
      return new Date(Date.now() + seconds * 1000).toISOString();
    }
    const parsed = Date.parse(String(retryAfter));
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  const reset = headers["x-ratelimit-reset"];
  if (reset !== undefined) {
    const epoch = Number(reset);
    if (Number.isFinite(epoch)) {
      return new Date(epoch * 1000).toISOString();
    }
  }
  return null;
}
