# core impact

Deterministic domain logic for reverse structural impact and historical co-change presentation.
Role C owns this package; A owns storage/API/contracts; B supplies Git observations and co-change;
D binds the returned values to the existing frontend.

## Structural impact

`computeStructuralImpact(options, edges)` requires:

- a full 40-character snapshot SHA;
- exactly one input mode: `changedFiles` or `proposedDiff`;
- normalized analyzer edges for that same snapshot (a mismatch is rejected);
- depth 1–3, at most 200 affected files by default and 200,000 edges.

It builds a reverse adjacency `imported → importers` map, traverses breadth-first, stops at the
depth cap, stops cycles at a repeated file, keeps one deterministic shortest path per affected file,
and returns each path with importer evidence in dependent → changed-file order. It never reads
source text, runs an analyzer, or invents a feature/test mapping.

Dynamic imports remain in the result but are labelled and warned about; unresolved/external/gaps
never become edges. `proposedDiff` is parsed as data with byte/line/file caps; renamed, deleted,
added and binary paths stay explicit. Rename mappings resolve changed paths to the current path.

Co-change is adapted from B's `CoChangeResult` into a **separate `associations` array** containing
`sharedCommits`, `targetCommits`, `share`, commit SHAs, the actual observation window and coverage
caveats. It can never create or extend a structural path.

## Output

`ImpactResult` contains `changedFiles`, `snapshotSha`, `affected`, `associations`, `warnings` and
coverage counters. A maps this domain result to the shared API contract; this is not a published
wire DTO. The frontend's structural rendering guard remains presentation-only, not server
validation.

## Verify

```powershell
cd packages/dependency-adapter && npm ci --ignore-scripts
cd ../core/impact
node --test test/*.test.ts
../../dependency-adapter/node_modules/.bin/tsc -p tsconfig.json --noEmit
```

The real-analyzer test consumes the C-01 fixture and proves the real
`main.tsx → Workspace.tsx → investigations.tsx` path.
