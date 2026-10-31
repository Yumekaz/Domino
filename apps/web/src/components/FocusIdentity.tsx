import { useQuery } from '@tanstack/react-query';
import { ScanLine } from 'lucide-react';
import { api } from '../api/client';
export default function FocusIdentity({ repoId, entityId, snapshotId }: { repoId: string; entityId: string; snapshotId?: string }) {
  const query = useQuery({
    queryKey: ['entity', repoId, snapshotId, entityId],
    queryFn: ({ signal }) => api.entity(repoId, entityId, signal, snapshotId),
    enabled: !!entityId,
  });
  if (!entityId) return null;
  return (
    <span className="focus-identity" title={query.data?.entity.path || entityId}>
      <ScanLine size={12} />
      <span>FOLLOWING</span>
      <b>{query.data?.entity.title || entityId}</b>
    </span>
  );
}
