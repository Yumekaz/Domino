import { describe, expect, it } from 'vitest';
import { fixtureRequest } from './fixtureAdapter';
import { fixtureAuthId, fixtureRepositoryId } from './fixtureIds';
import {
  analysisSchema,
  answerSchema,
  detailSchema,
  graphSchema,
  impactSchema,
  repositorySchema,
  riskSchema,
  searchSchema,
} from '../api/schemas';
const root = `/repositories/${fixtureRepositoryId}`;
const post = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body) });
describe('Explicit development fixture integration shapes', () => {
  it('validates the partial snapshot and complete response families', async () => {
    expect(repositorySchema.parse(await fixtureRequest(root)).snapshot?.status).toBe('partial');
    searchSchema.parse(await fixtureRequest(`${root}/search?q=auth`));
    detailSchema.parse(await fixtureRequest(`${root}/entities/${fixtureAuthId}`));
    riskSchema.parse(await fixtureRequest(`${root}/knowledge-risk`));
    analysisSchema.parse(await fixtureRequest(`${root}/analysis/fixture-run`));
  });
  it('only exposes graph edges whose endpoints are in the returned bounded neighborhood', async () => {
    const first = graphSchema.parse(
      await fixtureRequest(`${root}/graph?entityId=${fixtureAuthId}&depth=1`),
    );
    const expanded = graphSchema.parse(
      await fixtureRequest(
        `${root}/graph?entityId=${fixtureAuthId}&depth=3&includeInferred=true`,
      ),
    );
    expect(expanded.nodes.length).toBeGreaterThan(first.nodes.length);
    expect(first.edges.every((e) => e.verification !== 'inferred')).toBe(true);
    expect(expanded.edges.some((e) => e.verification === 'inferred')).toBe(true);
  });
  it('never pretends to answer an arbitrary question', async () => {
    const answer = answerSchema.parse(
      await fixtureRequest(`${root}/ask`, post({ question: 'An unsupported question' })),
    );
    expect(answer.status).toBe('not_found');
    expect(answer.claims).toEqual([]);
    expect(answer.sources).toEqual([]);
  });
  it('only returns the isolated known impact example', async () => {
    const example = impactSchema.parse(
      await fixtureRequest(`${root}/impact`, post({ changedFiles: ['src/auth.ts'] })),
    );
    expect(example.affected.some((a) => a.depth === 2)).toBe(true);
    await expect(
      fixtureRequest(`${root}/impact`, post({ changedFiles: ['src/arbitrary.ts'] })),
    ).rejects.toMatchObject({ code: 'FIXTURE_INPUT_UNSUPPORTED' });
    await expect(
      fixtureRequest(`${root}/impact`, post({ proposedDiff: 'arbitrary diff' })),
    ).rejects.toMatchObject({ code: 'FIXTURE_INPUT_UNSUPPORTED' });
  });
  it('does not simulate a check for arbitrary PR numbers', async () => {
    await expect(fixtureRequest(`${root}/pr-check`, post({ prNumber: 123 }))).rejects.toMatchObject(
      { code: 'FIXTURE_INPUT_UNSUPPORTED' },
    );
  });
});
