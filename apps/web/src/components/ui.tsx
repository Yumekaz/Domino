import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AlertTriangle, ArrowUpRight, LoaderCircle, RotateCcw, SearchX } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ApiError } from '../api/errors';
import { safeSourceUrl } from '../api/links';
import type { Source } from '../api/schemas';

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="brand" aria-label="Domino home">
      <img src="/assets/domino-mark.png" alt="" width="40" height="40" />
      {!compact && (
        <span>
          domino<span className="brand-period">.</span>
        </span>
      )}
    </Link>
  );
}
export function Button({
  children,
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  return (
    <button className={`button button-${variant} ${className}`} {...props}>
      {children}
    </button>
  );
}
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="eyebrow">{children}</div>;
}
export function PageTitle({
  number,
  title,
  description,
  action,
}: {
  number: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-title">
      <div>
        <Eyebrow>INVESTIGATION / {number}</Eyebrow>
        <h1 tabIndex={-1}>
          {title}
          <span className="blue">.</span>
        </h1>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}
export function Loading({ text = 'Retrieving repository evidence' }: { text?: string }) {
  return (
    <div className="state-box" role="status">
      <LoaderCircle className="spin" size={25} />
      <p>{text}…</p>
    </div>
  );
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state-box">
      <SearchX size={30} strokeWidth={1.3} />
      <h3>{title}</h3>
      <div>{children}</div>
    </div>
  );
}
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const message = error instanceof Error ? error.message : 'The request could not be completed.';
  return (
    <div className="error-state" role="alert">
      <AlertTriangle size={23} />
      <div>
        <Badge tone="orange">{error instanceof ApiError ? error.code : 'REQUEST_FAILED'}</Badge>
        <h3>There’s a gap in the connection.</h3>
        <p>{message}</p>
        {retry && (
          <Button variant="secondary" onClick={retry}>
            <RotateCcw size={15} /> Try again
          </Button>
        )}
      </div>
    </div>
  );
}
export function Warnings({ warnings }: { warnings?: string[] }) {
  if (!warnings?.length) return null;
  return (
    <div className="warnings">
      <AlertTriangle size={16} />
      <div>
        {warnings.map((w, i) => (
          <p key={i}>{w}</p>
        ))}
      </div>
    </div>
  );
}
export function SourceLink({ url, children }: { url?: string; children: ReactNode }) {
  const safe = safeSourceUrl(url);
  return safe ? (
    <a className="source-link" href={safe} target="_blank" rel="noopener noreferrer">
      {children}
      <ArrowUpRight size={14} />
    </a>
  ) : (
    <span className="muted">{children} · source link unavailable</span>
  );
}
export function SourceList({ sources, idPrefix }: { sources: Source[]; idPrefix?: string }) {
  const uniqueId = useId();
  return (
    <div className="source-list">
      {sources.map((s, i) => (
        <article className="source-item" key={s.id} id={`${idPrefix || uniqueId}-${i + 1}`}>
          <span className="source-index">{String(i + 1).padStart(2, '0')}</span>
          <div>
            <Badge>{s.kind.replaceAll('_', ' ')}</Badge>
            <h4>
              <SourceLink url={s.url}>{s.locator}</SourceLink>
            </h4>
            {s.observedAt && <time>{s.observedAt}</time>}
            {s.excerpt && <blockquote>{s.excerpt}</blockquote>}
          </div>
        </article>
      ))}
    </div>
  );
}
export function Sha({ value }: { value?: string }) {
  return <code title={value}>{value ? value.slice(0, 8) : 'not indexed'}</code>;
}
export function SectionLabel({ children }: { children: ReactNode }) {
  return <h2 className="section-label">{children}</h2>;
}
