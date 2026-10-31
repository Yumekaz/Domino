import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import {
  analysisInputSchema,
  analysisSchema,
  prCheckResponseSchema,
  type Impact,
  type ImpactServicePort,
  type PrCheckServicePort,
} from "../../../packages/contracts/src/index.ts";
import {
  MissingRecord,
  publishedSnapshot,
} from "../../../packages/database/src/read-model.ts";
import { ApiFailure } from "./errors.ts";
import { resolvePullRequest } from "./github.ts";

type PrCheckDeps = {
  pool: pg.Pool;
  impact: ImpactServicePort;
  token?: string;
  resolve?: typeof resolvePullRequest;
};

type StoredRun = { id: string };

async function existingRun(
  pool: pg.Pool,
  repoId: string,
  idempotencyKey: string,
): Promise<StoredRun | null> {
  const result = await pool.query<StoredRun>(
    `SELECT id FROM analysis_runs
     WHERE repo_id=$1 AND kind='pull_request' AND input->>'idempotencyKey'=$2
     LIMIT 1`,
    [repoId, idempotencyKey],
  );
  return result.rows[0] ?? null;
}

/**
 * Manual PR analysis trigger used by the workspace. It resolves the PR's exact
 * revisions from GitHub, analyses the indexed snapshot through C's deterministic
 * impact service, and persists a pollable analysis run. The automatic PR check
 * remains C's read-only Actions workflow.
 */
export function createPrCheckService(deps: PrCheckDeps): PrCheckServicePort {
  return {
    async start(repoId, input) {
      const repository = await deps.pool.query<{ html_url: string }>(
        "SELECT html_url FROM repositories WHERE id=$1",
        [repoId],
      );
      if (!repository.rows[0])
        throw new MissingRecord("Repository was not found.");
      const resolve = deps.resolve ?? resolvePullRequest;
      const pull = await resolve(
        repository.rows[0].html_url,
        input.prNumber,
        deps.token,
      );
      let snapshot;
      try {
        snapshot = await publishedSnapshot(deps.pool, repoId);
      } catch (error) {
        if (error instanceof MissingRecord)
          throw new ApiFailure(
            409,
            "INDEX_PARTIAL",
            "Index a repository before requesting a pull-request analysis.",
            true,
          );
        throw error;
      }
      const snapshotId = String(snapshot.id);
      const snapshotSha = String(snapshot.head_sha);
      const stale = snapshotSha !== pull.headSha;
      const event = "manual";
      const idempotencyKey = createHash("sha256")
        .update(
          JSON.stringify({
            repoId,
            snapshotSha,
            prNumber: pull.number,
            baseSha: pull.baseSha,
            headSha: pull.headSha,
            event,
          }),
        )
        .digest("hex");
      const prior = await existingRun(deps.pool, repoId, idempotencyKey);
      if (prior) return prCheckResponseSchema.parse({ runId: prior.id });

      const warnings: string[] = [];
      if (pull.truncated)
        warnings.push(
          "GitHub returned more than 300 changed files; the analysis is bounded to the first 300.",
        );
      let status: "completed" | "failed" = "completed";
      let result: Impact | null = null;
      if (stale) {
        warnings.push(
          `The active snapshot ${snapshotSha.slice(0, 8)} does not match the PR head ${pull.headSha.slice(0, 8)}. No impact result was substituted. Manual analysis requires a matching indexed revision; refreshing the default branch may not match this PR head.`,
        );
      } else {
        try {
          result = await deps.impact.analyze(repoId, {
            snapshotId,
            changedFiles: pull.changedFiles,
            maxDepth: 3,
          });
        } catch (error) {
          const candidate = (error as { code?: unknown }).code;
          const code =
            typeof candidate === "string" &&
            /^[A-Z][A-Z_]{2,63}$/.test(candidate)
              ? candidate
              : "IMPACT_FAILED";
          status = "failed";
          warnings.push(
            `Impact analysis failed (${code}). No result was substituted; inspect the indexed structural coverage.`,
          );
        }
      }
      const runId = randomUUID();
      const output = analysisSchema.parse({
        id: runId,
        status,
        prNumber: pull.number,
        baseSha: pull.baseSha,
        headSha: pull.headSha,
        event,
        createdAt: new Date().toISOString(),
        stale,
        result,
        warnings,
        prUrl: pull.prUrl,
      });
      const runInput = {
        ...analysisInputSchema.parse({
          prNumber: pull.number,
          baseSha: pull.baseSha,
          headSha: pull.headSha,
          event,
          stale,
          prUrl: pull.prUrl,
          idempotencyKey,
        }),
        snapshotId,
        snapshotSha,
      };
      const inserted = await deps.pool.query<StoredRun>(
        `INSERT INTO analysis_runs(id,repo_id,snapshot_id,kind,status,input,output,warnings,created_at)
         VALUES($1,$2,$3,'pull_request',$4,$5::jsonb,$6::jsonb,$7::jsonb,now())
         ON CONFLICT DO NOTHING RETURNING id`,
        [
          runId,
          repoId,
          snapshotId,
          status,
          JSON.stringify(runInput),
          JSON.stringify(output),
          JSON.stringify(warnings),
        ],
      );
      if (inserted.rows[0])
        return prCheckResponseSchema.parse({ runId: inserted.rows[0].id });
      const raced = await existingRun(deps.pool, repoId, idempotencyKey);
      if (!raced)
        throw new ApiFailure(
          503,
          "ANALYSIS_UNAVAILABLE",
          "The analysis run could not be persisted.",
          true,
        );
      return prCheckResponseSchema.parse({ runId: raced.id });
    },
  };
}
