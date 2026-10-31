import { lazy, Suspense, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Expand, Network, Search, Maximize2, Minimize2 } from 'lucide-react';
import { graphRecordColors } from './network-elements';
import { returnedEntityKinds } from '../../api/entity-kinds';
import { api, fixtureMode } from '../../api/client';
import { fixtureAuthId } from '../../dev/fixtureIds';
import type { Graph } from '../../api/schemas';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Eyebrow,
  Loading,
  PageTitle,
  Sha,
  SourceLink,
  Warnings,
} from '../../components/ui';
import { useRepo } from '../Workspace';
import { EntityIcon, EntityInspector } from '../investigations';
import type { GraphSelection } from './GraphCanvas';
const GraphCanvas = lazy(() => import('./GraphCanvas'));
export default function GraphPage() {
  const { repoId, repository, focus, setFocus } = useRepo();
  const [selection, setSelection] = useState<GraphSelection>(null);
  const [expanded, setExpanded] = useState(false);
  const [depth, setDepth] = useState<1 | 2 | 3>(2);
  const [domain, setDomain] = useState('all');
  const [kind, setKind] = useState('all');
  const [relationship, setRelationship] = useState('all');
  const [verification, setVerification] = useState('all');
  const [date, setDate] = useState('');
  const [inferred, setInferred] = useState(false);
  const [layout, setLayout] = useState('fcose');
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const root = focus || (fixtureMode ? fixtureAuthId : '');
  const searchQuery = useInfiniteQuery({
    queryKey: ['graph-search', repoId, term],
    queryFn: ({ pageParam, signal }) => api.search(repoId, term, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor || undefined,
    enabled: !!term,
  });
  const searchResults = searchQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const query = useQuery({
    queryKey: ['graph', repoId, repository.snapshot?.id, root, depth, inferred],
    queryFn: ({ signal }) =>
      api.graph(
        repoId,
        { snapshotId: repository.snapshot!.id, entityId: root, depth, includeInferred: inferred },
        signal,
      ),
    enabled: !!repository.snapshot && !!root,
  });
  const graph = useMemo<Graph | null>(() => {
    if (!query.data) return null;
    const structural = ['IMPORTS', 'DEPENDS_ON', 'POSSIBLY_AFFECTS'];
    let edges = query.data.edges.filter(
      (e) =>
        (domain === 'all' ||
          (domain === 'structure' ? structural.includes(e.kind) : !structural.includes(e.kind))) &&
        (verification === 'all' || e.verification === verification) &&
        (relationship === 'all' || e.kind === relationship) &&
        (!date || (!!e.observedAt && e.observedAt >= date)),
    );
    const nodes = query.data.nodes.filter(
      (n) =>
        (kind === 'all' || n.kind === kind) &&
        (domain === 'all' || edges.some((e) => e.source === n.id || e.target === n.id)),
    );
    const ids = new Set(nodes.map((n) => n.id));
    edges = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    return { ...query.data, nodes, edges };
  }, [query.data, domain, verification, date, kind, relationship]);
  const edge =
    selection?.kind === 'edge' ? graph?.edges.find((e) => e.id === selection.id) : undefined;
  return (
    <section
      className={`memory-network-page ${expanded ? 'graph-is-expanded' : ''}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setExpanded(false);
        if (expanded && event.key === 'Tab') {
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),summary',
            ),
          ).filter((element) => element.getClientRects().length);
          const first = controls[0],
            last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <PageTitle
        number="05"
        title="Nothing is isolated"
        description="Explore a bounded neighborhood. Every relationship keeps its origin attached."
        action={
          <Button variant="secondary" onClick={() => setExpanded(!expanded)}>
            {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            {expanded ? 'Close map focus' : 'Expand map'}
          </Button>
        }
      />
      <form
        className="graph-search-form"
        onSubmit={(e) => {
          e.preventDefault();
          setTerm(search.trim());
        }}
      >
        <Search size={17} />
        <label htmlFor="graph-root" className="sr-only">
          Find a graph starting point
        </label>
        <input
          id="graph-root"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Find a file, PR, issue, or contributor to focus…"
        />
        <Button variant="secondary">Find a starting point</Button>
      </form>
      {searchQuery.isPending && searchQuery.isFetching ? (
        <Loading text="Finding graph starting points" />
      ) : searchQuery.isError && !searchQuery.data ? (
        <ErrorState error={searchQuery.error} />
      ) : (
        term && (
          <div className="graph-search-results">
            {searchResults.length ? (
              searchResults.map((n) => (
                <button
                  key={n.id}
                  aria-label={`${n.title} — ${n.kind}`}
                  onClick={() => {
                    setFocus(n.id);
                    setSelection({ kind: 'node', id: n.id });
                    setTerm('');
                  }}
                >
                  <EntityIcon kind={n.kind} />
                  {n.title}
                  <ArrowUpRight size={14} />
                </button>
              ))
            ) : (
              <p>No matching indexed records.</p>
            )}
            {searchQuery.isFetchNextPageError && (
              <ErrorState error={searchQuery.error} retry={() => searchQuery.fetchNextPage()} />
            )}
            {searchQuery.hasNextPage && (
              <Button
                variant="secondary"
                disabled={searchQuery.isFetchingNextPage}
                onClick={() => void searchQuery.fetchNextPage()}
              >
                {searchQuery.isFetchingNextPage ? 'Loading…' : 'Load more starting points'}
              </Button>
            )}
          </div>
        )
      )}
      <div className="graph-toolbar">
        <div className="segmented">
          <button aria-pressed={domain === 'all'} onClick={() => setDomain('all')}>
            Connected
          </button>
          <button aria-pressed={domain === 'history'} onClick={() => setDomain('history')}>
            Historical
          </button>
          <button aria-pressed={domain === 'structure'} onClick={() => setDomain('structure')}>
            Structural
          </button>
        </div>
        <label>
          Hops{' '}
          <select value={depth} onChange={(e) => setDepth(Number(e.target.value) as 1 | 2 | 3)}>
            {[1, 2, 3].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label>
          Layout{' '}
          <select value={layout} onChange={(e) => setLayout(e.target.value)}>
            <option value="fcose">Spatial network</option>
            <option value="concentric">Radial focus</option>
            <option value="breadthfirst">Layered paths</option>
            <option value="circle">Circular</option>
            <option value="grid">Grid</option>
          </select>
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={inferred}
            onChange={(e) => setInferred(e.target.checked)}
          />
          Include inferred
        </label>
      </div>
      <details className="graph-filters">
        <summary>Filter visible records and relationships</summary>
        <div>
          <label>
            Record type{' '}
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="all">All types</option>
              {returnedEntityKinds(query.data?.nodes || []).map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label>
            Relationship type{' '}
            <select value={relationship} onChange={(e) => setRelationship(e.target.value)}>
              <option value="all">All relationships</option>
              {[...new Set(query.data?.edges.map((e) => e.kind) || [])].map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label>
            Verification{' '}
            <select value={verification} onChange={(e) => setVerification(e.target.value)}>
              <option value="all">All classes</option>
              {['observed', 'derived', 'inferred'].map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label>
            Relationships observed since{' '}
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <span>
            Display filters apply to this bounded neighborhood. Undated edges are excluded by a date
            filter.
          </span>
        </div>
      </details>
      {!repository.snapshot ? (
        <Empty title="A snapshot is required">
          Index repository history before opening the graph.
        </Empty>
      ) : !root ? (
        <Empty title="Choose the first connection">
          Find a starting record above, or open the graph from connected history.
        </Empty>
      ) : query.isPending ? (
        <Loading text="Loading a bounded graph neighborhood" />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => query.refetch()} />
      ) : (
        graph && (
          <>
            <Warnings warnings={graph.warnings} />
            {graph.truncated && (
              <div className="bounded-note">
                <Network size={15} />
                This is a bounded neighborhood. Expand a record to request more connections.
              </div>
            )}
            <div className="network-map-heading">
              <div>
                <strong>The connected neighborhood</strong>
                <span>Explore the relationships. Select a record to inspect its source.</span>
              </div>
              <Badge>
                {layout === 'fcose'
                  ? 'SPATIAL VIEW'
                  : layout === 'concentric'
                    ? 'RADIAL FOCUS'
                    : 'STRUCTURED LAYOUT'}
              </Badge>
            </div>
            <div className={`graph-layout ${selection ? 'with-selection' : ''}`}>
              <section className="graph-board">
                {graph.nodes.length ? (
                  <Suspense fallback={<Loading text="Preparing graph renderer" />}>
                    <GraphCanvas
                      graph={graph}
                      rootId={root}
                      appearance="dark"
                      layout={layout}
                      selection={selection}
                      onSelect={setSelection}
                    />
                  </Suspense>
                ) : (
                  <Empty title="No records match these filters">
                    Widen the visible types, date, or relationship class.
                  </Empty>
                )}
                <div className="graph-legend">
                  {[...new Set(graph.nodes.map((node) => node.kind))].map((recordKind) => (
                    <span key={recordKind}>
                      <i style={{ background: graphRecordColors[recordKind] || '#9fb1c7' }} />
                      {recordKind.replace(/([a-z])([A-Z])/g, '$1 $2')}
                    </span>
                  ))}
                  <span>— Observed</span>
                  <span>··· Derived</span>
                  <span>– – Inferred</span>
                </div>
              </section>
              {selection?.kind === 'node' ? (
                <div>
                  <Button
                    variant="secondary"
                    className="expand-button"
                    onClick={() => {
                      setFocus(selection.id);
                      setDepth(Math.min(3, depth + 1) as 1 | 2 | 3);
                    }}
                  >
                    <Expand size={15} />
                    Expand from this record
                  </Button>
                  <EntityInspector
                    entityId={selection.id}
                    onClose={() => setSelection(null)}
                    onNavigate={(id) => setSelection({ kind: 'node', id })}
                  />
                </div>
              ) : edge ? (
                <aside className="edge-inspector">
                  <Eyebrow>RELATIONSHIP PROVENANCE</Eyebrow>
                  <h2>{edge.kind.replaceAll('_', ' ')}</h2>
                  <Badge tone={edge.verification === 'inferred' ? 'orange' : 'blue'}>
                    {edge.verification}
                  </Badge>
                  <p>
                    {graph.nodes.find((n) => n.id === edge.source)?.title} →{' '}
                    {graph.nodes.find((n) => n.id === edge.target)?.title}
                  </p>
                  <blockquote>
                    {edge.evidenceExcerpt || 'No excerpt was returned for this relationship.'}
                  </blockquote>
                  <dl>
                    <dt>Extractor</dt>
                    <dd>{edge.extractor || 'Not supplied'}</dd>
                    <dt>Revision</dt>
                    <dd>
                      <Sha value={edge.snapshotSha} />
                    </dd>
                    <dt>Observed</dt>
                    <dd>{edge.observedAt || 'Not supplied'}</dd>
                  </dl>
                  <SourceLink url={edge.sourceUrl}>Open relationship source</SourceLink>
                  {edge.sourceEntityId && (
                    <Button
                      variant="secondary"
                      onClick={() => setSelection({ kind: 'node', id: edge.sourceEntityId! })}
                    >
                      Inspect source record
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => setSelection(null)}>
                    Clear selection
                  </Button>
                </aside>
              ) : null}
            </div>
            <details className="graph-accessible-list">
              <summary>Keyboard-accessible graph records and relationships</summary>
              <h3>Records in this neighborhood</h3>
              <div>
                {graph.nodes.map((n) => (
                  <button key={n.id} onClick={() => setSelection({ kind: 'node', id: n.id })}>
                    <EntityIcon kind={n.kind} />
                    {n.title}
                    <Badge>{n.kind}</Badge>
                  </button>
                ))}
              </div>
              <h3>Relationships in this neighborhood</h3>
              <div>
                {graph.edges.map((e) => (
                  <button key={e.id} onClick={() => setSelection({ kind: 'edge', id: e.id })}>
                    {graph.nodes.find((n) => n.id === e.source)?.title} →{' '}
                    {graph.nodes.find((n) => n.id === e.target)?.title}
                    <Badge>{e.kind}</Badge>
                    <Badge>{e.verification}</Badge>
                  </button>
                ))}
              </div>
            </details>
          </>
        )
      )}
    </section>
  );
}
