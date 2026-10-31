import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  ArrowUpRight,
  Braces,
  Check,
  ChevronRight,
  FileCode2,
  GitCommitHorizontal,
  GitPullRequest,
  HelpCircle,
  History,
  Network,
  Search,
  Shield,
  Sparkles,
  MessageSquare,
  Lightbulb,
  Boxes,
  FolderGit2,
  X,
} from 'lucide-react';
import { returnedEntityKinds } from '../api/entity-kinds';
import { impactPresentation, hasStructuralPath } from '../components/impact-presentation';
import { api, fixtureMode } from '../api/client';
import { hasValidCitations, type Impact } from '../api/schemas';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Eyebrow,
  Loading,
  PageTitle,
  SectionLabel,
  Sha,
  SourceLink,
  SourceList,
  Warnings,
} from '../components/ui';
import { useRepo } from './Workspace';
import ImpactAtlas from '../components/ImpactAtlas';
import SourceLens from '../components/SourceLens';
import KnowledgeLedger from '../components/KnowledgeLedger';
import RevisionBridge from '../components/RevisionBridge';

export function EntityIcon({ kind, size = 18 }: { kind: string; size?: number }) {
  if (kind === 'DiscussionComment') return <MessageSquare size={size} />;
  if (kind === 'Decision') return <Lightbulb size={size} />;
  if (kind === 'Module') return <Boxes size={size} />;
  if (kind === 'Repository') return <FolderGit2 size={size} />;
  const Icon =
    kind === 'PullRequest'
      ? GitPullRequest
      : kind === 'Commit'
        ? GitCommitHorizontal
        : kind === 'File' || kind === 'FileRevision'
          ? FileCode2
          : kind === 'Contributor'
            ? Shield
            : kind === 'Issue'
              ? HelpCircle
              : Braces;
  return <Icon size={size} />;
}
export function EntityInspector({
  entityId,
  onClose,
  onNavigate,
}: {
  entityId: string;
  onClose?: () => void;
  onNavigate?: (id: string) => void;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (window.matchMedia('(max-width: 900px)').matches)
      panel.current?.scrollIntoView({ block: 'start' });
  }, [entityId]);
  const { repoId, setFocus, path } = useRepo();
  const query = useQuery({
    queryKey: ['entity', repoId, entityId],
    queryFn: ({ signal }) => api.entity(repoId, entityId, signal),
    enabled: !!entityId,
  });
  return (
    <aside ref={panel} className="entity-inspector" aria-label="Entity evidence">
      <div className="inspector-heading">
        <Eyebrow>EVIDENCE INSPECTOR</Eyebrow>
        {onClose && (
          <button className="icon-button" onClick={onClose} aria-label="Close evidence inspector">
            <X size={17} />
          </button>
        )}
      </div>
      {query.isPending ? (
        <Loading text="Retrieving source detail" />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => query.refetch()} />
      ) : (
        <>
          <Badge tone="blue">{query.data.entity.kind}</Badge>
          <h2>{query.data.entity.title}</h2>
          {query.data.entity.path && <code className="file-path">{query.data.entity.path}</code>}
          {query.data.entity.date && <time>{query.data.entity.date}</time>}
          {query.data.entity.excerpt && <p>{query.data.entity.excerpt}</p>}
          <SourceLink url={query.data.entity.sourceUrl}>Open original record</SourceLink>
          <SourceList sources={query.data.sources} />
          <SectionLabel>Follow the relationships</SectionLabel>
          <div className="neighbor-list">
            {query.data.neighbors.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  setFocus(n.id);
                  onNavigate?.(n.id);
                }}
              >
                <EntityIcon kind={n.kind} />
                <span>{n.title}</span>
                <ChevronRight size={15} />
              </button>
            ))}
          </div>
          {query.data.edges.map((edge) => (
            <div className="relation-proof" key={edge.id}>
              <Badge tone={edge.verification === 'inferred' ? 'orange' : 'neutral'}>
                {edge.verification}
              </Badge>
              <code>{edge.kind}</code>
              {edge.evidenceExcerpt && <p>{edge.evidenceExcerpt}</p>}
              <SourceLink url={edge.sourceUrl}>Relationship provenance</SourceLink>
            </div>
          ))}
          <Link
            className="button button-secondary"
            to={`${path('graph').split('?')[0]}?focus=${encodeURIComponent(entityId)}`}
          >
            <Network size={16} /> Explore in graph
          </Link>
          <Link
            className="button button-secondary"
            to={`${path('ask').split('?')[0]}?focus=${encodeURIComponent(entityId)}`}
          >
            <Sparkles size={16} /> Ask about this record
          </Link>
          <Link
            className="button button-secondary"
            to={`${path('history').split('?')[0]}?focus=${encodeURIComponent(entityId)}`}
          >
            <History size={16} /> Open connected history
          </Link>
        </>
      )}
    </aside>
  );
}
export function HistoryPage() {
  const { repoId, focus, setFocus } = useRepo();
  const [params] = useSearchParams();
  const [input, setInput] = useState(params.get('q') || '');
  const [q, setQ] = useState(input);
  const [kind, setKind] = useState('all');
  const query = useInfiniteQuery({
    queryKey: ['search', repoId, q],
    queryFn: ({ pageParam, signal }) => api.search(repoId, q, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor || undefined,
  });
  const items = (query.data?.pages.flatMap((p) => p.items) || [])
    .filter((e) => kind === 'all' || e.kind === kind)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return (
    <>
      <PageTitle
        number="02"
        title="Follow the thread"
        description="Find the record. Follow its relationships. Inspect the original evidence."
      />
      <form
        className="search-form"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(input);
        }}
      >
        <Search size={20} />
        <label className="sr-only" htmlFor="history-search">
          Search connected history
        </label>
        <input
          autoComplete="off"
          id="history-search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="A file, a decision, a pull request…"
        />
        <Button>
          Find connections <ArrowRight size={16} />
        </Button>
      </form>
      <div className="history-toolbar">
        <div className="flex items-center gap-2">
          <History size={16} />
          <span>Indexed history</span>
        </div>
        <label>
          Type{' '}
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="all">All record types</option>
            {returnedEntityKinds(items).map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
      </div>
      <div className={`investigation-split ${focus ? 'has-inspector' : ''}`}>
        <section>
          {query.isPending ? (
            <Loading text="Finding connected records" />
          ) : query.isError ? (
            <ErrorState error={query.error} retry={() => query.refetch()} />
          ) : !items.length ? (
            <Empty title="No indexed records found">
              Try a narrower term or another record type. Missing records are not proof of missing
              history.
            </Empty>
          ) : (
            <div className="timeline">
              {items.map((entity) => (
                <button
                  className={`timeline-item ${focus === entity.id ? 'selected' : ''}`}
                  key={entity.id}
                  onClick={() => setFocus(entity.id)}
                >
                  <span className="timeline-icon">
                    <EntityIcon kind={entity.kind} />
                  </span>
                  <div>
                    <div className="timeline-meta">
                      <Badge>{entity.kind}</Badge>
                      <time>{entity.date || 'Date not supplied'}</time>
                    </div>
                    <h3>{entity.title}</h3>
                    {entity.path && <code>{entity.path}</code>}
                    {entity.excerpt && <p>{entity.excerpt}</p>}
                  </div>
                  <ArrowUpRight size={17} />
                </button>
              ))}
            </div>
          )}
          {query.hasNextPage && (
            <Button
              variant="secondary"
              disabled={query.isFetchingNextPage}
              onClick={() => query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? 'Loading…' : 'Load more records'}
            </Button>
          )}
        </section>
        {focus && <EntityInspector entityId={focus} onClose={() => setFocus('')} />}
      </div>
    </>
  );
}
export function AskPage() {
  const { repoId, repository, focus } = useRepo();
  const [question, setQuestion] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [selectedSource, setSelectedSource] = useState('');
  const ask = useMutation({
    mutationFn: (q: string) =>
      api.ask(repoId, {
        question: q,
        snapshotId: repository.snapshot?.id,
        focusEntityId: focus || undefined,
      }),
  });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;
    setSubmitted(question.trim());
    setSelectedSource('');
    ask.mutate(question.trim());
  };
  const grounded = ask.data ? hasValidCitations(ask.data) : false;
  return (
    <>
      <PageTitle
        number="03"
        title="Ask for the why"
        description="A question deserves a trail of evidence. Every answer starts with indexed history."
      />
      <div className={`ask-layout reasoning-studio ${ask.data ? 'has-answer' : ''}`}>
        <section>
          <form className={`question-form ${ask.data ? 'compact-input' : ''}`} onSubmit={onSubmit}>
            <label htmlFor="question">
              <Sparkles size={17} /> YOUR INVESTIGATION
            </label>
            <textarea
              id="question"
              value={question}
              maxLength={2000}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Why was this code written this way?"
              rows={3}
              required
            />
            <div className="question-form-bottom">
              <span>
                {focus ? `Focused on entity: ${focus}` : 'Search across the indexed repository'}
              </span>
              <Button disabled={ask.isPending || !repository.snapshot || !question.trim()}>
                {ask.isPending ? 'Tracing sources…' : 'Trace the reasoning'}
                <ArrowRight size={16} />
              </Button>
            </div>
          </form>
          {fixtureMode && (
            <button
              className="sample-question"
              onClick={() => setQuestion('Why is token refresh separate from session state?')}
            >
              Use the synthetic example question <ArrowUpRight size={14} />
            </button>
          )}
          {!repository.snapshot && (
            <Warnings warnings={['Wait for an indexed snapshot before asking a question.']} />
          )}
          {ask.isPending ? (
            <Loading text="Retrieving and checking supporting history" />
          ) : ask.isError ? (
            <ErrorState error={ask.error} retry={() => ask.mutate(submitted)} />
          ) : ask.data ? (
            <article className="answer-report" aria-live="polite">
              <div className="answer-heading">
                <Eyebrow>THE REASONING / INSPECTABLE CLAIMS</Eyebrow>
                <Badge
                  tone={
                    ask.data.status === 'not_found' || ask.data.status === 'unavailable'
                      ? 'orange'
                      : 'blue'
                  }
                >
                  {ask.data.status.replaceAll('_', ' ')}
                </Badge>
              </div>
              <h2>{submitted}</h2>
              <div className="report-sha">
                BASED ON SNAPSHOT <Sha value={ask.data.snapshotSha} />
              </div>
              {ask.data.snapshotSha !== repository.snapshot?.headSha && (
                <Warnings
                  warnings={[
                    'This answer refers to a different revision from the active snapshot. Refresh or inspect its sources before relying on it.',
                  ]}
                />
              )}
              <Warnings warnings={ask.data.warnings} />
              {ask.data.status === 'unavailable' ? (
                <div className="state-box" role="status">
                  <HelpCircle size={26} strokeWidth={1.4} />
                  <h3>Generated synthesis is unavailable.</h3>
                  <p>
                    {ask.data.unknowns[0] ||
                      'The model provider could not produce a validated answer. No answer was substituted.'}
                  </p>
                  {ask.data.errorCode && <code>Provider state: {ask.data.errorCode}</code>}
                  <p>
                    {ask.data.searchAvailable
                      ? 'Indexed search, original sources, the graph and deterministic impact remain available.'
                      : 'Indexed search is also unavailable for this snapshot. Inspect repository coverage and retry.'}
                  </p>
                </div>
              ) : !grounded ? (
                <Warnings
                  warnings={[
                    'The response contains unsupported citation references. Its answer and claims have been withheld.',
                  ]}
                />
              ) : (
                <>
                  <p className="answer-summary">
                    {ask.data.status === 'not_found'
                      ? 'No supporting project history found.'
                      : ask.data.answer ?? 'No answer text was returned.'}
                  </p>
                  <div className="claim-list">
                    {ask.data.claims.map((claim, i) => (
                      <div key={i}>
                        <span className="claim-number">{i + 1}</span>
                        <div>
                          <Badge tone={claim.support === 'inferred' ? 'orange' : 'blue'}>
                            {claim.support}
                          </Badge>
                          <p>{claim.text}</p>
                          <div className="claim-citations">
                            {claim.evidenceIds.map((id) => (
                              <button
                                key={id}
                                aria-pressed={selectedSource === id}
                                aria-controls="answer-source-detail"
                                onClick={() => setSelectedSource(id)}
                              >
                                Source {ask.data!.sources.findIndex((s) => s.id === id) + 1}{' '}
                                <ArrowRight size={12} />
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {ask.data.unknowns.length > 0 && (
                <div className="unknowns">
                  <h3>
                    <HelpCircle size={16} /> What the history does not establish
                  </h3>
                  {ask.data.unknowns.map((u, i) => (
                    <p key={i}>{u}</p>
                  ))}
                </div>
              )}
            </article>
          ) : (
            <div className="ask-empty">
              <span className="ask-glyph">
                why<span>?</span>
              </span>
              <h2>
                The answer is in the history.
                <br />
                <span className="muted-word">If it’s there at all.</span>
              </h2>
              <p>
                Ask about a design choice, a change, or the reasoning behind a file. When evidence
                is missing, you’ll see an explicit “not found.”
              </p>
            </div>
          )}
        </section>
        <aside className="evidence-column">
          <SectionLabel>
            <Shield size={16} /> Supporting evidence
          </SectionLabel>
          {ask.data?.sources.length ? (
            <SourceLens
              sources={ask.data.sources}
              selectedId={selectedSource}
              onSelect={setSelectedSource}
              id="answer-source"
            />
          ) : (
            <div className="evidence-placeholder">
              <span className="evidence-symbol observed">
                <Check size={18} />
              </span>
              <p>Original records and claim-level references will appear here.</p>
              <p>Evidence is limited to your indexed snapshot and available source coverage.</p>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
export function ImpactResults({ result }: { result: Impact }) {
  const first = result.affected[0];
  const [selected, setSelected] = useState<{ file: string; signal?: string } | null>(
    first ? { file: first.file, signal: first.signal } : null,
  );
  const active = result.affected.find(
    (item) => item.file === selected?.file && item.signal === selected?.signal,
  );
  const presentation = active ? impactPresentation(active, result.changedFiles) : null;
  const selectFile = (file: string, signal?: string) => {
    const item = signal
      ? result.affected.find((item) => item.file === file && item.signal === signal)
      : result.affected.find(
          (item) => item.file === file && hasStructuralPath(item, result.changedFiles),
        ) || result.affected.find((item) => item.file === file);
    setSelected({ file, signal: item?.signal });
  };
  return (
    <>
      <div className="result-topline">
        <Eyebrow>POSSIBLE IMPACT / RETURNED BY ANALYZER</Eyebrow>
        <Sha value={result.snapshotSha} />
      </div>
      <Warnings warnings={result.warnings} />
      <ImpactAtlas
        result={result}
        selected={selected?.file || null}
        selectedSignal={selected?.signal}
        onSelect={selectFile}
      />
      {!result.affected.length ? (
        <Empty title="No affected paths were returned">
          This does not establish that the change has no runtime consequences. Review coverage and
          limitations.
        </Empty>
      ) : (
        <div className="impact-results">
          <div className="impact-files">
            {result.affected.map((item) => {
              const display = impactPresentation(item, result.changedFiles);
              return (
                <button
                  key={JSON.stringify([item.file, item.signal])}
                  className={
                    selected?.file === item.file && selected?.signal === item.signal
                      ? 'selected'
                      : ''
                  }
                  onClick={() => selectFile(item.file, item.signal)}
                >
                  <span className={`hop-count ${display.kind}`}>{display.marker}</span>
                  <div>
                    <code>{item.file}</code>
                    <span>{display.label}</span>
                  </div>
                  <ChevronRight size={17} />
                </button>
              );
            })}
          </div>
          <section className="impact-proof">
            {active && presentation ? (
              <>
                <Badge tone={presentation.kind === 'structural' ? 'blue' : 'orange'}>
                  {presentation.badge}
                </Badge>
                <h3>{active.file}</h3>
                {presentation.kind === 'unknown' && (
                  <div className="impact-unknown">
                    <HelpCircle size={18} />
                    <div>
                      <strong>Keep this signal separate from a dependency claim.</strong>
                      <p>
                        The returned classification or path does not establish an inspectable
                        reverse dependency. Read the explanation and available evidence before
                        relying on it.
                      </p>
                      <code>Reported signal: {active.signal}</code>
                    </div>
                  </div>
                )}
                <p>{active.explanation}</p>
                <Eyebrow>{presentation.pathLabel}</Eyebrow>
                {presentation.kind === 'structural' ? (
                  <ol className="dependency-path">
                    {active.path.map((file, index) => (
                      <li key={index}>
                        <span>{String(index + 1).padStart(2, '0')}</span>
                        <code>{file}</code>
                      </li>
                    ))}
                  </ol>
                ) : active.path.length ? (
                  <ul className="returned-file-list">
                    {active.path.map((file, index) => (
                      <li key={index}>
                        <FileCode2 size={13} />
                        <code>{file}</code>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">No file sequence was returned for this signal.</p>
                )}
                {presentation.kind === 'association' && (
                  <div className="cochange-scope">
                    <div>
                      <span>SAMPLE SIZE</span>
                      <strong>
                        {active.cochange
                          ? `${active.cochange.sampleSize} of ${active.cochange.targetCommits} indexed commits`
                          : 'Not available'}
                      </strong>
                    </div>
                    <div>
                      <span>OBSERVATION WINDOW</span>
                      <strong>
                        {active.cochange
                          ? `${active.cochange.windowFrom ?? 'not supplied'} → ${active.cochange.windowTo ?? 'not supplied'}`
                          : 'Not available'}
                      </strong>
                    </div>
                    <p>
                      Co-change is context for investigation; it does not establish an import
                      relationship. The sample and window describe only the indexed history.
                    </p>
                  </div>
                )}
                <SectionLabel>Evidence</SectionLabel>
                {active.evidence.length ? (
                  active.evidence.map((e, index) => (
                    <div className="import-evidence" key={index}>
                      <Badge>{e.type}</Badge>
                      <code>
                        {e.file}
                        {e.line ? `:${e.line}` : ''}
                      </code>
                      <SourceLink url={e.url}>Inspect source</SourceLink>
                    </div>
                  ))
                ) : (
                  <p className="muted">
                    No individual source locator was returned. This signal requires additional
                    source inspection.
                  </p>
                )}
              </>
            ) : selected && result.changedFiles.includes(selected.file) ? (
              <div className="changed-origin-proof">
                <Badge tone="blue">PROPOSED CHANGE</Badge>
                <h3>{selected.file}</h3>
                <p>
                  This is an input to the analysis. Follow a returned dependent to inspect why it
                  may be affected.
                </p>
                <Sha value={result.snapshotSha} />
              </div>
            ) : (
              <Empty title="Follow an affected path">
                Choose a file to inspect the returned reasoning and its supporting evidence.
              </Empty>
            )}
          </section>
        </div>
      )}
    </>
  );
}
export function ImpactPage() {
  const { repoId, repository, focus } = useRepo();
  const focused = useQuery({
    queryKey: ['entity', repoId, focus],
    queryFn: ({ signal }) => api.entity(repoId, focus, signal),
    enabled: !!focus,
  });
  const [mode, setMode] = useState('files');
  const [input, setInput] = useState('');
  const [depth, setDepth] = useState(3);
  const [validation, setValidation] = useState('');
  const impact = useMutation({
    mutationFn: () =>
      api.impact(repoId, {
        snapshotId: repository.snapshot!.id,
        maxDepth: depth,
        ...(mode === 'files'
          ? {
              changedFiles: [
                ...new Set(
                  input
                    .split('\n')
                    .map((f) => f.trim())
                    .filter(Boolean),
                ),
              ],
            }
          : { proposedDiff: input }),
      }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (new TextEncoder().encode(input).byteLength > 100000) {
      setValidation('Limit the input to 100 KB. Narrow this change before submitting.');
      return;
    }
    if (
      mode === 'files' &&
      input
        .split('\n')
        .some((f) => f.trim().startsWith('/') || f.includes('..') || f.includes('\\'))
    ) {
      setValidation('Use repository-relative paths, one per line, with forward slashes.');
      return;
    }
    setValidation('');
    impact.mutate();
  };
  return (
    <>
      <PageTitle
        number="04"
        title="See what follows"
        description="Start with a proposed change. Inspect the dependency paths behind its possible impact."
      />
      <form className={`impact-form ${impact.data ? 'compact-input' : ''}`} onSubmit={submit}>
        <div className="impact-form-head">
          <div className="segmented" aria-label="Change input">
            <button
              type="button"
              aria-pressed={mode === 'files'}
              onClick={() => {
                setMode('files');
                setInput('');
                impact.reset();
              }}
            >
              Changed files
            </button>
            <button
              type="button"
              aria-pressed={mode === 'diff'}
              onClick={() => {
                setMode('diff');
                setInput('');
                impact.reset();
              }}
            >
              Proposed diff
            </button>
          </div>
          <label>
            Traversal depth{' '}
            <select value={depth} onChange={(e) => setDepth(Number(e.target.value))}>
              {[1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n} hop{n > 1 ? 's' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label htmlFor="change-input" className="sr-only">
          {mode === 'files' ? 'Changed file paths' : 'Proposed unified diff'}
        </label>
        <textarea
          className="code-input"
          id="change-input"
          rows={4}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={100001}
          placeholder={
            mode === 'files' ? 'src/auth.ts\nsrc/session.ts' : 'Paste a proposed unified diff…'
          }
          required
        />
        <div className="question-form-bottom">
          <span>
            {mode === 'files'
              ? 'Repository-relative paths · one per line'
              : 'Proposed change only · no repository edits'}
          </span>
          <Button disabled={impact.isPending || !repository.snapshot || !input.trim()}>
            {impact.isPending ? 'Following dependencies…' : 'Trace change impact'}
            <ArrowRight size={16} />
          </Button>
        </div>
        {validation && <p className="field-error">{validation}</p>}
      </form>
      {focused.data?.entity.path && mode === 'files' && (
        <Button variant="ghost" onClick={() => setInput(focused.data!.entity.path!)}>
          Use focused file: {focused.data.entity.path}
        </Button>
      )}
      {fixtureMode && mode === 'files' && (
        <button className="sample-question" onClick={() => setInput('src/auth.ts')}>
          Use synthetic auth.ts change <ArrowUpRight size={14} />
        </button>
      )}
      {!repository.snapshot && (
        <Warnings warnings={['An indexed snapshot is required for impact analysis.']} />
      )}
      <div className="impact-legend">
        <span>
          <i className="blue-dot" />
          Direct
        </span>
        <span>
          <i className="orange-dot" />
          Transitive
        </span>
        <span>
          <i className="dashed-dot" />
          Historical co-change
        </span>
        <span>Potential consequences, not guaranteed failures.</span>
      </div>
      {impact.isPending ? (
        <Loading text="Tracing reverse dependencies" />
      ) : impact.isError ? (
        <ErrorState error={impact.error} retry={() => impact.mutate()} />
      ) : impact.data ? (
        <>
          {impact.data.snapshotSha !== repository.snapshot?.headSha && (
            <Warnings
              warnings={[
                'This analysis uses a different revision from the active snapshot. Treat it as stale.',
              ]}
            />
          )}
          <ImpactResults key={impact.submittedAt} result={impact.data} />
        </>
      ) : (
        <div className="impact-intro">
          <div className="schematic-chain">
            <span>A</span>
            <ArrowRight />
            <span>B</span>
            <ArrowRight />
            <span>C</span>
          </div>
          <h2>
            Don’t just see the radius.
            <br />
            Understand the route.
          </h2>
          <p>
            Every returned file includes the reason it may be affected. Structural dependencies and
            historical associations stay visibly distinct.
          </p>
        </div>
      )}
    </>
  );
}
export function RiskPage() {
  const { repoId, repository, path } = useRepo();
  const [singleOnly, setSingleOnly] = useState(false);
  const query = useInfiniteQuery({
    queryKey: ['risk', repoId, repository.snapshot?.id],
    queryFn: ({ pageParam, signal }) =>
      api.risk(repoId, repository.snapshot!.id, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!repository.snapshot,
  });
  const pages = query.data?.pages ?? [];
  const first = pages[0];
  const files = pages.flatMap((page) => page.files);
  const warnings = [...new Set(pages.flatMap((page) => page.warnings))];
  return (
    <>
      <PageTitle
        number="06"
        title="Who carries the context"
        description="See where the indexed history records a single observed contributor."
      />
      {!repository.snapshot ? (
        <Empty title="No authorship snapshot yet">
          Contributor evidence becomes available after indexing.
        </Empty>
      ) : query.isPending ? (
        <Loading text="Retrieving observed contribution history" />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => query.refetch()} />
      ) : (
        <>
          <div className="risk-prologue">
            <div>
              <Eyebrow>THE PEOPLE BEHIND THE COMMIT HISTORY</Eyebrow>
              <h2>
                Observed <em>≠ known.</em>
              </h2>
            </div>
            <p>
              Single-observed-contributor files are a reason to share context. They do not prove
              that only one person knows the code. The observation depends on history coverage,
              contributor aliases, and rename resolution.
            </p>
          </div>
          <div className="risk-scope">
            <span>
              HISTORY WINDOW{' '}
              <b>
                {first?.historyFrom ?? 'not supplied'} → {first?.historyTo ?? 'not supplied'}
              </b>
            </span>
            <Badge tone={first?.partial ? 'orange' : 'blue'}>
              {first?.partial ? 'Partial history' : 'Reported history complete'}
            </Badge>
            <Sha value={first?.snapshotSha} />
          </div>
          <Warnings warnings={warnings} />
          {first?.snapshotSha !== repository.snapshot?.headSha && (
            <Warnings
              warnings={[
                'Contribution results refer to a different snapshot. Refresh before relying on this view.',
              ]}
            />
          )}
          <div className="history-toolbar">
            <SectionLabel>Observed file contributors</SectionLabel>
            <label className="check-label">
              <input
                type="checkbox"
                checked={singleOnly}
                onChange={(e) => setSingleOnly(e.target.checked)}
              />
              Single contributor only
            </label>
          </div>
          <KnowledgeLedger
            files={files.filter((file) => !singleOnly || file.observedAuthors === 1)}
            historyPath={path('history').split('?')[0]}
          />
          {query.hasNextPage && (
            <Button
              variant="secondary"
              disabled={query.isFetchingNextPage}
              onClick={() => query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? 'Loading…' : 'Load more observed files'}
            </Button>
          )}
        </>
      )}
    </>
  );
}
export function PRPage() {
  const { repoId, repository } = useRepo();
  const [params, setParams] = useSearchParams();
  const [number, setNumber] = useState('');
  const [lookup, setLookup] = useState('');
  const [latestError, setLatestError] = useState('');
  const runId = params.get('run') || '';
  const trigger = useMutation({
    mutationFn: () => api.prCheck(repoId, Number(number)),
    onSuccess: (d) =>
      setParams((p) => {
        p.set('run', d.runId);
        return p;
      }),
  });
  const latest = useMutation({
    mutationFn: () => api.latestAnalysis(repoId, Number(number)),
    onSuccess: (d) => {
      setLatestError('');
      setParams((p) => {
        p.set('run', d.id);
        return p;
      });
    },
    onError: (error) =>
      setLatestError(
        error instanceof Error
          ? error.message
          : 'No automatic analysis run was found for this pull request.',
      ),
  });
  const query = useQuery({
    queryKey: ['analysis', repoId, runId],
    queryFn: ({ signal }) => api.analysis(repoId, runId, signal),
    enabled: !!runId,
    refetchInterval: (q) =>
      q.state.status === 'error' ||
      (q.state.data &&
        ['completed', 'failed', 'partial', 'cancelled'].includes(q.state.data.status))
        ? false
        : 2500,
  });
  return (
    <>
      <PageTitle
        number="07"
        title="Review the ripple effect"
        description="Inspect a pull request’s impact analysis, input revision, and actual workflow summary."
      />
      <div className="pr-controls">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            trigger.mutate();
          }}
        >
          <label htmlFor="pr-number">Pull request number</label>
          <div className="input-action">
            <span className="input-prefix">#</span>
            <input
              id="pr-number"
              type="number"
              min="1"
              step="1"
              required
              value={number}
              onChange={(e) => {
                setNumber(e.target.value);
                setLatestError('');
              }}
              placeholder="12"
            />
            <Button
              disabled={trigger.isPending || !repository.snapshot || !/^[1-9]\d*$/.test(number)}
            >
              {trigger.isPending ? 'Requesting…' : 'Request analysis'}
              <ArrowRight size={15} />
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={latest.isPending || !/^[1-9]\d*$/.test(number)}
              onClick={() => latest.mutate()}
            >
              {latest.isPending ? 'Finding…' : 'Find automatic run'}
            </Button>
          </div>
        </form>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (lookup.trim())
              setParams((p) => {
                p.set('run', lookup.trim());
                return p;
              });
          }}
        >
          <label htmlFor="run-id">Or inspect an existing run</label>
          <div className="input-action">
            <input
              id="run-id"
              value={lookup}
              onChange={(e) => setLookup(e.target.value)}
              placeholder="Analysis run ID"
              required
            />
            <Button variant="secondary">Open run</Button>
          </div>
        </form>
      </div>
      {trigger.error && <ErrorState error={trigger.error} />}
      {latestError && <p className="field-error">{latestError}</p>}
      <p className="field-hint">
        Automatic checks require the repository’s GitHub Actions integration. A configured workflow
        can ingest its run and Actions URL here; “Find automatic run” opens the latest ingested run.
        Requesting an analysis here uses the indexed snapshot and does not install a workflow or
        publish a PR comment.
      </p>
      {!runId ? (
        <div className="pr-empty">
          <GitPullRequest size={58} strokeWidth={1} />
          <h2>
            Review the change.
            <br />
            <span className="muted-word">With its context attached.</span>
          </h2>
          <p>
            Open a run to inspect changed files, dependency paths, freshness, and its actual Actions
            summary.
          </p>
        </div>
      ) : query.isPending ? (
        <Loading text="Retrieving PR analysis" />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => query.refetch()} />
      ) : (
        <>
          <RevisionBridge run={query.data} />
          <Warnings
            warnings={[
              ...query.data.warnings,
              ...(query.data.stale ||
              (query.data.result && query.data.result.snapshotSha !== query.data.headSha)
                ? [
                    'The analysis is stale relative to the PR head. Refresh the underlying index or request a new run.',
                  ]
                : []),
            ]}
          />
          {query.data.result ? (
            <>
              <SectionLabel>Changed files</SectionLabel>
              <div className="changed-file-list">
                {query.data.result.changedFiles.map((f) => (
                  <code key={f}>{f}</code>
                ))}
              </div>
              <ImpactResults key={runId} result={query.data.result} />
            </>
          ) : ['queued', 'running', 'pending'].includes(query.data.status) ? (
            <Loading text="Analysis is still running; polling its actual status" />
          ) : (
            <Empty title="No impact result was published">
              Review the run status and warnings. No analysis has been substituted.
            </Empty>
          )}
        </>
      )}
    </>
  );
}
