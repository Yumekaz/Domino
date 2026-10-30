import { useCallback, useEffect, useState } from 'react';
import {
  Link,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  GitBranch,
  GitPullRequest,
  History,
  Layers3,
  Network,
  Plus,
  Radio,
  RefreshCw,
  ScanLine,
  Search,
  Shield,
  Sparkles,
} from 'lucide-react';
import { api, fixtureMode } from '../api/client';
import { type Repository } from '../api/schemas';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Eyebrow,
  Loading,
  Logo,
  PageTitle,
  SectionLabel,
  Sha,
  Warnings,
} from '../components/ui';
import { AskPage, HistoryPage, ImpactPage, PRPage, RiskPage } from './investigations';
import GraphPage from './graph/GraphPage';
import InvestigationOverview from '../components/InvestigationOverview';
import '../workspace-v2.css';
import RepositoryCommand from '../components/RepositoryCommand';
import RepositoryConnection from '../components/RepositoryConnection';
import FocusIdentity from '../components/FocusIdentity';
import { MotionToggle } from '../components/MotionPolicy';
import '../investigation-studio.css';
import '../workspace-theatre.css';

type RepoContext = {
  repository: Repository;
  repoId: string;
  focus: string;
  setFocus: (id: string) => void;
  path: (page: string) => string;
};
export function useRepo() {
  return useOutletContext<RepoContext>();
}
type Recent = { id: string; label: string };
function readRecent(): Recent[] {
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(fixtureMode ? 'domino.fixture.recent' : 'domino.recent') || '[]',
    );
    return Array.isArray(stored)
      ? stored.filter((r): r is Recent => typeof r?.id === 'string' && typeof r?.label === 'string')
      : [];
  } catch {
    return [];
  }
}
function remember(repository: Repository) {
  try {
    localStorage.setItem(
      fixtureMode ? 'domino.fixture.recent' : 'domino.recent',
      JSON.stringify(
        [
          { id: repository.id, label: `${repository.owner}/${repository.name}` },
          ...readRecent().filter((r) => r.id !== repository.id),
        ].slice(0, 8),
      ),
    );
  } catch {
    /* Optional browser history. */
  }
}
function FixtureBanner() {
  return fixtureMode ? (
    <div className="fixture-banner">
      <Badge tone="orange">DEVELOPMENT FIXTURE</Badge>
      <span>
        Synthetic records and simulated analyses. No real repository evidence, ingestion, or Actions
        run.
      </span>
    </div>
  ) : null;
}
const client = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 30000, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});
export default function Workspace() {
  return (
    <QueryClientProvider client={client}>
      <WorkspaceRoutes />
    </QueryClientProvider>
  );
}
function WorkspaceRoutes() {
  return (
    <div className="workspace desktop-workspace">
      <a className="skip-link" href="#workspace-main">
        Skip to investigation
      </a>
      <FixtureBanner />
      <Routes>
        <Route index element={<RepositoryHome />} />
        <Route path="repositories/:repoId" element={<RepoShell />}>
          <Route index element={<Overview />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="ask" element={<AskPage />} />
          <Route path="impact" element={<ImpactPage />} />
          <Route path="graph" element={<GraphPage />} />
          <Route path="risk" element={<RiskPage />} />
          <Route path="pr" element={<PRPage />} />
          <Route
            path="*"
            element={
              <Empty title="This investigation doesn’t exist">
                <Link to="/app">Choose a repository</Link>
              </Empty>
            }
          />
        </Route>
        <Route path="*" element={<RepositoryHome />} />
      </Routes>
    </div>
  );
}
function RepositoryHome() {
  const navigate = useNavigate();
  const [existingId, setExistingId] = useState('');
  const health = useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => api.health(signal),
    retry: false,
  });
  return (
    <>
      <header className="app-home-nav">
        <Logo />
        <Link to="/" className="subtle-link">
          <ArrowLeft size={15} /> Back to the story
        </Link>
        <Badge tone={health.isSuccess ? 'blue' : 'neutral'}>
          <Radio size={12} />
          {fixtureMode
            ? 'Fixture adapter'
            : health.isSuccess
              ? `API: ${health.data.status}`
              : 'API not connected'}
        </Badge>
      </header>
      <main id="workspace-main" className="repository-home page-width">
        <div className="home-heading">
          <Eyebrow>THE DOMINO WORKSPACE</Eyebrow>
          <h1 tabIndex={-1}>
            Big picture.
            <br />
            <span className="muted-word">Small starting point.</span>
          </h1>
          <p>One repository. All the context you can trace.</p>
        </div>
        <div className="import-layout">
          <section className="import-panel">
            <div className="panel-topline">
              <span className="small-square" />
              <span>01 / CONNECT A REPOSITORY</span>
              <GitBranch size={19} />
            </div>
            <h2>Start with the source.</h2>
            <p>
              Connect a public GitHub repository to collect its history and map its code
              relationships.
            </p>
            <RepositoryConnection />
            <div className="import-expectations">
              <h3>What happens next</h3>
              <ol>
                <li>
                  <span>01</span>Collect commits, issues, PRs, and documents.
                </li>
                <li>
                  <span>02</span>Connect source-backed history and static imports.
                </li>
                <li>
                  <span>03</span>Publish a snapshot with its SHA and coverage.
                </li>
              </ol>
              <p>Coverage depends on available history. Limited imports are labelled.</p>
            </div>
          </section>
          <aside className="import-art">
            <img
              src="/assets/domino-midnight.webp"
              alt="Cobalt dominoes with orange and yellow accents"
              width="1672"
              height="941"
            />
            <div>
              <Eyebrow>BEFORE YOU CHANGE IT.</Eyebrow>
              <h2>
                Understand
                <br />
                what connects it.
              </h2>
            </div>
          </aside>
        </div>
        {fixtureMode && (
          <div className="fixture-entry">
            <div>
              <Badge tone="orange">SYNTHETIC DEVELOPMENT REPOSITORY</Badge>
              <p>
                Explore client interactions without claiming a real analysis. To exercise simulated
                import, use <code>https://github.com/domino-example/causal-lab</code>.
              </p>
            </div>
            <Link className="button button-secondary" to="/app/repositories/development-fixture">
              Open fixture <ArrowRight size={17} />
            </Link>
          </div>
        )}
        <section className="recent-repos">
          <SectionLabel>Continue an investigation</SectionLabel>
          {readRecent().length > 0 ? (
            <div className="recent-list">
              {readRecent().map((r) => (
                <Link key={r.id} to={`/app/repositories/${encodeURIComponent(r.id)}`}>
                  <GitBranch size={18} />
                  <span>{r.label}</span>
                  <ArrowUpRight size={17} />
                </Link>
              ))}
            </div>
          ) : (
            <p className="muted">
              Connected repositories you open in this browser will appear here.
            </p>
          )}
          <form
            className="existing-repo-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (existingId.trim())
                navigate(`/app/repositories/${encodeURIComponent(existingId.trim())}`);
            }}
          >
            <label htmlFor="existing-repo">Have an existing repository ID?</label>
            <input
              id="existing-repo"
              value={existingId}
              onChange={(e) => setExistingId(e.target.value)}
              placeholder="Repository ID supplied by your team"
              required
            />
            <Button variant="ghost">
              Open <ArrowRight size={15} />
            </Button>
          </form>
        </section>
        {health.isError && (
          <div className="connection-note">
            <Radio size={17} />
            <p>
              The live API is unavailable. Repository import and analysis need the backend service.
              You can retry the connection below.
            </p>
            <Button variant="secondary" onClick={() => health.refetch()}>
              Check connection
            </Button>
          </div>
        )}
      </main>
    </>
  );
}
const sections = [
  { slug: '', label: 'Overview', icon: Layers3, index: '01' },
  { slug: 'history', label: 'Connected history', icon: History, index: '02' },
  { slug: 'ask', label: 'Ask Domino', icon: Sparkles, index: '03' },
  { slug: 'impact', label: 'Change impact', icon: ScanLine, index: '04' },
  { slug: 'graph', label: 'Memory graph', icon: Network, index: '05' },
  { slug: 'risk', label: 'Knowledge at risk', icon: Shield, index: '06' },
  { slug: 'pr', label: 'PR checks', icon: GitPullRequest, index: '07' },
];
function RepoShell() {
  const navigate = useNavigate();
  const { repoId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const [switcher, setSwitcher] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const location = useLocation();
  const focus = params.get('focus') || '';
  const job = params.get('job');
  const query = useQuery({
    queryKey: ['repository', repoId],
    queryFn: ({ signal }) => api.repository(repoId, signal),
  });
  const basePath = `/app/repositories/${encodeURIComponent(repoId)}`;
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen(true);
        return;
      }
      const target = event.target as HTMLElement;
      if (
        event.key !== '/' ||
        event.ctrlKey ||
        event.metaKey ||
        target.closest('input,textarea,select,[contenteditable="true"]')
      )
        return;
      event.preventDefault();
      navigate(
        `/app/repositories/${encodeURIComponent(repoId)}/history${focus ? `?focus=${encodeURIComponent(focus)}` : ''}`,
      );
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [navigate, repoId, focus]);
  useEffect(() => {
    if (query.data) remember(query.data);
  }, [query.data]);
  const path = (page: string) =>
    `${basePath}${page ? `/${page}` : ''}${focus ? `?focus=${encodeURIComponent(focus)}` : ''}`;
  const setFocus = useCallback(
    (id: string) =>
      setParams((p) => {
        if (id) p.set('focus', id);
        else p.delete('focus');
        return p;
      }),
    [setParams],
  );
  return (
    <div className="app-layout">
      <RepositoryCommand repoId={repoId} open={commandOpen} onClose={() => setCommandOpen(false)} />
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Logo compact />
          <MotionToggle />
        </div>
        <span className="sidebar-label">INVESTIGATE</span>
        <nav aria-label="Workspace">
          {sections.map((s) => (
            <NavLink
              end={!s.slug}
              key={s.slug}
              to={path(s.slug)}
              className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}
            >
              <s.icon size={18} />
              <span>{s.label}</span>
              <small>{s.index}</small>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-principle">
            <span className="evidence-symbol observed">
              <Shield size={15} />
            </span>
            <p>
              Every connection
              <br />
              needs a source.
            </p>
          </div>
          <Link to="/app">
            <Plus size={15} /> Connect repository
          </Link>
          <Link to="/">
            <ArrowLeft size={15} /> The Domino story
          </Link>
        </div>
      </aside>
      <div className="app-body">
        <header className="workspace-topbar">
          <Logo compact />
          <MotionToggle />
          <div className="repo-switch-wrap">
            <button
              className="repo-switch"
              aria-expanded={switcher}
              onClick={() => setSwitcher(!switcher)}
            >
              <span className="repo-avatar">
                <GitBranch size={19} />
              </span>
              <span>
                <small>{query.data?.owner || 'REPOSITORY'}</small>
                <strong>{query.data?.name || repoId}</strong>
              </span>
              <ChevronDown size={15} />
            </button>
            {switcher && (
              <div className="repo-switch-menu">
                {readRecent()
                  .filter((r) => r.id !== repoId)
                  .map((r) => (
                    <Link
                      onClick={() => setSwitcher(false)}
                      key={r.id}
                      to={`/app/repositories/${encodeURIComponent(r.id)}`}
                    >
                      {r.label}
                    </Link>
                  ))}
                <Link to="/app">
                  <Plus size={14} /> Connect a repository
                </Link>
                <button onClick={() => setSwitcher(false)}>Close</button>
              </div>
            )}
          </div>

          <div>
            <span className="workspace-breadcrumb">Workspace /</span>
            <span>
              {sections.find(
                (s) => location.pathname === `${basePath}${s.slug ? `/${s.slug}` : ''}`,
              )?.label || 'Investigation'}
            </span>
          </div>
          <button
            className="topbar-search"
            onClick={() => setCommandOpen(true)}
            aria-label="Find a connection"
          >
            <Search size={16} />
            <span>Find a connection</span>
            <kbd>Ctrl K</kbd>
          </button>
          <Link className="mobile-brand" to="/app">
            D<span className="blue">.</span>
          </Link>
        </header>
        <div className="snapshot-bar">
          <span>
            <GitBranch size={13} />
            {query.data?.snapshot?.branch || 'No branch indexed'}
          </span>
          <span>
            SHA <Sha value={query.data?.snapshot?.headSha} />
          </span>
          <FocusIdentity repoId={repoId} entityId={focus} />
          <Badge tone={query.data?.snapshot?.status === 'ready' ? 'blue' : 'orange'}>
            {query.data?.snapshot?.status || 'No snapshot'}
          </Badge>
          {query.data?.snapshot?.completedAt && (
            <span className="snapshot-time">
              Indexed{' '}
              {new Date(query.data.snapshot.completedAt).toLocaleString('en-IN', {
                timeZone: 'Asia/Calcutta',
              })}{' '}
              IST
            </span>
          )}
        </div>
        <main className="app-main" id="workspace-main">
          {query.isPending ? (
            <Loading />
          ) : query.isError ? (
            <ErrorState error={query.error} retry={() => query.refetch()} />
          ) : (
            <>
              {job && <JobStatus repoId={repoId} jobId={job} />}
              {!!query.data.snapshot?.warnings.length && (
                <details className="index-notes">
                  <summary>
                    <Shield size={15} />
                    <span>
                      {query.data.snapshot.status === 'partial'
                        ? 'Partial index — review coverage and source notes'
                        : 'Review index coverage and source notes'}
                    </span>
                    <Badge tone="orange">{query.data.snapshot.warnings.length} NOTES</Badge>
                  </summary>
                  <Warnings warnings={query.data.snapshot.warnings} />
                </details>
              )}
              <Outlet
                context={
                  { repository: query.data, repoId, focus, setFocus, path } satisfies RepoContext
                }
              />
            </>
          )}
        </main>
      </div>
    </div>
  );
}
function JobStatus({ repoId, jobId }: { repoId: string; jobId: string }) {
  const client = useQueryClient();
  const job = useQuery({
    queryKey: ['job', repoId, jobId],
    queryFn: ({ signal }) => api.job(repoId, jobId, signal),
    refetchInterval: (q) =>
      q.state.status === 'error' ||
      (q.state.data && ['ready', 'completed', 'partial', 'failed'].includes(q.state.data.status))
        ? false
        : 2000,
  });
  useEffect(() => {
    if (job.data && ['ready', 'completed', 'partial'].includes(job.data.status))
      void client.invalidateQueries({ queryKey: ['repository', repoId] });
  }, [job.data, repoId, client]);
  return (
    <section className="job-status" aria-live="polite">
      {job.isPending ? (
        <Loading text="Checking import job" />
      ) : job.isError ? (
        <ErrorState error={job.error} retry={() => job.refetch()} />
      ) : (
        <>
          <div className="flex items-center gap-3">
            <Radio size={18} />
            <strong>{job.data.phase}</strong>
            <Badge>{job.data.status}</Badge>
          </div>
          {job.data.progress !== undefined && (
            <progress max="100" value={job.data.progress} aria-label="Reported import progress" />
          )}
          {job.data.error && <p className="field-error">{job.data.error}</p>}
          <Warnings warnings={job.data.warnings} />
          {job.data.status === 'failed' && (
            <p>Review the import error, then use Refresh index to start a new job.</p>
          )}
        </>
      )}
    </section>
  );
}
function Overview() {
  const { repository, repoId, path } = useRepo();
  const navigate = useNavigate();
  const snapshot = repository.snapshot;
  const refresh = useMutation({
    mutationFn: () => api.reindex(repoId),
    onSuccess: (d) =>
      navigate(
        `/app/repositories/${encodeURIComponent(repoId)}?job=${encodeURIComponent(d.jobId)}`,
      ),
  });
  return (
    <section className="overview-investigation">
      <PageTitle
        number="01"
        title="The connected picture"
        description="Your repository, grounded in a specific moment in its history."
        action={
          <Button variant="secondary" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
            <RefreshCw size={15} />
            {refresh.isPending ? 'Requesting…' : 'Refresh index'}
          </Button>
        }
      />
      {refresh.error && <ErrorState error={refresh.error} />}
      <div className="repository-title-line">
        <GitBranch size={16} />
        <span>
          {repository.owner} / <b>{repository.name}</b>
        </span>
        <Badge>{snapshot?.status || 'Awaiting snapshot'}</Badge>
      </div>
      <InvestigationOverview />
      <SectionLabel>Source coverage</SectionLabel>
      {snapshot ? (
        <div className="coverage-grid">
          {snapshot.coverage.map((c) => (
            <div key={c.kind}>
              <Eyebrow>{c.kind}</Eyebrow>
              <strong>
                {c.indexed.toLocaleString()}
                <small>{c.total !== undefined ? ` / ${c.total.toLocaleString()}` : ''}</small>
              </strong>
              <Badge tone={c.status === 'complete' ? 'blue' : 'orange'}>{c.status}</Badge>
            </div>
          ))}
        </div>
      ) : (
        <Empty title="Indexing has not published a snapshot">
          Coverage appears when the backend supplies it. No progress is estimated.
        </Empty>
      )}
      <div className="investigate-heading">
        <SectionLabel>Choose a thread</SectionLabel>
        <span>FOLLOW THE QUESTION. KEEP THE CONTEXT.</span>
      </div>
      <div className="investigation-links">
        {sections.slice(1).map((s) => (
          <Link key={s.slug} to={path(s.slug)}>
            <span className="investigation-link-index">{s.index}</span>
            <s.icon size={22} />
            <h3>{s.label}</h3>
            <ArrowUpRight size={20} />
          </Link>
        ))}
      </div>
      <div className="limit-note">
        <BookOpen size={19} />
        <p>
          Domino explains what the indexed evidence supports. Static relationships describe possible
          impact. They do not guarantee runtime behavior or a confirmed breakage.
        </p>
      </div>
    </section>
  );
}
