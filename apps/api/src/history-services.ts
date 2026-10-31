import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type pg from "pg";
import { z } from "zod";
import {
  answerSchema,
  riskSchema,
  type Answer,
  type Risk,
} from "../../../packages/contracts/src/index.ts";
import { scopeHistoryStore } from "../../../packages/database/src/history-port.ts";
import { publishedSnapshot } from "../../../packages/database/src/read-model.ts";
import { ApiFailure } from "./errors.ts";

const bAnswer = z.object({
  status: z.enum(["supported", "not_found", "partial", "unavailable"]),
  answer: z.string().nullable(),
  claims: z.array(
    z.object({
      text: z.string(),
      evidenceIds: z.array(z.string()),
      support: z.enum(["documented", "interpretation"]),
    }),
  ),
  sources: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      url: z.string(),
      locator: z.string(),
      excerpt: z.string(),
      timestamp: z.string().nullable(),
      revision: z.string(),
      contentSha: z.string(),
    }),
  ),
  unknowns: z.array(z.string()),
  warnings: z.array(z.string()),
  snapshotSha: z.string(),
  errorCode: z.string().nullable(),
  searchAvailable: z.boolean(),
});
const bRisk = z.object({
  snapshotSha: z.string(),
  totalFiles: z.number(),
  returned: z.number(),
  offset: z.number(),
  caveats: z.array(z.string()),
  files: z.array(
    z.object({
      path: z.string(),
      observedAuthors: z.number(),
      commitCount: z.number(),
      commitCountIsLowerBound: z.boolean(),
      lastEdit: z.string().nullable(),
      contributors: z.array(
        z.object({ name: z.string(), observedCommits: z.number() }),
      ),
      caveats: z.array(z.string()),
    }),
  ),
});
export interface HistoryServices {
  ask(
    repoId: string,
    snapshotId: string,
    question: string,
    focusEntityId?: string,
  ): Promise<Answer>;
  risk(
    repoId: string,
    snapshotId: string,
    limit: number,
    cursor?: string,
  ): Promise<Risk>;
  close(): Promise<void>;
}
const load = (path: string) =>
  import(pathToFileURL(resolve(process.cwd(), path)).href);
