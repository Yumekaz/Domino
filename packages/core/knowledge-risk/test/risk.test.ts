import { test } from "node:test";
import assert from "node:assert/strict";
import { computeKnowledgeRisk } from "../src/risk.ts";
import { MemoryHistoryStore } from "../../../retrieval/src/memoryStore.ts";
import type { CoverageReport, SnapshotRecord } from "../../history/src/types.ts";

const REPO = "11111111-1111-5111-8111-111111111111";
const SNAPSHOT = "22222222-2222-5222-8222-222222222222";
const SHA = "d631ea87f49443c4c8dbf84fd79bf600d11a5fac";

function coverage(overrides: Partial<CoverageReport> = {}): CoverageReport {
  return {
    sources: {
      gitHistory: {
        source: "gitHistory",
        status: "complete",
        pagesFetched: 1,
        items: 7,
        capHit: false,
        warnings: [],
        window: { from: "2025-01-01T00:00:00Z", to: "2025-03-06T12:27:36Z" },
      },
    },
    warnings: [],
    limits: {
      gitPossibleAliasGroups: 0,
      gitMailmapPresent: false,
      gitHistoryShallow: false,
    },
    ...overrides,
  };
}

async function storeWithRows(
  rows: Array<{
    path: string;
    key: string;
    name: string;
    email: string;
    commits: number;
    shas: string[];
    first: string;
    last: string;
  }>,
  report: CoverageReport = coverage(),
): Promise<MemoryHistoryStore> {
  const store = new MemoryHistoryStore();
  await store.ensureRepository({
    id: REPO,
    githubId: 315531538,
    owner: "sindresorhus",
    name: "yocto-queue",
    defaultBranch: "main",
    visibility: "public",
    htmlUrl: "https://github.com/sindresorhus/yocto-queue",
    createdAt: "2026-10-31T00:00:00Z",
  });
  const snapshot: SnapshotRecord = {
    id: SNAPSHOT,
    repoId: REPO,
    headSha: SHA,
    branch: "main",
    status: "partial",
    coverage: report,
    toolVersions: { git: "2.52.0", node: "24.13.0" },
    startedAt: "2026-10-31T00:00:00Z",
    completedAt: "2026-10-31T00:01:00Z",
    errors: [],
  };
  await store.createSnapshot(snapshot);
  await store.replaceFileContributors(
    rows.map((row) => ({
      snapshotId: SNAPSHOT,
      path: row.path,
      contributorKey: row.key,
      contributorName: row.name,
      contributorEmail: row.email,
      observedCommits: row.commits,
      firstTouch: row.first,
      lastTouch: row.last,
      commitShas: row.shas,
    })),
  );
  return store;
}

test("classifies single observed contributors without claiming absolute ownership", async () => {
  const store = await storeWithRows([
    {
      path: "src/only.ts",
      key: "git:email:alice@example.com",
      name: "Alice",
      email: "alice@example.com",
      commits: 3,
      shas: ["a".repeat(40), "b".repeat(40), "c".repeat(40)],
      first: "2025-01-01T00:00:00Z",
      last: "2025-03-01T00:00:00Z",
    },
  ]);
  const result = await computeKnowledgeRisk(
    { repoId: REPO, snapshotId: SNAPSHOT, limit: 50 },
    { store, clock: { isoNow: () => "2026-10-31T00:00:00.000Z" } },
  );
  assert.equal(result.snapshotSha, SHA);
  assert.equal(result.totalFiles, 1);
  assert.equal(result.returned, 1);
  const file = result.files[0];
  assert.ok(file);
  assert.equal(file.classification, "single_observed_contributor");
  assert.equal(file.observedAuthors, 1);
  assert.equal(file.contributors[0]?.shareOfReturnedCommits, 1);
  assert.match(file.caveats.join(" "), /does not prove that one human knows/);
  assert.match(result.caveats.join(" "), /indexed Git history/);
});

