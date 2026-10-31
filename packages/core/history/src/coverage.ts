import type {
  CoverageReport,
  CoverageStatus,
  CoverageWindow,
  SourceCoverage,
  SourceName,
} from "./types.ts";

export interface SourceCoverageUpdate {
  status?: CoverageStatus;
  pagesFetched?: number;
  items?: number;
  capHit?: boolean;
  warning?: string;
  window?: CoverageWindow | null;
  errorCode?: string;
  errorMessage?: string;
}

export class CoverageBuilder {
  private readonly sources = new Map<SourceName, SourceCoverage>();
  private readonly warnings = new Set<string>();

  private readonly limits: Record<string, number | string | boolean | null>;

  constructor(limits: Record<string, number | string | boolean | null>) {
    this.limits = limits;
  }

  start(source: SourceName, window: CoverageWindow | null = null): void {
    this.sources.set(source, {
      source,
      status: "not_attempted",
      pagesFetched: 0,
      items: 0,
      capHit: false,
      warnings: [],
      window,
    });
  }

  update(source: SourceName, update: SourceCoverageUpdate): void {
    const current = this.sources.get(source);
    const base: SourceCoverage = current ?? {
      source,
      status: "not_attempted",
      pagesFetched: 0,
      items: 0,
      capHit: false,
      warnings: [],
      window: null,
    };
    const next: SourceCoverage = {
      ...base,
      status: update.status ?? base.status,
      pagesFetched: update.pagesFetched ?? base.pagesFetched,
      items: update.items ?? base.items,
      capHit: update.capHit ?? base.capHit,
      window: update.window === undefined ? base.window : update.window,
      warnings: update.warning ? [...base.warnings, update.warning] : base.warnings,
    };
    if (update.errorCode !== undefined) {
      next.errorCode = update.errorCode;
    }
    if (update.errorMessage !== undefined) {
      next.errorMessage = update.errorMessage;
    }
    this.sources.set(source, next);
  }

  finish(
    source: SourceName,
    status: CoverageStatus,
    update: Omit<SourceCoverageUpdate, "status"> = {},
  ): void {
    this.update(source, { ...update, status });
  }

  addWarning(warning: string): void {
    this.warnings.add(warning);
  }

  get(source: SourceName): SourceCoverage | undefined {
    return this.sources.get(source);
  }

  toReport(): CoverageReport {
    const sources: Partial<Record<SourceName, SourceCoverage>> = {};
    for (const [name, coverage] of this.sources) {
      sources[name] = {
        ...coverage,
        warnings: [...coverage.warnings],
      };
    }
    return {
      sources,
      warnings: [...this.warnings],
      limits: { ...this.limits },
    };
  }
}

export function mergeCoverageReports(
  left: CoverageReport,
  right: CoverageReport,
  limits: Record<string, number | string | boolean | null>,
): CoverageReport {
  const sources: Partial<Record<SourceName, SourceCoverage>> = { ...left.sources };
  for (const [name, coverage] of Object.entries(right.sources) as Array<
    [SourceName, SourceCoverage]
  >) {
    sources[name] = {
      ...coverage,
      warnings: [...coverage.warnings],
    };
  }
  return {
    sources,
    warnings: [...new Set([...left.warnings, ...right.warnings])],
    limits: { ...limits },
  };
}

export function coverageIsComplete(report: CoverageReport, sources: readonly SourceName[]): boolean {
  return sources.every((source) => report.sources[source]?.status === "complete");
}
