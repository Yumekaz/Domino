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
  X,
} from 'lucide-react';
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

export function EntityIcon({ kind, size = 18 }: { kind: string; size?: number }) {
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
            {['File', 'PullRequest', 'Issue', 'Commit', 'Document', 'Contributor'].map((k) => (
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
      <div className="ask-layout">
        <section>
          <form className={`question-form ${ask.data ? 'compact-input' : ''}`} onSubmit={onSubmit}>
            <label htmlFor="question">
              <Sparkles size={17} /> YOUR INVESTIGATION
            </label>
            <textarea
              id="question"
              value={question}
              maxLength={4000}
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
                <Eyebrow>INVESTIGATION REPORT</Eyebrow>
                <Badge tone={ask.data.status === 'not_found' ? 'orange' : 'blue'}>
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
              )}{' '}
              {!grounded ? (
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
                      : ask.data.answer}
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
                              <a
                                key={id}
                                href={`#source-${ask.data!.sources.findIndex((s) => s.id === id) + 1}`}
                              >
                                Source {ask.data!.sources.findIndex((s) => s.id === id) + 1}{' '}
                                <ArrowRight size={12} />
                              </a>
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
            <SourceList sources={ask.data.sources} idPrefix="source" />
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
  const [selected, setSelected] = useState<string | null>(result.affected[0]?.file || null);
  const active = result.affected.find((a) => a.file === selected);
  return (
    <>
      <div className="result-topline">
        <Eyebrow>POSSIBLE IMPACT / RETURNED BY ANALYZER</Eyebrow>
        <Sha value={result.snapshotSha} />
      </div>
      <Warnings warnings={result.warnings} />
      <ImpactAtlas result={result} selected={selected} onSelect={setSelected} />
      {!result.affected.length ? (
        <Empty title="No affected paths were returned">
          This does not establish that the change has no runtime consequences. Review coverage and
          limitations.
        </Empty>
      ) : (
        <div className="impact-results">
          <div className="impact-files">
            {result.affected.map((a) => (
              <button
                key={`${a.file}-${a.signal}`}
                className={selected === a.file ? 'selected' : ''}
                onClick={() => setSelected(a.file)}
              >
                <span
                  className={`hop-count ${a.signal === 'historically_coupled' ? 'cochange' : a.depth > 1 ? 'transitive' : ''}`}
                >
                  {a.signal === 'historically_coupled' ? '↔' : a.depth}
                </span>
                <div>
                  <code>{a.file}</code>
                  <span>
                    {a.signal === 'historically_coupled'
                      ? 'Historical co-change · association'
                      : a.depth === 1
                        ? 'Direct dependent · possible impact'
                        : 'Transitive dependent · possible impact'}
                  </span>
                </div>
                <ChevronRight size={17} />
              </button>
            ))}
          </div>
          <section className="impact-proof">
            {active ? (
              <>
                <Badge tone="orange">
                  {active.signal === 'historically_coupled'
                    ? 'HISTORICAL ASSOCIATION'
                    : `${active.depth} HOP${active.depth === 1 ? '' : 'S'} · POSSIBLE IMPACT`}
                </Badge>
                <h3>{active.file}</h3>
                <p>{active.explanation}</p>
                <Eyebrow>
                  {active.signal === 'historically_coupled'
                    ? 'ASSOCIATED FILES · NOT AN IMPORT PATH'
                    : 'IMPORT PATH · DEPENDENT → CHANGED FILE'}
                </Eyebrow>
                <ol className="dependency-path">
                  {active.path.map((p, i) => (
                    <li key={i}>
                      <span>{String(i + 1).padStart(2, '0')}</span>
                      <code>{p}</code>
                    </li>
                  ))}
                </ol>
                <SectionLabel>Evidence</SectionLabel>
                {active.evidence.length ? (
                  active.evidence.map((e, i) => (
                    <div className="import-evidence" key={i}>
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
                    No individual source locator was returned. This association requires additional
                    source inspection.
                  </p>
                )}
              </>
            ) : selected && result.changedFiles.includes(selected) ? (
              <div className="changed-origin-proof">
                <Badge tone="blue">PROPOSED CHANGE</Badge>
                <h3>{selected}</h3>
                <p>
                  This is an input to the analysis. Follow a returned dependent to inspect why it
                  may be affected.
                </p>
                <Sha value={result.snapshotSha} />
              </div>
            ) : (
              <Empty title="Follow an affected path">
                Choose a file to inspect each hop and its supporting evidence.
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
  const { repoId, repository, path, setFocus } = useRepo();
  const [singleOnly, setSingleOnly] = useState(true);
  const query = useQuery({
    queryKey: ['risk', repoId, repository.snapshot?.id],
    queryFn: ({ signal }) => api.risk(repoId, repository.snapshot!.id, signal),
    enabled: !!repository.snapshot,
  });
  return (
    <>
      <PageTitle
        number="06"
        title="Keep knowledge connected"
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
          <div className="risk-summary">
            <div className="risk-emblem">
              <Shield size={55} strokeWidth={1} />
              <span>1</span>
            </div>
            <div>
              <Eyebrow>OBSERVATION, NOT A CLAIM ABOUT PEOPLE</Eyebrow>
              <h2>
                One observed contributor.
                <br />
                <span className="muted-word">A reason to share context.</span>
              </h2>
              <p>
                This does not mean only one person knows the code. Shallow history, contributor
                aliases, and rename resolution affect what can be observed.
              </p>
            </div>
          </div>
          <div className="risk-scope">
            <span>
              HISTORY WINDOW{' '}
              <b>
                {query.data.historyFrom} → {query.data.historyTo}
              </b>
            </span>
            <Badge tone={query.data.partial ? 'orange' : 'blue'}>
              {query.data.partial ? 'Partial history' : 'Reported history complete'}
            </Badge>
            <Sha value={query.data.snapshotSha} />
          </div>
          <Warnings warnings={query.data.warnings} />
          {query.data.snapshotSha !== repository.snapshot?.headSha && (
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
          <div className="risk-table">
            {query.data.files.filter((f) => !singleOnly || f.observedAuthors === 1).length === 0 ? (
              <Empty title="No matching files in the returned results">
                Coverage is bounded; this is not a guarantee of distributed knowledge.
              </Empty>
            ) : (
              query.data.files
                .filter((f) => !singleOnly || f.observedAuthors === 1)
                .map((f) => (
                  <article key={f.path}>
                    <div className="risk-file-heading">
                      <FileCode2 size={19} />
                      <h3>
                        <code>{f.path}</code>
                      </h3>
                      <Badge tone={f.observedAuthors === 1 ? 'orange' : 'neutral'}>
                        {f.observedAuthors} observed contributor{f.observedAuthors !== 1 ? 's' : ''}
                      </Badge>
                    </div>
                    <div className="risk-file-details">
                      <span>{f.commitCount} observed commits</span>
                      <span>Last edit {f.lastEdit}</span>
                      <Link
                        onClick={() => setFocus(f.entityId)}
                        to={`${path('history').split('?')[0]}?focus=${encodeURIComponent(f.entityId)}`}
                      >
                        Trace history <ArrowUpRight size={14} />
                      </Link>
                    </div>
                    <div className="contributor-bars">
                      {f.contributors.map((c, i) => (
                        <div key={c.name}>
                          <span className="contributor-avatar">{String.fromCharCode(65 + i)}</span>
                          <span>{c.name}</span>
                          <div className="contributor-bar">
                            <i
                              style={{
                                width: `${f.commitCount ? Math.min(100, (c.commits / f.commitCount) * 100) : 0}%`,
                              }}
                            />
                          </div>
                          <span>
                            {c.commits} commit{c.commits === 1 ? '' : 's'}
                          </span>
                        </div>
                      ))}
                    </div>
                    <details>
                      <summary>Inspect contribution evidence</summary>
                      <SourceList sources={f.sources} />
                    </details>
                  </article>
                ))
            )}
          </div>
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
  const runId = params.get('run') || '';
  const trigger = useMutation({
    mutationFn: () => api.prCheck(repoId, Number(number)),
    onSuccess: (d) =>
      setParams((p) => {
        p.set('run', d.runId);
        return p;
      }),
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
              onChange={(e) => setNumber(e.target.value)}
              placeholder="12"
            />
            <Button
              disabled={trigger.isPending || !repository.snapshot || !/^[1-9]\d*$/.test(number)}
            >
              {trigger.isPending ? 'Requesting…' : 'Request analysis'}
              <ArrowRight size={15} />
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
      <p className="field-hint">
        Automatic checks require your repository’s GitHub Actions integration. Requesting an
        analysis here does not install a workflow or publish a PR comment.
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
          <section className="pr-report">
            <div className="pr-report-title">
              <GitPullRequest size={25} />
              <div>
                <Eyebrow>ANALYSIS RUN {query.data.id}</Eyebrow>
                <h2>Pull request #{query.data.prNumber}</h2>
              </div>
              <Badge tone={query.data.status === 'completed' ? 'blue' : 'orange'}>
                {query.data.status}
              </Badge>
            </div>
            <div className="pr-revisions">
              <div>
                <Eyebrow>BASE</Eyebrow>
                <Sha value={query.data.baseSha} />
              </div>
              <ArrowRight size={19} />
              <div>
                <Eyebrow>HEAD</Eyebrow>
                <Sha value={query.data.headSha} />
              </div>
              <div>
                <Eyebrow>EVENT</Eyebrow>
                <span>{query.data.event}</span>
              </div>
              <div>
                <Eyebrow>CREATED</Eyebrow>
                <time>{query.data.createdAt}</time>
              </div>
            </div>
            <div className="flex flex-wrap gap-5">
              <SourceLink url={query.data.prUrl}>Open pull request</SourceLink>
              <SourceLink url={query.data.actionsUrl}>Open actual Actions summary</SourceLink>
            </div>
          </section>
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
