import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, FileCode2, Users } from 'lucide-react';
import type { Source } from '../api/schemas';
import SourceLens from './SourceLens';
import { Badge, Empty, Eyebrow } from './ui';
type ObservedFile = {
  path: string;
  entityId: string;
  observedAuthors: number;
  commitCount: number;
  commitCountIsLowerBound: boolean;
  lastEdit: string | null;
  contributors: { name: string; commits: number }[];
  sources: Source[];
  caveats: string[];
};

export default function KnowledgeLedger({
  files,
  historyPath,
}: {
  files: ObservedFile[];
  historyPath: string;
}) {
  const [selected, setSelected] = useState('');
  const file = files.find((item) => item.path === selected) || files[0];
  if (!file)
    return (
      <Empty title="No matching files in the returned results">
        Coverage is bounded; this is not a guarantee of distributed knowledge.
      </Empty>
    );
  const total = file.contributors.reduce((sum, contributor) => sum + contributor.commits, 0);
  const valid = total > 0 && file.contributors.every((contributor) => contributor.commits >= 0);
  return (
    <section className="knowledge-ledger" aria-label="Observed contributor concentration">
      <aside className="ledger-files" aria-label="Returned file records" tabIndex={0}>
        <header>
          <Eyebrow>RETURNED FILES</Eyebrow>
          <span>{files.length}</span>
        </header>
        {files.map((item) => (
          <button
            key={item.path}
            aria-pressed={item.path === file.path}
            onClick={() => setSelected(item.path)}
          >
            <FileCode2 size={17} />
            <span>
              <strong>{item.path.split('/').pop()}</strong>
              <code>{item.path}</code>
            </span>
            <b className={item.observedAuthors === 1 ? 'single-author' : ''}>
              {item.observedAuthors}
              <Users size={11} />
            </b>
          </button>
        ))}
        <p>
          Counts describe observed history.
          <br />
          They do not measure who knows the code.
        </p>
      </aside>
      <div
        className="ledger-reading"
        key={file.path}
        role="region"
        aria-label="Selected file contribution evidence"
        tabIndex={0}
      >
        <header>
          <div>
            <Eyebrow>THE HUMAN SIDE OF THE HISTORY</Eyebrow>
            <h2>{file.path}</h2>
          </div>
          <Badge tone={file.observedAuthors === 1 ? 'orange' : 'blue'}>
            {file.observedAuthors === 1 ? 'CONCENTRATED HISTORY' : 'MULTIPLE OBSERVED CONTRIBUTORS'}
          </Badge>
        </header>
        <div className="ledger-measure">
          <div>
            <strong>{String(file.observedAuthors).padStart(2, '0')}</strong>
            <span>
              OBSERVED
              <br />
              CONTRIBUTOR{file.observedAuthors === 1 ? '' : 'S'}
            </span>
          </div>
          <p>
            History records{' '}
            <b>
              {file.commitCount} commit{file.commitCount === 1 ? '' : 's'}
            </b>{' '}
            for this file.
            <br />
            Last recorded edit <time>{file.lastEdit ?? 'not supplied'}</time>.
          </p>
          <Link to={`${historyPath}?focus=${encodeURIComponent(file.entityId)}`}>
            Follow the history
            <ArrowUpRight size={16} />
          </Link>
        </div>
        <div className="contribution-spectrum" aria-label="Shares of returned contributor counts">
          {valid ? (
            file.contributors.map((contributor, index) => (
              <span
                key={`${contributor.name}-${index}`}
                style={
                  {
                    flexGrow: contributor.commits,
                    '--contribution-index': index % 5,
                  } as CSSProperties
                }
                title={`${contributor.name}: ${contributor.commits} reported commits`}
              />
            ))
          ) : (
            <p>Contribution proportions are unavailable.</p>
          )}
        </div>
        <div className="ledger-contributors">
          {file.contributors.map((contributor, index) => (
            <div key={`${contributor.name}-${index}`}>
              <span
                className="ledger-person"
                style={{ '--contribution-index': index % 5 } as CSSProperties}
              >
                {contributor.name.slice(0, 1).toUpperCase()}
              </span>
              <strong>{contributor.name}</strong>
              <span>
                {contributor.commits} reported commit{contributor.commits === 1 ? '' : 's'}
              </span>
              {valid && (
                <b>
                  {Math.round((contributor.commits / total) * 100)}
                  <small>%</small>
                </b>
              )}
            </div>
          ))}
        </div>
        <p className="spectrum-caption">
          Shares use the returned contributor entries, within the reported history window.
          {file.commitCountIsLowerBound &&
            ' The reported commit count is a lower bound because contributor samples were capped.'}
          {total !== file.commitCount &&
            ` Those entries total ${total}; the file reports ${file.commitCount} commits.`}
        </p>
        {file.caveats.length > 0 && (
          <div className="ledger-caveats">
            {file.caveats.map((caveat) => (
              <p key={caveat}>{caveat}</p>
            ))}
          </div>
        )}
        <div className="ledger-provenance">
          <Eyebrow>FOLLOW THE OBSERVATION TO ITS SOURCE</Eyebrow>
          <SourceLens sources={file.sources} id="contribution-source" />
        </div>
      </div>
    </section>
  );
}
