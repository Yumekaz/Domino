# Domino pull-request impact check

This directory contains the read-only GitHub Actions workflow and its summary generator. It is
owned by role C. It computes deterministic reverse structural impact from dependency-cruiser
observations at the PR head and writes a `GITHUB_STEP_SUMMARY`.

## Trust model

- Trigger: `pull_request` only, for `opened`, `reopened` and `synchronize`. There is no
  `pull_request_target` and no privileged checkout of untrusted code.
- Permissions: `contents: read` and `pull-requests: read` only. No write permission is granted.
  The only secret available to the compute step is `DOMINO_API_TOKEN`, and only when the repository
  configures it. It is sent exclusively as a Bearer header to the configured HTTPS
  `DOMINO_API_URL`. Fork pull requests do not receive repository secrets, so a fork run produces
  the summary but skips ingestion.
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
explicit. It never posts a PR comment or a check conclusion.

When `DOMINO_API_URL`, `DOMINO_WEB_URL` and the `DOMINO_API_TOKEN` secret are configured, the run is
also ingested into Domino through `POST /api/v1/integrations/pr-analysis`. The API re-resolves the
public PR, requires the exact base/head SHAs, validates the Actions run URL against the repository,
and persists one idempotent analysis run with the real Actions URL. The summary then links to that
run. Ingestion requires the repository to be imported already. Any ingestion failure is reported
in the summary as a warning and never fails the check; the GitHub summary remains authoritative.

**Bootstrap:** before this package is merged into the base branch, the workflow detects that the
trusted analyzer is absent from the base checkout, writes a short “not yet bootstrapped” summary,
and skips analysis. It does not display a computed impact result or a fabricated success.

## Setup

1. Merge this workflow and `packages/dependency-adapter` on the default/base branch.
2. Optionally configure repository variables:
   - `DOMINO_TARGET_PATH` (default `.`) — code root to analyze inside the PR checkout.
   - `DOMINO_TSCONFIG` (default empty; auto-detects `tsconfig.json` at the target root,
     repository root, or `apps/web/tsconfig.json`).
   - `DOMINO_API_URL` — public HTTPS origin of the Domino API, without `/api/v1`.
   - `DOMINO_WEB_URL` — public HTTPS origin of the Domino web app for the run link.
3. To enable ingestion, add a repository secret `DOMINO_API_TOKEN` that matches the API's Bearer
   token. Import the repository into Domino first. Without these settings the workflow is
   summary-only and says so; it never invents a workspace link.
4. Open or update a PR. The summary appears under the Actions run, and the Domino PR view can open
   the ingested run with **Find automatic run**.

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

Tests cover event validation, changed-file parsing/pagination, summary truthfulness, optional Domino
ingestion (request shape, non-fatal failures, run links) and static workflow security properties.
Remote execution was verified on temporary PR #13: opened head `2e2a590…` (run 41175040860) and
synchronized head `9410250…` (run 41175108532), each with real direct dependents and a genuine step
summary. Automatic ingestion was then verified locally end-to-end: the real analyzer replayed PR #13's
synchronized head, a local Fastify API verified the public PR revisions through GitHub, persisted the
run with the real Actions URL, and the browser opened it through **Find automatic run**. That run used
a temporary local PostgreSQL database; hosted ingestion remains a deployment step.

## Limitations

- Fork PRs receive the read-only token and may require maintainer approval depending on repository
  settings. Repository secrets are unavailable to fork runs, so those runs remain summary-only.
- The check analyses static imports only. Dynamic imports, runtime dependency injection, unresolved
  aliases, generated files and external modules remain limitations.
- Historical co-change is unavailable in this read-only workflow because it requires the indexed
  dataset. It is never inferred from import paths.
- Ingestion requires an already-imported repository, an API URL reachable from the runner and a
  matching API token. The ingested run carries no snapshot ID and its result is the workflow's
  structural analysis at the PR head; it does not replace a manual indexed-snapshot analysis.
