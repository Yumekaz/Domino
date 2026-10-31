import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { snapshotSearchKey } from './search-key';

describe('snapshot-scoped search', () => {
  it.each(['search', 'graph-search', 'command-search'] as const)(
    'fetches a fresh first page for %s after the snapshot changes',
    async (scope) => {
      const client = new QueryClient();
      client.setQueryData(snapshotSearchKey(scope, 'repo', 'old-snapshot', 'index'), {
        pages: [{ items: ['old'], nextCursor: 'old-snapshot-cursor' }],
        pageParams: [undefined],
      });
      const fetchPage = vi.fn(async ({ pageParam }: { pageParam: string | undefined }) => ({
        items: ['new'],
        nextCursor: null,
        requestedCursor: pageParam,
      }));
      const result = await client.fetchInfiniteQuery({
        queryKey: snapshotSearchKey(scope, 'repo', 'new-snapshot', 'index'),
        initialPageParam: undefined as string | undefined,
        queryFn: fetchPage,
        getNextPageParam: (last: { nextCursor: string | null }) => last.nextCursor ?? undefined,
      });
      expect(result.pages[0].items).toEqual(['new']);
      expect(result.pages[0].requestedCursor).toBeUndefined();
      expect(fetchPage).toHaveBeenCalledTimes(1);
      client.clear();
    },
  );
});
