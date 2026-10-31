import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
cytoscape.use(fcose);

export type SpatialLayoutInput = {
  nodes: { id: string; width: number; height: number }[];
  edges: { id: string; source: string; target: string }[];
  records: boolean;
  dense: boolean;
};
export type SpatialLayoutOutput =
  { positions: Record<string, { x: number; y: number }> } | { error: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SpatialLayoutInput>) => void) | null;
  postMessage(data: SpatialLayoutOutput): void;
};
scope.onmessage = ({ data }) => {
  let cy: cytoscape.Core | undefined;
  try {
    cy = cytoscape({
      headless: true,
      styleEnabled: true,
      elements: [
        ...data.nodes.map((node) => ({ data: node })),
        ...data.edges.map((edge) => ({ data: edge })),
      ],
      style: [{ selector: 'node', style: { width: 'data(width)', height: 'data(height)' } }],
    });
    cy.layout({
      name: 'fcose',
      quality: 'proof',
      randomize: true,
      animate: false,
      fit: false,
      packComponents: false,
      nodeDimensionsIncludeLabels: false,
      idealEdgeLength: () => (data.records ? 170 : 125),
      nodeRepulsion: () => 8000,
      nodeSeparation: 90,
      gravity: 0.12,
      numIter: data.dense ? 1200 : 2200,
      tilingPaddingVertical: 40,
      tilingPaddingHorizontal: 40,
    } as cytoscape.LayoutOptions).run();
    const positions: Record<string, { x: number; y: number }> = {};
    cy.nodes().forEach((node) => {
      positions[node.id()] = { ...node.position() };
    });
    scope.postMessage({ positions });
  } catch {
    scope.postMessage({ error: 'Spatial arrangement unavailable' });
  } finally {
    cy?.destroy();
  }
};
