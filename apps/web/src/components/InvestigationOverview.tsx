import { lazy, Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, GitBranch, Network, ShieldCheck, Sparkles } from 'lucide-react';
import { api } from '../api/client';
import { useRepo } from '../pages/Workspace';
import { EntityIcon, EntityInspector } from '../pages/investigations';
import { Badge, Empty, ErrorState, Eyebrow, Loading, Sha, SourceLink, Warnings } from './ui';
import type { GraphSelection } from '../pages/graph/GraphCanvas';
const GraphCanvas = lazy(() => import('../pages/graph/GraphCanvas'));
export default function InvestigationOverview() {
  const { repository, repoId, focus, path } = useRepo();
  const [selection, setSelection] = useState<GraphSelection>(null);
  const records = useQuery({
    queryKey: ['overview-records', repoId, repository.snapshot?.id],
    queryFn: ({ signal }) => api.search(repoId, '', undefined, signal),
    enabled: !!repository.snapshot,
  });
  const root =
    focus ||
    records.data?.items.find((n) => n.kind === 'File' || n.kind === 'FileRevision')?.id ||
    records.data?.items[0]?.id;
  const graph = useQuery({
    queryKey: ['overview-graph', repoId, repository.snapshot?.id, root],
    queryFn: ({ signal }) =>
      api.graph(
        repoId,
        { snapshotId: repository.snapshot!.id, entityId: root!, depth: 2, includeInferred: false },
        signal,
      ),
    enabled: !!repository.snapshot && !!root,
  });
  const selectedEdge =
    selection?.kind === 'edge' ? graph.data?.edges.find((e) => e.id === selection.id) : undefined;
  const graphLink = `${path('graph').split('?')[0]}${root ? `?focus=${encodeURIComponent(root)}` : ''}`;
  return (
    <section className="investigation-atlas">
      <div className="atlas-header">
        <div>
          <Network size={17} />
          <h2>Connected memory</h2>
          <Badge>BOUNDED / 2 HOPS</Badge>
        </div>
        <Link to={graphLink}>
          Open full map <ArrowUpRight size={16} />
        </Link>
      </div>
      <Warnings warnings={graph.data?.warnings} />
      <div className="atlas-body">
        <div className="atlas-field">
          {!repository.snapshot ? (
            <Empty title="The first connection is still ahead">
              An indexed snapshot will bring this map to life.
            </Empty>
          ) : records.isPending ? (
            <Loading text="Locating indexed records" />
          ) : records.isError ? (
            <ErrorState error={records.error} retry={() => records.refetch()} />
          ) : !root ? (
            <Empty title="No indexed records were returned">
              Inspect source coverage or refresh the index.
            </Empty>
          ) : graph.isPending ? (
            <Loading text="Connecting this neighborhood" />
          ) : graph.isError ? (
            <ErrorState error={graph.error} retry={() => graph.refetch()} />
          ) : graph.data.nodes.length ? (
            <Suspense fallback={<Loading text="Opening the memory map" />}>
              <GraphCanvas
                graph={graph.data}
                appearance="dark"
                layout={window.matchMedia('(max-width: 640px)').matches ? 'grid' : 'breadthfirst'}
                selection={selection}
                onSelect={setSelection}
              />
            </Suspense>
          ) : (
            <Empty title="No relationships returned for this record">
              Open the history explorer to choose another starting point.
            </Empty>
          )}
          <div className="atlas-field-footer">
            <span>
              <i />
              RECORDED LINKS & STATIC RELATIONSHIPS
            </span>
            <span>SELECT A RECORD. FOLLOW ITS SOURCE.</span>
          </div>
        </div>
        <aside className="atlas-context">
          {selection?.kind === 'node' ? (
            <EntityInspector
              entityId={selection.id}
              onClose={() => setSelection(null)}
              onNavigate={(id) => setSelection({ kind: 'node', id })}
            />
          ) : selectedEdge ? (
            <div className="atlas-edge">
              <Eyebrow>THE CONNECTION</Eyebrow>
              <h3>{selectedEdge.kind.replaceAll('_', ' ')}</h3>
              <Badge tone={selectedEdge.verification === 'inferred' ? 'orange' : 'blue'}>
                {selectedEdge.verification}
              </Badge>
              <p>
                {selectedEdge.evidenceExcerpt || 'No excerpt was supplied for this relationship.'}
              </p>
              <SourceLink url={selectedEdge.sourceUrl}>Inspect provenance</SourceLink>
              <button onClick={() => setSelection(null)}>
                Return to the snapshot <ArrowRight size={13} />
              </button>
            </div>
          ) : (
            <>
              <div className="atlas-context-heading">
                <Eyebrow>THE INDEXED MOMENT</Eyebrow>
                <ShieldCheck size={18} />
              </div>
              <h3>
                Context has
                <br />a starting point.
              </h3>
              <p>
                Every view belongs to an exact revision. Follow a record to inspect where the
                connection came from.
              </p>
              <dl className="atlas-snapshot">
                <div>
                  <dt>
                    <GitBranch size={13} /> Branch
                  </dt>
                  <dd>{repository.snapshot?.branch || 'Not indexed'}</dd>
                </div>
                <div>
                  <dt>Revision</dt>
                  <dd>
                    <Sha value={repository.snapshot?.headSha} />
                  </dd>
                </div>
                <div>
                  <dt>Observed history</dt>
                  <dd>
                    {repository.snapshot?.historyFrom || 'Not supplied'}
                    <br />
                    {repository.snapshot?.historyTo || ''}
                  </dd>
                </div>
              </dl>
              <Link className="atlas-question" to={path('ask')}>
                <Sparkles size={17} />
                <span>Start with a why</span>
                <ArrowUpRight size={16} />
              </Link>
              <Link className="atlas-secondary-link" to={path('impact')}>
                Investigate a proposed change <ArrowRight size={14} />
              </Link>
            </>
          )}
        </aside>
      </div>
      <div className="atlas-records">
        <Eyebrow>RECENTLY RETURNED RECORDS</Eyebrow>
        <div>
          {records.data?.items.slice(0, 5).map((n) => (
            <button key={n.id} onClick={() => setSelection({ kind: 'node', id: n.id })}>
              <EntityIcon kind={n.kind} size={15} />
              <span>{n.title}</span>
              <ArrowUpRight size={13} />
            </button>
          ))}
        </div>
      </div>
      {graph.data && (
        <details className="atlas-accessible">
          <summary>Inspect this neighborhood with keyboard controls</summary>
          <div>
            {graph.data.nodes.map((node) => (
              <button key={node.id} onClick={() => setSelection({ kind: 'node', id: node.id })}>
                <EntityIcon kind={node.kind} size={14} />
                {node.title}
                <Badge>{node.kind}</Badge>
              </button>
            ))}
          </div>
          <div>
            {graph.data.edges.map((edge) => (
              <button key={edge.id} onClick={() => setSelection({ kind: 'edge', id: edge.id })}>
                {graph.data.nodes.find((node) => node.id === edge.source)?.title} →{' '}
                {graph.data.nodes.find((node) => node.id === edge.target)?.title}
                <Badge>{edge.kind}</Badge>
                <Badge>{edge.verification}</Badge>
              </button>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
