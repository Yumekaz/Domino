export const CODE_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
]);

const EXCLUDED_SEGMENTS = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "vendor",
  "__generated__",
  "generated",
  ".git",
  ".next",
  ".nuxt",
  ".cache",
  ".turbo",
  ".venv",
  "venv",
]);

const GENERATED_SUFFIXES = [
  /\.min\.(?:js|mjs|cjs)$/i,
  /\.bundle\.(?:js|mjs|cjs)$/i,
  /\.generated\.[a-z0-9]+$/i,
  /\.gen\.[a-z0-9]+$/i,
  /\.d\.(?:ts|mts|cts)$/i,
];

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".bmp",
  ".tiff",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".wasm",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".jar",
  ".class",
  ".mp3",
  ".mp4",
  ".mov",
  ".avi",
  ".webm",
  ".sqlite",
  ".db",
]);

/** Normalizes a repository-relative path, or returns null for unsafe/absolute values. */
export function normalizeRepoRelativePath(value: string): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\\/g, "/");
  if (!trimmed || trimmed.length > 1024 || trimmed.includes("\0")) return null;
  const withoutPrefix = trimmed.replace(/^\.\//, "");
  if (withoutPrefix.startsWith("/") || /^[A-Za-z]:\//.test(withoutPrefix)) return null;
  const segments = withoutPrefix.split("/");
  if (segments.some((segment) => segment === ".." || segment === "")) return null;
  return segments.join("/");
}

function extensionOf(value: string): string {
  const index = value.lastIndexOf(".");
  return index === -1 ? "" : value.slice(index).toLowerCase();
}

export function isExcludedStructuralPath(value: string): boolean {
  const normalized = normalizeRepoRelativePath(value);
  if (!normalized) return true;
  const segments = normalized.toLowerCase().split("/");
  if (segments.some((segment) => EXCLUDED_SEGMENTS.has(segment))) return true;
  return GENERATED_SUFFIXES.some((pattern) => pattern.test(normalized));
}

export function isCodeFile(value: string): boolean {
  const normalized = normalizeRepoRelativePath(value);
  if (!normalized) return false;
  return CODE_EXTENSIONS.has(extensionOf(normalized));
}

export function isBinaryFile(value: string): boolean {
  const normalized = normalizeRepoRelativePath(value);
  if (!normalized) return false;
  return BINARY_EXTENSIONS.has(extensionOf(normalized));
}

export function isDocFile(value: string): boolean {
  const normalized = normalizeRepoRelativePath(value);
  if (!normalized) return false;
  return /\.(?:md|mdx|txt|adoc|rst)$/i.test(normalized);
}
