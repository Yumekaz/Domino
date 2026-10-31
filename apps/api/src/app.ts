import Fastify from "fastify";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { ZodError, type ZodType } from "zod";
import type pg from "pg";
import type { PgBoss } from "pg-boss";
import {
  analysisInputSchema,
  analysisSchema,
  answerSchema,
  askRequestSchema,
  canonicalGithubUrl,
  detailQuerySchema,
  detailSchema,
  graphQuerySchema,
  graphSchema,
  healthSchema,
  idSchema,
  impactRequestSchema,
  impactSchema,
  importRequestSchema,
  importResponseSchema,
  jobSchema,
  latestAnalysisQuerySchema,
  prAnalysisIngestRequestSchema,
  prAnalysisIngestResponseSchema,
  prCheckRequestSchema,
  prCheckResponseSchema,
  reindexRequestSchema,
  repositorySchema,
  riskQuerySchema,
  riskSchema,
  searchQuerySchema,
  searchSchema,
  type ImpactServicePort,
  type PrCheckServicePort,
} from "../../../packages/contracts/src/index.ts";
import {
  enqueueImport,
  HISTORY_QUEUE,
  reconcileImport,
} from "../../../packages/database/src/jobs.ts";
import {
  entityDetail,
  graphNeighborhood,
  mapSnapshot,
  MissingRecord,
  publishedSnapshot,
  searchEntities,
} from "../../../packages/database/src/read-model.ts";
import { ApiFailure } from "./errors.ts";
import {
  resolvePublicRepository,
  resolvePullRequest,
  type GithubRepository,
} from "./github.ts";
import type { HistoryServices } from "./history-services.ts";

type Deps = {
  pool: pg.Pool;
  boss: PgBoss;
  history: HistoryServices | null;
  token?: string;
  allowedOrigins?: string[];
  logger?: boolean;
  impact?: ImpactServicePort;
  prCheck?: PrCheckServicePort;
  resolveRepo?: (url: string) => Promise<GithubRepository>;
  resolvePull?: typeof resolvePullRequest;
  enqueue?: typeof enqueueImport;
};
function parse<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new ApiFailure(
      400,
      "INVALID_REQUEST",
      "The request does not match the API contract.",
    );
  return parsed.data;
}
const repoId = (params: unknown) =>
  parse(idSchema, (params as { repoId?: unknown }).repoId);
const fieldId = (params: unknown, key: string) =>
  parse(idSchema, (params as Record<string, unknown>)[key]);
const escapePattern = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function validActionsUrl(value: string, owner: string, name: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      new RegExp(
        `^/${escapePattern(owner)}/${escapePattern(name)}/actions/runs/\\d+(?:/attempts/\\d+)?/?$`,
      ).test(url.pathname)
    );
  } catch {
    return false;
  }
}
const sameToken = (header: string | undefined, expected: string) => {
  if (!header?.startsWith("Bearer ")) return false;
  const actual = Buffer.from(header.slice(7)),
    wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
};

