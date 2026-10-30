import { useEffect, useRef } from 'react';
import cytoscape, { type Core } from 'cytoscape';
import { Maximize2, Minus, Plus } from 'lucide-react';
import type { Graph } from '../../api/schemas';
export type GraphSelection = { kind: 'node' | 'edge'; id: string } | null;
export default function GraphCanvas({
  graph,
  layout,
  onSelect,
  selection,
  appearance = 'light',
}: {
  graph: Graph;
  layout: string;
  onSelect: (s: GraphSelection) => void;
  selection: GraphSelection;
  appearance?: 'light' | 'dark';
}) {
  const container = useRef<HTMLDivElement>(null);
  const core = useRef<Core | null>(null);
  useEffect(() => {
    if (!container.current) return;
    const narrow = container.current.clientWidth < 520;
    const layoutOptions = {
      name: layout,
      padding: narrow ? 24 : 48,
      animate: false,
      spacingFactor: narrow ? 1.05 : 1.15,
      nodeDimensionsIncludeLabels: true,
      avoidOverlap: true,
      ...(layout === 'grid' ? { cols: narrow ? 2 : 3 } : {}),
    } as cytoscape.LayoutOptions;
    const cy = cytoscape({
      container: container.current,
      pixelRatio: Math.min(window.devicePixelRatio, 2),
      minZoom: 0.2,
      maxZoom: 2.5,
      elements: [
        ...graph.nodes.map((n) => ({
          data: {
            id: `node:${n.id}`,
            entityId: n.id,
            label: `${n.kind.replace('PullRequest', 'PULL REQUEST').toUpperCase()}\n${n.title.length > 38 ? n.title.slice(0, 35) + '…' : n.title}`,
            kind: n.kind,
          },
        })),
        ...graph.edges.map((e) => ({
          data: {
            id: `edge:${e.id}`,
            source: `node:${e.source}`,
            target: `node:${e.target}`,
            label: e.kind.replaceAll('_', ' '),
            verification: e.verification,
            edgeId: e.id,
          },
        })),
      ],
      layout: layoutOptions,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': '#ffffff',
            'border-color': '#c2ccd6',
            'border-width': 1.3,
            color: '#384756',
            label: 'data(label)',
            'font-family': 'Manrope Variable, sans-serif',
            'font-size': narrow ? 12 : 11,
            'font-weight': 500,
            'text-valign': 'center',
            'text-margin-y': 0,
            'line-height': 1.6,
            width: narrow ? 124 : 152,
            height: narrow ? 76 : 67,
            shape: 'round-rectangle',
            'text-wrap': 'wrap',
            'text-max-width': narrow ? '108px' : '132px',
          },
        },
        {
          selector: 'node[kind = "File"], node[kind = "FileRevision"]',
          style: {
            'background-color': '#edf2ff',
            'border-color': '#a5bced',
            color: '#244ca5',
            shape: 'round-rectangle',
          },
        },
        {
          selector: 'node[kind = "PullRequest"]',
          style: {
            'background-color': '#fff2e7',
            'border-color': '#dbb38c',
            color: '#855227',
            shape: 'round-rectangle',
          },
        },
        {
          selector: 'node[kind = "Issue"]',
          style: { 'background-color': '#fff9df', 'border-color': '#c6b46c', color: '#78632d' },
        },
        {
          selector: 'node[kind = "Contributor"]',
          style: {
            'background-color': '#eef0f3',
            'border-color': '#a8b2c1',
            shape: 'round-rectangle',
          },
        },
        {
          selector: 'edge',
          style: {
            width: 1.8,
            'line-color': '#8b9daf',
            'target-arrow-color': '#8b9daf',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            label: narrow ? '' : 'data(label)',
            'font-size': 9,
            'font-family': 'IBM Plex Mono',
            color: '#667b90',
            'text-rotation': 'autorotate',
            'text-background-color': '#fafaf7',
            'text-background-opacity': 1,
            'text-background-padding': '4px',
          },
        },
        {
          selector: 'edge[verification = "inferred"]',
          style: {
            'line-style': 'dashed',
            'line-color': '#cb6b2e',
            'target-arrow-color': '#cb6b2e',
          },
        },
        {
          selector: 'edge[verification = "derived"]',
          style: {
            'line-style': 'dotted',
            'line-color': '#8a7843',
            'target-arrow-color': '#8a7843',
          },
        },
        { selector: '.dimmed', style: { opacity: 0.24 } },
        {
          selector: '.path-focus',
          style: {
            'border-width': 2,
            'border-color': '#1649ed',
            'background-color': '#1649ed',
            color: '#ffffff',
            opacity: 1,
          },
        },
        {
          selector: 'edge.path-focus',
          style: { width: 3, 'line-color': '#184aef', 'target-arrow-color': '#184aef', opacity: 1 },
        },
      ],
    });
    if (appearance === 'dark')
      cy.style()
        .append([
          {
            selector: 'node',
            style: { 'background-color': '#142238', 'border-color': '#3b5372', color: '#cddbef' },
          },
          {
            selector: 'node[kind = "File"],node[kind = "FileRevision"]',
            style: { 'background-color': '#142d58', 'border-color': '#3c67a5', color: '#bed2fa' },
          },
          {
            selector: 'node[kind = "PullRequest"]',
            style: { 'background-color': '#33251e', 'border-color': '#9c653e', color: '#f2c3a0' },
          },
          {
            selector: 'node[kind = "Issue"]',
            style: { 'background-color': '#302b1e', 'border-color': '#968448', color: '#e2d09d' },
          },
          {
            selector: 'node[kind = "Contributor"]',
            style: { 'background-color': '#1a2739', 'border-color': '#53677f', color: '#bdcee3' },
          },
          {
            selector: 'edge',
            style: {
              'line-color': '#526d90',
              'target-arrow-color': '#526d90',
              color: '#8da6c8',
              'text-background-color': '#0d1726',
            },
          },
          {
            selector: 'edge[verification = "derived"]',
            style: { 'line-color': '#9d875b', 'target-arrow-color': '#9d875b' },
          },
          {
            selector: 'edge[verification = "inferred"]',
            style: { 'line-color': '#a76c44', 'target-arrow-color': '#a76c44' },
          },
          {
            selector: 'node.path-focus',
            style: {
              'background-color': '#1649ed',
              'border-color': '#7397ff',
              color: '#fff',
              'border-width': 2,
            },
          },
          {
            selector: 'edge.path-focus',
            style: {
              'line-color': '#86adff',
              'target-arrow-color': '#86adff',
              color: '#c6d9ff',
              width: 3,
            },
          },
        ] as cytoscape.StylesheetStyle[])
        .update();
    core.current = cy;
    cy.on('tap', 'node', (e) => onSelect({ kind: 'node', id: e.target.data('entityId') }));
    cy.on('tap', 'edge', (e) => onSelect({ kind: 'edge', id: e.target.data('edgeId') }));
    cy.on('tap', (e) => {
      if (e.target === cy) onSelect(null);
    });
    const observer = new ResizeObserver(() => {
      if (
        cy.destroyed() ||
        !container.current?.isConnected ||
        container.current.clientWidth < 1 ||
        container.current.clientHeight < 1 ||
        !cy.nodes().length
      )
        return;
      const compact = (container.current?.clientWidth || 0) < 520;
      cy.nodes().style({
        width: compact ? 124 : 152,
        height: compact ? 76 : 67,
        'font-size': compact ? 12 : 11,
        'text-max-width': compact ? '108px' : '132px',
      });
      cy.resize();
      cy.layout({
        ...layoutOptions,
        ...(compact ? { name: 'grid', cols: 2, padding: 24 } : {}),
      } as cytoscape.LayoutOptions).run();
    });
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      cy.destroy();
      core.current = null;
    };
  }, [graph, layout, onSelect, appearance]);
  useEffect(() => {
    const cy = core.current;
    if (!cy) return;
    cy.elements().removeClass('dimmed path-focus');
    if (selection) {
      const element = cy.getElementById(
        selection.kind === 'edge' ? `edge:${selection.id}` : `node:${selection.id}`,
      );
      if (element.length) {
        cy.elements().addClass('dimmed');
        const related =
          selection.kind === 'edge'
            ? element.add(element.connectedNodes())
            : element.closedNeighborhood();
        related.removeClass('dimmed').addClass('path-focus');
      }
    }
  }, [selection, graph, layout]);
  return (
    <div className="graph-canvas-wrap">
      <div
        ref={container}
        className="graph-canvas"
        role="img"
        aria-label="Interactive bounded repository graph. Use the record and relationship lists below for keyboard access."
      />
      <div className="graph-controls">
        <button
          aria-label="Zoom in graph"
          onClick={() => core.current?.zoom(core.current.zoom() * 1.2)}
        >
          <Plus size={16} />
        </button>
        <button
          aria-label="Zoom out graph"
          onClick={() => core.current?.zoom(core.current.zoom() / 1.2)}
        >
          <Minus size={16} />
        </button>
        <button aria-label="Fit graph to view" onClick={() => core.current?.fit(undefined, 58)}>
          <Maximize2 size={16} />
        </button>
      </div>
      <div className="graph-canvas-caption">
        DRAG TO PAN · SCROLL OR PINCH TO ZOOM · SELECT TO INSPECT
      </div>
    </div>
  );
}
