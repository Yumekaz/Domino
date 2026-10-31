import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import {
  analysisInputSchema,
  analysisJobSchema,
  githubUrlSchema,
  idSchema,
  repositoryPathSchema,
} from "../../contracts/src/index.ts";

export const ANALYSIS_QUEUE = "analysis.impact";
export type AnalysisJobPayload = z.infer<typeof analysisJobSchema>;
export const queuedPrInputSchema = analysisInputSchema.extend({
  repoUrl: githubUrlSchema,
  githubId: z.number().int().positive().safe(),
  snapshotId: idSchema,
  workspaceSnapshotId: idSchema,
  changedFiles: z.array(repositoryPathSchema).max(300),
  renameMap: z.record(repositoryPathSchema, repositoryPathSchema).default({}),
  removedFiles: z.array(repositoryPathSchema).max(300).default([]),
  truncated: z.boolean(),
  queueJobId: idSchema,
  attempt: z.number().int().positive(),
});
export type QueuedPrInput = z.infer<typeof queuedPrInputSchema>;

/** Run, isolated PR snapshot and queue message are committed together. */
export async function enqueuePrAnalysis(
  pool: pg.Pool,
  boss: PgBoss,
  repoId: string,
  input: Omit<QueuedPrInput, "snapshotId" | "queueJobId" | "attempt">,
): Promise<{ runId: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
      String(input.githubId),
    ]);
    const existing = await client.query<{
      id: string;
      status: string;
      input: { attempt?: number };
    }>(
      "SELECT id,status,input FROM analysis_runs WHERE repo_id=$1 AND kind='pull_request' AND input->>'idempotencyKey'=$2 FOR UPDATE",
      [repoId, input.idempotencyKey],
    );
    const prior = existing.rows[0];
    if (prior && !["failed", "cancelled"].includes(prior.status)) {
      await client.query("COMMIT");
      return { runId: prior.id };
    }
    const runId = prior?.id ?? randomUUID();
    const snapshotId = randomUUID();
    const queueJobId = randomUUID();
    const data = queuedPrInputSchema.parse({
      ...input,
      snapshotId,
      queueJobId,
      attempt: (prior?.input.attempt ?? 0) + 1,
    });
    await client.query(
      "INSERT INTO index_snapshots(id,repo_id,head_sha,branch,status,tool_versions,started_at) VALUES($1,$2,$3,$4,'pending',$5::jsonb,now())",
      [
        snapshotId,
        repoId,
        data.headSha,
        `refs/pull/${data.prNumber}/head`,
        JSON.stringify({ purpose: "pull_request", analysisRunId: runId }),
      ],
    );
    if (prior) {
      await client.query(
        "UPDATE analysis_runs SET snapshot_id=$3,status='queued',input=$4::jsonb,output=NULL,warnings='[]'::jsonb WHERE id=$1 AND repo_id=$2",
        [runId, repoId, snapshotId, JSON.stringify(data)],
      );
    } else {
      await client.query(
        "INSERT INTO analysis_runs(id,repo_id,snapshot_id,kind,status,input) VALUES($1,$2,$3,'pull_request','queued',$4::jsonb)",
        [runId, repoId, snapshotId, JSON.stringify(data)],
      );
    }
    const accepted = await boss.send(
      ANALYSIS_QUEUE,
      analysisJobSchema.parse({ runId, repoId }),
      {
        id: queueJobId,
        retryLimit: 0,
        expireInSeconds: 360,
        db: {
          executeSql: async (sql, values) => ({
            rows: (await client.query(sql, values)).rows,
          }),
        },
      },
    );
    if (!accepted) throw new Error("Analysis queue did not accept the job");
    await client.query("COMMIT");
    return { runId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** A worker death must become a retryable failure, never an eternal spinner. */
export async function reconcilePrAnalysis(
  pool: pg.Pool,
  boss: PgBoss,
  repoId: string,
  runId: string,
) {
  const result = await pool.query(
    "SELECT * FROM analysis_runs WHERE repo_id=$1 AND id=$2",
    [repoId, runId],
  );
  const run = result.rows[0];
  if (!run || !["queued", "running"].includes(run.status)) return run;
  const parsed = queuedPrInputSchema.safeParse(run.input);
  if (!parsed.success) return run; // Legacy runs do not have an associated queue message.
  const job = await boss.getJobById(ANALYSIS_QUEUE, parsed.data.queueJobId);
  if (job && !["completed", "failed", "cancelled"].includes(job.state))
    return run;
  const warnings = [
    "The analysis worker stopped before publishing a report. Request analysis again to retry this revision.",
  ];
  const status = job?.state === "cancelled" ? "cancelled" : "failed";
  await pool.query(
    "UPDATE index_snapshots SET status=$3,completed_at=now(),errors=$4::jsonb WHERE id=$1 AND repo_id=$2 AND status='pending'",
    [parsed.data.snapshotId, repoId, status, JSON.stringify(warnings)],
  );
  const updated = await pool.query(
    "UPDATE analysis_runs SET status=$3,output=NULL,warnings=$4::jsonb WHERE id=$1 AND repo_id=$2 AND status IN ('queued','running') AND input->>'queueJobId'=$5 RETURNING *",
    [runId, repoId, status, JSON.stringify(warnings), parsed.data.queueJobId],
  );
  return (
    updated.rows[0] ??
    (
      await pool.query(
        "SELECT * FROM analysis_runs WHERE id=$1 AND repo_id=$2",
        [runId, repoId],
      )
    ).rows[0]
  );
}
