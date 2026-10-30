import { useState } from 'react';
import { Link } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ArrowUpRight, GitBranch, History, Network, ShieldCheck } from 'lucide-react';
import { fixtureMode } from '../../api/client';
import RepositoryConnection from '../RepositoryConnection';
import { Eyebrow, Logo } from '../ui';

export default function WorkspaceDoorway() {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <div className="workspace-doorway">
        <header>
          <Logo />
          <span>
            <i />
            THE PRODUCT STARTS HERE
          </span>
          <Link to="/app">
            Open workspace
            <ArrowUpRight size={15} />
          </Link>
        </header>
        <div className="doorway-body">
          <div className="doorway-orbit" aria-hidden="true">
            <span className="doorway-node node-a">
              <History size={23} />
              <b>THE REASON</b>
            </span>
            <span className="doorway-node node-b">
              <GitBranch size={27} />
              <b>YOUR REPOSITORY</b>
            </span>
            <span className="doorway-node node-c">
              <Network size={23} />
              <b>THE CONSEQUENCE</b>
            </span>
            <svg viewBox="0 0 420 330">
              <path d="M75 75 C75 180 210 105 210 170 S345 210 345 270" />
            </svg>
            <span className="doorway-orbit-caption">START WITH ONE CONNECTION.</span>
          </div>
          <section className="doorway-connect">
            <Eyebrow>YOUR REPOSITORY. YOUR NEXT MOVE.</Eyebrow>
            <h3>
              Your next question.
              <br />
              <em>Your own code.</em>
            </h3>
            <p>
              Bring the history into focus. Connect a repository to begin collecting its recorded
              decisions and code relationships.
            </p>
            <RepositoryConnection id="launch-repository-url" />
            <footer>
              <ShieldCheck size={15} />
              <span>
                {fixtureMode
                  ? 'Development fixture adapter. This import is simulated.'
                  : 'Your index, sources, and revision appear after import.'}
              </span>
            </footer>
          </section>
        </div>
      </div>
    </QueryClientProvider>
  );
}
