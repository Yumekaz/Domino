import { describe, expect, it } from 'vitest';
import { networkElements, networkClasses } from './network-elements';
import type { Graph } from '../../api/schemas';
const graph: Graph = {
  nodes: [
    { id: 'a', kind: 'File', title: 'auth.ts' },
    { id: 'b', kind: 'File', title: 'session.ts' },
    { id: 'c', kind: 'Document', title: 'Notes' },
  ],
  edges: [
    {
      id: 'import',
      source: 'b',
      target: 'a',
      kind: 'IMPORTS',
      verification: 'observed',
      snapshotSha: '0'.repeat(40),
    },
  ],
  truncated: true,
  warnings: [],
  snapshotSha: '0'.repeat(40),
};
describe('network presentation boundaries', () => {
  it('keeps exactly the returned records and edges', () => {
    const elements = networkElements(graph, 'a');
    expect(elements).toHaveLength(4);
    expect(
      elements.filter((element) => 'edgeId' in element.data).map((element) => element.data.id),
    ).toEqual(['edge:import']);
  });
  it('derives degree from visible relationships and keeps disconnected records', () => {
    const nodes = networkElements(graph).filter((element) => 'degree' in element.data);
    expect(
      nodes.map((node) => [node.data.id, 'degree' in node.data ? node.data.degree : null]),
    ).toEqual([
      ['node:a', 1],
      ['node:b', 1],
      ['node:c', 0],
    ]);
  });
  it('never makes an unavailable focus record into a graph node', () => {
    expect(
      networkElements(graph, 'missing').filter(
        (element) => 'root' in element.data && element.data.root === 1,
      ),
    ).toEqual([]);
  });
  it('preserves edge direction and verification', () => {
    expect(
      networkElements(graph).find((element) => element.data.id === 'edge:import')?.data,
    ).toMatchObject({ source: 'node:b', target: 'node:a', verification: 'observed' });
  });
  it('prepares selected neighborhoods without hiding unrelated records permanently', () => {
    const selected = networkClasses(graph, { kind: 'node', id: 'a' }, false);
    expect(selected.get('node:a')).toBe('path-focus is-selected');
    expect(selected.get('node:b')).toBe('path-focus');
    expect(selected.get('node:c')).toBe('dimmed');
    expect(selected.get('edge:import')).toBe('path-focus');
    expect([...networkClasses(graph, null, false).values()].every((value) => value === '')).toBe(
      true,
    );
  });
  it('selects an edge and only its endpoints while retaining the labels toggle', () => {
    const selected = networkClasses(graph, { kind: 'edge', id: 'import' }, true);
    expect(selected.get('edge:import')).toBe('path-focus is-selected show-relation-labels');
    expect(selected.get('node:a')).toBe('path-focus');
    expect(selected.get('node:c')).toBe('dimmed');
    expect(networkClasses(graph, { kind: 'node', id: 'unavailable' }, false).get('node:a')).toBe(
      '',
    );
  });
});
