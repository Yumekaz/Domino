import { z } from "zod";

// Proposed integration contract. Changes require role A and consumer review.
export const idSchema = z.uuid();
export const shaSchema = z.string().regex(/^[a-f0-9]{40}$/);
export const instantSchema = z.iso.datetime({ offset: true });
export const repositoryPathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      !value.includes("\0") &&
      value
        .split("/")
        .every((part) => part !== "" && part !== "." && part !== ".."),
    "Expected a normalized repository-relative path",
  );

export function canonicalGithubUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return;
    const parts = url.pathname.replace(/\/$/, "").split("/").filter(Boolean);
    if (
      parts.length !== 2 ||
      !parts.every((part) => /^[a-zA-Z0-9_.-]+$/.test(part)) ||
      parts.some((part) => part === "." || part === "..")
    )
      return;
    const name = parts[1].replace(/\.git$/i, "");
    if (!name) return;
    return `https://github.com/${parts[0]}/${name}`;
  } catch {
    return;
  }
}
export const githubUrlSchema = z
  .string()
  .max(512)
  .transform((input, ctx) => {
    const url = canonicalGithubUrl(input);
    if (!url) {
      ctx.addIssue({
        code: "custom",
        message: "Expected a public GitHub repository URL",
      });
      return z.NEVER;
    }
    return url;
  });
export const entityKinds = [
  "Repository",
  "File",
  "FileRevision",
  "Commit",
  "PullRequest",
  "Issue",
  "DiscussionComment",
  "Document",
  "Decision",
  "Contributor",
  "Module",
] as const;
export const relationshipKinds = [
  "AUTHORED",
  "MODIFIED",
  "IN_PR",
  "CLOSES_ISSUE",
  "REFERENCES",
  "COMMENTS_ON",
  "REVIEWED",
  "IMPORTS",
  "CO_CHANGED_WITH",
  "DOCUMENTS",
  "DECISION_SUPPORTED_BY",
  "POSSIBLY_AFFECTS",
] as const;
export const entityKindSchema = z.enum(entityKinds);
export const relationshipKindSchema = z.enum(relationshipKinds);
export const verificationSchema = z.enum(["observed", "derived", "inferred"]);
export const snapshotStatusSchema = z.enum([
  "pending",
  "ready",
  "partial",
  "failed",
  "cancelled",
]);
export const jobStatusSchema = z.enum([
  "queued",
  "running",
  "ready",
  "partial",
  "failed",
  "cancelled",
]);
export const runStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "partial",
  "failed",
  "cancelled",
]);
export const errorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
  retryAfterSeconds: z.number().int().nonnegative().optional(),
  requestId: z.string().optional(),
});
export const importRequestSchema = z.object({ url: githubUrlSchema }).strict();
export const importResponseSchema = z.object({
  repoId: idSchema,
  jobId: idSchema,
});
export const reindexRequestSchema = z.object({}).strict();
export const historyJobSchema = z
  .object({
    jobId: idSchema,
    repoId: idSchema,
    snapshotId: idSchema,
    repoUrl: githubUrlSchema,
    headSha: shaSchema,
    branch: z.string().min(1).max(255),
    githubId: z.number().int().positive().safe(),
  })
  .strict();
