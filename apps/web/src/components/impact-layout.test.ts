import { describe, expect, it } from 'vitest';
import { returnedImpactPaths } from './impact-layout';
import type { Impact } from '../api/schemas';
const result: Impact = {
  changedFiles: ['a.ts'],
  snapshotSha: '0'.repeat(40),
  warnings: [],
  truncated: false,
  affected: [
    {
      file: 'c.ts',
      signal: 'static_reverse_dependency',
      depth: 2,
      path: ['c.ts', 'b.ts', 'a.ts'],
      impact: 'possible',
      explanation: 'Returned path',
      evidence: [],
    },
    {
      file: 'd.ts',
      signal: 'historically_coupled',
      depth: 0,
      path: ['d.ts', 'a.ts'],
      impact: 'possible',
      explanation: 'Association',
      evidence: [],
    },
  ],
};
describe('Returned impact display paths', () => {
  it('draws only returned path segments in the labelled impact direction', () => {
    const graph = returnedImpactPaths(result);
    expect(graph.edges).toEqual([
      { source: 'a.ts', target: 'b.ts' },
      { source: 'b.ts', target: 'c.ts' },
    ]);
    expect(graph.nodes.find((n) => n.file === 'c.ts')?.level).toBe(2);
  });
  it('keeps co-change out of structural paths', () => {
    expect(returnedImpactPaths(result).nodes.some((n) => n.file === 'd.ts')).toBe(false);
  });
  it('does not invent a connection for an empty path', () => {
    expect(
      returnedImpactPaths({ ...result, affected: [{ ...result.affected[0], path: [] }] }).edges,
    ).toEqual([]);
  });
  it('bounds large path sets without changing the response', () => {
    const many = {
      ...result,
      affected: Array.from({ length: 20 }, (_, i) => ({
        ...result.affected[0],
        file: `file${i}.ts`,
        depth: 1,
        path: [`file${i}.ts`, 'a.ts'],
      })),
    };
    expect(returnedImpactPaths(many).limited).toBe(true);
    expect(many.affected).toHaveLength(20);
    expect(returnedImpactPaths(many).edges).toHaveLength(12);
  });
});
