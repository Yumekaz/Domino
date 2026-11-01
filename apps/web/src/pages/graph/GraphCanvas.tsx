import { useEffect, useRef, useState } from 'react';
import cytoscape, { type Core } from 'cytoscape';
import { Crosshair, Maximize2, Minus, Plus, RotateCcw, CircleDot, Rows3 } from 'lucide-react';
import { useDominoMotion } from '../../components/MotionPolicy';
import type { Graph } from '../../api/schemas';
import { networkElements, networkClasses } from './network-elements';
import { spatialLayout } from './spatial-layout';
import { nextGraphFrame, populateGraph } from './progressive-elements';
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
  DiscussionComment: '<path d="M4 4h16v12H9l-5 5V4Zm4 4h8m-8 4h5"/>',
  Decision: '<path d="M8 16c0-3-3-3-3-7a7 7 0 0 1 14 0c0 4-3 4-3 7H8Zm1 4h6m-5 3h4M9 8l2 2 4-4"/>',
  Module: '<path d="M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z"/>',
  Repository: '<path d="M3 5h7l2 3h9v13H3V5Zm4 8h10m-10 4h6"/>',
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
  const [preparing, setPreparing] = useState(true);
  const relayout = useRef<() => void>(() => {});
  const layoutCache = useRef<{
    graph: Graph;
    layout: string;
    rootId?: string;
    positions: Partial<Record<'network' | 'records', Record<string, cytoscape.Position>>>;
  } | null>(null);
  const dark = appearance === 'dark';
  const selectionRef = useRef({ selection, edgeLabels });
  useEffect(() => {
    selectionRef.current = { selection, edgeLabels };
  }, [selection, edgeLabels]);
  const highlight = (cy: Core) => {
    const { selection: active, edgeLabels: labels } = selectionRef.current;
    const classes = networkClasses(graph, active, labels);
    cy.batch(() => {
      cy.elements().forEach((element) => {
        const next = classes.get(element.id()) || '';
        if (element.classes().join(' ') !== next) element.classes(next);
      });
    });
  };
  const highlightRef = useRef(highlight);
  useEffect(() => {
    highlightRef.current = highlight;
  });
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const stage = (name: string, start: number) => {
      const key = `domino.graph.${name}`;
      performance.clearMeasures(key);
      performance.measure(key, { start, end: performance.now() });
    };
    const createStart = performance.now();
    const controller = new AbortController();
    const records = presentation === 'records';
    if (
      !layoutCache.current ||
      layoutCache.current.graph !== graph ||
      layoutCache.current.layout !== layout ||
      layoutCache.current.rootId !== rootId
    ) {
      layoutCache.current = { graph, layout, rootId, positions: {} };
    }
    const cache = layoutCache.current;
    const background = dark ? '#0b1320' : '#f7f9fb';
    const ink = dark ? '#c5d5eb' : '#354e6c';
    const dense = graph.nodes.length > 120;
    const cy = cytoscape({
      container: element,
      elements: [],
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
          ['DiscussionComment', '#293b50', '#8ba7c4'],
          ['Decision', '#554429', '#d9b780'],
          ['Module', '#1d3f62', '#86b6e5'],
          ['Repository', '#233f55', '#a4c9e5'],
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
            // Wide neighborhoods must not rasterize dozens of unreadable
            // 3–7px labels. Selection/hover still names the individual record.
            'min-zoomed-font-size': 9,
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
            'min-zoomed-font-size': 0,
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
            'min-zoomed-font-size': 8,
          },
        },
        {
          selector: 'edge.is-selected',
          style: { label: 'data(label)', 'min-zoomed-font-size': 0 },
        },
        { selector: 'edge.show-relation-labels', style: { label: 'data(label)' } },
        {
          selector: '.is-hovered',
          style: {
            'border-color': '#fff',
            'border-width': 2.5,
            'underlay-opacity': records ? 0 : 0.2,
            'min-zoomed-font-size': 0,
          },
        },
      ] as cytoscape.StylesheetStyle[],
    });
    stage('create', createStart);
    core.current = cy;
    let disposed = false;
    let populated = false;
    let arrangeVersion = 0;
    let arranged = false;
    let cancelLayout: (() => void) | undefined;
    const arrange = async (force = false) => {
      const version = ++arrangeVersion;
      cancelLayout?.();
      const cached = !force ? cache.positions[presentation] : undefined;
      if (cached) {
        cy.nodes().positions((node) => cached[node.id()] ?? node.position());
        cy.resize();
        cy.fit(undefined, 30);
        if (cy.zoom() > 1.35) {
          cy.zoom(1.35);
          cy.center();
        }
        arranged = true;
        element.setAttribute('aria-busy', 'false');
        return;
      }
      let spatialAvailable = true;
      let spatialPositions: Record<string, cytoscape.Position> | undefined;
      if (layout === 'fcose' && graph.nodes.length > 2) {
        element.setAttribute('aria-busy', 'true');
        // Existing preset positions already provide the resting state. Do not
        // run a second synchronous layout before the worker can even start.
        try {
          const measureStart = performance.now();
          const task = spatialLayout({
            nodes: cy.nodes().map((node) => {
              const box = node.boundingBox({ includeLabels: true, includeOverlays: false });
              return {
                id: node.id(),
                width: Math.max(node.outerWidth(), box.w),
                height: Math.max(node.outerHeight(), box.h),
              };
            }),
            edges: graph.edges.map((edge) => ({
              id: `edge:${edge.id}`,
              source: `node:${edge.source}`,
              target: `node:${edge.target}`,
            })),
            records,
            dense,
          });
          cancelLayout = task.cancel;
          stage('measure-and-dispatch', measureStart);
          spatialPositions = await task.promise;
          if (!disposed) setLayoutNote('');
        } catch {
          if (disposed || version !== arrangeVersion) return;
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
        name === 'concentric'
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
                cols: graph.nodes.length <= 12 ? 3 : Math.ceil(Math.sqrt(graph.nodes.length * 1.5)),
              }
            : { ...common, spacingFactor: 1.3, circle: name === 'circle' };
      cy.resize();
      const applyStart = performance.now();
      if (spatialPositions) {
        // Orient/compact coordinates before touching the renderer. Moving,
        // fitting, rotating and fitting again invalidated the same edges twice.
        let x1 = Infinity,
          y1 = Infinity,
          x2 = -Infinity,
          y2 = -Infinity;
        cy.nodes().forEach((node) => {
          const point = spatialPositions[node.id()];
          x1 = Math.min(x1, point.x - node.outerWidth() / 2);
          x2 = Math.max(x2, point.x + node.outerWidth() / 2);
          y1 = Math.min(y1, point.y - node.outerHeight() / 2);
          y2 = Math.max(y2, point.y + node.outerHeight() / 2);
        });
        const rotate = y2 - y1 > x2 - x1 && element.clientWidth > element.clientHeight * 1.3;
        const scale = graph.nodes.length < 30 && !records ? 0.7 : 1;
        cy.nodes().positions((node) => {
          const point = spatialPositions[node.id()];
          return {
            x: (rotate ? point.y : point.x) * scale,
            y: (rotate ? point.x : point.y) * scale,
          };
        });
        cy.fit(undefined, records ? 40 : 30);
      } else cy.layout(options as cytoscape.LayoutOptions).run();
      if (cy.zoom() > 1.35) {
        cy.zoom(1.35);
        cy.center();
      }
      arranged = true;
      element.setAttribute('aria-busy', 'false');
      stage('apply-layout', applyStart);
    };
    relayout.current = () => {
      if (populated) void arrange(true);
    };
    const initialize = async () => {
      setPreparing(true);
      element.setAttribute('aria-busy', 'true');
      const initialClasses = networkClasses(
        graph,
        selectionRef.current.selection,
        selectionRef.current.edgeLabels,
      );
      const elements: cytoscape.ElementDefinition[] = networkElements(graph, rootId).map(
        (element) => ({ ...element, classes: initialClasses.get(element.data.id) }),
      );
      // Frame each small insertion at its final overview scale, avoiding an
      // initial full-size text rasterization for every record at zoom=1.
      const nodes = elements.filter((item) => item.position);
      if (nodes.length) {
        const xs = nodes.map((item) => item.position!.x),
          ys = nodes.map((item) => item.position!.y);
        const x1 = Math.min(...xs) - 100,
          x2 = Math.max(...xs) + 100;
        const y1 = Math.min(...ys) - 100,
          y2 = Math.max(...ys) + 100;
        const scale = Math.min(
          element.clientWidth / (x2 - x1),
          element.clientHeight / (y2 - y1),
          1.35,
        );
        cy.viewport({
          zoom: Math.max(0.08, scale),
          pan: {
            x: element.clientWidth / 2 - ((x1 + x2) / 2) * scale,
            y: element.clientHeight / 2 - ((y1 + y2) / 2) * scale,
          },
        });
      }
      if (layout === 'fcose') {
        // Position the nodes before introducing curves. Repositioning an
        // already-complete graph made the renderer recalculate every edge in
        // one frame, defeating otherwise progressive initialization.
        await populateGraph(
          cy,
          elements.filter((element) => !element.data.source),
          controller.signal,
        );
        await nextGraphFrame(controller.signal);
        await arrange();
        controller.signal.throwIfAborted();
        element.setAttribute('aria-busy', 'true');
        await populateGraph(
          cy,
          elements.filter((element) => element.data.source),
          controller.signal,
        );
      } else {
        await populateGraph(cy, elements, controller.signal);
        await nextGraphFrame(controller.signal);
        await arrange();
      }
      populated = true;
      highlightRef.current(cy);
      element.setAttribute('aria-busy', 'false');
      setPreparing(false);
    };
    void initialize().catch(() => {
      if (!disposed) {
        setPreparing(false);
        setLayoutNote('Graph preparation was interrupted. Rearrange or reopen this view.');
        element.setAttribute('aria-busy', 'false');
      }
    });
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
          if (!populated) return;
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
      controller.abort();
      cancelLayout?.();
      observer.disconnect();
      cancelAnimationFrame(resizeFrame);
      cancelAnimationFrame(zoomFrame);
      if (arranged) {
        const positions: Record<string, cytoscape.Position> = {};
        cy.nodes().forEach((node) => {
          positions[node.id()] = { ...node.position() };
        });
        cache.positions[presentation] = positions;
      }
      cy.destroy();
      core.current = null;
      relayout.current = () => {};
    };
  }, [graph, layout, appearance, rootId, presentation, dark]);
  useEffect(() => {
    const cy = core.current;
    if (!cy) return;
    highlightRef.current(cy);
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
      {preparing && (
        <p className="network-layout-note" role="status">
          Preparing graph view…
        </p>
      )}
    </div>
  );
}