export function createApp(deps: Deps) {
  const app = Fastify({
    logger:
      deps.logger === false
        ? false
        : {
            redact: ["req.headers.authorization"],
            serializers: {
              req: (request: { method: string; url: string }) => ({
                method: request.method,
                path: request.url.split("?")[0],
              }),
            },
          },
    bodyLimit: 300_000,
    requestTimeout: 30_000,
    trustProxy: false,
  });
  const allowed = new Set(
    deps.allowedOrigins ?? [
      "http://localhost:5173",
      "http://localhost:5174",
      "http://127.0.0.1:5173",
      "http://127.0.0.1:5174",
    ],
  );
  const counters = new Map<string, { start: number; count: number }>();
  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin) {
      if (!allowed.has(origin))
        throw new ApiFailure(
          403,
          "ORIGIN_NOT_ALLOWED",
          "This origin is not allowed.",
        );
      reply
        .header("Access-Control-Allow-Origin", origin)
        .header("Vary", "Origin");
      if (request.method === "OPTIONS")
        return reply
          .header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
          .header("Access-Control-Allow-Headers", "Authorization,Content-Type")
          .code(204)
          .send();
    }
    if (deps.token && !sameToken(request.headers.authorization, deps.token))
      throw new ApiFailure(401, "UNAUTHORIZED", "Authentication is required.");
    const now = Date.now();
    if (counters.size >= 10_000)
      for (const [key, entry] of counters)
        if (now - entry.start > 60_000) counters.delete(key);
    let entry = counters.get(request.ip);
    if (!entry || now - entry.start >= 60_000) {
      if (!entry && counters.size >= 10_000)
        throw new ApiFailure(
          429,
          "RATE_LIMITED",
          "Too many clients. Retry later.",
          true,
        );
      entry = { start: now, count: 0 };
      counters.set(request.ip, entry);
    }
    if (++entry.count > 120)
      throw new ApiFailure(
        429,
        "RATE_LIMITED",
        "Too many requests. Retry later.",
        true,
      );
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiFailure)
      return reply.code(error.statusCode).send({
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        requestId: request.id,
      });
    if (error instanceof MissingRecord)
      return reply.code(404).send({
        code: "SOURCE_NOT_FOUND",
        message: error.message,
        retryable: false,
        requestId: request.id,
      });
    if (error instanceof Error && error.message === "INVALID_CURSOR")
      return reply.code(400).send({
        code: "INVALID_CURSOR",
        message:
          "The pagination cursor is invalid or belongs to another snapshot.",
        retryable: false,
        requestId: request.id,
      });
    if (error instanceof ZodError)
      request.log.error(
        { requestId: request.id },
        "A service response violated the shared contract",
      );
    else
      request.log.error(
        {
          requestId: request.id,
          errorName: error instanceof Error ? error.name : "unknown",
        },
        "Request failed",
      );
    const status = (error as { statusCode?: unknown }).statusCode;
    if (status === 413)
      return reply.code(413).send({
        code: "PAYLOAD_TOO_LARGE",
        message: "Request exceeded the size limit.",
        retryable: false,
        requestId: request.id,
      });
    if (status === 400 || status === 415)
      return reply.code(Number(status)).send({
        code: "INVALID_REQUEST",
        message: "Invalid request body.",
        retryable: false,
        requestId: request.id,
      });
    return reply.code(500).send({
      code: "INTERNAL_ERROR",
      message: "The request could not be completed.",
      retryable: true,
      requestId: request.id,
    });
  });
  app.get("/api/v1/health", async (_req, reply) => {
    let database: "ok" | "unavailable" = "ok",
      queue: "ok" | "unavailable" = "ok";
    try {
      await deps.pool.query("SELECT 1");
    } catch {
      database = "unavailable";
    }
    try {
      if (!(await deps.boss.getQueue(HISTORY_QUEUE))) queue = "unavailable";
    } catch {
      queue = "unavailable";
    }
    const status = database === "ok" && queue === "ok" ? "ok" : "degraded";
    return reply
      .code(status === "ok" ? 200 : 503)
      .send(healthSchema.parse({ status, database, queue }));
  });
  const resolveRepo =
    deps.resolveRepo ??
    ((url: string) =>
      resolvePublicRepository(
        url,
        process.env.DOMINO_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN,
      ));
  const enqueue = deps.enqueue ?? enqueueImport;
  app.post("/api/v1/repositories", async (req, reply) => {
    const body = parse(importRequestSchema, req.body);
    const resolved = await resolveRepo(body.url);
    return reply
      .code(202)
      .send(
        importResponseSchema.parse(
          await enqueue(deps.pool, deps.boss, resolved),
        ),
      );
  });
  app.get("/api/v1/repositories/:repoId", async (req) => {
    const id = repoId(req.params),
      result = await deps.pool.query("SELECT * FROM repositories WHERE id=$1", [
        id,
      ]);
    const repo = result.rows[0];
    if (!repo) throw new MissingRecord("Repository was not found.");
    let snapshot = null;
    try {
      snapshot = mapSnapshot(await publishedSnapshot(deps.pool, id));
    } catch (error) {
      if (!(error instanceof MissingRecord)) throw error;
    }
    return repositorySchema.parse({
      id: repo.id,
      owner: repo.owner,
      name: repo.name,
      url: repo.html_url,
      snapshot,
    });
  });
  app.get("/api/v1/repositories/:repoId/jobs/:jobId", async (req) => {
    const job = await reconcileImport(
      deps.pool,
      deps.boss,
      repoId(req.params),
      fieldId(req.params, "jobId"),
    );
    if (!job) throw new MissingRecord("Import job was not found.");
    return jobSchema.parse({
      id: job.id,
      status: job.status,
      phase: job.phase,
      warnings: job.warnings,
      ...(job.progress === null ? {} : { progress: Number(job.progress) }),
      ...(job.error ? { error: job.error } : {}),
    });
  });
  app.post("/api/v1/repositories/:repoId/reindex", async (req, reply) => {
    parse(reindexRequestSchema, req.body);
    const id = repoId(req.params),
      rows = await deps.pool.query<{ html_url: string; github_id: string }>(
        "SELECT html_url,github_id FROM repositories WHERE id=$1",
        [id],
      );
    if (!rows.rows[0]) throw new MissingRecord("Repository was not found.");
    const resolved = await resolveRepo(rows.rows[0].html_url);
    if (String(resolved.githubId) !== String(rows.rows[0].github_id))
      throw new ApiFailure(
        409,
        "REPOSITORY_IDENTITY_CHANGED",
        "Repository identity changed; import it as a new repository.",
      );
    return reply
      .code(202)
      .send(
        importResponseSchema.parse(
          await enqueue(deps.pool, deps.boss, resolved),
        ),
      );
  });
  app.get("/api/v1/repositories/:repoId/search", async (req) => {
    const q = parse(searchQuerySchema, req.query);
    return searchSchema.parse(
      await searchEntities(
        deps.pool,
        repoId(req.params),
        q.q,
        q.limit,
        q.cursor,
      ),
    );
  });
  app.get("/api/v1/repositories/:repoId/entities/:entityId", async (req) =>
    detailSchema.parse(
      await entityDetail(
        deps.pool,
        repoId(req.params),
        fieldId(req.params, "entityId"),
        parse(detailQuerySchema, req.query).snapshotId,
      ),
    ),
  );
  app.get("/api/v1/repositories/:repoId/graph", async (req) =>
    graphSchema.parse(
      await graphNeighborhood(
        deps.pool,
        repoId(req.params),
        parse(graphQuerySchema, req.query),
      ),
    ),
  );
  app.post("/api/v1/repositories/:repoId/ask", async (req) => {
    const id = repoId(req.params),
      body = parse(askRequestSchema, req.body);
    if (!deps.history)
      throw new ApiFailure(
        503,
        "HISTORY_UNAVAILABLE",
        "The reviewed history service is not installed.",
        true,
      );
    const snapshot = await publishedSnapshot(deps.pool, id, body.snapshotId);
    return answerSchema.parse(
      await deps.history.ask(
        id,
        String(snapshot.id),
        body.question,
        body.focusEntityId,
      ),
    );
  });
  app.post("/api/v1/repositories/:repoId/impact", async (req) => {
    const id = repoId(req.params),
      body = parse(impactRequestSchema, req.body);
    const snapshot = await publishedSnapshot(deps.pool, id, body.snapshotId);
    if (!deps.impact)
      throw new ApiFailure(
        503,
        "ANALYZER_UNSUPPORTED",
        "The structural impact service is not installed yet.",
        true,
      );
    const result = impactSchema.parse(await deps.impact.analyze(id, body));
    if (result.snapshotSha !== snapshot.head_sha)
      throw new ApiFailure(
        409,
        "INDEX_STALE",
        "The impact result refers to a different snapshot. Refresh the analysis.",
        true,
      );
    return result;
  });
  app.get("/api/v1/repositories/:repoId/knowledge-risk", async (req) => {
    const q = parse(riskQuerySchema, req.query);
    if (!deps.history)
      throw new ApiFailure(
        503,
        "HISTORY_UNAVAILABLE",
        "The reviewed history service is not installed.",
        true,
      );
    return riskSchema.parse(
      await deps.history.risk(
        repoId(req.params),
        q.snapshotId,
        q.limit,
        q.cursor,
      ),
    );
  });
  app.post("/api/v1/repositories/:repoId/pr-check", async (req, reply) => {
    const id = repoId(req.params),
      body = parse(prCheckRequestSchema, req.body);
    if (!deps.prCheck)
      throw new ApiFailure(
        503,
        "ANALYZER_UNSUPPORTED",
        "The PR analysis service is not installed yet.",
        true,
      );
    return reply
      .code(202)
      .send(prCheckResponseSchema.parse(await deps.prCheck.start(id, body)));
  });
  app.post("/api/v1/integrations/pr-analysis", async (req, reply) => {
    const body = parse(prAnalysisIngestRequestSchema, req.body);
    const canonical = canonicalGithubUrl(body.repositoryUrl);
    if (!canonical)
      throw new ApiFailure(
        400,
        "UNSUPPORTED_REPO",
        "Use a public github.com repository URL.",
      );
    const [, , , owner, name] = canonical.split("/");
    const repoResult = await deps.pool.query<{ id: string }>(
      `SELECT id FROM repositories
       WHERE lower(owner)=lower($1) AND lower(name)=lower($2) LIMIT 1`,
      [owner, name],
    );
    const repositoryId = repoResult.rows[0]?.id;
    if (!repositoryId)
      throw new ApiFailure(
        409,
        "REPOSITORY_NOT_INDEXED",
        "Import this repository before ingesting pull-request analyses.",
        false,
      );
    const resolvePull =
      deps.resolvePull ??
      ((url: string, number: number) =>
        resolvePullRequest(
          url,
          number,
          process.env.DOMINO_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN,
        ));
    const pull = await resolvePull(body.repositoryUrl, body.prNumber);
    if (
      pull.number !== body.prNumber ||
      pull.baseSha !== body.baseSha ||
      pull.headSha !== body.headSha
    )
      throw new ApiFailure(
        409,
        "PR_REVISION_MISMATCH",
        "The supplied PR revisions do not match the public pull request.",
        false,
      );
    if (!validActionsUrl(body.actionsUrl, owner, name))
      throw new ApiFailure(
        400,
        "INVALID_ACTIONS_URL",
        "Use the actual GitHub Actions run URL for this repository.",
        false,
      );
    const idempotencyKey = createHash("sha256")
      .update(
        JSON.stringify({
          repoId: repositoryId,
          prNumber: body.prNumber,
          baseSha: body.baseSha,
          headSha: body.headSha,
          event: body.event,
          actionsUrl: body.actionsUrl,
        }),
      )
      .digest("hex");
    const existing = await deps.pool.query<{ id: string }>(
      `SELECT id FROM analysis_runs
       WHERE repo_id=$1 AND kind='pull_request' AND input->>'idempotencyKey'=$2
       LIMIT 1`,
      [repositoryId, idempotencyKey],
    );
    if (existing.rows[0])
      return reply.code(202).send(
        prAnalysisIngestResponseSchema.parse({
          repoId: repositoryId,
          runId: existing.rows[0].id,
        }),
      );
    const runId = randomUUID();
    const createdAt = new Date().toISOString();
    const warnings = [
      ...new Set([
        ...body.result.warnings,
        "Ingested from the trusted read-only PR workflow at the PR head.",
      ]),
    ];
    const output = analysisSchema.parse({
      id: runId,
      status: "completed",
      prNumber: pull.number,
      baseSha: pull.baseSha,
      headSha: pull.headSha,
      event: body.event,
      createdAt,
      stale: false,
      result: body.result,
      warnings,
      actionsUrl: body.actionsUrl,
      prUrl: pull.prUrl,
    });
    const input = {
      ...analysisInputSchema.parse({
        prNumber: pull.number,
        baseSha: pull.baseSha,
        headSha: pull.headSha,
        event: body.event,
        stale: false,
        actionsUrl: body.actionsUrl,
        prUrl: pull.prUrl,
        idempotencyKey,
      }),
      source: "github_actions",
      changedFiles: body.changedFiles,
    };
    const inserted = await deps.pool.query<{ id: string }>(
      `INSERT INTO analysis_runs(id,repo_id,snapshot_id,kind,status,input,output,warnings,created_at)
       VALUES($1,$2,NULL,'pull_request','completed',$3::jsonb,$4::jsonb,$5::jsonb,now())
       ON CONFLICT DO NOTHING RETURNING id`,
      [
        runId,
        repositoryId,
        JSON.stringify(input),
        JSON.stringify(output),
        JSON.stringify(warnings),
      ],
    );
    if (inserted.rows[0])
      return reply.code(202).send(
        prAnalysisIngestResponseSchema.parse({
          repoId: repositoryId,
          runId: inserted.rows[0].id,
        }),
      );
    const raced = await deps.pool.query<{ id: string }>(
      `SELECT id FROM analysis_runs
       WHERE repo_id=$1 AND kind='pull_request' AND input->>'idempotencyKey'=$2
       LIMIT 1`,
      [repositoryId, idempotencyKey],
    );
    if (!raced.rows[0])
      throw new ApiFailure(
        503,
        "ANALYSIS_UNAVAILABLE",
        "The ingested analysis run could not be persisted.",
        true,
      );
    return reply.code(202).send(
      prAnalysisIngestResponseSchema.parse({
        repoId: repositoryId,
        runId: raced.rows[0].id,
      }),
    );
  });
  app.get("/api/v1/repositories/:repoId/analyses/latest", async (req) => {
    const query = parse(latestAnalysisQuerySchema, req.query);
    const result = await deps.pool.query<{
      id: string;
      status: string;
      input: unknown;
      output: unknown;
      warnings: unknown;
      created_at: Date | string;
    }>(
      `SELECT id,status,input,output,warnings,created_at FROM analysis_runs
       WHERE repo_id=$1 AND kind='pull_request' AND input->>'prNumber'=$2
         AND input->>'source'='github_actions'
       ORDER BY created_at DESC,id DESC LIMIT 1`,
      [repoId(req.params), String(query.prNumber)],
    );
    const row = result.rows[0];
    if (!row) throw new MissingRecord("No pull-request analysis run was found.");
    if (row.output) return analysisSchema.parse(row.output);
    const input = analysisInputSchema.safeParse(row.input);
    if (!input.success)
      throw new ApiFailure(
        503,
        "ANALYSIS_UNAVAILABLE",
        "The stored run is missing required revision metadata.",
        true,
      );
    return analysisSchema.parse({
      ...input.data,
      id: row.id,
      status: row.status,
      createdAt: new Date(row.created_at).toISOString(),
      result: null,
      warnings: Array.isArray(row.warnings) ? row.warnings : [],
    });
  });
  app.get("/api/v1/repositories/:repoId/analysis/:runId", async (req) => {
    const rows = await deps.pool.query(
      "SELECT * FROM analysis_runs WHERE repo_id=$1 AND id=$2",
      [repoId(req.params), fieldId(req.params, "runId")],
    );
    if (!rows.rows[0]) throw new MissingRecord("Analysis run was not found.");
    const row = rows.rows[0];
    const input = analysisInputSchema.safeParse(row.input);
    if (!input.success)
      throw new ApiFailure(
        503,
        "ANALYSIS_UNAVAILABLE",
        "The run is missing required revision metadata.",
        true,
      );
    if (row.output) {
      const output = analysisSchema.parse(row.output);
      if (
        output.id !== row.id ||
        output.status !== row.status ||
        output.prNumber !== input.data.prNumber ||
        output.baseSha !== input.data.baseSha ||
        output.headSha !== input.data.headSha
      )
        throw new ApiFailure(
          503,
          "ANALYSIS_UNAVAILABLE",
          "The stored report does not match its run metadata.",
          true,
        );
      return output;
    }
    return analysisSchema.parse({
      ...input.data,
      id: row.id,
      status: row.status,
      createdAt: new Date(row.created_at).toISOString(),
      result: null,
      warnings: row.warnings,
    });
  });
  return app;
}