export const coverageSchema = z.object({
  kind: z.string(),
  indexed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative().optional(),
  status: z.enum([
    "complete",
    "partial",
    "failed",
    "not_attempted",
    "cancelled",
  ]),
  warnings: z.array(z.string()).default([]),
});
export const snapshotSchema = z.object({
  id: idSchema,
  headSha: shaSchema,
  branch: z.string().min(1),
  status: snapshotStatusSchema,
  completedAt: instantSchema.optional(),
  historyFrom: instantSchema.optional(),
  historyTo: instantSchema.optional(),
  coverage: z.array(coverageSchema),
  warnings: z.array(z.string()),
});
export const repositorySchema = z.object({
  id: idSchema,
  owner: z.string(),
  name: z.string(),
  url: githubUrlSchema,
  snapshot: snapshotSchema.nullable(),
});
export const jobSchema = z.object({
  id: idSchema,
  status: jobStatusSchema,
  phase: z.string(),
  progress: z.number().min(0).max(100).optional(),
  warnings: z.array(z.string()),
  error: z.string().optional(),
});
export const sourceSchema = z.object({
  id: idSchema,
  kind: z.string(),
  url: z.url({ protocol: /^https$/ }).optional(),
  locator: z.string(),
  excerpt: z.string().optional(),
  observedAt: instantSchema.optional(),
  revision: shaSchema.optional(),
  contentSha: z.string().optional(),
});
export const entitySchema = z.object({
  id: idSchema,
  kind: entityKindSchema,
  title: z.string(),
  sourceUrl: z.url({ protocol: /^https$/ }).optional(),
  date: instantSchema.optional(),
  excerpt: z.string().optional(),
  path: repositoryPathSchema.optional(),
});
export const edgeSchema = z.object({
  id: idSchema,
  source: idSchema,
  target: idSchema,
  kind: relationshipKindSchema,
  verification: verificationSchema,
  sourceUrl: z.url({ protocol: /^https$/ }).optional(),
  sourceEntityId: idSchema.optional(),
  extractor: z.string().optional(),
  snapshotSha: shaSchema,
  observedAt: instantSchema.optional(),
  evidenceExcerpt: z.string().optional(),
  locator: z.string().optional(),
  lineRange: z
    .tuple([z.number().int().positive(), z.number().int().positive()])
    .optional(),
});
export const searchQuerySchema = z
  .object({
    q: z.string().trim().max(500),
    limit: z.coerce.number().int().min(1).max(100).default(30),
    cursor: z.string().max(1024).optional(),
  })
  .strict();
export const searchSchema = z.object({
  items: z.array(entitySchema),
  nextCursor: z.string().nullable(),
  snapshotSha: shaSchema,
});
export const detailQuerySchema = z
  .object({ snapshotId: idSchema.optional() })
  .strict();
export const detailSchema = z.object({
  entity: entitySchema,
  sources: z.array(sourceSchema),
  neighbors: z.array(entitySchema),
  edges: z.array(edgeSchema),
  snapshotSha: shaSchema,
  truncated: z.boolean(),
  warnings: z.array(z.string()),
});
const list = <T extends z.ZodType>(item: T) =>
  z.preprocess(
    (value) =>
      value === undefined ? [] : Array.isArray(value) ? value : [value],
    z.array(item).max(32),
  );
export const graphQuerySchema = z
  .object({
    snapshotId: idSchema,
    entityId: idSchema,
    depth: z.coerce.number().int().min(1).max(3).default(1),
    nodeKinds: list(entityKindSchema),
    relationshipKinds: list(relationshipKindSchema),
    includeInferred: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    verification: list(verificationSchema),
    from: instantSchema.optional(),
    to: instantSchema.optional(),
  })
  .strict()
  .refine(
    (q) => !q.from || !q.to || Date.parse(q.from) <= Date.parse(q.to),
    "Invalid date range",
  );
export const graphSchema = z
  .object({
    nodes: z.array(entitySchema),
    edges: z.array(edgeSchema),
    truncated: z.boolean(),
    warnings: z.array(z.string()),
    snapshotSha: shaSchema,
  })
  .superRefine((graph, ctx) => {
    const ids = new Set(graph.nodes.map((n) => n.id));
    if (
      ids.size !== graph.nodes.length ||
      new Set(graph.edges.map((e) => e.id)).size !== graph.edges.length ||
      graph.edges.some((e) => !ids.has(e.source) || !ids.has(e.target))
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Graph contains duplicate identifiers or dangling relationships",
      });
  });
export const askRequestSchema = z
  .object({
    question: z.string().trim().min(1).max(2000),
    snapshotId: idSchema.optional(),
    focusEntityId: idSchema.optional(),
  })
  .strict();
