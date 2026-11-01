/** Synthetic UI exercises only. Never imported by a production build. No GitHub evidence is claimed. */
import type { Answer, Edge, Entity, Impact, Repository } from '../api/schemas';
import { ApiError } from '../api/client';
import {
  fixtureAuthId,
  fixtureCommitId,
  fixtureContributionSourceId,
  fixtureContributorId,
  fixtureDashboardId,
  fixtureDocumentId,
  fixtureIssueId,
  fixtureJobId,
  fixturePullRequestId,
  fixtureRepositoryId,
  fixtureRunId,
  fixtureSessionId,
  fixtureSnapshotId,
  fixtureSourceId,
} from './fixtureIds';

export const fixtureId = fixtureRepositoryId;
const sha = '0000000000000000000000000000000000000000';
const at = (date: string) => `${date}T00:00:00Z`;
const nodes: Entity[] = [
  {
    id: fixtureIssueId,
    kind: 'Issue',
    title: 'Keep sessions during token refresh',
    date: at('2026-10-01'),
    excerpt: 'SYNTHETIC: Refreshing a token should not discard an active session.',
  },
  {
    id: fixturePullRequestId,
    kind: 'PullRequest',
    title: 'Separate token refresh from session state',
    date: at('2026-10-03'),
    excerpt: 'SYNTHETIC: Preserve the session while the token is refreshed.',
  },
  {
    id: fixtureCommitId,
    kind: 'Commit',
    title: 'Preserve active sessions',
    date: at('2026-10-04'),
  },
  { id: fixtureAuthId, kind: 'File', title: 'auth.ts', path: 'src/auth.ts', date: at('2026-10-04') },
  {
    id: fixtureSessionId,
    kind: 'File',
    title: 'session.ts',
    path: 'src/session.ts',
    date: at('2026-10-04'),
  },
  {
    id: fixtureDashboardId,
    kind: 'File',
    title: 'dashboard.tsx',
    path: 'src/dashboard.tsx',
    date: at('2026-10-05'),
  },
  { id: fixtureContributorId, kind: 'Contributor', title: 'Fixture contributor A', date: at('2026-10-03') },
  { id: fixtureDocumentId, kind: 'Document', title: 'Session design notes', date: at('2026-10-06') },
];
const baseEdges: Array<
  Pick<Edge, 'id' | 'source' | 'target' | 'kind' | 'verification'>
