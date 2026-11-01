import { createHash } from "node:crypto";
import type pg from "pg";
import type { PgBoss } from "pg-boss";
import {
  listDominoWorkflowRuns,
  resolvePullRequest,
} from "../../api/src/github.ts";
import { publishedSnapshot } from "../../../packages/database/src/read-model.ts";
import { enqueuePrAnalysis } from "../../../packages/database/src/analysis-jobs.ts";

export async function syncObservedActions(deps: {
  pool: pg.Pool;
  boss: PgBoss;
  token: string;
  signal?: AbortSignal;
  list?: typeof listDominoWorkflowRuns;
  resolve?: typeof resolvePullRequest;
}) {
  const repositories = await deps.pool.query<{
    id: string;
    github_id: string;
    html_url: string;
  }>(
    "SELECT id,github_id,html_url FROM repositories ORDER BY created_at DESC,id LIMIT 10",
  );
  let queued = 0;
  for (const repo of repositories.rows) {
    if (deps.signal?.aborted) break;
    try {
      const workspace = await publishedSnapshot(deps.pool, repo.id);
      const observed = await (deps.list ?? listDominoWorkflowRuns)(
        repo.html_url,
        deps.token,
      );
      if (observed.repositoryId !== Number(repo.github_id)) continue;
      for (const run of observed.runs) {
        for (const pr of run.pull_requests.slice(0, 1)) {
          if (deps.signal?.aborted) return { queued };
          const idempotencyKey = createHash("sha256")
            .update(
              `actions-observed-v1:${repo.id}:${run.id}:${run.run_attempt}:${run.head_sha}:${pr.number}`,
            )
            .digest("hex");
          const exists = await deps.pool.query(
            "SELECT id FROM analysis_runs WHERE repo_id=$1 AND input->>'idempotencyKey'=$2",
            [repo.id, idempotencyKey],
          );
          if (exists.rows.length) continue;
          const pull = await (deps.resolve ?? resolvePullRequest)(
            repo.html_url,
            pr.number,
            deps.token,
          );
          if (
            pull.headSha !== run.head_sha ||
            (pull.repositoryId !== undefined &&
              pull.repositoryId !== Number(repo.github_id))
          )
            continue;
          const renameMap: Record<string, string> = {},
            removedFiles: string[] = [];
          for (const file of pull.fileChanges ?? []) {
            if (file.status === "renamed" && file.previousFilename)
              renameMap[file.previousFilename] = file.filename;
            if (file.status === "removed") removedFiles.push(file.filename);
          }
          if (deps.signal?.aborted) return { queued };
          await enqueuePrAnalysis(deps.pool, deps.boss, repo.id, {
            repoUrl: repo.html_url,
            githubId: Number(repo.github_id),
            workspaceSnapshotId: String(workspace.id),
            prNumber: pull.number,
            baseSha: pull.baseSha,
            headSha: pull.headSha,
            prUrl: pull.prUrl,
            event: "actions_observed",
            stale: false,
            actionsUrl: run.html_url,
            idempotencyKey,
            changedFiles: pull.changedFiles,
            truncated: pull.truncated,
            renameMap,
            removedFiles,
          });
          queued++;
        }
      }
    } catch {
      // Missing workflow, permission/rate limits or an unfinished index do not
      // interrupt deterministic local work. No remote result is fabricated.
    }
  }
  return { queued };
}
