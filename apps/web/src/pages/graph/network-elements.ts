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
