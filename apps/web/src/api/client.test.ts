import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, fixtureMode, request } from './client';
import { z } from 'zod';
import {
  answerSchema,
  canonicalGithubUrl,
  graphSchema,
  hasValidCitations,
  safeSourceUrl,
} from './schemas';
afterEach(() => vi.unstubAllGlobals());
describe('Public GitHub input boundary', () => {
  it('canonicalizes supported repository URLs', () => {
    expect(canonicalGithubUrl(' https://github.com/pmndrs/zustand.git/ ')).toBe(
      'https://github.com/pmndrs/zustand',
    );
  });
  it.each([
    'http://github.com/a/b',
    'https://github.com.evil.test/a/b',
    'https://user:secret@github.com/a/b',
    'https://github.com/a/b/issues',
    'https://github.com/a/b?token=x',
    'file:///a/b',
    'owner/repo',
  ])('rejects %s', (value) => expect(canonicalGithubUrl(value)).toBeUndefined());
  it.each([
    'javascript:alert(1)',
    'data:text/html,hi',
    'http://example.com',
    'https://secret@example.com',
  ])('withholds unsafe source link %s', (value) => expect(safeSourceUrl(value)).toBeUndefined());
});
describe('Evidence is never substituted', () => {
  it('uses live mode by default', () => expect(fixtureMode).toBe(false));
  it('pins entity evidence requests to the selected snapshot', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 'SOURCE_NOT_FOUND', message: 'Not found' }), { status: 404 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.entity('repo', 'entity', undefined, 'snapshot-id')).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' });
    expect(String(fetchMock.mock.calls[0][0])).toContain('/repositories/repo/entities/entity?snapshotId=snapshot-id');
  });
  it('reports transport failures without loading fixtures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await expect(api.repository('real-repo')).rejects.toMatchObject({
      code: 'CONNECTION_UNAVAILABLE',
    });
  });
  it('aborts an obsolete read instead of substituting a result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true },
            );
          }),
      ),
    );
    const controller = new AbortController();
    const read = api.repository('repo', controller.signal);
    controller.abort();
    await expect(read).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('maps the request time budget to an explicit timeout error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('Request timed out', 'TimeoutError')),
    );
    await expect(api.repository('repo')).rejects.toMatchObject({ code: 'TIME_BUDGET_EXCEEDED' });
  });
  it('rejects a malformed success response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ invented: true }), { status: 200 })),
    );
    await expect(api.repository('repo')).rejects.toMatchObject({ code: 'CONTRACT_MISMATCH' });
  });
  it('preserves machine-readable API errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 'GITHUB_RATE_LIMITED', message: 'Retry later' }), {
          status: 429,
        }),
      ),
    );
    await expect(api.import('https://github.com/a/b')).rejects.toMatchObject({
      code: 'GITHUB_RATE_LIMITED',
      message: 'Retry later',
    });
  });
  it('handles non-JSON responses explicitly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>proxy error</html>', { status: 502 })),
    );
    await expect(request('/health', z.object({ status: z.string() }))).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
  it('sends agreed ask request fields to the scoped endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          answer: 'No supporting project history found.',
          status: 'not_found',
          claims: [],
          sources: [],
          unknowns: [],
          warnings: [],
          snapshotSha: 'a'.repeat(40),
          errorCode: null,
          searchAvailable: true,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetcher);
    await api.ask('repo/id', { question: 'Why?', snapshotId: 'snapshot', focusEntityId: 'entity' });
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/repositories/repo%2Fid/ask');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      question: 'Why?',
      snapshotId: 'snapshot',
      focusEntityId: 'entity',
    });
  });
  it('requires claim citations to exist in the returned pack', () => {
    const missingId = '11111111-1111-4111-8111-111111111111';
    const response = answerSchema.parse({
      answer: 'A reason',
      status: 'supported',
      claims: [{ text: 'Claim', support: 'documented', evidenceIds: [missingId] }],
      sources: [{ id: missingId, kind: 'comment', locator: 'Source' }],
      unknowns: [],
      warnings: [],
      snapshotSha: 'a'.repeat(40),
      errorCode: null,
      searchAvailable: true,
    });
    expect(hasValidCitations(response)).toBe(true);
    expect(hasValidCitations({ ...response, sources: [] })).toBe(false);
    expect(answerSchema.safeParse({ ...response, sources: [] }).success).toBe(false);
  });
  it('rejects dangling graph relationships and duplicate IDs', () => {
    const node = {
      id: '11111111-1111-4111-8111-111111111111',
      title: 'file',
      kind: 'File',
    };
    const edge = {
      id: '22222222-2222-4222-8222-222222222222',
      source: '11111111-1111-4111-8111-111111111111',
      target: '33333333-3333-4333-8333-333333333333',
      kind: 'IMPORTS',
      verification: 'observed',
      snapshotSha: 'a'.repeat(40),
    };
    expect(
      graphSchema.safeParse({
        nodes: [node],
        edges: [edge],
        truncated: false,
        warnings: [],
        snapshotSha: 'a'.repeat(40),
      }).success,
    ).toBe(false);
    expect(
      graphSchema.safeParse({
        nodes: [node, node],
        edges: [],
        truncated: false,
        warnings: [],
        snapshotSha: 'a'.repeat(40),
      }).success,
    ).toBe(false);
  });
});
