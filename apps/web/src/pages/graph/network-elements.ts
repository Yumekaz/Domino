import type { Graph } from '../../api/schemas';
export const graphRecordColors: Record<string, string> = {
  File: '#7da7ff',
  FileRevision: '#7da7ff',
  PullRequest: '#eea86b',
  Issue: '#d5c170',
  Commit: '#8bacd0',
  Contributor: '#a2b3d0',
  Document: '#9eb7bb',
  DiscussionComment: '#8ba7c4',
  Decision: '#d9b780',
  Module: '#86b6e5',
  Repository: '#a4c9e5',
};

/** Selection classes are known before drawing, so first paint need not rasterize two styles. */
export function networkClasses(
  graph: Graph,
  selection: { kind: 'node' | 'edge'; id: string } | null,
  edgeLabels: boolean,
) {
  const nodes = new Set<string>(),
    edges = new Set<string>();
  let found = false;
  if (selection?.kind === 'node' && graph.nodes.some((node) => node.id === selection.id)) {
    found = true;
    nodes.add(selection.id);
    for (const edge of graph.edges)
      if (edge.source === selection.id || edge.target === selection.id) {
        edges.add(edge.id);
        nodes.add(edge.source);
        nodes.add(edge.target);
      }
  } else if (selection?.kind === 'edge') {
    const edge = graph.edges.find((edge) => edge.id === selection.id);
    if (edge) {
      found = true;
      edges.add(edge.id);
      nodes.add(edge.source);
      nodes.add(edge.target);
    }
  }
  const result = new Map<string, string>();
  for (const node of graph.nodes)
    result.set(
      `node:${node.id}`,
      [
        found ? (nodes.has(node.id) ? 'path-focus' : 'dimmed') : '',
        selection?.kind === 'node' && selection.id === node.id ? 'is-selected' : '',
      ]
        .filter(Boolean)
        .join(' '),
    );
  for (const edge of graph.edges)
    result.set(
      `edge:${edge.id}`,
      [
        found ? (edges.has(edge.id) ? 'path-focus' : 'dimmed') : '',
        selection?.kind === 'edge' && selection.id === edge.id ? 'is-selected' : '',
        edgeLabels ? 'show-relation-labels' : '',
      ]
        .filter(Boolean)
        .join(' '),
    );
  return result;
}
/** Presentation metadata uses only the visible returned neighborhood. */
export function networkElements(graph: Graph, rootId?: string) {
  const degrees = new Map(graph.nodes.map((node) => [node.id, 0]));
  for (const edge of graph.edges) {
    degrees.set(edge.source, (degrees.get(edge.source) || 0) + 1);
    degrees.set(edge.target, (degrees.get(edge.target) || 0) + 1);
  }
  return [
    ...graph.nodes.map((node, index) => ({
      data: {
        id: `node:${node.id}`,
        entityId: node.id,
        kind: node.kind,
        label: node.title.length > 45 ? `${node.title.slice(0, 42)}…` : node.title,
        recordLabel: `${node.kind.replace('PullRequest', 'PULL REQUEST').toUpperCase()}\n${node.title.length > 38 ? `${node.title.slice(0, 35)}…` : node.title}`,
        degree: degrees.get(node.id) || 0,
        diameter:
          (graph.nodes.length < 30 ? 44 : 26) +
          Math.min(22, Math.sqrt(degrees.get(node.id) || 0) * 6),
        root: node.id === rootId ? 1 : 0,
      },
      position: {
        x: Math.cos(index * 2.39996) * Math.sqrt(index + 1) * 75,
        y: Math.sin(index * 2.39996) * Math.sqrt(index + 1) * 75,
      },
    })),
    ...graph.edges.map((edge) => ({
      data: {
        id: `edge:${edge.id}`,
        source: `node:${edge.source}`,
        target: `node:${edge.target}`,
        label: edge.kind.replaceAll('_', ' '),
        kind: edge.kind,
        verification: edge.verification,
        edgeId: edge.id,
      },
    })),
  ];
}