export const answerSchema = z
  .object({
    answer: z.string().nullable(),
    status: z.enum(["supported", "not_found", "partial", "unavailable"]),
    claims: z.array(
      z.object({
        text: z.string(),
        evidenceIds: z.array(idSchema).min(1),
        support: z.enum(["documented", "inferred"]),
      }),
    ),
    sources: z.array(sourceSchema),
    unknowns: z.array(z.string()),
    warnings: z.array(z.string()),
    snapshotSha: shaSchema,
    errorCode: z.string().nullable(),
    searchAvailable: z.boolean(),
  })
  .superRefine((answer, ctx) => {
    const sourceIds = new Set(answer.sources.map((s) => s.id));
    if (
      (answer.status === "not_found" || answer.status === "unavailable") &&
      answer.claims.length
    )
      ctx.addIssue({
        code: "custom",
        message: "No claims are permitted for this status",
      });
    if (
      (answer.status === "supported" || answer.status === "partial") &&
      (!answer.answer || !answer.claims.length)
    )
      ctx.addIssue({
        code: "custom",
        message: "A supported answer requires supported claims",
      });
    if (
      answer.claims.some((c) => c.evidenceIds.some((id) => !sourceIds.has(id)))
    )
      ctx.addIssue({
        code: "custom",
        message: "A citation is absent from the returned sources",
      });
  });
const impactEvidenceSchema = z.object({
  type: z.string(),
  file: repositoryPathSchema,
  line: z.number().int().positive().optional(),
  url: z.url({ protocol: /^https$/ }).optional(),
});
export const impactRequestSchema = z
  .object({
    snapshotId: idSchema,
    changedFiles: z.array(repositoryPathSchema).min(1).max(200).optional(),
    proposedDiff: z.string().min(1).max(250_000).optional(),
    maxDepth: z.number().int().min(1).max(3).default(3),
  })
  .strict()
  .refine(
    (v) => (v.changedFiles === undefined) !== (v.proposedDiff === undefined),
    "Supply exactly one change input",
  );
export const impactSchema = z
  .object({
    changedFiles: z.array(repositoryPathSchema),
    snapshotSha: shaSchema,
    affected: z.array(
      z.object({
        file: repositoryPathSchema,
        signal: z.enum([
          "static_reverse_dependency",
          "historically_coupled",
          "unknown",
        ]),
        depth: z.number().int().nonnegative(),
        path: z.array(repositoryPathSchema),
        impact: z.enum(["possible", "unknown"]),
        explanation: z.string(),
        evidence: z.array(impactEvidenceSchema),
        cochange: z
          .object({
            sampleSize: z.number().int().nonnegative(),
            targetCommits: z.number().int().nonnegative(),
            windowFrom: instantSchema.nullable(),
            windowTo: instantSchema.nullable(),
          })
          .optional(),
      }),
    ),
    warnings: z.array(z.string()),
    truncated: z.boolean(),
  })
  .superRefine((result, ctx) => {
    for (const [i, item] of result.affected.entries()) {
      if (
        item.signal === "static_reverse_dependency" &&
        (item.depth < 1 ||
          item.path.length !== item.depth + 1 ||
          item.path[0] !== item.file ||
          !result.changedFiles.includes(item.path.at(-1) ?? ""))
      )
        ctx.addIssue({
          code: "custom",
          path: ["affected", i, "path"],
          message: "Invalid structural dependency path",
        });
      if (item.signal === "historically_coupled" && !item.cochange)
        ctx.addIssue({
          code: "custom",
          path: ["affected", i, "cochange"],
          message: "Historical association requires its sample and window",
        });
      if (
        item.signal === "historically_coupled" &&
        item.cochange &&
        (item.cochange.sampleSize < 1 ||
          item.cochange.sampleSize > item.cochange.targetCommits ||
          (item.cochange.windowFrom &&
            item.cochange.windowTo &&
            Date.parse(item.cochange.windowFrom) >
              Date.parse(item.cochange.windowTo)))
      )
        ctx.addIssue({
          code: "custom",
          path: ["affected", i, "cochange"],
          message: "Invalid historical sample or observation window",
        });
    }
  });
export const riskQuerySchema = z
  .object({
    snapshotId: idSchema,
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().max(1024).optional(),
  })
  .strict();
