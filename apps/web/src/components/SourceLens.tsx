import { useState } from 'react';
import { ArrowUpRight, Quote, ShieldCheck } from 'lucide-react';
import type { Source } from '../api/schemas';
import { Badge, Eyebrow, SourceLink } from './ui';

export default function SourceLens({
  sources,
  selectedId,
  onSelect,
  id = 'source-lens',
}: {
  sources: Source[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  id?: string;
}) {
  const [local, setLocal] = useState('');
  const active = sources.find((source) => source.id === (selectedId || local)) || sources[0];
  if (!active)
    return (
      <div className="lens-empty">
        <ShieldCheck size={30} strokeWidth={1} />
        <h3>The source is the starting point.</h3>
        <p>
          No source records were returned for this selection. An unavailable source stays
          unavailable.
        </p>
      </div>
    );
  const index = sources.indexOf(active);
  return (
    <section className="source-lens" aria-label="Source inspection">
      <div className="lens-index" aria-label="Returned sources">
        {sources.map((source, i) => (
          <button
            key={source.id}
            aria-pressed={source.id === active.id}
            aria-controls={`${id}-detail`}
            onClick={() => {
              setLocal(source.id);
              onSelect?.(source.id);
            }}
          >
            <span>{String(i + 1).padStart(2, '0')}</span>
            <span>{source.kind.replaceAll('_', ' ')}</span>
            <ArrowUpRight size={13} />
          </button>
        ))}
      </div>
      <article id={`${id}-detail`} className="lens-document" key={active.id} aria-live="polite">
        <header>
          <Eyebrow>ORIGINAL RECORD / {String(index + 1).padStart(2, '0')}</Eyebrow>
          <Badge>{active.kind.replaceAll('_', ' ')}</Badge>
        </header>
        <Quote className="lens-quote-mark" size={38} strokeWidth={1} aria-hidden="true" />
        <blockquote>
          {active.excerpt ||
            'No excerpt was supplied. Inspect the original record when its source link is available.'}
        </blockquote>
        <div className="lens-location">
          <span>SOURCE LOCATION</span>
          <strong>{active.locator}</strong>
          {active.observedAt && <time>{active.observedAt}</time>}
        </div>
        <footer>
          <SourceLink url={active.url}>Inspect original source</SourceLink>
          <ShieldCheck size={17} />
        </footer>
      </article>
    </section>
  );
}
