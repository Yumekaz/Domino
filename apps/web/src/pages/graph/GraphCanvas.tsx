import { useEffect, useRef, useState } from 'react';
import cytoscape, { type Core } from 'cytoscape';
import { Crosshair, Maximize2, Minus, Plus, RotateCcw, CircleDot, Rows3 } from 'lucide-react';
import { useDominoMotion } from '../../components/MotionPolicy';
import type { Graph } from '../../api/schemas';
import { networkElements } from './network-elements';
import './network.css';

export type GraphSelection = { kind: 'node' | 'edge'; id: string } | null;
// Small code-authored glyphs. No generated node or external image URLs.
const glyphs: Record<string, string> = {
  File: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13l-2 2 2 2m8-4 2 2-2 2"/>',
  PullRequest:
    '<circle cx="6" cy="3" r="2"/><path d="M6 5v12m7-14h2a3 3 0 0 1 3 3v11m-5-14 3-3m-3 3 3 3"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="19" r="2"/>',
  Issue: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/>',
  Commit: '<circle cx="12" cy="12" r="4"/><path d="M2 12h6m8 0h6"/>',
  Contributor: '<circle cx="12" cy="8" r="4"/><path d="M4 22v-2a8 8 0 0 1 16 0v2"/>',
  Document: '<path d="M5 3h14v18H5zM8 8h8m-8 4h8m-8 4h5"/>',
};
const icon = (kind: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#e8f0ff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${glyphs[kind === 'FileRevision' ? 'File' : kind] || glyphs.Document}</svg>`)}`;

export default function GraphCanvas({
  graph,
  layout,
  onSelect,
  selection,
  appearance = 'light',
  rootId,
  initialPresentation = 'network',
  testLabel,
}: {
  graph: Graph;
  layout: string;
  onSelect: (selection: GraphSelection) => void;
  selection: GraphSelection;
  appearance?: 'light' | 'dark';
  rootId?: string;
  initialPresentation?: 'network' | 'records';
  testLabel?: string;
}) {
  const reduced = useDominoMotion();
  const container = useRef<HTMLDivElement>(null);
  const core = useRef<Core | null>(null);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);
  const [presentation, setPresentation] = useState(initialPresentation);
  const [edgeLabels, setEdgeLabels] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [layoutNote, setLayoutNote] = useState('');
  const relayout = useRef<() => void>(() => {});
  const dark = appearance === 'dark';
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const records = presentation === 'records';
    const background = dark ? '#0b1320' : '#f7f9fb';
    const ink = dark ? '#c5d5eb' : '#354e6c';
    const dense = graph.nodes.length > 120;
    const cy = cytoscape({
      container: element,
      elements: networkElements(graph, rootId),
      layout: { name: 'preset' },
      pixelRatio: Math.min(window.devicePixelRatio, dense ? 1 : 1.75),
      minZoom: 0.08,
      maxZoom: 3.5,
      selectionType: 'single',
      boxSelectionEnabled: false,
      style: [
        {
          selector: 'node',
          style: {
            shape: records ? 'round-rectangle' : 'ellipse',
            width: records ? 152 : 'data(diameter)',
            height: records ? 67 : 'data(diameter)',
            'background-color': dark ? '#1d2c43' : '#dce6f3',
            'border-color': '#7995b5',
            'border-width': 1.5,
            label: records ? 'data(recordLabel)' : 'data(label)',
            color: ink,
            'font-family': 'Manrope Variable, sans-serif',
            'font-size': records ? 11 : graph.nodes.length < 30 ? 15 : 12,
            'font-weight': 500,
            'text-valign': records ? 'center' : 'bottom',
            'text-margin-y': records ? 0 : 12,
            'text-wrap': 'wrap',
            'text-max-width': records ? '132px' : '140px',
            'line-height': 1.55,
            'text-background-color': background,
            'text-background-opacity': records ? 0 : 0.85,
            'text-background-padding': '3px',
            'min-zoomed-font-size': records ? 8 : 9,
            'overlay-opacity': 0,
            'underlay-color': '#4d77a3',
            'underlay-opacity': records ? 0 : 0.1,
            'underlay-padding': 7,
            'underlay-shape': 'ellipse',
            'background-width': '45%',
            'background-height': '45%',
            'background-fit': 'contain',
            'background-clip': 'none',
            'background-repeat': 'no-repeat',
          },
        },
        ...[
          ['File', '#2453ac', '#7da7ff'],
          ['FileRevision', '#2453ac', '#7da7ff'],
          ['PullRequest', '#633d28', '#eea86b'],
          ['Issue', '#635631', '#d5c170'],
          ['Commit', '#253c55', '#8bacd0'],
          ['Contributor', '#344055', '#a2b3d0'],
          ['Document', '#35494f', '#9eb7bb'],
        ].map(([kind, fill, border]) => ({
          selector: `node[kind = "${kind}"]`,
          style: {
            'background-color': fill,
            'border-color': border,
            'underlay-color': border,
            'background-image': records ? 'none' : icon(kind),
          },
        })),
        {
          selector: 'node[root = 1]',
          style: {
            'border-width': 2.5,
            'border-color': '#ffbe83',
            'underlay-color': '#ffaf70',
            'underlay-opacity': records ? 0 : 0.13,
            'underlay-padding': 12,
          },
        },
        {
          selector: 'edge',
          style: {
            width: 1.15,
            'line-color': dark ? '#425a78' : '#96a9bc',
            'target-arrow-color': dark ? '#526e91' : '#8099b4',
            'target-arrow-shape': 'triangle',
            'arrow-scale': 0.65,
            'curve-style': 'bezier',
            label: '',
            'font-size': 9,
            'font-family': 'IBM Plex Mono',
            color: dark ? '#adc2dd' : '#486789',
            'text-rotation': 'autorotate',
            'text-background-color': background,
            'text-background-opacity': 0.95,
            'text-background-padding': '4px',
            'min-zoomed-font-size': 8,
          },
        },
        {
          selector: 'edge[verification = "derived"]',
          style: {
            'line-style': 'dotted',
            'line-color': '#88794f',
            'target-arrow-color': '#88794f',
          },
        },
        { selector: 'edge[kind = "CO_CHANGED_WITH"]', style: { 'target-arrow-shape': 'none' } },
        {
          selector: 'edge[verification = "inferred"]',
          style: {
            'line-style': 'dashed',
            'line-color': '#b37b51',
            'target-arrow-color': '#b37b51',
          },
        },
        { selector: '.dimmed', style: { opacity: 0.15 } },
        {
          selector: 'node.path-focus',
          style: {
            opacity: 1,
            'border-color': '#b4d0ff',
            'border-width': 2.2,
            'underlay-opacity': records ? 0 : 0.2,
            'underlay-padding': 10,
            'font-size': 13,
            'min-zoomed-font-size': 0,
            color: dark ? '#edf3ff' : '#213d60',
          },
        },
        {
          selector: 'node.is-selected',
          style: {
            'border-color': '#ffc38e',
            'border-width': 3,
            'underlay-color': '#ffb675',
            'underlay-opacity': records ? 0 : 0.17,
            'underlay-padding': 15,
          },
        },
        {
          selector: 'edge.path-focus',
          style: {
            opacity: 1,
            width: 2,
            'line-color': '#91b5f0',
            'target-arrow-color': '#91b5f0',
            label: 'data(label)',
            'min-zoomed-font-size': 0,
          },
        },
        { selector: 'edge.show-relation-labels', style: { label: 'data(label)' } },
        {
          selector: '.is-hovered',
          style: {
            'border-color': '#fff',
            'border-width': 2.5,
            'underlay-opacity': records ? 0 : 0.2,
          },
        },
      ] as cytoscape.StylesheetStyle[],
    });
    core.current = cy;
    let disposed = false;
    let arrangeVersion = 0;
    const arrange = async () => {
      const version = ++arrangeVersion;
      let spatialAvailable = true;
      if (layout === 'fcose' && graph.nodes.length > 2) {
        element.setAttribute('aria-busy', 'true');
        try {
          await import('./fcose-layout');
          if (!disposed) setLayoutNote('');
        } catch {
          spatialAvailable = false;
          if (!disposed) setLayoutNote('Spatial layout unavailable. Showing the radial layout.');
        }
      }
      if (
        disposed ||
        version !== arrangeVersion ||
        cy.destroyed() ||
        !element.isConnected ||
        element.clientWidth < 1 ||
        element.clientHeight < 1 ||
        !cy.nodes().length
      )
        return;
      const name = !spatialAvailable
        ? 'concentric'
        : graph.nodes.length < 3 && layout === 'fcose'
          ? 'circle'
          : layout;
      const common = {
        name,
        padding: records ? 40 : 30,
        animate: false,
        fit: true,
        nodeDimensionsIncludeLabels: true,
        avoidOverlap: true,
      };
      const options =
        name === 'fcose'
          ? {
              ...common,
              quality: 'proof',
              randomize: true,
              packComponents: false,
              idealEdgeLength: () => (records ? 170 : 125),
              nodeRepulsion: () => 8000,
              nodeSeparation: 90,
              gravity: 0.12,
              numIter: dense ? 1200 : 2200,
              tilingPaddingVertical: 40,
              tilingPaddingHorizontal: 40,
            }
          : name === 'concentric'
            ? {
                ...common,
                minNodeSpacing: 65,
                spacingFactor: 1.15,
                concentric: (node: cytoscape.NodeSingular) => (node.data('root') ? 2 : 1),
                levelWidth: () => 1,
              }
            : name === 'grid'
              ? {
                  ...common,
                  cols:
                    graph.nodes.length <= 12 ? 3 : Math.ceil(Math.sqrt(graph.nodes.length * 1.5)),
                }
              : { ...common, spacingFactor: 1.3, circle: name === 'circle' };
      cy.resize();
      cy.layout(options as cytoscape.LayoutOptions).run();
      // Rotate a tall force layout to suit a landscape canvas; topology is unchanged.
      const bounds = cy.nodes().boundingBox({ includeLabels: false });
      if (
        name === 'fcose' &&
        bounds.h > bounds.w &&
        element.clientWidth > element.clientHeight * 1.3
      ) {
        cy.nodes().positions((node) => ({ x: node.position('y'), y: node.position('x') }));
        cy.fit(undefined, 30);
      }
      if (name === 'fcose' && graph.nodes.length < 30 && !records) {
        // Small neighborhoods need readable record targets, rather than a distant overview.
        cy.nodes().positions((node) => ({
          x: node.position('x') * 0.7,
          y: node.position('y') * 0.7,
        }));
        cy.fit(undefined, 30);
      }
      if (cy.zoom() > 1.35) {
        cy.zoom(1.35);
        cy.center();
      }
      element.setAttribute('aria-busy', 'false');
    };
    relayout.current = arrange;
    arrange();
    cy.on('tap', 'node', (event) =>
      onSelectRef.current({ kind: 'node', id: event.target.data('entityId') }),
    );
    cy.on('tap', 'edge', (event) =>
      onSelectRef.current({ kind: 'edge', id: event.target.data('edgeId') }),
    );
    cy.on('tap', (event) => {
      if (event.target === cy) onSelectRef.current(null);
    });
    cy.on('mouseover', 'node', (event) => {
      element.style.cursor = 'pointer';
      event.target.addClass('is-hovered');
    });
    cy.on('mouseout', 'node', (event) => {
      element.style.cursor = 'grab';
      event.target.removeClass('is-hovered');
    });
    let zoomFrame = 0;
    const updateZoom = () => {
      if (zoomFrame) return;
      zoomFrame = requestAnimationFrame(() => {
        zoomFrame = 0;
        if (!cy.destroyed()) setZoom(Math.round(cy.zoom() * 100));
      });
    };
    cy.on('zoom', updateZoom);
    updateZoom();
    let resizeFrame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        if (!cy.destroyed() && element.clientWidth > 0 && element.clientHeight > 0) {
          cy.resize();
          cy.fit(undefined, 30);
          if (cy.zoom() > 1.35) {
            cy.zoom(1.35);
            cy.center();
          }
        }
      });
    });
    observer.observe(element);
    return () => {
      disposed = true;
      observer.disconnect();
      cancelAnimationFrame(resizeFrame);
      cancelAnimationFrame(zoomFrame);
      cy.destroy();
      core.current = null;
      relayout.current = () => {};
    };
  }, [graph, layout, appearance, rootId, presentation, dark]);
  useEffect(() => {
    const cy = core.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().removeClass('dimmed path-focus is-selected show-relation-labels');
      if (edgeLabels) cy.edges().addClass('show-relation-labels');
      if (selection) {
        const target = cy.getElementById(`${selection.kind}:${selection.id}`);
        if (target.length) {
          cy.elements().addClass('dimmed');
          const related =
            selection.kind === 'edge'
              ? target.add(target.connectedNodes())
              : target.closedNeighborhood();
          related.removeClass('dimmed').addClass('path-focus');
          target.addClass('is-selected');
        }
      }
    });
  }, [selection, graph, layout, presentation, rootId, edgeLabels]);
  const focusSelected = () => {
    const cy = core.current;
    if (!cy || !selection) return;
    const target = cy.getElementById(`${selection.kind}:${selection.id}`);
    if (!target.length) return;
    const related =
      selection.kind === 'edge' ? target.add(target.connectedNodes()) : target.closedNeighborhood();
    if (reduced || document.documentElement.dataset.input === 'keyboard') cy.fit(related, 45);
    else cy.animate({ fit: { eles: related, padding: 45 } }, { duration: 240 });
  };
  return (
    <div
      className={`graph-canvas-wrap network-canvas presentation-${presentation} ${dark ? 'dark-network' : ''}`}
    >
      <div className="network-viewbar">
        <span className="network-scope">
          <i />
          {graph.nodes.length} RECORDS <b>/</b> {graph.edges.length} RELATIONSHIPS{' '}
          <small>IN THIS VIEW</small>
        </span>
        <div className="network-switch" aria-label="Graph presentation">
          <button
            aria-pressed={presentation === 'network'}
            onClick={() => setPresentation('network')}
          >
            <CircleDot size={13} />
            Network
          </button>
          <button
            aria-pressed={presentation === 'records'}
            onClick={() => setPresentation('records')}
          >
            <Rows3 size={13} />
            Records
          </button>
        </div>
      </div>
      <div
        ref={container}
        className="graph-canvas"
        role="img"
        aria-label="Interactive bounded repository graph. Drag nodes to explore. Use the record and relationship lists below for keyboard access."
      />
      {import.meta.env.DEV && testLabel && (
        <div className="renderer-test-watermark">
          DEVELOPER TEST / SYNTHETIC TOPOLOGY<span>{testLabel}</span>
        </div>
      )}
      <div className="graph-controls network-navigation">
        <button
          aria-label="Zoom in graph"
          onClick={() => {
            const cy = core.current;
            if (cy)
              cy.zoom({
                level: cy.zoom() * 1.2,
                renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
              });
          }}
        >
          <Plus size={16} />
        </button>
        <span aria-label="Graph zoom">{zoom}%</span>
        <button
          aria-label="Zoom out graph"
          onClick={() => {
            const cy = core.current;
            if (cy)
              cy.zoom({
                level: cy.zoom() / 1.2,
                renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
              });
          }}
        >
          <Minus size={16} />
        </button>
        <button aria-label="Fit graph to view" onClick={() => core.current?.fit(undefined, 30)}>
          <Maximize2 size={15} />
        </button>
        <button
          aria-label="Focus selected connection"
          disabled={!selection}
          onClick={focusSelected}
        >
          <Crosshair size={15} />
        </button>
        <button aria-label="Rearrange graph" onClick={() => relayout.current()}>
          <RotateCcw size={14} />
        </button>
      </div>
      <div className="network-detail-options">
        <label>
          <input
            type="checkbox"
            checked={edgeLabels}
            onChange={(event) => setEdgeLabels(event.target.checked)}
          />
          Relationship labels
        </label>
        <span>Node size = visible connections. Labels reveal as you zoom.</span>
      </div>
      {layoutNote && layout === 'fcose' && (
        <p className="network-layout-note" role="status">
          {layoutNote}
        </p>
      )}
    </div>
  );
}
