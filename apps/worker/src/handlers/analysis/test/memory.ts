import type {
  NormalizedStructuralAnalysis,
  StructuralImport,
} from "../../../../../../packages/dependency-adapter/src/types.ts";
import type {
  AnalysisRunRecord,
  AnalysisRunStore,
  CoChangeReader,
  StructuralAnalyzerPort,
  StructuralImportStore,
} from "../types.ts";
import type { CoChangeResult } from "../../../../../../packages/core/impact/src/types.ts";

export const SHA_A = "a".repeat(40);
export const SHA_B = "b".repeat(40);
export const SHA_C = "c".repeat(40);

export function makeEdge(
  importer: string,
  imported: string,
  snapshotSha = SHA_A,
  dynamic = false,
): StructuralImport {
  const specifier = `./${imported.split("/").pop()?.replace(/\.tsx?$/, "")}`;
  return {
    importer,
    imported,
    specifier,
    dependencyTypes: ["import", "local"],
    dynamic,
    circular: false,
    extractor: "dependency-cruiser",
    analyzerVersion: "18.7.0",
    configHash: "e".repeat(64),
    snapshotSha,
    evidence: { type: "import", specifier, line: null },
  };
}

function importKey(edge: StructuralImport): string {
  return JSON.stringify([edge.importer, edge.imported, edge.specifier, edge.dynamic]);
}

export class MemoryImportStore implements StructuralImportStore {
  private readonly records = new Map<string, StructuralImport[]>();
  replaceCalls = 0;
  getCalls = 0;

  private key(repoId: string, snapshotId: string, snapshotSha: string): string {
    return JSON.stringify([repoId, snapshotId, snapshotSha]);
  }

  seed(repoId: string, snapshotId: string, snapshotSha: string, imports: StructuralImport[]): void {
    this.records.set(this.key(repoId, snapshotId, snapshotSha), [...imports]);
  }

  async replaceImports(input: {
    repoId: string;
    snapshotId: string;
    snapshotSha: string;
    imports: readonly StructuralImport[];
    analyzer: { version: string; configHash: string };
  }): Promise<{ stored: number }> {
    this.replaceCalls += 1;
    const key = this.key(input.repoId, input.snapshotId, input.snapshotSha);
    const merged = new Map<string, StructuralImport>();
    for (const edge of this.records.get(key) ?? []) merged.set(importKey(edge), edge);
    for (const edge of input.imports) merged.set(importKey(edge), edge);
    const values = [...merged.values()].sort(
      (left, right) =>
        left.importer.localeCompare(right.importer) ||
        left.imported.localeCompare(right.imported) ||
        left.specifier.localeCompare(right.specifier),
    );
    this.records.set(key, values);
    return { stored: values.length };
  }

  async getImports(input: {
    repoId: string;
    snapshotId: string;
    snapshotSha: string;
  }): Promise<StructuralImport[]> {
    this.getCalls += 1;
    return [...(this.records.get(this.key(input.repoId, input.snapshotId, input.snapshotSha)) ?? [])];
  }
}

export class MemoryRunStore implements AnalysisRunStore {
  private readonly byKey = new Map<string, AnalysisRunRecord>();
  private readonly byId = new Map<string, AnalysisRunRecord>();
  saveCount = 0;

  async getByKey(idempotencyKey: string): Promise<AnalysisRunRecord | null> {
    return this.byKey.get(idempotencyKey) ?? null;
  }

  async get(repoId: string, runId: string): Promise<AnalysisRunRecord | null> {
    const run = this.byId.get(runId);
    return run && run.repoId === repoId ? run : null;
  }

  async save(run: AnalysisRunRecord): Promise<AnalysisRunRecord> {
    const existing = this.byKey.get(run.idempotencyKey);
    if (existing) return existing;
    this.byKey.set(run.idempotencyKey, run);
    this.byId.set(run.id, run);
    this.saveCount += 1;
    return run;
  }
}

export class FakeAnalyzer implements StructuralAnalyzerPort {
  calls = 0;
  private readonly imports: StructuralImport[];
  private readonly metadataSha: string;
  private readonly gaps: NormalizedStructuralAnalysis["gaps"];

  constructor(
    imports: StructuralImport[],
    metadataSha = SHA_A,
    gaps: NormalizedStructuralAnalysis["gaps"] = [],
  ) {
    this.imports = imports;
    this.metadataSha = metadataSha;
    this.gaps = gaps;
  }

  async analyze(input: {
    repositoryId: string;
    snapshotSha: string;
    checkoutDir: string;
    checkoutSha?: string;
  }): Promise<NormalizedStructuralAnalysis> {
    this.calls += 1;
    return {
      metadata: {
        repositoryId: input.repositoryId,
        snapshotSha: this.metadataSha,
        analyzer: "dependency-cruiser",
        version: "18.7.0",
        configHash: "f".repeat(64),
        analyzedAt: "2026-10-31T00:00:00.000Z",
      },
      imports: this.imports,
      gaps: this.gaps,
      excludedModules: [],
      summary: {
        modulesCruised: 4,
        modules: 4,
        dependencies: this.imports.length,
        structuralImports: this.imports.length,
        dynamicImports: this.imports.filter((edge) => edge.dynamic).length,
        circularImports: 0,
        unresolvedImports: this.gaps.filter((gap) => gap.reason === "unresolved").length,
        externalImports: this.gaps.filter((gap) => gap.reason === "external").length,
        nonCodeImports: this.gaps.filter((gap) => gap.reason === "non-code").length,
        excludedModules: 0,
      },
    };
  }
}

export function makeCoChange(
  targetFile = "src/auth.ts",
  file = "src/historical.ts",
): CoChangeResult {
  return {
    targetFile,
    observations: [
      {
        file,
        sharedCommits: 2,
        targetCommits: 3,
        share: 2 / 3,
        commitShas: [SHA_B, SHA_C],
        window: { from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" },
      },
    ],
    coverage: {
      commitsAnalyzed: 8,
      commitsTouchingTarget: 3,
      commitsExcludedOverCap: 0,
      observationsTruncated: 0,
      maxFilesPerCommit: 50,
      minSupport: 2,
      window: { from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" },
      excludedPaths: 0,
      warnings: [],
    },
  };
}

export class FakeCoChange implements CoChangeReader {
  calls: string[] = [];
  private readonly result: CoChangeResult;
  private readonly error?: Error;

  constructor(result: CoChangeResult, error?: Error) {
    this.result = result;
    this.error = error;
  }

  async getCoChange(input: { repoId: string; snapshotId: string; targetFile: string }): Promise<CoChangeResult> {
    this.calls.push(input.targetFile);
    if (this.error) throw this.error;
    return this.result;
  }
}

let runCounter = 0;
export const clock = { now: () => new Date("2026-10-31T10:00:00.000Z") };
export const ids = { runId: () => `run-${++runCounter}` };
