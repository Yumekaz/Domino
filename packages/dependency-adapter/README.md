# dependency adapter

Normalizes trusted dependency-cruiser observations for the Domino impact service. Role C owns this
package; A owns the root workspace and dependency policy, B supplies the exact-SHA checkout.

## Pinned analyzer

- `dependency-cruiser@18.7.0` (MIT)
- TypeScript `6.0.3` for the `tsc` parser
- Controlled config: `parser: "tsc"`, `tsPreCompilationDeps: true`, `doNotFollow: node_modules`,
  explicit vendor/generated exclusions. The caller provides the target `tsconfig` path.
- No repository config, script, install or build is executed. The analyzer receives an explicit
  argument array, a bounded timeout and a bounded output buffer. Only non-secret environment
  variables reach the subprocess.

## Real C-01 spike

A real run on this repository at `f62846192575672c4f1b7b2fe424e853218c9a15` analyzed
`apps/web/src`:

- 53 modules cruised (41 code modules + 12 CSS/declaration modules excluded)
- 123 dependencies observed → 105 structural imports
- 7 dynamic imports, 12 circular imports, 3 unresolved imports
- Real chain: `apps/web/src/main.tsx` dynamically imports `pages/Workspace.tsx`, which statically
  imports `pages/investigations.tsx`. The direct edge is circular; the transitive path includes a
  dynamic import.

The sanitized analyzer JSON and metadata are in `test/fixtures/`. Machine-specific
`summary.optionsUsed` was removed; modules/dependencies are verbatim. dependency-cruiser's JSON does
not expose source line numbers, so evidence records `line: null` rather than inventing one.

## Use

```ts
import {
  analyzeCheckout,
  buildDependencyCruiserConfig,
  hashAnalyzerConfiguration,
  ANALYZER_VERSION,
} from "./src/index.ts";

const config = buildDependencyCruiserConfig({ tsConfigPath: "/checkout/apps/web/tsconfig.json" });
const result = await analyzeCheckout({
  scriptPath: "/analyzer/node_modules/dependency-cruiser/bin/dependency-cruiser.mjs",
  workingDirectory: "/checkout",
  targetDir: "apps/web/src",
  configPath: "/tmp/domino-config.json",
  metadata: {
    repositoryId: "owner/repo",
    snapshotSha: "<full 40-hex SHA>",
    analyzer: "dependency-cruiser",
    version: ANALYZER_VERSION,
    configHash: hashAnalyzerConfiguration(ANALYZER_VERSION, config),
    analyzedAt: new Date().toISOString(),
  },
});
```

`workingDirectory` must be the checked-out repository root so stored paths remain
repository-relative. `scriptPath` avoids Windows `.cmd` shim issues; `binaryPath` is also supported
for Unix installations.

## Output guarantees

- Importer → imported direction is preserved.
- External, unresolved, non-code, vendor, generated and declaration imports never become edges.
- Duplicate observations are deduplicated; dynamic/circular flags are retained.
- Every edge carries extractor/version/config hash/snapshot SHA and a specifier locator.
- No historical, co-change or LLM relationship is accepted by this adapter.

## Verify

```powershell
cd packages/dependency-adapter
npm ci --ignore-scripts
node --test test/*.test.ts
npm run typecheck
```

The package-local lockfile pins the analyzer for the read-only workflow. A owns root workspace
integration; this lockfile should be adopted or relocated rather than bypassed.
