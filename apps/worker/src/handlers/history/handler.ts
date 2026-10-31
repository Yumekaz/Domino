import type { HistoryProgressEvent } from "../../../../../packages/core/history/src/types.ts";
import {
  runHistoryImport,
  type HistoryImportDeps,
  type HistoryImportJob,
  type HistoryImportResult,
} from "./pipeline.ts";

export interface HistoryJobContext {
  signal?: AbortSignal;
  progress?: (event: HistoryProgressEvent) => void | Promise<void>;
}

export interface HistoryImportHandler {
  readonly queue: "history.import";
  handle(job: HistoryImportJob, context?: HistoryJobContext): Promise<HistoryImportResult>;
}

export function createHistoryImportHandler(deps: HistoryImportDeps): HistoryImportHandler {
  return {
    queue: "history.import",
    async handle(job: HistoryImportJob, context: HistoryJobContext = {}) {
      return await runHistoryImport(job, {
        ...deps,
        ...(context.signal === undefined ? {} : { signal: context.signal }),
        ...(context.progress === undefined ? {} : { progress: context.progress }),
      });
    },
  };
}

export { runHistoryImport };
export type { HistoryImportDeps, HistoryImportJob, HistoryImportResult };
