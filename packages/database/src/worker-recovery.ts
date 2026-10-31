import type pg from "pg";
import { idSchema } from "../../contracts/src/index.ts";

/** Called only after this supervisor observes its own worker process exit. */
export async function recoverOwnedWork(pool: pg.Pool, workerInstance: string) {
  idSchema.parse(workerInstance);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const warning =
      "The local worker stopped before completion. Retry this operation; previously published repository data remains available.";
    const imports = await client.query(
      "SELECT id,repo_id,snapshot_id FROM import_jobs WHERE worker_instance=$1 AND status='running' FOR UPDATE",
      [workerInstance],
    );
    for (const job of imports.rows) {
      const snapshot = await client.query(
        "SELECT status FROM index_snapshots WHERE id=$1 AND repo_id=$2",
        [job.snapshot_id, job.repo_id],
      );
      const persisted = ["ready", "partial"].includes(snapshot.rows[0]?.status);
      const status = persisted ? snapshot.rows[0].status : "failed";
      if (!persisted)
        await client.query(
          "UPDATE index_snapshots SET status='failed',completed_at=now(),errors=$3::jsonb WHERE id=$1 AND repo_id=$2 AND status='pending'",
          [job.snapshot_id, job.repo_id, JSON.stringify([warning])],
        );
      await client.query(
        "UPDATE import_jobs SET status=$2,phase=$2,error=$3,worker_instance=NULL,updated_at=now() WHERE id=$1",
        [job.id, status, persisted ? null : warning],
      );
    }
    const analyses = await client.query(
      "SELECT id,repo_id,snapshot_id FROM analysis_runs WHERE input->>'workerInstance'=$1 AND status='running' FOR UPDATE",
      [workerInstance],
    );
    for (const run of analyses.rows) {
      await client.query(
        "UPDATE index_snapshots SET status='failed',completed_at=now(),errors=$3::jsonb WHERE id=$1 AND repo_id=$2 AND status='pending'",
        [run.snapshot_id, run.repo_id, JSON.stringify([warning])],
      );
      await client.query(
        "UPDATE analysis_runs SET status='failed',output=NULL,warnings=$2::jsonb WHERE id=$1",
        [run.id, JSON.stringify([warning])],
      );
    }
    await client.query("COMMIT");
    return { imports: imports.rows.length, analyses: analyses.rows.length };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
