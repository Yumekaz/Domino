import { z } from "zod";
import {
  canonicalGithubUrl,
  repositoryPathSchema,
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

export interface PullRequestRecord {
  repositoryId?: number;
  number: number;
  baseSha: string;
  headSha: string;
  prUrl: string;
  changedFiles: string[];
  truncated: boolean;
  fileChanges?: {
    filename: string;
    previousFilename: string | null;
    status: string;
  }[];
}

const prResponse = z.object({
  number: z.number().int().positive(),
  html_url: z.string().min(1),
  base: z.object({ sha: shaSchema }),
  head: z.object({ sha: shaSchema }),
});
const prFilesResponse = z.array(
  z.object({
    filename: z.string().min(1),
    status: z.string().min(1),
    previous_filename: z.string().min(1).optional(),
  }),
);

function githubHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "domino-api/0.1",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function readGithubJson(
  path: string,
  headers: Record<string, string>,
  notFoundCode = "SOURCE_NOT_FOUND",
): Promise<unknown> {
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
      "GitHub could not be reached. Retry the request.",
      true,
    );
  }
  if (response.status === 404)
    throw new ApiFailure(
      404,
      notFoundCode,
      "The public GitHub record was not found.",
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
}

const workflowRunsSchema = z.object({
  workflow_runs: z
    .array(
      z.object({
        id: z.number().int().positive().safe(),
        html_url: z.string(),
        head_sha: shaSchema,
        event: z.string(),
        path: z.string(),
        conclusion: z.string().nullable(),
        run_attempt: z.number().int().positive().default(1),
        pull_requests: z
          .array(z.object({ number: z.number().int().positive() }))
          .max(20),
      }),
    )
    .max(5),
});

export async function listDominoWorkflowRuns(repoUrl: string, token?: string) {
  const repository = await resolvePublicRepository(repoUrl, token);
  const response = await readGithubJson(
    `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/actions/workflows/pr-impact.yml/runs?event=pull_request&status=completed&per_page=5`,
    githubHeaders(token),
    "WORKFLOW_NOT_CONFIGURED",
  );
  const runs = workflowRunsSchema
    .parse(response)
    .workflow_runs.filter(
      (run) =>
        run.event === "pull_request" &&
        run.conclusion === "success" &&
        run.path.split("@")[0] === ".github/workflows/pr-impact.yml" &&
        run.html_url.toLowerCase() ===
          `${repository.url}/actions/runs/${run.id}`.toLowerCase(),
    );
  return { repositoryId: repository.githubId, runs };
}

/** Resolves a public pull request's exact revisions and bounded changed-file list. */
export async function resolvePullRequest(
  repoUrl: string,
  prNumber: number,
  token?: string,
): Promise<PullRequestRecord> {
  const canonical = canonicalGithubUrl(repoUrl);
  if (!canonical)
    throw new ApiFailure(
      400,
      "UNSUPPORTED_REPO",
      "The repository is not a supported public GitHub repository.",
    );
  const [, , , owner, name] = canonical.split("/");
  const headers = githubHeaders(token);
  const repository = await resolvePublicRepository(canonical, token);
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${prNumber}`;
  const parsedPr = prResponse.safeParse(
    await readGithubJson(base, headers, "PR_NOT_FOUND"),
  );
  if (!parsedPr.success || parsedPr.data.number !== prNumber)
    throw new ApiFailure(
      502,
      "GITHUB_INVALID_RESPONSE",
      "GitHub returned incomplete pull-request metadata.",
    );
  const pr = parsedPr.data;
  if (
    pr.html_url.toLowerCase() !== `${canonical}/pull/${prNumber}`.toLowerCase()
  )
    throw new ApiFailure(
      502,
      "GITHUB_INVALID_RESPONSE",
      "GitHub returned an unexpected pull-request URL.",
    );
  const changedFiles = new Set<string>();
  const fileChanges: NonNullable<PullRequestRecord["fileChanges"]> = [];
  let truncated = false;
  for (let page = 1; page <= 3; page++) {
    const files = prFilesResponse.parse(
      await readGithubJson(
        `${base}/files?per_page=100&page=${page}`,
        headers,
        "PR_NOT_FOUND",
      ),
    );
    for (const file of files) {
      const path = repositoryPathSchema.safeParse(file.filename);
      const previous = file.previous_filename
        ? repositoryPathSchema.safeParse(file.previous_filename)
        : null;
      if (!path.success || (previous && !previous.success))
        throw new ApiFailure(
          502,
          "GITHUB_INVALID_RESPONSE",
          "GitHub returned an unsafe changed-file path.",
        );
      changedFiles.add(path.data);
      fileChanges.push({
        filename: path.data,
        previousFilename: previous?.data ?? null,
        status: file.status,
      });
    }
    if (files.length < 100) break;
    if (page === 3) truncated = true;
  }
  const confirmed = prResponse.parse(
    await readGithubJson(base, headers, "PR_NOT_FOUND"),
  );
  if (confirmed.head.sha !== pr.head.sha || confirmed.base.sha !== pr.base.sha)
    throw new ApiFailure(
      409,
      "INDEX_STALE",
      "The pull request changed during lookup. Request analysis again.",
      true,
    );
  return {
    repositoryId: repository.githubId,
    number: pr.number,
    baseSha: pr.base.sha,
    headSha: pr.head.sha,
    prUrl: pr.html_url,
    changedFiles: [...changedFiles].sort(),
    truncated,
    fileChanges,
  };
}
