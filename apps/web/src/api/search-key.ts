/** Search cursors and results belong to a particular indexed snapshot. */
export function snapshotSearchKey(scope: 'search' | 'graph-search' | 'command-search', repoId: string, snapshotId: string | undefined, term: string) {
  return [scope, repoId, snapshotId, term] as const;
}
