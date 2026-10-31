import {
  impactSchema,
  type Impact as ContractImpact,
} from "../../../contracts/src/index.ts";
import { ImpactError, type ImpactResult } from "./types.ts";

/**
 * Maps C's domain impact result to A's accepted shared impact contract.
 * Structural paths and historical associations remain separate signals in the
 * contract's affected array. Invalid proof is rejected rather than coerced.
 */
export function toContractImpact(result: ImpactResult): ContractImpact {
  const structural = result.affected.map((item) => ({
    file: item.file,
    signal: item.signal,
    depth: item.depth,
    path: item.path,
    impact: item.impact,
    explanation: item.explanation,
    evidence: item.evidence.map((hop) => ({
      type: hop.dynamic ? "dynamic_import" : "import",
      file: hop.importer,
      ...(typeof hop.line === "number" && hop.line > 0 ? { line: hop.line } : {}),
    })),
  }));

  const associations = result.associations.map((item) => ({
    file: item.file,
    signal: "historically_coupled" as const,
    depth: 0,
    path: [item.file, item.targetFile],
    impact: "possible" as const,
    explanation: `Historical co-change: ${item.sharedCommits} of ${item.targetCommits} indexed commit(s) touching ${item.targetFile} also changed ${item.file}. This is an association, not an import path.`,
    evidence: [],
    cochange: {
      sampleSize: item.targetCommits,
      targetCommits: item.targetCommits,
      windowFrom: item.window.from,
      windowTo: item.window.to,
    },
  }));

  const parsed = impactSchema.safeParse({
    changedFiles: result.changedFiles,
    snapshotSha: result.snapshotSha,
    affected: [...structural, ...associations],
    warnings: result.warnings,
    truncated: result.coverage.truncated,
  });
  if (!parsed.success) {
    throw new ImpactError(
      "INVALID_INPUT",
      `The impact result does not match the shared contract: ${parsed.error.issues[0]?.message ?? "unknown issue"}`,
    );
  }
  return parsed.data;
}
