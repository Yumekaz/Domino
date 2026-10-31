import { createHash } from "node:crypto";
import path from "node:path";
import { HistoryError } from "./errors.ts";

export function contentSha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function contentHashJson(value: unknown): string {
  return contentSha256(canonicalJson(value));
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(String(value));
}

export function normalizeRepoPath(input: string): string {
  if (typeof input !== "string" || input.length === 0) {
    throw new HistoryError("INVALID_PATH", "Repository path must be a non-empty string");
  }
  const replaced = input.replace(/\\/g, "/");
  if (replaced.includes("\0")) {
    throw new HistoryError("INVALID_PATH", "Repository path contains a NUL byte");
  }
  if (/^[a-zA-Z]:\//.test(replaced) || replaced.startsWith("/") || replaced.startsWith("//")) {
    throw new HistoryError("INVALID_PATH", `Repository path must be relative: ${input}`);
  }
  const segments = replaced.split("/").filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.length === 0) {
    throw new HistoryError("INVALID_PATH", "Repository path resolves to the repository root");
  }
  if (segments.some((segment) => segment === "..")) {
    throw new HistoryError("INVALID_PATH", `Repository path escapes the repository: ${input}`);
  }
  const normalized = segments.join("/");
  if (/[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new HistoryError("INVALID_PATH", "Repository path contains control characters");
  }
  return normalized;
}

export function resolveWithinRepo(root: string, repoPath: string): string {
  const normalized = normalizeRepoPath(repoPath);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...normalized.split("/"));
  const relative = path.relative(resolvedRoot, resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new HistoryError("INVALID_PATH", `Path escapes the checkout: ${repoPath}`);
  }
  return resolved;
}

const CODE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".md",
  ".mdx",
]);

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".mp4",
  ".mov",
  ".wasm",
]);

const DEFAULT_COCHANGE_EXCLUSIONS = [
  "node_modules/",
  ".git/",
  "dist/",
  "build/",
  "coverage/",
  "vendor/",
  ".github/",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
];

export interface PathFilterOptions {
  extensions?: ReadonlySet<string>;
  excludedPrefixes?: readonly string[];
  excludedExact?: readonly string[];
}

export function extensionOf(repoPath: string): string {
  const base = repoPath.slice(repoPath.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot).toLowerCase();
}

export function isRiskSourcePath(repoPath: string): boolean {
  return CODE_EXTENSIONS.has(extensionOf(repoPath)) && !BINARY_EXTENSIONS.has(extensionOf(repoPath));
}

export function isCodePath(repoPath: string): boolean {
  return [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"].includes(
    extensionOf(repoPath),
  );
}

export function isCoChangeCandidate(repoPath: string, options: PathFilterOptions = {}): boolean {
  const excludedPrefixes = options.excludedPrefixes ?? DEFAULT_COCHANGE_EXCLUSIONS;
  const excludedExact = options.excludedExact ?? [];
  const extensions = options.extensions ?? CODE_EXTENSIONS;
  if (excludedExact.includes(repoPath)) {
    return false;
  }
  if (excludedPrefixes.some((prefix) => repoPath.startsWith(prefix))) {
    return false;
  }
  if (BINARY_EXTENSIONS.has(extensionOf(repoPath))) {
    return false;
  }
  return extensions.has(extensionOf(repoPath));
}

export function isBinaryPath(repoPath: string): boolean {
  return BINARY_EXTENSIONS.has(extensionOf(repoPath));
}

export function isLikelyGeneratedPath(repoPath: string): boolean {
  const lower = repoPath.toLowerCase();
  return (
    lower.endsWith(".min.js") ||
    lower.endsWith(".min.css") ||
    lower.includes("/generated/") ||
    lower.includes("/__generated__/") ||
    lower.endsWith(".g.dart")
  );
}

export function clip(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength))}\n[truncated ${value.length - maxLength} characters]`;
}

export function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
