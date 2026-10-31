# Structural impact and PR checks

Role C implementation notes, 31 October 2026. This document describes the deterministic structural
analysis delivered in `codex/backend-c`. It does not claim that shared contracts, database
persistence, API routes or live GitHub Actions execution are complete; those remain A/B gates.

## Data flow

1. **Analyzer adapter** (`packages/dependency-adapter`)
   - Trusted pinned `dependency-cruiser@18.7.0` with `tsc` parser and TypeScript 6.0.3.
   - Runs against a repository-relative target in a supplied exact-SHA checkout.
   - Emits normalized `importer → imported` observations with extractor/version/config hash,
     snapshot SHA and import specifier. External, unresolved, non-code, vendor, generated and
     declaration modules never become structural edges.
2. **Impact core** (`packages/core/impact`)
   - Bounded reverse breadth-first traversal from changed files to importers, depth 1–3.
   - One deterministic shortest explanatory path per affected file; cycles stop at repeated files.
   - Evidence remains attached to every hop; dynamic imports are retained with an explicit runtime
     limitation; unresolved gaps are warnings, never fabricated paths.
   - Co-change is a **separate association collection** with sample size, support, share, commit
     SHAs and observation window. It never creates an import arrow.
3. **Worker analysis handler** (`apps/worker/src/handlers/analysis`)
   - Uses A's `StructuralImportStore` and `AnalysisRunStore` ports and B's co-change port.
   - Stores only normalized analyzer observations; repeat runs are idempotent. B's co-change failure
     removes only the association signal, not structural results.
   - PR runs are keyed by repository/snapshot/base/head/event. A snapshot that does not match the PR
     head is persisted as **completed with `stale: true` and no result**; it never analyses the wrong
     revision. Invalid Actions URLs are withheld.
   - `toContractAnalysis`/`toContractAnalysisInput` map domain runs to A's accepted
     `analysisSchema`/`analysisInputSchema`.
4. **On-demand API impact service** (`packages/core/impact/src/service.ts`)
   - Implements A's `ImpactServicePort` over a narrow snapshot/reverse-dependency source port and
     B's co-change port. A can wire its database functions without C owning SQL.
   - Bounded per-file reverse lookups (500 rows), at most 2,000 files and 200,000 edges. Source
     truncation and missing analyzer provenance remain visible warnings.
   - `toContractImpact` maps structural and co-change signals to A's `impactSchema` and rejects
     non-conforming proof instead of coercing it.
5. **Read-only workflow** (`.github/workflows/pr-impact.yml`, `integrations/github-action`)
   - `pull_request` opened/reopened/synchronize only; minimal `contents: read` and
     `pull-requests: read`; actions pinned by commit SHA.
   - Analyzer code is checked out from the exact **base** revision; the PR head is a separate
     read-only data checkout.
   - Only the pinned analyzer dependency is installed (`npm ci --ignore-scripts`); target installs,
     builds, hooks, scripts and configuration are never executed.
   - Changed-file metadata comes from GitHub's read-only API with a 300-file bound; output is a
     real `GITHUB_STEP_SUMMARY`. No PR comment or database run is implied.

## Measured evidence (C-01)

The real spike used the accepted checkout at
`f62846192575672c4f1b7b2fe424e853218c9a15` (tree equal to frontend freeze `0716669`) and analyzed
`apps/web/src` with the actual pinned analyzer:

- 53 modules cruised; 41 code modules + 12 CSS/declaration modules excluded
- 123 dependencies → 105 structural imports
- 7 dynamic, 12 circular, 3 unresolved observations
- Real direct impact: changing `pages/investigations.tsx` affects `pages/Workspace.tsx`
- Real transitive impact: `main.tsx` (dynamic import) → `Workspace.tsx` → `investigations.tsx`
- dependency-cruiser JSON exposes no source line numbers, so evidence records `line: null` rather
  than inventing one.

The sanitized real output and metadata are committed under
`packages/dependency-adapter/test/fixtures/`. Tests consume this output; the local workflow dry run
also produced the same paths from a fresh analyzer invocation.

## Bounds

| Bound | Default |
| --- | --- |
| Reverse depth | 3 (1–3 accepted) |
| Affected files | 200 |
| Structural edges | 200,000 |
| Proposed diff | 250 KB, 20,000 lines, 200 files |
| Analyzer timeout | 120 seconds |
| Analyzer output | 64 MB |
| PR changed files | 300 |
| PR polling/workflow job | 15 minutes |

## Explicit limitations

- Static imports describe possible impact, not guaranteed runtime breakage.
- Dynamic imports, unresolved external modules, runtime dependency injection, generated files and
  resolver/alias gaps remain limitations.
- Feature/test/decision mappings are omitted unless stored mappings exist.
- Historical co-change is unavailable to the read-only workflow because it needs the indexed
  dataset; the API path can return it separately through B's port.
- Shared Zod/API contracts are now available on integration; C maps its domain result to A's
  `impactSchema`/`analysisSchema` in contract tests. A still owns route/DB wiring.
- Database persistence, API routes/job registration, and genuine remote Actions execution remain
  A/B gates. C-02/C-05/C-07 are implemented against ports and tested in memory; C-09 is not
  performed.

## Verification

```powershell
cd packages/dependency-adapter
npm ci --ignore-scripts
node --test test/*.test.ts
./node_modules/.bin/tsc -p tsconfig.json --noEmit

cd ../core/impact
node --test test/*.test.ts
../../dependency-adapter/node_modules/.bin/tsc -p tsconfig.json --noEmit

cd ../../../apps/worker/src/handlers/analysis
node --test test/*.test.ts
../../../../../packages/dependency-adapter/node_modules/.bin/tsc -p tsconfig.json --noEmit

cd ../../../../../integrations/github-action
node --test test/*.test.ts
```
