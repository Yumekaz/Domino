import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import GraphCanvas, { type GraphSelection } from '../pages/graph/GraphCanvas';
import DominoScene from '../components/launch/DominoScene';
import { MotionPolicy, MotionToggle } from '../components/MotionPolicy';
import type { Graph } from '../api/schemas';
import '../fonts.css';
import '../styles.css';
import '../launch.css';
import { fixtureAuthId, fixtureRepositoryId } from './fixtureIds';
import '../desktop-northstar.css';
import './renderer-harness.css';

function RendererHarness() {
  const [count, setCount] = useState(300);
  const [mode, setMode] = useState('graph');
  const [selection, setSelection] = useState<GraphSelection>(null);
  const [progress, setProgress] = useState(0);
  const sceneProgress = useRef(0);
  const [ready, setReady] = useState(false);
  const sceneReady = useCallback(() => setReady(true), []);
  const [report, setReport] = useState('No sample collected.');
  const [running, setRunning] = useState(false);
  const cancel = useRef(() => {});
  useEffect(() => () => cancel.current(), []);
  const graph = useMemo<Graph>(
    () => ({
      nodes: Array.from({ length: count }, (_, index) => ({
        id: `harness-${index}`,
        kind: 'File',
        title: `Renderer test ${index}`,
        path: `harness/record-${index}.ts`,
      })),
      edges: Array.from({ length: count - 1 }, (_, index) => ({
        id: `harness-edge-${index}`,
        source: `harness-${Math.floor(index / 2)}`,
        target: `harness-${index + 1}`,
        kind: 'IMPORTS' as const,
        verification: 'observed' as const,
        snapshotSha: '0'.repeat(40),
      })),
      truncated: false,
      warnings: ['RENDERER HARNESS: generated topology, not repository evidence.'],
      snapshotSha: '0'.repeat(40),
    }),
    [count],
  );
  const measure = () => {
    cancel.current();
    if (mode === 'scene') sceneProgress.current = 0;
    setRunning(true);
    setReport('Sampling for five seconds…');
    let frame = 0,
      start = 0,
      last = 0,
      action = 0,
      hidden = false;
    const deltas: number[] = [];
    const tasks: number[] = [];
    let observer: PerformanceObserver | undefined;
    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      observer = new PerformanceObserver((list) =>
        list.getEntries().forEach((entry) => tasks.push(entry.duration)),
      );
      observer.observe({ type: 'longtask' });
    }
    const tick = (now: number) => {
      if (!start) {
        start = now;
        last = now;
      } else {
        deltas.push(now - last);
        last = now;
      }
      hidden ||= document.hidden;
      if (mode === 'scene') sceneProgress.current = Math.min(100, (now - start) / 45);
      else if (mode === 'counter') setProgress(Math.min(100, (now - start) / 45));
      else if (mode === 'graph' && now - action > 450) {
        action = now;
        setSelection({
          kind: 'node',
          id: `harness-${(Math.floor((now - start) / 450) * 13) % count}`,
        });
      }
      if (now - start < 5000) {
        frame = requestAnimationFrame(tick);
        return;
      }
      observer?.disconnect();
      const sorted = [...deltas].sort((a, b) => a - b);
      const percentile = (p: number) =>
        Number(
          (sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] || 0).toFixed(2),
        );
      setRunning(false);
      setReport(
        JSON.stringify(
          {
            fixture: 'RENDERER HARNESS - NOT REPOSITORY EVIDENCE',
            mode,
            nodes: mode.startsWith('graph') ? count : undefined,
            durationMs: Math.round(now - start),
            samples: deltas.length,
            rafMedianMs: percentile(0.5),
            rafP95Ms: percentile(0.95),
            rafMaxMs: percentile(1),
            framesOver33ms: deltas.filter((delta) => delta > 33.34).length,
            longTasksSupported: !!observer,
            longTasks: tasks.length,
            longTaskTotalMs: Math.round(tasks.reduce((sum, item) => sum + item, 0)),
            interruptedByHiddenTab: hidden,
            note: 'Browser rAF cadence under a local development workload. Not GPU completion timing, production FPS, or a repository-scale benchmark.',
          },
          null,
          2,
        ),
      );
    };
    frame = requestAnimationFrame(tick);
    cancel.current = () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  };
  return (
    <MotionPolicy>
      <main className="renderer-harness">
        <header>
          <div>
            <a
              className="harness-product-link"
              href={`/app/repositories/${fixtureRepositoryId}/graph?focus=${fixtureAuthId}`}
            >
              Open the actual Domino workspace ↗
            </a>
            <strong>DEVELOPMENT RENDERER HARNESS</strong>
            <p>
              Generated renderer stress data. No repository evidence, analysis, sources, or product
              metrics.
            </p>
          </div>
          <MotionToggle />
        </header>
        <nav>
          <label>
            Renderer
            <select
              disabled={running}
              value={mode}
              onChange={(event) => {
                setReady(false);
                setMode(event.target.value);
              }}
            >
              <option value="graph">Graph / repeated React selection</option>
              <option value="graph-static">Graph / manual viewport</option>
              <option value="scene">Three.js scene</option>
              <option value="idle">Empty baseline</option>
              <option value="counter">React update baseline</option>
            </select>
          </label>
          {mode.startsWith('graph') && (
            <label>
              Records
              <select
                disabled={running}
                value={count}
                onChange={(event) => {
                  setCount(Number(event.target.value));
                  setSelection(null);
                }}
              >
                {[100, 300, 600].map((size) => (
                  <option key={size}>{size}</option>
                ))}
              </select>
            </label>
          )}
          <button onClick={measure} disabled={running || (mode === 'scene' && !ready)}>
            {running ? 'Sampling…' : 'Measure five seconds'}
          </button>
        </nav>
        {mode.startsWith('graph') ? (
          <GraphCanvas
            graph={graph}
            layout="grid"
            initialPresentation="records"
            testLabel={`${count} generated records. This is a load test, not the product graph.`}
            selection={selection}
            onSelect={setSelection}
            appearance="dark"
          />
        ) : mode === 'scene' ? (
          <div className="desktop-northstar harness-scene">
            <DominoScene
              cinematic
              progress={0}
              progressSource={sceneProgress}
              onPush={() => {
                sceneProgress.current = 0;
              }}
              onReady={sceneReady}
            />
          </div>
        ) : (
          <div className="harness-baseline" style={{ height: 470 }}>
            {mode === 'counter' ? (
              <output>React counter: {progress.toFixed(2)}</output>
            ) : (
              'Empty baseline: no graph or 3D renderer mounted.'
            )}
          </div>
        )}
        <pre aria-live="polite" id="performance-report">
          {report}
        </pre>
      </main>
    </MotionPolicy>
  );
}
if (import.meta.env.DEV && import.meta.env.MODE === 'fixtures')
  createRoot(document.getElementById('root')!).render(<RendererHarness />);
else
  document.getElementById('root')!.textContent =
    'This development-only harness requires the fixtures Vite mode.';
