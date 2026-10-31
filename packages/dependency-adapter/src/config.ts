import { createHash } from "node:crypto";
import type { AnalyzerConfig } from "./types.ts";

export const ANALYZER_VERSION = "18.7.0";
export const EXTRACTOR = "dependency-cruiser" as const;
export const DEFAULT_EXCLUDE_PATTERN =
  "(^|/)(node_modules|dist|build|out|coverage|vendor|__generated__|generated|\\.git|\\.next|\\.cache)(/|$)";

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export function hashAnalyzerConfiguration(version: string, config: unknown): string {
  return createHash("sha256")
    .update(stableStringify({ analyzer: EXTRACTOR, version, config }))
    .digest("hex");
}

export function buildDependencyCruiserConfig(input: {
  tsConfigPath?: string;
  excludePattern?: string;
} = {}): AnalyzerConfig {
  return {
    forbidden: [],
    options: {
      parser: "tsc",
      tsPreCompilationDeps: true,
      doNotFollow: { path: "node_modules" },
      exclude: { path: input.excludePattern ?? DEFAULT_EXCLUDE_PATTERN },
      ...(input.tsConfigPath ? { tsConfig: { fileName: input.tsConfigPath } } : {}),
    },
  };
}
