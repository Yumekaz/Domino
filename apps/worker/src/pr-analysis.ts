import type pg from "pg";
import { analysisSchema } from "../../../packages/contracts/src/index.ts";
import {
  queuedPrInputSchema,
  type AnalysisJobPayload,
} from "../../../packages/database/src/analysis-jobs.ts";
import { replacePendingStructural } from "../../../packages/database/src/impact.ts";
import { scopeHistoryStore } from "../../../packages/database/src/history-port.ts";
import type { HistoryStore } from "../../../packages/core/history/src/ports.ts";
import {
  canonicalFileKey,
  entityId,
} from "../../../packages/core/history/src/ids.ts";
import { githubBlobUrl } from "../../../packages/core/history/src/graph.ts";
import { toContractImpact } from "../../../packages/core/impact/src/contracts.ts";
import {
  checkoutRepository,
  type CheckoutHandle,
  type CheckoutOptions,
} from "../../../packages/git-adapter/src/checkout.ts";
import { analyzeRepositoryCheckout } from "../../../packages/dependency-adapter/src/repository.ts";
import {
  isCodeFile,
  isExcludedStructuralPath,
} from "../../../packages/dependency-adapter/src/paths.ts";
import type { NormalizedStructuralAnalysis } from "../../../packages/dependency-adapter/src/types.ts";
import { resolvePullRequest } from "../../api/src/github.ts";
import { createImpactAnalysisHandler } from "./handlers/analysis/handler.ts";

type Dependencies = {
  pool: pg.Pool;
  store: HistoryStore;
  token?: string;
  workerInstance?: string;
  shutdownSignal?: AbortSignal;
  checkout?: (options: CheckoutOptions) => Promise<CheckoutHandle>;
  analyze?: typeof analyzeRepositoryCheckout;
  resolve?: typeof resolvePullRequest;
};

