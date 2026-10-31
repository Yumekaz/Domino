import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  GitBranch,
  Network,
  ShieldCheck,
  Sparkles,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { api } from '../api/client';
import { useRepo } from '../pages/Workspace';
import { EntityIcon, EntityInspector, ImpactResults } from '../pages/investigations';
import { Badge, Empty, ErrorState, Eyebrow, Loading, Sha, SourceLink, Warnings } from './ui';
import SourceLens from './SourceLens';
import type { GraphSelection } from '../pages/graph/GraphCanvas';
import GraphRecords from '../pages/graph/GraphRecords';
const GraphCanvas = lazy(() => import('../pages/graph/GraphCanvas'));
export default function InvestigationOverview() {
  const { repository, repoId, focus, setFocus, path } = useRepo();
  const [selection, setSelection] = useState<GraphSelection>(null);
  const [mapRoot, setMapRoot] = useState(focus);
  const [mode, setMode] = useState<'map' | 'sources' | 'impact'>('map');
  const [expanded, setExpanded] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const studio = useRef<HTMLElement>(null);
  const records = useQuery({
    queryKey: ['overview-records', repoId, repository.snapshot?.id],
    queryFn: ({ signal }) => api.search(repoId, '', undefined, signal),
    enabled: !!repository.snapshot,
  });
  const root =
    mapRoot ||
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
  const select = useCallback(
    (next: GraphSelection) => {
      setSelection(next);
      setMode('map');
      if (next?.kind === 'node') {
        setFocus(next.id);
        if (!graph.data?.nodes.some((node) => node.id === next.id)) setMapRoot(next.id);
      }
    },
    [setFocus, graph.data],
  );
  useEffect(() => {
    studio.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [mode]);
  const recordId = selection?.kind === 'node' ? selection.id : root;
  const record = useQuery({
    queryKey: ['entity', repoId, repository.snapshot?.id, recordId],
    queryFn: ({ signal }) => api.entity(repoId, recordId!, signal, repository.snapshot?.id),
    enabled: !!recordId,
  });
  const impact = useMutation({
    mutationFn: (file: string) =>
      api.impact(repoId, {
        snapshotId: repository.snapshot!.id,
        changedFiles: [file],
        maxDepth: 3,
      }),
  });
  const file = record.data?.entity.path;
  const isFile = ['File', 'FileRevision'].includes(record.data?.entity.kind || '');
  const recordPath = (page: string) =>
    `${path(page).split('?')[0]}${recordId ? `?focus=${encodeURIComponent(recordId)}` : ''}`;
  const selectedEdge =
    selection?.kind === 'edge' ? graph.data?.edges.find((e) => e.id === selection.id) : undefined;
  const graphLink = recordPath('graph');
  return (
    <section
      ref={studio}
      className={`investigation-atlas investigation-studio mode-${mode} ${expanded ? 'is-expanded' : ''}`}
      aria-label="Investigation studio"
      onKeyDown={(event) => {
        if (expanded && event.key === 'Escape') {
          setExpanded(false);
          event.stopPropagation();
        }
        if (expanded && event.key === 'Tab') {
          const targets = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary',
            ),
          ).filter((element) => element.getClientRects().length);
          const first = targets[0];
          const last = targets.at(-1);
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
      <div className="atlas-header">
        <div>
          <Network size={17} />
          <h2>Connected memory</h2>
          <Badge>BOUNDED / 2 HOPS</Badge>
          <button
            className="studio-expand"
            aria-pressed={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}{' '}
            {expanded ? 'Close focus view' : 'Enter focus view'}
          </button>
        </div>
        <Link to={graphLink}>
          Open full map <ArrowUpRight size={16} />
        </Link>
      </div>
      <div className="studio-command">
        <div className="studio-selected">
          <span>IN FOCUS</span>
          <strong>{record.data?.entity.title || 'Choose a record'}</strong>
          {file && <code>{file}</code>}
        </div>
        <div className="studio-modes" aria-label="Investigation sequence">
          <button aria-pressed={mode === 'map'} onClick={() => setMode('map')}>
            <span>01</span> Locate
          </button>
          <button
            aria-pressed={mode === 'sources'}
            disabled={!recordId}
            onClick={() => setMode('sources')}
          >
            <span>02</span> Inspect evidence
          </button>
          <button
            aria-pressed={mode === 'impact'}
            disabled={!isFile || !file || !repository.snapshot || impact.isPending}
            title={
              !isFile
                ? 'Select an indexed file to trace its possible impact'
                : 'Request impact analysis for the selected file'
            }
            onClick={() => {
              if (!file) return;
              setMode('impact');
              impact.mutate(file);
            }}
          >
            <span>03</span> Trace consequences <ArrowRight size={13} />
          </button>
        </div>
      </div>
      <Warnings warnings={graph.data?.warnings} />
      {mode === 'sources' ? (
        <div className="studio-source-view studio-transition">
          <div className="studio-source-origin">
            <Eyebrow>THE SELECTED RECORD</Eyebrow>
            <EntityIcon kind={record.data?.entity.kind || 'File'} size={35} />
            <h3>{record.data?.entity.title}</h3>
            {file && <code>{file}</code>}
            <p>
              Inspect the source records attached to this selection. An excerpt shows what was
              recorded; interpretation remains a separate step.
            </p>
            <Link to={recordPath('ask')}>
              Ask about this record <ArrowUpRight size={16} />
            </Link>
            <button onClick={() => setMode('map')}>
              Return to the connected map <ArrowRight size={14} />
            </button>
          </div>
          {record.isPending ? (
            <Loading text="Retrieving original sources" />
          ) : record.isError ? (
            <ErrorState error={record.error} retry={() => record.refetch()} />
          ) : (
            <SourceLens sources={record.data.sources} id="studio-source" />
          )}
        </div>
      ) : mode === 'impact' ? (
        <div className="studio-impact studio-transition">
          <div className="studio-impact-heading">
            <Eyebrow>FROM RECORD TO POSSIBLE CONSEQUENCE</Eyebrow>
            <h3>{file}</h3>
            <Link to={recordPath('impact')}>
              Open full investigation <ArrowUpRight size={15} />
            </Link>
          </div>
          {impact.isPending ? (
            <Loading text="Tracing returned dependency paths" />
          ) : impact.isError ? (
            <ErrorState error={impact.error} retry={() => file && impact.mutate(file)} />
          ) : impact.data ? (
            <ImpactResults key={impact.submittedAt} result={impact.data} />
          ) : (
            <Empty title="Choose an indexed file">
              The analysis needs a selected file and an indexed snapshot.
            </Empty>
          )}
        </div>
      ) : (
        <div className="atlas-body studio-transition">
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
                  layout="fcose"
                  rootId={root}
                  selection={selection}
                  onSelect={select}
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
                onNavigate={(id) => select({ kind: 'node', id })}
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
                <Link className="atlas-question" to={recordPath('ask')}>
                  <Sparkles size={17} />
                  <span>Start with a why</span>
                  <ArrowUpRight size={16} />
                </Link>
                <Link className="atlas-secondary-link" to={recordPath('impact')}>
                  Investigate a proposed change <ArrowRight size={14} />
                </Link>
              </>
            )}
          </aside>
        </div>
      )}
      <div className="atlas-records">
        <Eyebrow>RECENTLY RETURNED RECORDS</Eyebrow>
        <div>
          {records.data?.items.slice(0, 5).map((n) => (
            <button
              key={n.id}
              onClick={() => {
                select({ kind: 'node', id: n.id });
                setMode('map');
              }}
            >
              <EntityIcon kind={n.kind} size={15} />
              <span>{n.title}</span>
              <ArrowUpRight size={13} />
            </button>
          ))}
        </div>
      </div>
      {graph.data && (
        <details
          className="atlas-accessible"
          open={recordsOpen}
          onToggle={(event) => setRecordsOpen(event.currentTarget.open)}
        >
          <summary>Inspect this neighborhood with keyboard controls</summary>
          {recordsOpen && <GraphRecords graph={graph.data} onSelect={select} />}
        </details>
      )}
    </section>
  );
}