export async function createHistoryServices(
  pool: pg.Pool,
  databaseUrl: string,
): Promise<HistoryServices> {
  let modules;
  try {
    const [
      storeModule,
      clientModule,
      retrievalModule,
      qaModule,
      riskModule,
      llmModule,
    ] = await Promise.all([
      load("packages/retrieval/src/postgresStore.ts"),
      load("packages/retrieval/src/pgClient.ts"),
      load("packages/retrieval/src/pack.ts"),
      load("packages/core/evidence/src/ask.ts"),
      load("packages/core/knowledge-risk/src/risk.ts"),
      load("packages/llm-adapter/src/openai.ts"),
    ]);
    modules = {
      storeModule,
      clientModule,
      retrievalModule,
      qaModule,
      riskModule,
      llmModule,
    };
  } catch {
    throw new ApiFailure(
      503,
      "HISTORY_UNAVAILABLE",
      "The reviewed history service has not been installed.",
      true,
    );
  }
  const client = new modules.clientModule.PgSqlClient({
    connectionString: databaseUrl,
    max: 4,
  });
  const baseStore = new modules.storeModule.PostgresHistoryStore(
    client,
  ) as Record<string, unknown>;
  const clock = { isoNow: () => new Date().toISOString() };
  const provider =
    process.env.DOMINO_OPENAI_API_KEY || process.env.OPENAI_API_KEY
      ? modules.llmModule.createOpenAiProviderFromEnv()
      : new modules.llmModule.UnavailableLlmProvider();
  return {
    async ask(repoId, snapshotId, question, focusEntityId) {
      await publishedSnapshot(pool, repoId, snapshotId);
      const store = scopeHistoryStore(baseStore, pool, { repoId, snapshotId });
      const retriever = new modules.retrievalModule.DefaultEvidenceRetriever({
        store,
        clock,
      });
      const result = bAnswer.parse(
        await modules.qaModule.askQuestion(
          {
            repoId,
            snapshotId,
            question,
            ...(focusEntityId ? { focusEntityId } : {}),
          },
          {
            store,
            retriever,
            llm: provider,
            clock,
            limits: {
              maxChunks: 6,
              maxNeighbors: 4,
              maxInputChars: 12000,
              maxOutputTokens: 600,
              maxClaims: 4,
            },
          },
        ),
      );
      return answerSchema.parse({
        ...result,
        claims: result.claims.map((c) => ({
          ...c,
          support: c.support === "interpretation" ? "inferred" : "documented",
        })),
        sources: result.sources.map((s) => ({
          id: s.id,
          kind: s.kind,
          url: s.url,
          locator: s.locator,
          excerpt: s.excerpt,
          ...(s.timestamp ? { observedAt: s.timestamp } : {}),
          revision: s.revision,
          contentSha: s.contentSha,
        })),
      });
    },
    async risk(repoId, snapshotId, limit, cursor) {
      const snapshot = await publishedSnapshot(pool, repoId, snapshotId);
      let offset = 0;
      if (cursor) {
        try {
          const decoded = JSON.parse(
            Buffer.from(cursor, "base64url").toString("utf8"),
          ) as { snapshotId: unknown; offset: unknown };
          if (
            decoded.snapshotId !== snapshotId ||
            !Number.isSafeInteger(decoded.offset) ||
            Number(decoded.offset) < 0 ||
            Number(decoded.offset) > 1_000_000
          )
            throw new Error();
          offset = Number(decoded.offset);
        } catch {
          throw new ApiFailure(
            400,
            "INVALID_CURSOR",
            "The pagination cursor is invalid or belongs to another snapshot.",
          );
        }
      }
      const store = scopeHistoryStore(baseStore, pool, { repoId, snapshotId });
      const result = bRisk.parse(
        await modules.riskModule.computeKnowledgeRisk(
          { repoId, snapshotId, limit, offset },
          { store, clock },
        ),
      );
      const paths = result.files.map((f) => f.path);
      const entities = await pool.query<{ entity_id: string; path: string }>(
        `SELECT entity_id,metadata->>'path' AS path FROM entity_versions
        WHERE repo_id=$1 AND snapshot_id=$2 AND kind='File' AND metadata->>'path'=ANY($3::text[])`,
        [repoId, snapshotId, paths],
      );
      const entityByPath = new Map(
        entities.rows.map((row) => [row.path, row.entity_id]),
      );
      const proof = await pool.query<{
        path: string;
        id: string;
        url: string;
        sha: string | null;
        observed_at: Date | null;
      }>(
        `SELECT e.id,e.source_url AS url,e.observed_at,v.metadata->>'currentPath' AS path,c.metadata->>'sha' AS sha
         FROM edges e JOIN entity_versions v ON v.repo_id=e.repo_id AND v.snapshot_id=e.snapshot_id AND v.entity_id=e.to_entity_id
         JOIN entity_versions c ON c.repo_id=e.repo_id AND c.snapshot_id=e.snapshot_id AND c.entity_id=e.from_entity_id
         WHERE e.repo_id=$1 AND e.snapshot_id=$2 AND e.kind='MODIFIED' AND v.metadata->>'currentPath'=ANY($3::text[])
           AND e.source_url IS NOT NULL ORDER BY e.observed_at DESC,e.id LIMIT 500`,
        [repoId, snapshotId, paths],
      );
      const files = result.files.flatMap((file) => {
        const entityId = entityByPath.get(file.path);
        if (!entityId) return [];
        const sources = proof.rows
          .filter(
            (p) =>
              p.path === file.path && p.url.startsWith("https://github.com/"),
          )
          .slice(0, 10)
          .map((p) => ({
            id: p.id,
            kind: "commit",
            url: p.url,
            locator: p.sha
              ? `Commit ${p.sha} · ${p.path}`
              : `Recorded change · ${p.path}`,
            ...(p.observed_at
              ? { observedAt: new Date(p.observed_at).toISOString() }
              : {}),
          }));
        return [
          {
            path: file.path,
            entityId,
            observedAuthors: file.observedAuthors,
            commitCount: file.commitCount,
            commitCountIsLowerBound: file.commitCountIsLowerBound,
            lastEdit: file.lastEdit,
            contributors: file.contributors.map((c) => ({
              name: c.name,
              commits: c.observedCommits,
            })),
            sources,
            caveats: file.caveats,
          },
        ];
      });
      const coverage = (snapshot.coverage ?? {}) as {
        sources?: {
          gitHistory?: {
            window?: { from?: string | null; to?: string | null };
          };
        };
      };
      const window = coverage.sources?.gitHistory?.window;
      const warnings = [...result.caveats];
      if (files.some((file) => file.commitCountIsLowerBound))
        warnings.push(
          "Some commit counts are lower bounds because contributor samples were capped.",
        );
      if (files.length !== result.files.length)
        warnings.push(
          "Some risk rows had no corresponding file record in this snapshot.",
        );
      const nextCursor =
        result.offset + result.returned < result.totalFiles
          ? Buffer.from(
              JSON.stringify({
                snapshotId,
                offset: result.offset + result.returned,
              }),
            ).toString("base64url")
          : null;
      return riskSchema.parse({
        snapshotSha: result.snapshotSha,
        historyFrom: window?.from ?? null,
        historyTo: window?.to ?? null,
        partial: snapshot.status === "partial",
        warnings,
        files,
        nextCursor,
      });
    },
    async close() {
      await client.close();
    },
  };
}