test("shows distributions for multiple authors and never labels them safe", async () => {
  const store = await storeWithRows([
    {
      path: "src/shared.ts",
      key: "git:email:alice@example.com",
      name: "Alice",
      email: "alice@example.com",
      commits: 2,
      shas: ["a".repeat(40), "b".repeat(40)],
      first: "2025-01-01T00:00:00Z",
      last: "2025-02-01T00:00:00Z",
    },
    {
      path: "src/shared.ts",
      key: "git:email:bob@example.com",
      name: "Bob",
      email: "bob@example.com",
      commits: 1,
      shas: ["c".repeat(40)],
      first: "2025-03-01T00:00:00Z",
      last: "2025-03-01T00:00:00Z",
    },
  ]);
  const result = await computeKnowledgeRisk(
    { repoId: REPO, snapshotId: SNAPSHOT },
    { store, clock: { isoNow: () => "2026-10-31T00:00:00.000Z" } },
  );
  const file = result.files[0];
  assert.ok(file);
  assert.equal(file.classification, "multiple_observed_contributors");
  assert.equal(file.observedAuthors, 2);
  assert.equal(file.contributors[0]?.shareOfReturnedCommits, 2 / 3);
  assert.equal(file.contributors[1]?.shareOfReturnedCommits, 1 / 3);
  assert.match(file.caveats.join(" "), /do not by themselves establish safety/);
});

test("discloses truncated commit samples, alias groups, shallow history and pagination", async () => {
  const report = coverage({
    sources: {
      gitHistory: {
        source: "gitHistory",
        status: "partial",
        pagesFetched: 1,
        items: 200,
        capHit: true,
        warnings: ["History analysis stopped at the configured 200-commit limit."],
        window: { from: "2024-01-01T00:00:00Z", to: "2025-03-06T12:27:36Z" },
      },
    },
    warnings: ["The checkout is shallow."],
    limits: {
      gitPossibleAliasGroups: 1,
      gitMailmapPresent: true,
      gitHistoryShallow: true,
    },
  });
  const rows = [
    {
      path: "src/legacy.ts",
      key: "git:email:alice@example.com",
      name: "Alice",
      email: "alice@example.com",
      commits: 60,
      shas: Array.from({ length: 20 }, (_, index) =>
        index.toString(16).padStart(40, "0"),
      ),
      first: "2024-01-01T00:00:00Z",
      last: "2025-03-01T00:00:00Z",
    },
    {
      path: "src/other.ts",
      key: "git:email:bob@example.com",
      name: "Bob",
      email: "bob@example.com",
      commits: 1,
      shas: ["f".repeat(40)],
      first: "2025-01-01T00:00:00Z",
      last: "2025-01-01T00:00:00Z",
    },
  ];
  const store = await storeWithRows(rows, report);
  const result = await computeKnowledgeRisk(
    { repoId: REPO, snapshotId: SNAPSHOT, limit: 1 },
    { store, clock: { isoNow: () => "2026-10-31T00:00:00.000Z" } },
  );
  assert.equal(result.returned, 1);
  assert.equal(result.totalFiles, 2);
  assert.equal(result.files[0]?.commitCountIsLowerBound, true);
  assert.match(result.files[0]?.caveats.join(" ") ?? "", /lower bound/);
  assert.match(result.caveats.join(" "), /coverage is partial/);
  assert.match(result.caveats.join(" "), /not merged/);
  assert.match(result.caveats.join(" "), /paginated/);
  assert.match(result.caveats.join(" "), /\.mailmap/);
});

test("excludes non-code paths by default and includes them on request", async () => {
  const store = await storeWithRows([
    {
      path: "readme.md",
      key: "git:email:carol@example.com",
      name: "Carol",
      email: "carol@example.com",
      commits: 1,
      shas: ["d".repeat(40)],
      first: "2025-01-01T00:00:00Z",
      last: "2025-01-01T00:00:00Z",
    },
  ]);
  const defaultResult = await computeKnowledgeRisk(
    { repoId: REPO, snapshotId: SNAPSHOT },
    { store, clock: { isoNow: () => "2026-10-31T00:00:00.000Z" } },
  );
  assert.equal(defaultResult.returned, 0);
  assert.match(defaultResult.caveats.join(" "), /No files/);
  const allResult = await computeKnowledgeRisk(
    { repoId: REPO, snapshotId: SNAPSHOT, includeAllPaths: true },
    { store, clock: { isoNow: () => "2026-10-31T00:00:00.000Z" } },
  );
  assert.equal(allResult.returned, 1);
});

test("requires a published snapshot", async () => {
  const store = new MemoryHistoryStore();
  await assert.rejects(
    computeKnowledgeRisk(
      { repoId: REPO, snapshotId: SNAPSHOT },
      { store, clock: { isoNow: () => "2026-10-31T00:00:00.000Z" } },
    ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === "SNAPSHOT_NOT_FOUND",
  );
});
