import { z } from "zod";
import {
  canonicalGithubUrl,
  shaSchema,
} from "../../../packages/contracts/src/index.ts";
import { ApiFailure } from "./errors.ts";

export interface GithubRepository {
  githubId: number;
  owner: string;
  name: string;
  url: string;
  branch: string;
  headSha: string;
}
const repoResponse = z.object({
  id: z.number().int().positive().safe(),
  private: z.boolean(),
  default_branch: z.string().min(1).max(255),
  name: z.string().min(1),
  owner: z.object({ login: z.string().min(1) }),
  html_url: z.string(),
});
const commitResponse = z.object({ sha: shaSchema });

export async function resolvePublicRepository(
  input: string,
  token?: string,
): Promise<GithubRepository> {
  const url = canonicalGithubUrl(input);
  if (!url)
    throw new ApiFailure(
      400,
      "UNSUPPORTED_REPO",
      "Use a public github.com repository URL.",
    );
  const [, , , owner, name] = url.split("/");
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "domino-api/0.1",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const read = async (path: string): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetch(`https://api.github.com${path}`, {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ApiFailure(
        503,
        "GITHUB_UNAVAILABLE",
        "GitHub could not be reached. Retry the import.",
        true,
      );
    }
    if (response.status === 404)
      throw new ApiFailure(
        404,
        "REPO_NOT_PUBLIC",
        "Public repository or branch was not found.",
      );
    if (response.status === 403 || response.status === 429)
      throw new ApiFailure(
        503,
        "GITHUB_RATE_LIMITED",
        "GitHub refused the request or the rate limit was reached.",
        true,
      );
    if (!response.ok)
      throw new ApiFailure(
        502,
        "GITHUB_UNAVAILABLE",
        "GitHub returned an unsuccessful response.",
        true,
      );
    const size = Number(response.headers.get("content-length") || 0);
    if (size > 1_000_000)
      throw new ApiFailure(
        502,
        "GITHUB_RESPONSE_TOO_LARGE",
        "GitHub response exceeded the configured limit.",
      );
    if (!response.body)
      throw new ApiFailure(
        502,
        "GITHUB_INVALID_RESPONSE",
        "GitHub returned an empty response.",
      );
    const reader = response.body.getReader();
    const parts: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 1_000_000) {
          await reader.cancel();
          throw new ApiFailure(
            502,
            "GITHUB_RESPONSE_TOO_LARGE",
            "GitHub response exceeded the configured limit.",
          );
        }
        parts.push(value);
      }
      return JSON.parse(Buffer.concat(parts).toString("utf8")) as unknown;
    } catch (error) {
      if (error instanceof ApiFailure) throw error;
      throw new ApiFailure(
        502,
        "GITHUB_INVALID_RESPONSE",
        "GitHub returned an invalid response.",
      );
    } finally {
      reader.releaseLock();
    }
  };
  const parsed = repoResponse.safeParse(
    await read(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
    ),
  );
  if (!parsed.success)
    throw new ApiFailure(
      502,
      "GITHUB_INVALID_RESPONSE",
      "GitHub repository metadata was incomplete.",
    );
  if (parsed.data.private)
    throw new ApiFailure(
      403,
      "REPO_NOT_PUBLIC",
      "Only public repositories can be indexed.",
    );
  const repo = parsed.data;
  const canonical = canonicalGithubUrl(repo.html_url);
  if (
    !canonical ||
    canonical.toLowerCase() !==
      `https://github.com/${repo.owner.login}/${repo.name}`.toLowerCase()
  )
    throw new ApiFailure(
      502,
      "GITHUB_INVALID_RESPONSE",
      "GitHub returned an unexpected repository identity.",
    );
  const commit = commitResponse.safeParse(
    await read(
      `/repos/${encodeURIComponent(repo.owner.login)}/${encodeURIComponent(repo.name)}/commits/${encodeURIComponent(repo.default_branch)}`,
    ),
  );
  if (!commit.success)
    throw new ApiFailure(
      502,
      "GITHUB_INVALID_RESPONSE",
      "GitHub did not return a full branch SHA.",
    );
  return {
    githubId: repo.id,
    owner: repo.owner.login,
    name: repo.name,
    url: canonical,
    branch: repo.default_branch,
    headSha: commit.data.sha,
  };
}
