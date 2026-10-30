import { useMemo, useSyncExternalStore } from 'react';
import { FileCode2, ArrowRight } from 'lucide-react';
import type { Impact } from '../api/schemas';
import { returnedImpactPaths } from './impact-layout';
import { Badge, Eyebrow } from './ui';
const subscribeToWidth = (callback: () => void) => {
  const media = window.matchMedia('(max-width: 640px)');
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
};
const isCompact = () => window.matchMedia('(max-width: 640px)').matches;
export default function ImpactAtlas({
  result,
  selected,
  onSelect,
}: {
  result: Impact;
  selected: string | null;
  onSelect: (file: string) => void;
}) {
  const layout = useMemo(() => returnedImpactPaths(result), [result]);
  const compact = useSyncExternalStore(subscribeToWidth, isCompact, () => false);
  const active = result.affected.find((a) => a.file === selected);
  const chosen = new Set(active?.signal === 'static_reverse_dependency' ? active.path : []);
  const depth = Math.max(1, ...layout.nodes.map((n) => n.level));
  const levelStarts: number[] = [];
  let verticalHeight = 35;
  for (let i = 0; i <= depth; i++) {
    levelStarts.push(verticalHeight);
    verticalHeight +=
      Math.max(1, Math.ceil(layout.nodes.filter((n) => n.level === i).length / 2)) * 110 + 35;
  }
  const height = compact
    ? verticalHeight
    : Math.max(
        270,
        ...Array.from(
          { length: depth + 1 },
          (_, i) => layout.nodes.filter((n) => n.level === i).length * 88,
        ),
      );
  const positions = new Map(
    layout.nodes.map((n) => {
      const peers = layout.nodes.filter((p) => p.level === n.level);
      const peerIndex = peers.findIndex((p) => p.file === n.file);
      return [
        n.file,
        {
          x: compact
            ? peers.length === 1
              ? 500
              : peerIndex % 2 === 0
                ? 250
                : 750
            : 100 + (n.level * 800) / depth,
          y: compact
            ? levelStarts[n.level] + 55 + Math.floor(peerIndex / 2) * 110
            : ((peerIndex + 1) * height) / (peers.length + 1),
        },
      ];
    }),
  );
  const associations = result.affected.filter((a) => a.signal === 'historically_coupled');
  if (!layout.edges.length) return null;
  return (
    <section className="impact-atlas">
      <header>
        <div>
          <Eyebrow>THE CASCADE / RETURNED STRUCTURAL PATHS</Eyebrow>
          <h2>A change is the beginning.</h2>
        </div>
        <Badge tone="blue">POSSIBLE IMPACT</Badge>
      </header>
      <div className="impact-atlas-scroller">
        <div className={`impact-atlas-stage ${compact ? 'vertical-map' : ''}`} style={{ height }}>
          {!compact && (
            <div className="impact-atlas-columns">
              {Array.from({ length: depth + 1 }, (_, i) => (
                <span key={i}>
                  {i === 0
                    ? 'THE CHANGE'
                    : i === 1
                      ? 'DIRECT DEPENDENTS'
                      : `${i} HOPS FROM THE CHANGE`}
                </span>
              ))}
            </div>
          )}
          <svg viewBox={`0 0 1000 ${height}`} preserveAspectRatio="none" aria-hidden="true">
            {layout.edges.map((e) => {
              const a = positions.get(e.source)!;
              const b = positions.get(e.target)!;
              const focused = chosen.has(e.source) && chosen.has(e.target);
              return (
                <path
                  pathLength="1"
                  className={focused ? 'focused' : ''}
                  key={JSON.stringify([e.source, e.target])}
                  d={`M${a.x} ${a.y} C${(a.x + b.x) / 2} ${a.y},${(a.x + b.x) / 2} ${b.y},${b.x} ${b.y}`}
                />
              );
            })}
          </svg>
          {layout.nodes.map((n) => {
            const point = positions.get(n.file)!;
            return (
              <button
                className={`impact-map-record ${n.changed ? 'changed' : ''} ${chosen.has(n.file) ? 'on-path' : ''} ${selected === n.file ? 'selected' : ''}`}
                style={{ left: `${point.x / 10}%`, top: point.y }}
                key={n.file}
                onClick={() => onSelect(n.file)}
                aria-label={`Inspect path record ${n.file}`}
              >
                <span>
                  <FileCode2 size={15} />
                  {n.changed ? 'CHANGED FILE' : `${n.level} HOP${n.level === 1 ? '' : 'S'} AWAY`}
                </span>
                <strong>{n.file.split('/').pop()}</strong>
                <small title={n.file}>{n.file}</small>
              </button>
            );
          })}
        </div>
      </div>
      <footer>
        <span>
          <i />
          Impact direction: change → potential dependents
        </span>
        <span>Inspect the original import direction in the proof below.</span>
        {layout.limited && <Badge tone="orange">BOUNDED DISPLAY · FULL RESULTS BELOW</Badge>}
      </footer>
      {!!associations.length && (
        <div className="cochange-rail">
          <Eyebrow>HISTORICAL CO-CHANGE / SEPARATE SIGNAL</Eyebrow>
          {associations.map((a) => (
            <button key={a.file} onClick={() => onSelect(a.file)}>
              <span>↔</span>
              <code>{a.file}</code>
              <ArrowRight size={13} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
