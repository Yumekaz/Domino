import { z } from 'zod';

// Client integration assumptions, pending packages/contracts. See docs/INTEGRATION.md.
export const sourceSchema = z.object({
  id: z.string(),
  kind: z.string(),
  url: z.string().optional(),
  locator: z.string(),
  excerpt: z.string().optional(),
  observedAt: z.string().optional(),
});
export const entitySchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  sourceUrl: z.string().optional(),
  date: z.string().optional(),
  excerpt: z.string().optional(),
  path: z.string().optional(),
});
export const edgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  kind: z.string(),
  verification: z.enum(['observed', 'derived', 'inferred']),
  sourceUrl: z.string().optional(),
  sourceEntityId: z.string().optional(),
  extractor: z.string().optional(),
  snapshotSha: z.string().optional(),
  observedAt: z.string().optional(),
  evidenceExcerpt: z.string().optional(),
});
export const snapshotSchema = z.object({
  id: z.string(),
  headSha: z.string(),
  branch: z.string(),
  status: z.string(),
  completedAt: z.string().optional(),
  historyFrom: z.string().optional(),
  historyTo: z.string().optional(),
  coverage: z.array(
    z.object({
      kind: z.string(),
      indexed: z.number(),
      total: z.number().optional(),
      status: z.string(),
    }),
  ),
  warnings: z.array(z.string()).default([]),
});
export const repositorySchema = z.object({
  id: z.string(),
  owner: z.string(),
  name: z.string(),
  url: z.string(),
  snapshot: snapshotSchema.nullable(),
});
export const jobSchema = z.object({
  id: z.string(),
  status: z.string(),
  phase: z.string(),
  progress: z.number().min(0).max(100).optional(),
  warnings: z.array(z.string()).default([]),
  error: z.string().optional(),
});
export const importSchema = z.object({ repoId: z.string(), jobId: z.string() });
export const searchSchema = z.object({
  items: z.array(entitySchema),
  nextCursor: z.string().nullable().optional(),
});
export const detailSchema = z.object({
  entity: entitySchema,
  sources: z.array(sourceSchema),
  neighbors: z.array(entitySchema),
  edges: z.array(edgeSchema),
});
export const graphSchema = z
  .object({
    nodes: z.array(entitySchema),
    edges: z.array(edgeSchema),
    truncated: z.boolean(),
    warnings: z.array(z.string()).default([]),
  })
  .superRefine((graph, ctx) => {
    const ids = new Set(graph.nodes.map((n) => n.id));
    if (
      ids.size !== graph.nodes.length ||
      new Set(graph.edges.map((e) => e.id)).size !== graph.edges.length
    )
      ctx.addIssue({ code: 'custom', message: 'Duplicate graph identifiers' });
    if (graph.edges.some((e) => !ids.has(e.source) || !ids.has(e.target)))
      ctx.addIssue({
        code: 'custom',
        message: 'A relationship references a record outside the returned neighborhood',
      });
  });
export const answerSchema = z.object({
  answer: z.string(),
  status: z.enum(['supported', 'not_found', 'partial']),
  claims: z.array(
    z.object({
      text: z.string(),
      evidenceIds: z.array(z.string()),
      support: z.enum(['documented', 'inferred']),
    }),
  ),
  sources: z.array(sourceSchema),
  unknowns: z.array(z.string()),
  snapshotSha: z.string(),
});
export const impactSchema = z.object({
  changedFiles: z.array(z.string()),
  snapshotSha: z.string(),
  affected: z.array(
    z.object({
      file: z.string(),
      signal: z.string(),
      depth: z.number(),
      path: z.array(z.string()),
      impact: z.string(),
      explanation: z.string(),
      evidence: z.array(
        z.object({
          type: z.string(),
          file: z.string(),
          line: z.number().optional(),
          url: z.string().optional(),
        }),
      ),
    }),
  ),
  warnings: z.array(z.string()),
});
export const riskSchema = z.object({
  snapshotSha: z.string(),
  historyFrom: z.string(),
  historyTo: z.string(),
  partial: z.boolean(),
  warnings: z.array(z.string()),
  files: z.array(
    z.object({
      path: z.string(),
      entityId: z.string(),
      observedAuthors: z.number(),
      commitCount: z.number(),
      lastEdit: z.string(),
      contributors: z.array(z.object({ name: z.string(), commits: z.number() })),
      sources: z.array(sourceSchema),
    }),
  ),
});
export const analysisSchema = z.object({
  id: z.string(),
  status: z.string(),
  prNumber: z.number(),
  baseSha: z.string(),
  headSha: z.string(),
  event: z.string(),
  createdAt: z.string(),
  actionsUrl: z.string().optional(),
  prUrl: z.string().optional(),
  stale: z.boolean(),
  result: impactSchema.nullable(),
  warnings: z.array(z.string()),
});
export type Entity = z.infer<typeof entitySchema>;
export type Edge = z.infer<typeof edgeSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type Repository = z.infer<typeof repositorySchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Graph = z.infer<typeof graphSchema>;
export type Answer = z.infer<typeof answerSchema>;
export type Impact = z.infer<typeof impactSchema>;
export type Analysis = z.infer<typeof analysisSchema>;
export type GraphQuery = {
  snapshotId: string;
  entityId: string;
  depth?: 1 | 2 | 3;
  nodeKinds?: string[];
  relationshipKinds?: string[];
  includeInferred?: boolean;
};
export type ImpactRequest = {
  snapshotId: string;
  changedFiles?: string[];
  proposedDiff?: string;
  maxDepth?: number;
};
export type AskRequest = { question: string; snapshotId?: string; focusEntityId?: string };

export { safeSourceUrl } from './links';
export function canonicalGithubUrl(value: string): string | undefined {
  try {
    const u = new URL(value.trim());
    if (
      u.protocol !== 'https:' ||
      u.hostname !== 'github.com' ||
      u.port ||
      u.username ||
      u.password ||
      u.search ||
      u.hash
    )
      return;
    const parts = u.pathname.replace(/\/$/, '').split('/').filter(Boolean);
    if (
      parts.length !== 2 ||
      !parts.every((p) => /^[a-zA-Z0-9_.-]+$/.test(p)) ||
      parts.some((p) => p === '.' || p === '..')
    )
      return;
    const name = parts[1].replace(/\.git$/, '');
    return name ? `https://github.com/${parts[0]}/${name}` : undefined;
  } catch {
    return;
  }
}
export function hasValidCitations(answer: Answer): boolean {
  const ids = new Set(answer.sources.map((s) => s.id));
  return answer.status === 'not_found'
    ? answer.claims.length === 0
    : answer.claims.length > 0 &&
        answer.claims.every(
          (c) => c.evidenceIds.length > 0 && c.evidenceIds.every((id) => ids.has(id)),
        );
}
