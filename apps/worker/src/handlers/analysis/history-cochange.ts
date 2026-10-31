import type { CoChangeConsumerPort } from "../../../../../packages/core/history/src/ports.ts";
import type { CoChangeResult } from "../../../../../packages/core/impact/src/types.ts";
import type { CoChangeReader } from "./types.ts";

export type CoChangeQueryOptions = {
  minSupport: number;
  maxResults: number;
  maxFilesPerCommit: number;
};

export const DEFAULT_COCHANGE_QUERY: CoChangeQueryOptions = {
  minSupport: 2,
  maxResults: 20,
  maxFilesPerCommit: 50,
};

/**
 * Adapts B's observed-co-change consumer port to C's analysis port.
 * B computes the association; C never derives it from import paths.
 */
export function createHistoryCoChangeReader(
  port: CoChangeConsumerPort,
  options: CoChangeQueryOptions = DEFAULT_COCHANGE_QUERY,
): CoChangeReader {
  return {
    getCoChange: ({ repoId, snapshotId, targetFile }): Promise<CoChangeResult> =>
      port.getCoChange(repoId, snapshotId, targetFile, options),
  };
}
