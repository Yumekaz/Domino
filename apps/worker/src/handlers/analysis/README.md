# Role C analysis handlers: integration notes

This directory is owned by role C. It computes deterministic structural impact and PR analysis
runs. A owns worker bootstrap, queue registration, SQL, API routes and root dependencies; B owns the
exact-SHA checkout, Git change data and historical co-change observations; D owns live frontend
binding. This code does not edit those owners' files or invent the shared wire contract.

## What A must register

```ts
import { createImpactAnalysisHandler } from "./handlers/analysis/handler.ts";
import { analyzePullRequest, getAnalysisRun } from "./handlers/analysis/pr.ts";

const analysis = createImpactAnalysisHandler({
  imports: structuralImportStore, // A implements replaceImports/getImports
  runs: analysisRunStore,         // A implements getByKey/get/save
  coChange: bCoChangeReader,      // B implements the co-change consumer port
  analyzer: structuralAnalyzer,   // C's analyzeCheckout adapter, trusted binary/config
  clock: { now: () => new Date() },
  ids: { runId: () => crypto.randomUUID() },
  // progress: (event) => jobs.update(jobId, event),
});

// pg-boss queue name: analysis.impact
```

PR ingress must call `analyzePullRequest` only after verifying GitHub/event authenticity and the
repository identity. The request/response DTO is A's responsibility; `AnalysisRunRecord` is a domain
result for A to map, not a published wire schema.

## Ports

- `StructuralImportStore.replaceImports` must atomically replace/upsert imports for
  `(repoId, snapshotId, snapshotSha)` and be idempotent for repeated runs. Only normalized
  dependency-cruiser observations belong here; never historical or LLM relationships.
- `StructuralImportStore.getImports` returns stored import observations for the exact snapshot.
- `AnalysisRunStore.getByKey` enforces idempotency; `get(repoId, runId)` must be repository-scoped.
- `CoChangeReader` is B's observed co-change result, including coverage sample size/window.
- `StructuralAnalyzerPort` should wrap `analyzeCheckout` from `packages/dependency-adapter` with the
  trusted pinned analyzer and controlled config. It must not execute repository scripts or installs.
- `checkoutDir`/`checkoutSha` come from B's exact-SHA checkout. If `checkoutSha` disagrees with the
  snapshot, the handler rejects the job.

## Behaviour

- Reverse traversal is bounded by depth, affected count and edge count. Cycles stop at a repeated
  file. Dynamic imports are retained with an explicit runtime limitation. Unresolved, external,
  vendor/generated and non-code imports never become structural edges.
- Historical co-change is returned in a separate `associations` array with sample/window metadata.
  It never creates or extends a reverse-dependency path.
- A PR whose snapshot SHA differs from the head SHA is persisted as **stale** with no result. The
  service never analyses the wrong revision.
- Duplicate PR events are idempotent by key; a new head SHA produces a new run.
- Actions URLs are accepted only when they are actual `https://github.com/<owner>/<repo>/actions/runs/<id>`
  links; otherwise they are withheld with a warning.

## Test

```powershell
cd apps/worker/src/handlers/analysis
node --test test/*.test.ts
```

The tests use in-memory ports and labelled fixtures. They do not represent database persistence or
Actions execution; A/B integration remains a separate gate.
