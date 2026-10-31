import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, Search, X } from 'lucide-react';
import { api } from '../api/client';
import { snapshotSearchKey } from '../api/search-key';
import { EntityIcon } from '../pages/investigations';
import { Badge, Empty, ErrorState, Eyebrow, Loading } from './ui';
export default function RepositoryCommand({
  repoId,
  snapshotId,
  open,
  onClose,
}: {
  repoId: string;
  snapshotId?: string;
  open: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const navigate = useNavigate();
  useEffect(() => {
    if (open) {
      dialog.current?.showModal();
      input.current?.focus();
    } else dialog.current?.close();
  }, [open]);
  useEffect(() => {
    const timer = window.setTimeout(() => setTerm(text.trim()), 220);
    return () => clearTimeout(timer);
  }, [text]);
  const query = useQuery({
    queryKey: snapshotSearchKey('command-search', repoId, snapshotId, term),
    queryFn: ({ signal }) => api.search(repoId, term, undefined, signal),
    enabled: open && !!term,
  });
  const currentTerm = text.trim() === term;
  const go = (entityId: string) => {
    onClose();
    navigate(
      `/app/repositories/${encodeURIComponent(repoId)}/history?focus=${encodeURIComponent(entityId)}`,
    );
  };
  return (
    <dialog
      ref={dialog}
      className="repository-command"
      aria-labelledby="command-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="command-heading">
        <div>
          <Eyebrow>FOLLOW A THREAD</Eyebrow>
          <h2 id="command-title">Find the connection.</h2>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close repository search">
          <X size={18} />
        </button>
      </div>
      <div className="command-input">
        <Search size={21} />
        <label className="sr-only" htmlFor="repository-command-search">
          Search indexed repository records
        </label>
        <input
          id="repository-command-search"
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              results.current?.querySelector<HTMLButtonElement>(':scope > button')?.focus();
            } else if (e.key === 'Enter' && currentTerm && query.data?.items[0]) {
              e.preventDefault();
              go(query.data.items[0].id);
            }
          }}
          placeholder="A file, a question, a turning point…"
          autoComplete="off"
        />
        <kbd>ESC</kbd>
      </div>
      <div ref={results} className="command-results" aria-live="polite">
        {!text.trim() ? (
          <div className="command-idle">
            <span>WHAT ARE YOU TRYING TO UNDERSTAND?</span>
            <p>
              Search files, issues, pull requests, commits, and documents in this repository’s
              indexed history.
            </p>
            <div>
              {['File', 'Issue', 'PullRequest', 'Commit', 'Document'].map((kind) => (
                <span key={kind}>
                  <EntityIcon kind={kind} size={15} />
                  {kind.replace('PullRequest', 'Pull request')}
                </span>
              ))}
            </div>
          </div>
        ) : !currentTerm || query.isPending ? (
          <Loading text="Finding indexed connections" />
        ) : query.isError ? (
          <ErrorState error={query.error} retry={() => query.refetch()} />
        ) : !query.data.items.length ? (
          <Empty title="No indexed record matched">
            Try a file name or a different phrase. Available history is limited by index coverage.
          </Empty>
        ) : (
          query.data.items.map((item) => (
            <button
              key={item.id}
              onClick={() => go(item.id)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
                e.preventDefault();
                const buttons = Array.from(
                  results.current?.querySelectorAll<HTMLButtonElement>(':scope > button') || [],
                );
                const index = buttons.indexOf(e.currentTarget) + (e.key === 'ArrowDown' ? 1 : -1);
                if (index < 0) input.current?.focus();
                else buttons[Math.min(index, buttons.length - 1)]?.focus();
              }}
            >
              <span className="command-result-icon">
                <EntityIcon kind={item.kind} />
              </span>
              <div>
                <strong>{item.title}</strong>
                {item.path && <code>{item.path}</code>}
              </div>
              <Badge>{item.kind}</Badge>
              <ArrowUpRight size={16} />
            </button>
          ))
        )}
      </div>
      <footer>
        <span>SEARCH THE INDEXED HISTORY. INSPECT THE ORIGINAL SOURCE.</span>
        <span>↵ Select a record</span>
      </footer>
    </dialog>
  );
}
