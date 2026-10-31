import { useState } from 'react';
import type { Graph } from '../../api/schemas';
import { Badge, Button } from '../../components/ui';
import { EntityIcon } from '../investigations';
import type { GraphSelection } from './GraphCanvas';

/** Keyboard access to every returned item, without rendering a closed 400-row list. */
export default function GraphRecords({
  graph,
  onSelect,
}: {
  graph: Graph;
  onSelect: (selection: GraphSelection) => void;
}) {
  const [nodes, setNodes] = useState(30);
  const [edges, setEdges] = useState(30);
  const titles = new Map(graph.nodes.map((node) => [node.id, node.title]));
  return (
    <>
      <h3>Records in this neighborhood</h3>
      <div>
        {graph.nodes.slice(0, nodes).map((node) => (
          <button key={node.id} onClick={() => onSelect({ kind: 'node', id: node.id })}>
            <EntityIcon kind={node.kind} />
            {node.title}
            <Badge>{node.kind}</Badge>
          </button>
        ))}
      </div>
      {nodes < graph.nodes.length && (
        <Button
          className="pagination-load-more"
          variant="secondary"
          onClick={() => setNodes(nodes + 30)}
        >
          Show more graph records ({nodes} of {graph.nodes.length})
        </Button>
      )}
      <h3>Relationships in this neighborhood</h3>
      <div>
        {graph.edges.slice(0, edges).map((edge) => (
          <button key={edge.id} onClick={() => onSelect({ kind: 'edge', id: edge.id })}>
            {titles.get(edge.source)} → {titles.get(edge.target)}
            <Badge>{edge.kind}</Badge>
            <Badge>{edge.verification}</Badge>
          </button>
        ))}
      </div>
      {edges < graph.edges.length && (
        <Button
          className="pagination-load-more"
          variant="secondary"
          onClick={() => setEdges(edges + 30)}
        >
          Show more graph relationships ({edges} of {graph.edges.length})
        </Button>
      )}
    </>
  );
}
