export type DependencyCruiserDependency = {
  dynamic?: boolean;
  module: string;
  moduleSystem?: string;
  dependencyTypes?: string[];
  resolved?: string;
  coreModule?: boolean;
  followable?: boolean;
  couldNotResolve?: boolean;
  matchesDoNotFollow?: boolean;
  circular?: boolean;
  cycle?: { name: string; dependencyTypes?: string[] }[];
  valid?: boolean;
};

export type DependencyCruiserModule = {
  source: string;
  dependencies?: DependencyCruiserDependency[];
};

export type DependencyCruiserOutput = {
  modules: DependencyCruiserModule[];
  summary?: {
    totalCruised?: number;
    totalDependenciesCruised?: number;
    error?: number;
    warn?: number;
    info?: number;
    ignore?: number;
    [key: string]: unknown;
  };
};

export type AnalyzerMetadata = {
  repositoryId: string;
  snapshotSha: string;
  analyzer: "dependency-cruiser";
  version: string;
  configHash: string;
  analyzedAt: string;
};

export type ImportEvidence = {
  type: "import";
  specifier: string;
  line: number | null;
};

export type StructuralImport = {
  importer: string;
  imported: string;
  specifier: string;
  dependencyTypes: string[];
  dynamic: boolean;
  circular: boolean;
  extractor: string;
  analyzerVersion: string;
  configHash: string;
  snapshotSha: string;
  evidence: ImportEvidence;
};

export type AnalyzerGapReason = "unresolved" | "external" | "non-code" | "excluded";

export type AnalyzerGap = {
  importer: string;
  specifier: string;
  reason: AnalyzerGapReason;
  dynamic: boolean;
};

export type NormalizedStructuralAnalysis = {
  metadata: AnalyzerMetadata;
  /** Analysis limitations introduced by a degraded analyzer configuration. */
  limitations?: string[];
  imports: StructuralImport[];
  gaps: AnalyzerGap[];
  excludedModules: string[];
  summary: {
    modulesCruised: number;
    modules: number;
    dependencies: number;
    structuralImports: number;
    dynamicImports: number;
    circularImports: number;
    unresolvedImports: number;
    externalImports: number;
    nonCodeImports: number;
    excludedModules: number;
  };
};

export type AnalyzerConfig = {
  forbidden: unknown[];
  options: {
    parser: "tsc";
    tsPreCompilationDeps: true;
    doNotFollow: { path: string };
    exclude: { path: string };
    tsConfig?: { fileName: string };
  };
};
