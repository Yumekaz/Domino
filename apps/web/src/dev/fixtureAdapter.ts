/** Synthetic UI exercises only. Never imported by a production build. No GitHub evidence is claimed. */
import type { Answer, Edge, Entity, Impact, Repository } from '../api/schemas';
import { ApiError } from '../api/client';
export const fixtureId = 'development-fixture';
const sha = '0000000000000000000000000000000000000000';
const nodes: Entity[] = [
  {
    id: 'issue',
    kind: 'Issue',
    title: 'Keep sessions during token refresh',
    date: '2026-10-01',
    excerpt: 'SYNTHETIC: Refreshing a token should not discard an active session.',
  },
  {
    id: 'pr',
    kind: 'PullRequest',
    title: 'Separate token refresh from session state',
    date: '2026-10-03',
    excerpt: 'SYNTHETIC: Preserve the session while the token is refreshed.',
  },
  { id: 'commit', kind: 'Commit', title: 'Preserve active sessions', date: '2026-10-04' },
  { id: 'auth', kind: 'File', title: 'auth.ts', path: 'src/auth.ts', date: '2026-10-04' },
  { id: 'session', kind: 'File', title: 'session.ts', path: 'src/session.ts', date: '2026-10-04' },
  {
    id: 'dashboard',
    kind: 'File',
    title: 'dashboard.tsx',
    path: 'src/dashboard.tsx',
    date: '2026-10-05',
  },
  { id: 'person', kind: 'Contributor', title: 'Fixture contributor A', date: '2026-10-03' },
  { id: 'doc', kind: 'Document', title: 'Session design notes', date: '2026-10-06' },
];
const edges: Edge[] = [
  { id: 'e1', source: 'pr', target: 'issue', kind: 'CLOSES_ISSUE', verification: 'observed' },
  { id: 'e2', source: 'commit', target: 'pr', kind: 'IN_PR', verification: 'observed' },
  { id: 'e3', source: 'commit', target: 'auth', kind: 'MODIFIED', verification: 'observed' },
  { id: 'e4', source: 'session', target: 'auth', kind: 'IMPORTS', verification: 'observed' },
  { id: 'e5', source: 'dashboard', target: 'session', kind: 'IMPORTS', verification: 'observed' },
  { id: 'e6', source: 'person', target: 'commit', kind: 'AUTHORED', verification: 'observed' },
  { id: 'e7', source: 'doc', target: 'session', kind: 'DOCUMENTS', verification: 'inferred' },
  {
    id: 'e8',
    source: 'auth',
    target: 'dashboard',
    kind: 'CO_CHANGED_WITH',
    verification: 'derived',
  },
].map((e) => ({
  ...e,
  verification: e.verification as Edge['verification'],
  snapshotSha: sha,
  extractor: 'Synthetic fixture adapter',
  evidenceExcerpt: 'Development-only relationship. Not an observation of a real repository.',
  observedAt: '2026-10-04',
}));
const sources = [
  {
    id: 'fixture-discussion',
    kind: 'pr_comment',
    locator: 'Synthetic PR discussion · no public source',
    excerpt: 'SYNTHETIC: We separate token refresh to keep active sessions intact.',
    observedAt: '2026-10-03',
  },
];
const repository: Repository = {
  id: fixtureId,
  owner: 'domino-example',
  name: 'causal-lab',
  url: 'https://github.com/domino-example/causal-lab',
  snapshot: {
    id: 'fixture-snapshot',
    headSha: sha,
    branch: 'fixture/main',
    status: 'partial',
    completedAt: '2026-10-06T10:00:00Z',
    historyFrom: '2026-10-01',
    historyTo: '2026-10-06',
    coverage: [
      { kind: 'Commits', indexed: 3, status: 'limited' },
      { kind: 'Pull requests', indexed: 1, status: 'complete' },
      { kind: 'Issues', indexed: 1, status: 'complete' },
      { kind: 'Documents', indexed: 1, status: 'limited' },
    ],
    warnings: [
      'Synthetic development fixture. No repository has been indexed.',
      'Partial-history state is intentionally exercised.',
    ],
  },
};
const impact: Impact = {
  changedFiles: ['src/auth.ts'],
  snapshotSha: sha,
  affected: [
    {
      file: 'src/session.ts',
      signal: 'static_reverse_dependency',
      depth: 1,
      path: ['src/session.ts', 'src/auth.ts'],
      impact: 'possible',
      explanation: 'Synthetic example: session.ts imports auth.ts.',
      evidence: [{ type: 'import', file: 'src/session.ts', line: 4 }],
    },
    {
      file: 'src/dashboard.tsx',
      signal: 'static_reverse_dependency',
      depth: 2,
      path: ['src/dashboard.tsx', 'src/session.ts', 'src/auth.ts'],
      impact: 'possible',
      explanation: 'Synthetic example: dashboard.tsx imports session.ts, which imports auth.ts.',
      evidence: [{ type: 'import', file: 'src/dashboard.tsx', line: 2 }],
    },
    {
      file: 'src/dashboard.test.ts',
      signal: 'historically_coupled',
      depth: 0,
      path: ['src/dashboard.test.ts', 'src/auth.ts'],
      impact: 'possible',
      explanation: 'Synthetic co-change association, not an import relationship.',
      evidence: [],
    },
  ],
  warnings: [
    'Development fixture, not a computed impact result.',
    'Runtime dependencies are outside this illustrative analysis.',
  ],
};
let importedAt = 0;
export async function fixtureRequest(path: string, init?: RequestInit): Promise<unknown> {
  if (!import.meta.env.DEV) throw new Error('Fixtures are unavailable in production.');
  init?.signal?.throwIfAborted();
  const url = new URL(path, 'https://fixture.invalid');
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  if (path === '/health') return { status: 'development-fixture' };
  if (path === '/repositories' && init?.method === 'POST') {
    if (body.url !== repository.url)
      throw new ApiError(
        'FIXTURE_REPO_ONLY',
        `Fixture mode only simulates ${repository.url}. Start the live development server to import a real repository.`,
      );
    importedAt = Date.now();
    return { repoId: fixtureId, jobId: 'fixture-job' };
  }
  if (url.pathname.includes('/jobs/'))
    return {
      id: 'fixture-job',
      status: Date.now() - importedAt > 2000 ? 'partial' : 'running',
      phase:
        Date.now() - importedAt > 2000
          ? 'Complete with fixture warnings'
          : 'Simulating history collection',
      warnings: ['Development-only simulated job.'],
    };
  if (path.endsWith('/reindex')) {
    importedAt = Date.now();
    return { repoId: fixtureId, jobId: 'fixture-job' };
  }
  if (url.pathname.endsWith('/search')) {
    const q = (url.searchParams.get('q') || '').toLowerCase();
    return {
      items: nodes.filter((n) => `${n.title} ${n.kind} ${n.path || ''}`.toLowerCase().includes(q)),
      nextCursor: null,
    };
  }
  if (url.pathname.includes('/entities/')) {
    const id = decodeURIComponent(url.pathname.split('/').pop()!);
    const entity = nodes.find((n) => n.id === id);
    if (!entity) throw new ApiError('SOURCE_NOT_FOUND', 'No such fixture entity.');
    const related = edges.filter((e) => e.source === id || e.target === id);
    return {
      entity,
      sources,
      neighbors: nodes.filter(
        (n) => related.some((e) => e.source === n.id || e.target === n.id) && n.id !== id,
      ),
      edges: related,
    };
  }
  if (url.pathname.endsWith('/graph')) {
    const selected = url.searchParams.get('entityId') || 'auth';
    let ids = new Set([selected]);
    for (let i = 0; i < Number(url.searchParams.get('depth') || 1); i++) {
      const next = new Set(ids);
      edges.forEach((e) => {
        if (ids.has(e.source) || ids.has(e.target)) {
          next.add(e.source);
          next.add(e.target);
        }
      });
      ids = next;
    }
    const inferred = url.searchParams.get('includeInferred') === 'true';
    return {
      nodes: nodes.filter((n) => ids.has(n.id)),
      edges: edges.filter(
        (e) =>
          ids.has(e.source) && ids.has(e.target) && (inferred || e.verification !== 'inferred'),
      ),
      truncated: true,
      warnings: ['Synthetic neighborhood, not real repository evidence.'],
    };
  }
  if (path.endsWith('/ask')) {
    const supported = body.question === 'Why is token refresh separate from session state?';
    const answer: Answer = {
      answer: supported
        ? 'The synthetic discussion describes preserving active sessions during token refresh.'
        : 'No supporting project history found.',
      status: supported ? 'supported' : 'not_found',
      claims: supported
        ? [
            {
              text: 'The fixture discussion describes preserving active sessions during token refresh.',
              support: 'documented',
              evidenceIds: ['fixture-discussion'],
            },
          ]
        : [],
      sources: supported ? sources : [],
      unknowns: supported
        ? ['This example is synthetic and cannot explain a real repository.']
        : ['The fixture recognizes one exact example question. No answer was generated.'],
      snapshotSha: sha,
    };
    return answer;
  }
  if (path.endsWith('/impact')) {
    if (
      body.proposedDiff ||
      !Array.isArray(body.changedFiles) ||
      body.changedFiles.length !== 1 ||
      body.changedFiles[0] !== 'src/auth.ts'
    )
      throw new ApiError(
        'FIXTURE_INPUT_UNSUPPORTED',
        'This fixture only exercises src/auth.ts. Arbitrary impact analysis requires the live backend.',
      );
    return impact;
  }
  if (url.pathname.endsWith('/knowledge-risk'))
    return {
      snapshotSha: sha,
      historyFrom: '2026-10-01',
      historyTo: '2026-10-06',
      partial: true,
      warnings: [
        'Synthetic authorship, not Git-derived evidence.',
        'Contributor aliases and truncated history can change observations.',
      ],
      files: [
        {
          path: 'src/auth.ts',
          entityId: 'auth',
          observedAuthors: 1,
          commitCount: 3,
          lastEdit: '2026-10-04',
          contributors: [{ name: 'Fixture contributor A', commits: 3 }],
          sources: [
            {
              id: 'fixture-contribution',
              kind: 'commit',
              locator: 'Synthetic contribution record - no actual Git commit',
              excerpt: 'Development-only observed modification record. Not Git-derived evidence.',
              observedAt: '2026-10-04',
            },
          ],
        },
        {
          path: 'src/session.ts',
          entityId: 'session',
          observedAuthors: 2,
          commitCount: 4,
          lastEdit: '2026-10-05',
          contributors: [
            { name: 'Fixture contributor A', commits: 3 },
            { name: 'Fixture contributor B', commits: 1 },
          ],
          sources: [
            {
              id: 'fixture-contribution',
              kind: 'commit',
              locator: 'Synthetic contribution record - no actual Git commit',
              excerpt: 'Development-only observed modification record. Not Git-derived evidence.',
              observedAt: '2026-10-04',
            },
          ],
        },
      ],
    };
  if (path.endsWith('/pr-check')) {
    if (body.prNumber !== 12)
      throw new ApiError(
        'FIXTURE_INPUT_UNSUPPORTED',
        'This fixture only exercises PR 12. A real check requires the live backend.',
      );
    return { runId: 'fixture-run' };
  }
  if (url.pathname.includes('/analysis/'))
    return {
      id: 'fixture-run',
      status: 'completed',
      prNumber: 12,
      baseSha: sha,
      headSha: '1111111111111111111111111111111111111111',
      event: 'synchronize',
      createdAt: '2026-10-06T10:00:00Z',
      stale: true,
      result: impact,
      warnings: [
        'Synthetic PR state. No Action was run or comment posted.',
        'Fixture head differs from the snapshot; this example is stale.',
      ],
    };
  if (url.pathname === `/repositories/${fixtureId}`) return repository;
  throw new ApiError(
    'SOURCE_NOT_FOUND',
    'Unknown development fixture. Open the labelled fixture repository.',
  );
}