export const riskSchema = z.object({
  snapshotSha: shaSchema,
  historyFrom: instantSchema.nullable(),
  historyTo: instantSchema.nullable(),
  partial: z.boolean(),
  warnings: z.array(z.string()),
  files: z.array(
    z.object({
      path: repositoryPathSchema,
      entityId: idSchema,
      observedAuthors: z.number().int().nonnegative(),
      commitCount: z.number().int().nonnegative(),
      commitCountIsLowerBound: z.boolean(),
      lastEdit: instantSchema.nullable(),
      contributors: z.array(
        z.object({ name: z.string(), commits: z.number().int().nonnegative() }),
      ),
      sources: z.array(sourceSchema),
      caveats: z.array(z.string()),
    }),
  ),
  nextCursor: z.string().nullable(),
});
export const prCheckRequestSchema = z
  .object({ prNumber: z.number().int().positive().max(2_147_483_647) })
  .strict();
export const prCheckResponseSchema = z.object({ runId: idSchema });
export const analysisInputSchema = z.object({
  prNumber: z.number().int().positive(),
  baseSha: shaSchema,
  headSha: shaSchema,
  event: z.string().min(1),
  stale: z.boolean(),
  actionsUrl: z.url({ protocol: /^https$/ }).optional(),
  prUrl: z.url({ protocol: /^https$/ }).optional(),
  idempotencyKey: z.string().min(1).max(512),
});
export const analysisSchema = z.object({
  id: idSchema,
  status: runStatusSchema,
  prNumber: z.number().int().positive(),
  baseSha: shaSchema,
  headSha: shaSchema,
  event: z.string(),
  createdAt: instantSchema,
  actionsUrl: z.url({ protocol: /^https$/ }).optional(),
  prUrl: z.url({ protocol: /^https$/ }).optional(),
  stale: z.boolean(),
  result: impactSchema.nullable(),
  warnings: z.array(z.string()),
});
export const prAnalysisEventSchema = z.enum([
  "opened",
  "reopened",
  "synchronize",
]);
export const prAnalysisIngestRequestSchema = z
  .object({
    repositoryUrl: githubUrlSchema,
    prNumber: z.number().int().positive().max(2_147_483_647),
    baseSha: shaSchema,
    headSha: shaSchema,
    event: prAnalysisEventSchema,
    actionsUrl: z.url({ protocol: /^https$/ }),
    changedFiles: z.array(repositoryPathSchema).max(300),
    result: impactSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.result.snapshotSha !== value.headSha)
      ctx.addIssue({
        code: "custom",
        path: ["result", "snapshotSha"],
        message: "The ingested result must describe the PR head revision",
      });
    const declared = new Set(value.changedFiles);
    if (value.result.changedFiles.some((file) => !declared.has(file)))
      ctx.addIssue({
        code: "custom",
        path: ["result", "changedFiles"],
        message: "The result must describe only the changed files it declares",
      });
  });
export const prAnalysisIngestResponseSchema = z.object({
  repoId: idSchema,
  runId: idSchema,
});
export const latestAnalysisQuerySchema = z
  .object({ prNumber: z.coerce.number().int().positive() })
  .strict();
export const healthSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  database: z.enum(["ok", "unavailable"]),
  queue: z.enum(["ok", "unavailable"]),
});
export type Repository = z.infer<typeof repositorySchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Graph = z.infer<typeof graphSchema>;
export type Entity = z.infer<typeof entitySchema>;
export type Edge = z.infer<typeof edgeSchema>;
export type GraphQuery = z.infer<typeof graphQuerySchema>;
export type Answer = z.infer<typeof answerSchema>;
export type Impact = z.infer<typeof impactSchema>;
export type Risk = z.infer<typeof riskSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type Analysis = z.infer<typeof analysisSchema>;
export type AskRequest = z.infer<typeof askRequestSchema>;
export type ImpactRequest = z.infer<typeof impactRequestSchema>;
export type PrAnalysisIngestRequest = z.infer<
  typeof prAnalysisIngestRequestSchema
>;
export type PrAnalysisIngestResponse = z.infer<
  typeof prAnalysisIngestResponseSchema
>;
export interface ImpactServicePort {
  analyze(
    repoId: string,
    input: z.infer<typeof impactRequestSchema>,
  ): Promise<Impact>;
}
export interface PrCheckServicePort {
  start(
    repoId: string,
    input: z.infer<typeof prCheckRequestSchema>,
  ): Promise<z.infer<typeof prCheckResponseSchema>>;
}
