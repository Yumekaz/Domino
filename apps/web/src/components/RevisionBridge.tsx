import { ArrowRight, GitCommitHorizontal, GitPullRequest } from 'lucide-react';
import type { Analysis } from '../api/schemas';
import { Badge, Eyebrow, Sha, SourceLink } from './ui';
export default function RevisionBridge({ run }: { run: Analysis }) {
  const stale = run.stale || (!!run.result && run.result.snapshotSha !== run.headSha);
  return (
    <section
      className={`revision-bridge ${stale ? 'is-stale' : ''}`}
      aria-label="PR analysis revisions"
    >
      <header>
        <div>
          <Eyebrow>ANALYSIS RUN / {run.id}</Eyebrow>
          <h2>
            Pull request <em>#{run.prNumber}</em>
          </h2>
        </div>
        <Badge tone={run.status === 'completed' ? 'blue' : 'orange'}>{run.status}</Badge>
      </header>
      <div className="revision-track">
        <div className="revision-end">
          <span>01 / BASE REVISION</span>
          <GitCommitHorizontal size={26} strokeWidth={1} />
          <Sha value={run.baseSha} />
          <small title={run.baseSha}>The comparison starts here.</small>
        </div>
        <div className="revision-event">
          <div>
            <i />
            <ArrowRight size={18} />
            <i />
          </div>
          <span>
            <GitPullRequest size={15} />
            {run.event}
          </span>
          <time>{run.createdAt}</time>
        </div>
        <div className="revision-end head">
          <span>02 / PR HEAD</span>
          <GitCommitHorizontal size={26} strokeWidth={1} />
          <Sha value={run.headSha} />
          <small title={run.headSha}>The proposed revision.</small>
        </div>
      </div>
      <div className="revision-freshness">
        <span className="revision-status-light" />
        <div>
          <strong>
            {stale ? 'The input revisions need attention.' : 'Keep the input revision in view.'}
          </strong>
          <p>
            {stale
              ? 'This result is stale relative to the PR head. Inspect its indexed revision before using the analysis.'
              : 'Run status and result freshness are separate. Inspect the result revision and reported limitations.'}
          </p>
        </div>
        {run.result && (
          <span>
            RESULT SNAPSHOT <Sha value={run.result.snapshotSha} />
          </span>
        )}
      </div>
      <footer>
        <SourceLink url={run.prUrl}>Open pull request</SourceLink>
        <SourceLink url={run.actionsUrl}>Open actual Actions summary</SourceLink>
      </footer>
    </section>
  );
}
