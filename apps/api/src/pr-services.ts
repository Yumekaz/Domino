import { createHash } from "node:crypto";
import type pg from "pg";
import {
  prCheckResponseSchema,
  type PrCheckServicePort,
} from "../../../packages/contracts/src/index.ts";
import {
  MissingRecord,
  publishedSnapshot,
} from "../../../packages/database/src/read-model.ts";
import type { enqueuePrAnalysis } from "../../../packages/database/src/analysis-jobs.ts";
import { ApiFailure } from "./errors.ts";
import { resolvePullRequest } from "./github.ts";

type PrCheckDeps = {
  pool: pg.Pool;
  enqueue: (
    repoId: string,
    input: Parameters<typeof enqueuePrAnalysis>[3],
  ) => Promise<{ runId: string }>;
  token?: string;
  resolve?: typeof resolvePullRequest;
};

/** A manual request queues its exact PR head; it never reuses default-branch imports. */
export function createPrCheckService(deps: PrCheckDeps): PrCheckServicePort {
  return {
    async start(repoId, input) {
      const repository = await deps.pool.query<{
        html_url: string;
        github_id: string;
      }>("SELECT html_url,github_id FROM repositories WHERE id=$1", [repoId]);
      const repo = repository.rows[0];
      if (!repo) throw new MissingRecord("Repository was not found.");
      let workspace;
      try {
        workspace = await publishedSnapshot(deps.pool, repoId);
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
      const pull = await (deps.resolve ?? resolvePullRequest)(
        repo.html_url,
        input.prNumber,
        deps.token,
      );
      if (
        pull.repositoryId !== undefined &&
        pull.repositoryId !== Number(repo.github_id)
      )
        throw new ApiFailure(
          409,
          "REPOSITORY_IDENTITY_CHANGED",
          "Repository identity changed; import its current public identity again.",
        );
      const renameMap: Record<string, string> = {};
      const removedFiles: string[] = [];
      for (const file of pull.fileChanges ?? []) {
        if (file.status === "renamed" && file.previousFilename)
          renameMap[file.previousFilename] = file.filename;
        if (file.status === "removed") removedFiles.push(file.filename);
      }
      const idempotencyKey = createHash("sha256")
        .update(
          JSON.stringify({
            engine: "fresh-pr-v1",
            repoId,
            prNumber: pull.number,
            baseSha: pull.baseSha,
            headSha: pull.headSha,
            event: "manual",
          }),
        )
        .digest("hex");
      return prCheckResponseSchema.parse(
        await deps.enqueue(repoId, {
          repoUrl: repo.html_url,
          githubId: Number(repo.github_id),
          workspaceSnapshotId: String(workspace.id),
          prNumber: pull.number,
          baseSha: pull.baseSha,
          headSha: pull.headSha,
          event: "manual",
          stale: false,
          prUrl: pull.prUrl,
          idempotencyKey,
          changedFiles: pull.changedFiles,
          truncated: pull.truncated,
          renameMap,
          removedFiles,
        }),
      );
    },
  };
}