/** The analysis.impact queue uses C's domain handler against an isolated PR snapshot. */
export function createPrAnalysisProcessor(deps: Dependencies) {
  return async (
    payload: AnalysisJobPayload,
    queueJobId: string,
  ): Promise<void> => {
    const rows = await deps.pool.query(
      "SELECT a.*,r.html_url,r.github_id,r.owner,r.name FROM analysis_runs a JOIN repositories r ON r.id=a.repo_id WHERE a.id=$1 AND a.repo_id=$2 AND a.kind='pull_request'",
      [payload.runId, payload.repoId],
    );
    const row = rows.rows[0];
    if (!row || !["queued", "running"].includes(row.status)) return;
    const parsed = queuedPrInputSchema.safeParse(row.input);
    if (!parsed.success) throw new Error("INVALID_ANALYSIS_INPUT");
    const input = parsed.data;
    if (input.queueJobId !== queueJobId) return; // An old attempt must not overwrite a retry.
    if (
      input.repoUrl !== row.html_url ||
      input.githubId !== Number(row.github_id) ||
      input.snapshotId !== row.snapshot_id
    )
      throw new Error("ANALYSIS_IDENTITY_MISMATCH");
    const snapshot = await deps.pool.query(
      "SELECT head_sha,status,tool_versions FROM index_snapshots WHERE id=$1 AND repo_id=$2",
      [input.snapshotId, payload.repoId],
    );
    if (
      snapshot.rows[0]?.head_sha !== input.headSha ||
      snapshot.rows[0]?.status !== "pending" ||
      snapshot.rows[0]?.tool_versions.purpose !== "pull_request"
    )
      throw new Error("ANALYSIS_SNAPSHOT_MISMATCH");
    const claimed = await deps.pool.query(
      "UPDATE analysis_runs SET status='running',input=input || $4::jsonb WHERE id=$1 AND repo_id=$2 AND status='queued' AND input->>'queueJobId'=$3 RETURNING id",
      [
        payload.runId,
        payload.repoId,
        queueJobId,
        JSON.stringify(
          deps.workerInstance ? { workerInstance: deps.workerInstance } : {},
        ),
      ],
    );
    if (!claimed.rows.length) return;
    const warnings: string[] = [
      "Structural analysis uses the exact PR head. Historical co-change and contributor history are not recomputed for this structural-only snapshot.",
    ];
    if (input.event === "actions_observed")
      warnings.push(
        "This report was computed by the local worker after observing the linked GitHub Actions run. Its base revision is the PR base read locally; the linked workflow may have used an earlier base.",
      );
    if (input.truncated)
      warnings.push(
        "GitHub changed-file coverage is bounded to the first 300 files.",
      );
    if (input.removedFiles.length)
      warnings.push(
        "Removed files are assessed against imports remaining at the PR head; dependents deleted in the same PR are outside this head-only report.",
      );
    let checkout: CheckoutHandle | undefined;
    const signal = AbortSignal.any([
      AbortSignal.timeout(300_000),
      ...(deps.shutdownSignal ? [deps.shutdownSignal] : []),
    ]);
    const resolve = deps.resolve ?? resolvePullRequest;
    const sameRevision = (pr: Awaited<ReturnType<typeof resolvePullRequest>>) =>
      pr.baseSha === input.baseSha &&
      pr.headSha === input.headSha &&
      pr.number === input.prNumber &&
      (pr.repositoryId === undefined || pr.repositoryId === input.githubId);
    const finish = async (
      status: "completed" | "partial" | "failed" | "cancelled",
      result: ReturnType<typeof toContractImpact> | null,
      stale: boolean,
      normalized?: NormalizedStructuralAnalysis,
    ) => {
      const output = analysisSchema.parse({
        id: payload.runId,
        status,
        prNumber: input.prNumber,
        baseSha: input.baseSha,
        headSha: input.headSha,
        event: input.event,
        createdAt: new Date(row.created_at).toISOString(),
        stale,
        result,
        warnings: [...new Set(warnings)],
        prUrl: input.prUrl,
        actionsUrl: input.actionsUrl,
      });
      const client = await deps.pool.connect();
      try {
        await client.query("BEGIN");
        const current = await client.query(
          "SELECT status,input FROM analysis_runs WHERE id=$1 AND repo_id=$2 FOR UPDATE",
          [payload.runId, payload.repoId],
        );
        if (
          current.rows[0]?.status !== "running" ||
          current.rows[0]?.input.queueJobId !== queueJobId
        ) {
          await client.query("ROLLBACK");
          return;
        }
        const coverage = {
          sources: {
            structural: {
              source: "structural",
              status: ["failed", "cancelled"].includes(status)
                ? "failed"
                : status === "partial"
                  ? "partial"
                  : "complete",
              items: normalized?.imports.length ?? 0,
              pagesFetched: 0,
              capHit: !!result?.truncated,
              warnings: output.warnings,
              window: null,
            },
          },
          warnings: output.warnings,
          limits: {
            purpose: "pull_request",
            maxFiles: 5000,
            maxChangedFiles: 300,
            maxDepth: 3,
          },
        };
        await client.query(
          "UPDATE index_snapshots SET status=$3,coverage=$4::jsonb,tool_versions=tool_versions || $5::jsonb,completed_at=now(),errors=$6::jsonb WHERE id=$1 AND repo_id=$2 AND status='pending'",
          [
            input.snapshotId,
            payload.repoId,
            stale
              ? "failed"
              : ["failed", "cancelled"].includes(status)
                ? status
                : "partial",
            JSON.stringify(coverage),
            JSON.stringify(
              normalized
                ? {
                    dependencyCruiser: normalized.metadata.version,
                    configHash: normalized.metadata.configHash,
                  }
                : {},
            ),
            JSON.stringify(
              ["failed", "cancelled"].includes(status) || stale
                ? output.warnings
                : [],
            ),
          ],
        );
        await client.query(
          "UPDATE analysis_runs SET status=$3,output=$4::jsonb,warnings=$5::jsonb WHERE id=$1 AND repo_id=$2",
          [
            payload.runId,
            payload.repoId,
            status,
            JSON.stringify(output),
            JSON.stringify(output.warnings),
          ],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    };
    try {
      if (
        !sameRevision(await resolve(input.repoUrl, input.prNumber, deps.token))
      ) {
        warnings.push(
          "The pull request advanced before analysis started. Request a new analysis for its current head.",
        );
        await finish("completed", null, true);
        return;
      }
      checkout = await (deps.checkout ?? checkoutRepository)({
        remoteUrl: input.repoUrl,
        sha: input.headSha,
        fetchRef: `refs/pull/${input.prNumber}/head`,
        historyDepth: 1,
        maxFiles: 5000,
        maxBytes: 100 * 1024 * 1024,
        timeoutMs: 120_000,
        signal,
      });
      if (checkout.sha !== input.headSha)
        throw new Error("CHECKOUT_SHA_MISMATCH");
      const files = (await checkout.listFiles())
        .filter((file) => file.mode === "100644" || file.mode === "100755")
        .filter(
          (file) =>
            isCodeFile(file.path) && !isExcludedStructuralPath(file.path),
        );
      const store = scopeHistoryStore(deps.store, deps.pool, {
        repoId: payload.repoId,
        snapshotId: input.snapshotId,
        githubId: input.githubId,
      });
      await store.upsertEntities(
        files.map((file) => ({
          id: entityId(payload.repoId, "File", canonicalFileKey(file.path)),
          repoId: payload.repoId,
          kind: "File",
          canonicalKey: canonicalFileKey(file.path),
          title: file.path,
          sourceUrl: githubBlobUrl(
            row.owner,
            row.name,
            input.headSha,
            file.path,
          ),
          metadata: { path: file.path, currentPath: file.path },
        })),
      );
      let normalized: NormalizedStructuralAnalysis | undefined;
      const handler = createImpactAnalysisHandler({
        clock: { now: () => new Date() },
        ids: { runId: () => payload.runId },
        // The queue owns deduplication. The computed domain run is staged until
        // its report and snapshot can be atomically published together below.
        runs: {
          getByKey: async () => null,
          get: async () => null,
          save: async (run) => run,
        },
        imports: {
          getImports: async () => [],
          replaceImports: async (data) => {
            const stored = await replacePendingStructural(
              deps.pool,
              payload.repoId,
              input.snapshotId,
              data.imports.map((item) => ({
                ...item,
                evidence: item.evidence,
              })),
              { owner: row.owner, name: row.name },
              input.headSha,
            );
            return { stored: stored.dependencies };
          },
        },
        analyzer: {
          analyze: async () => {
            normalized = await (deps.analyze ?? analyzeRepositoryCheckout)({
              workingDirectory: checkout!.directory,
              repositoryId: String(input.githubId),
              snapshotSha: input.headSha,
              timeoutMs: 120_000,
              signal,
            });
            warnings.push(...(normalized.limitations ?? []));
            return normalized;
          },
        },
      });
      const run = await handler.handle({
        repoId: payload.repoId,
        repositoryId: String(input.githubId),
        snapshotId: input.snapshotId,
        snapshotSha: input.headSha,
        checkoutSha: checkout.sha,
        checkoutDir: checkout.directory,
        changedFiles: input.changedFiles,
        renameMap: input.renameMap,
        maxDepth: 3,
        refresh: true,
      });
      if (!run.result || !normalized || signal.aborted)
        throw new Error("ANALYSIS_INCOMPLETE");
      const observed = normalized as NormalizedStructuralAnalysis;
      if (
        !sameRevision(await resolve(input.repoUrl, input.prNumber, deps.token))
      ) {
        warnings.push(
          "The pull request advanced while analysis was running. The old-head result was withheld; request analysis again.",
        );
        await finish("completed", null, true, observed);
        return;
      }
      const result = toContractImpact(run.result);
      for (const affected of result.affected)
        for (const evidence of affected.evidence)
          evidence.url =
            githubBlobUrl(row.owner, row.name, input.headSha, evidence.file) +
            (evidence.line ? `#L${evidence.line}` : "");
      result.warnings.push(...warnings);
      warnings.push(...run.result.warnings);
      const partial =
        input.truncated ||
        input.removedFiles.length > 0 ||
        result.truncated ||
        observed.gaps.length > 0 ||
        !!observed.limitations?.length;
      await finish(partial ? "partial" : "completed", result, false, observed);
    } catch (error) {
      if (signal.aborted) {
        const stopped = deps.shutdownSignal?.aborted;
        warnings.push(
          stopped
            ? "The local worker was stopped and this PR analysis was cancelled. Request analysis again to retry."
            : "PR analysis exceeded its time budget. Request analysis again to retry; no impact result was published.",
        );
        await finish(stopped ? "cancelled" : "failed", null, false);
        return;
      }
      const candidate = (error as { code?: unknown }).code;
      const code =
        typeof candidate === "string" && /^[A-Z][A-Z_]{2,63}$/.test(candidate)
          ? candidate
          : "ANALYSIS_FAILED";
      warnings.push(
        `PR analysis failed (${code}). Request analysis again to retry. No impact result was substituted.`,
      );
      await finish("failed", null, false);
    } finally {
      await checkout?.dispose();
    }
  };
}