> = [
  {
    id: 'f0000000-0000-4000-8000-000000000030',
    source: fixturePullRequestId,
    target: fixtureIssueId,
    kind: 'CLOSES_ISSUE',
    verification: 'observed',
  },
  {
    id: 'f0000000-0000-4000-8000-000000000031',
    source: fixtureCommitId,
    target: fixturePullRequestId,
    kind: 'IN_PR',
    verification: 'observed',
  },
  {
    id: 'f0000000-0000-4000-8000-000000000032',
    source: fixtureCommitId,
    target: fixtureAuthId,
    kind: 'MODIFIED',
    verification: 'observed',
  },
  {
    id: 'f0000000-0000-4000-8000-000000000033',
    source: fixtureSessionId,
    target: fixtureAuthId,
    kind: 'IMPORTS',
    verification: 'observed',
  },
  {
    id: 'f0000000-0000-4000-8000-000000000034',
    source: fixtureDashboardId,
    target: fixtureSessionId,
    kind: 'IMPORTS',
    verification: 'observed',
  },
  {
    id: 'f0000000-0000-4000-8000-000000000035',
    source: fixtureContributorId,
    target: fixtureCommitId,
    kind: 'AUTHORED',
    verification: 'observed',
  },
  {
    id: 'f0000000-0000-4000-8000-000000000036',
    source: fixtureDocumentId,
    target: fixtureSessionId,
    kind: 'DOCUMENTS',
    verification: 'inferred',
  },
  {
    id: 'f0000000-0000-4000-8000-000000000037',
    source: fixtureAuthId,
    target: fixtureDashboardId,
    kind: 'CO_CHANGED_WITH',
    verification: 'derived',
  },
];
const edges: Edge[] = baseEdges.map((edge) => ({
  ...edge,
  snapshotSha: sha,
  extractor: 'Synthetic fixture adapter',
  evidenceExcerpt: 'Development-only relationship. Not an observation of a real repository.',
  observedAt: at('2026-10-04'),
}));
const sources = [
  {
    id: fixtureSourceId,
    kind: 'pr_comment',
    locator: 'Synthetic PR discussion · no public source',
    excerpt: 'SYNTHETIC: We separate token refresh to keep active sessions intact.',
    observedAt: at('2026-10-03'),
  },
];
const repository: Repository = {
  id: fixtureRepositoryId,
  owner: 'domino-example',
  name: 'causal-lab',
  url: 'https://github.com/domino-example/causal-lab',
  snapshot: {
    id: fixtureSnapshotId,
    headSha: sha,
    branch: 'fixture/main',
    status: 'partial',
    completedAt: '2026-10-06T10:00:00Z',
    historyFrom: at('2026-10-01'),
    historyTo: at('2026-10-06'),
    coverage: [
      {
        kind: 'Commits',
        indexed: 3,
        status: 'partial',
        warnings: ['Synthetic limited fixture history.'],
      },
      { kind: 'Pull requests', indexed: 1, status: 'complete', warnings: [] },
      { kind: 'Issues', indexed: 1, status: 'complete', warnings: [] },
      {
        kind: 'Documents',
        indexed: 1,
        status: 'partial',
        warnings: ['Synthetic limited fixture history.'],
      },
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
      cochange: {
        sampleSize: 2,
        targetCommits: 5,
        windowFrom: at('2026-10-01'),
        windowTo: at('2026-10-06'),
      },
    },
    {
      file: 'src/runtime-entry.ts',
      signal: 'unknown',
      depth: 0,
      path: [],
      impact: 'unknown',
      explanation:
        'Synthetic unresolved runtime reference. No structural dependency has been established and no real repository was analyzed.',
      evidence: [],
    },
  ],
  warnings: [
    'Development fixture, not a computed impact result.',
    'Runtime dependencies are outside this illustrative analysis.',
  ],
  truncated: false,
};
let importedAt = 0;
export async function fixtureRequest(path: string, init?: RequestInit): Promise<unknown> {
  if (!import.meta.env.DEV) throw new Error('Fixtures are unavailable in production.');
  init?.signal?.throwIfAborted();
  const url = new URL(path, 'https://fixture.invalid');
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  if (path === '/health') return { status: 'ok', database: 'ok', queue: 'ok' };
  if (path === '/repositories' && init?.method === 'POST') {
    if (body.url !== repository.url)
      throw new ApiError(
        'FIXTURE_REPO_ONLY',
        `Fixture mode only simulates ${repository.url}. Start the live development server to import a real repository.`,
      );
    importedAt = Date.now();
    return { repoId: fixtureRepositoryId, jobId: fixtureJobId };
  }
  if (url.pathname.includes('/jobs/'))
    return {
      id: fixtureJobId,
      status: Date.now() - importedAt > 2000 ? 'partial' : 'running',
      phase:
        Date.now() - importedAt > 2000
          ? 'Complete with fixture warnings'
          : 'Simulating history collection',
      warnings: ['Development-only simulated job.'],
    };
  if (path.endsWith('/reindex')) {
    importedAt = Date.now();
    return { repoId: fixtureRepositoryId, jobId: fixtureJobId };
  }
  if (url.pathname.endsWith('/search')) {
    const q = (url.searchParams.get('q') || '').toLowerCase();
    return {
      items: nodes.filter((n) => `${n.title} ${n.kind} ${n.path || ''}`.toLowerCase().includes(q)),
      nextCursor: null,
      snapshotSha: sha,
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
      snapshotSha: sha,
      truncated: false,
      warnings: ['Synthetic fixture neighborhood.'],
    };
  }
  if (url.pathname.endsWith('/graph')) {
    const selected = url.searchParams.get('entityId') || fixtureAuthId;
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
      snapshotSha: sha,
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
              evidenceIds: [fixtureSourceId],
            },
          ]
        : [],
      sources: supported ? sources : [],
      unknowns: supported
        ? ['This example is synthetic and cannot explain a real repository.']
        : ['The fixture recognizes one exact example question. No answer was generated.'],
      warnings: [],
      snapshotSha: sha,
      errorCode: null,
      searchAvailable: true,
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
      historyFrom: at('2026-10-01'),
      historyTo: at('2026-10-06'),
      partial: true,
      warnings: [
        'Synthetic authorship, not Git-derived evidence.',
        'Contributor aliases and truncated history can change observations.',
      ],
      files: [
        {
          path: 'src/auth.ts',
          entityId: fixtureAuthId,
          observedAuthors: 1,
          commitCount: 3,
          commitCountIsLowerBound: false,
          lastEdit: at('2026-10-04'),
          contributors: [{ name: 'Fixture contributor A', commits: 3 }],
          sources: [
            {
              id: fixtureContributionSourceId,
              kind: 'commit',
              locator: 'Synthetic contribution record - no actual Git commit',
              excerpt: 'Development-only observed modification record. Not Git-derived evidence.',
              observedAt: at('2026-10-04'),
            },
          ],
          caveats: ['Synthetic authorship; not a real Git observation.'],
        },
        {
          path: 'src/session.ts',
          entityId: fixtureSessionId,
          observedAuthors: 2,
          commitCount: 4,
          commitCountIsLowerBound: false,
          lastEdit: at('2026-10-05'),
          contributors: [
            { name: 'Fixture contributor A', commits: 3 },
            { name: 'Fixture contributor B', commits: 1 },
          ],
          sources: [
            {
              id: fixtureContributionSourceId,
              kind: 'commit',
              locator: 'Synthetic contribution record - no actual Git commit',
              excerpt: 'Development-only observed modification record. Not Git-derived evidence.',
              observedAt: at('2026-10-04'),
            },
          ],
          caveats: ['Synthetic authorship; not a real Git observation.'],
        },
      ],
      nextCursor: null,
    };
  if (path.endsWith('/pr-check')) {
    if (body.prNumber !== 12)
      throw new ApiError(
        'FIXTURE_INPUT_UNSUPPORTED',
        'This fixture only exercises PR 12. A real check requires the live backend.',
      );
    return { runId: fixtureRunId };
  }
  if (url.pathname.includes('/analysis/'))
    return {
      id: fixtureRunId,
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
  if (url.pathname.endsWith('/analyses/latest'))
    throw new ApiError(
      'FIXTURE_INPUT_UNSUPPORTED',
      'Automatic Actions runs require the live backend; this fixture contains no Actions run.',
    );
  if (url.pathname === `/repositories/${fixtureRepositoryId}`) return repository;
  throw new ApiError(
    'SOURCE_NOT_FOUND',
    'Unknown development fixture. Open the labelled fixture repository.',
  );
}
