import { HistoryError } from "../../core/history/src/errors.ts";

export interface GithubRemote {
  owner: string;
  repo: string;
  host: "github.com";
  canonicalUrl: string;
  cloneUrl: string;
}

const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

export function parseGithubRemote(input: string): GithubRemote {
  if (typeof input !== "string" || input.length === 0 || input.length > 300) {
    throw new HistoryError("INVALID_REMOTE", "Repository URL must be a non-empty GitHub URL");
  }
  if (/[\u0000-\u001f\u007f\s]/.test(input)) {
    throw new HistoryError("INVALID_REMOTE", "Repository URL contains whitespace or control characters");
  }
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new HistoryError("INVALID_REMOTE", "Repository URL is not a valid absolute URL");
  }
  if (parsed.protocol !== "https:") {
    throw new HistoryError("UNSUPPORTED_REMOTE", "Only https:// public GitHub repository URLs are accepted");
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new HistoryError("INVALID_REMOTE", "Repository URL must not contain credentials");
  }
  if (parsed.port.length > 0 || /^https:\/\/[^/?#]*:/i.test(input)) {
    throw new HistoryError("INVALID_REMOTE", "Repository URL must not specify a port");
  }
  if (parsed.search.length > 0 || parsed.hash.length > 0) {
    throw new HistoryError("INVALID_REMOTE", "Repository URL must not contain a query or fragment");
  }
  if (parsed.hostname.toLowerCase() !== "github.com") {
    throw new HistoryError("UNSUPPORTED_REMOTE", "Only github.com repository URLs are accepted");
  }
  const segments = parsed.pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.length !== 2) {
    throw new HistoryError("INVALID_REMOTE", "Repository URL must identify exactly owner/repository");
  }
  const [owner, rawRepo] = segments;
  const repo = rawRepo.toLowerCase().endsWith(".git") ? rawRepo.slice(0, -4) : rawRepo;
  if (!OWNER_PATTERN.test(owner)) {
    throw new HistoryError("INVALID_REMOTE", "GitHub owner is not a valid account name");
  }
  if (!REPO_PATTERN.test(repo) || repo === "." || repo === "..") {
    throw new HistoryError("INVALID_REMOTE", "GitHub repository name is not valid");
  }
  if (parsed.pathname.endsWith("/")) {
    // A trailing slash is harmless after segment normalization.
  }
  return {
    owner,
    repo,
    host: "github.com",
    canonicalUrl: `https://github.com/${owner}/${repo}`,
    cloneUrl: `https://github.com/${owner}/${repo}.git`,
  };
}

export function assertFullSha(sha: string): string {
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    throw new HistoryError("INVALID_REQUEST", "A full 40-character Git commit SHA is required", {
      details: { receivedLength: sha.length },
    });
  }
  return sha.toLowerCase();
}
