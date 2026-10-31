// Acceptance probe for the opened PR-impact workflow run; no runtime behavior changes.
import { z } from 'zod';
import * as s from './schemas';
import { ApiError } from './errors';
export { ApiError } from './errors';
export const fixtureMode = import.meta.env.DEV && import.meta.env.VITE_DATA_MODE === 'fixture';
const base = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '') + '/api/v1';

export async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  if (fixtureMode) {
    const { fixtureRequest } = await import('../dev/fixtureAdapter');
    return schema.parse(await fixtureRequest(path, init));
  }
  let response: Response;
  try {
    response = await fetch(base + path, {
      ...init,
      signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(20000)]),
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    if (error instanceof DOMException && error.name === 'TimeoutError')
      throw new ApiError(
        'TIME_BUDGET_EXCEEDED',
        'The API did not respond within 20 seconds. Try again or narrow this investigation.',
      );
    throw new ApiError(
      'CONNECTION_UNAVAILABLE',
      'Domino could not reach the API. Check the service connection and try again.',
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(
      'INVALID_RESPONSE',
      'The API returned an empty or non-JSON response. Check the backend connection.',
    );
  }
  if (!response.ok) {
    const e = z
      .object({ code: z.string().optional(), message: z.string().optional() })
      .safeParse(body);
    throw new ApiError(
      e.success ? e.data.code || `HTTP_${response.status}` : `HTTP_${response.status}`,
      e.success
        ? e.data.message || 'The request could not be completed.'
        : 'The request could not be completed.',
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new ApiError(
      'CONTRACT_MISMATCH',
      'The API response does not match the frontend integration schema. No analysis has been substituted.',
    );
  return parsed.data;
}
const repo = (id: string) => `/repositories/${encodeURIComponent(id)}`;
const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
export const api = {
  health: (signal?: AbortSignal) =>
    request('/health', s.healthSchema, { signal }),
  import: (url: string) => request('/repositories', s.importSchema, post({ url })),
  repository: (id: string, signal?: AbortSignal) =>
    request(repo(id), s.repositorySchema, { signal }),
  job: (id: string, jobId: string, signal?: AbortSignal) =>
    request(`${repo(id)}/jobs/${encodeURIComponent(jobId)}`, s.jobSchema, { signal }),
  reindex: (id: string) => request(`${repo(id)}/reindex`, s.importSchema, post({})),
  search: (id: string, q: string, cursor?: string, signal?: AbortSignal) => {
    const p = new URLSearchParams({ q, limit: '30' });
    if (cursor) p.set('cursor', cursor);
    return request(`${repo(id)}/search?${p}`, s.searchSchema, { signal });
  },
  entity: (id: string, entityId: string, signal?: AbortSignal) =>
    request(`${repo(id)}/entities/${encodeURIComponent(entityId)}`, s.detailSchema, { signal }),
  graph: (id: string, query: s.GraphQuery, signal?: AbortSignal) => {
    const p = new URLSearchParams({
      snapshotId: query.snapshotId,
      entityId: query.entityId,
      depth: String(query.depth || 1),
      includeInferred: String(query.includeInferred || false),
    });
    query.nodeKinds?.forEach((k) => p.append('nodeKinds', k));
    query.relationshipKinds?.forEach((k) => p.append('relationshipKinds', k));
    return request(`${repo(id)}/graph?${p}`, s.graphSchema, { signal });
  },
  ask: (id: string, body: s.AskRequest) => request(`${repo(id)}/ask`, s.answerSchema, post(body)),
  impact: (id: string, body: s.ImpactRequest) =>
    request(`${repo(id)}/impact`, s.impactSchema, post(body)),
  risk: (id: string, snapshotId: string, cursor?: string, signal?: AbortSignal) => {
    const params = new URLSearchParams({ snapshotId, limit: '50' });
    if (cursor) params.set('cursor', cursor);
    return request(`${repo(id)}/knowledge-risk?${params}`, s.riskSchema, { signal });
  },
  prCheck: (id: string, prNumber: number) =>
    request(`${repo(id)}/pr-check`, z.object({ runId: z.string() }), post({ prNumber })),
  analysis: (id: string, runId: string, signal?: AbortSignal) =>
    request(`${repo(id)}/analysis/${encodeURIComponent(runId)}`, s.analysisSchema, { signal }),
};
