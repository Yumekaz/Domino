# Domino pull-request impact check

This directory contains the read-only GitHub Actions workflow and its summary generator. It is
owned by role C. It computes deterministic reverse structural impact from dependency-cruiser
observations at the PR head and writes a `GITHUB_STEP_SUMMARY`.

## Trust model

- Trigger: `pull_request` only, for `opened`, `reopened` and `synchronize`. There is no
  `pull_request_target` and no privileged checkout of untrusted code.
- Permissions: `contents: read` and `pull-requests: read` only. No write permission and no
  repository secrets are passed to the job.
- Analyzer code and configuration come from a separate checkout of the **base** revision
  (`analyzer/`). The PR head is checked out separately under `target/` and is treated only as data.
- The workflow installs the trusted base workspace at `analyzer/` with `npm ci --ignore-scripts` so
  dependency-cruiser and its TypeScript peer resolve together. It never installs dependencies, runs
  scripts, builds, hooks, tests or configuration from the target repository. Target Git metadata is
  removed before analysis; target files are treated only as data.
- Changed-file metadata comes from GitHub's read-only pull-request files API with a bounded
  300-file/page limit. The analyzer runs with a 120-second budget and bounded output.
- Execution argument arrays are used throughout; no shell concatenation of PR content.

## Output

The summary includes the repository, PR number, event, full base/head SHAs, analyzer version and
config hash, changed files, direct/transitive possible-impact paths, evidence specifiers, and
limitations. Dynamic imports, unresolved/external modules and missing co-change data remain
explicit. No PR comment, check conclusion, or database analysis run is created by this workflow.

**Bootstrap:** before this package is merged into the base branch, the workflow detects that the
trusted analyzer is absent from the base checkout, writes a short “not yet bootstrapped” summary,
and skips analysis. It does not display a computed impact result or a fabricated success.

## Setup

1. Merge this workflow and `packages/dependency-adapter` on the default/base branch.
2. Optionally configure repository variables:
   - `DOMINO_TARGET_PATH` (default `.`) — code root to analyze inside the PR checkout.
   - `DOMINO_TSCONFIG` (default empty; auto-detects `tsconfig.json` at the target root,
     repository root, or `apps/web/tsconfig.json`).
3. Open or update a PR. The summary appears under the Actions run.

## Local dry run

The script supports a local changed-files file instead of the GitHub API. It still uses the real
pinned analyzer:

```powershell
cd packages/dependency-adapter
npm ci --ignore-scripts
$env:DOMINO_ANALYZER_ROOT = (Resolve-Path ../..)
$env:DOMINO_TARGET_ROOT = (Resolve-Path ../..)
$env:DOMINO_TARGET_PATH = "apps/web/src"
$env:DOMINO_TSCONFIG = "apps/web/tsconfig.json"
$env:DOMINO_CHANGED_FILES_FILE = "changed-files.json"
node ../../integrations/github-action/analyze-pr.mjs
```

`changed-files.json` uses GitHub's file-record shape (`filename`, `status`, optional
`previous_filename`). This local path is a development aid, not live Actions evidence.

## Tests

```powershell
cd integrations/github-action
node --test test/*.test.ts
```

Tests cover event validation, changed-file parsing/pagination, summary truthfulness and static
workflow security properties. Remote execution was verified on temporary PR #13: opened head
`2e2a590…` (run 41175040860) and synchronized head `9410250…` (run 41175108532), each with real
direct dependents and a genuine step summary.

## Limitations

- Fork PRs receive the read-only token and may require maintainer approval depending on repository
  settings. No secrets are exposed.
- The check analyses static imports only. Dynamic imports, runtime dependency injection, unresolved
  aliases, generated files and external modules remain limitations.
- Historical co-change is unavailable in this read-only workflow because it requires the indexed
  dataset. It is never inferred from import paths.
- The workflow does not persist an analysis run or supply a database-backed Actions URL to the
  frontend. A owns run persistence and the API ingestion of a genuine Actions URL.
