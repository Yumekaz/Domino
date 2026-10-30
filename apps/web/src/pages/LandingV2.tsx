import { lazy, Suspense, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Check, HelpCircle, Network, ShieldCheck } from 'lucide-react';
import { useInView } from 'motion/react';
import { MotionToggle } from '../components/MotionPolicy';
import HeroExperience from '../components/launch/HeroExperience';
import { chapters } from '../components/launch/chapters';
import { Badge, Button, Eyebrow, Logo } from '../components/ui';
import '../launch.css';
import '../desktop-northstar.css';
import '../launch-studio.css';
import ConsequenceStory from '../components/launch/ConsequenceStory';
const WorkspaceDoorway = lazy(() => import('../components/launch/WorkspaceDoorway'));
export default function LandingV2() {
  const doorway = useRef<HTMLDivElement>(null);
  const doorwayVisible = useInView(doorway, { once: true, margin: '300px' });
  const [connected, setConnected] = useState(false);
  const [evidence, setEvidence] = useState(1);

  return (
    <div className="launch-v2 desktop-northstar">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="launch-masthead">
        <Logo />
        <MotionToggle />
        <nav aria-label="Main navigation">
          <a href="#memory">The missing context</a>
          <a href="#mechanism">The domino effect</a>
          <a href="#trust">Our principles</a>
        </nav>
        <Link className="launch-enter" to="/app">
          Enter workspace <ArrowUpRight size={17} />
        </Link>
      </header>
      <main id="main">
        <HeroExperience />
        <section className="memory-chapter launch-width" id="memory">
          <div className="chapter-cap">
            <Eyebrow>01 / REWIND THE REASONING</Eyebrow>
            <span>FROM SCATTERED HISTORY TO A SHARED MEMORY</span>
          </div>
          <div className="memory-layout">
            <div className="memory-copy">
              <h2>
                The code stayed.
                <br />
                The context
                <br />
                <span>walked away.</span>
              </h2>
              <p>
                The diff tells you what changed.
                <br />
                The real story is somewhere between an issue, a review, and a decision nobody
                remembers making.
              </p>
              <Button variant="secondary" onClick={() => setConnected(!connected)}>
                {connected ? 'Scatter the history' : 'Connect the history'}
                <ArrowUpRight size={16} />
              </Button>
            </div>
            <div className={`memory-assembly ${connected ? 'assembled' : ''}`}>
              <div className="assembly-guide" />
              <span className="assembly-label">INTERACTIVE CONCEPT / NO REAL PROJECT EVIDENCE</span>
              {chapters.slice(0, 4).map((c, i) => (
                <button
                  className={`memory-paper paper-${i}`}
                  aria-pressed={evidence === i}
                  onClick={() => {
                    setEvidence(i);
                    setConnected(true);
                  }}
                  key={c.label}
                >
                  <span className="paper-kicker">
                    <c.icon size={15} />
                    {c.label}
                    <b>0{i + 1}</b>
                  </span>
                  <span className="paper-title">
                    {[
                      'A question|worth keeping.',
                      'The reason|in the review.',
                      'A recorded|turning point.',
                      'The code|it touched.',
                    ][i]
                      .split('|')
                      .map((line, j) => (
                        <span key={j}>{line}</span>
                      ))}
                  </span>
                  <span className="paper-lines">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="paper-bottom">
                    FOLLOW THE SOURCE <ArrowUpRight size={13} />
                  </span>
                </button>
              ))}
              <span className="assembly-foot">A CONNECTION IS ONLY AS GOOD AS ITS SOURCE.</span>
            </div>
          </div>
          <div className="evidence-annotation">
            <span className="annotation-symbol">
              <ShieldCheck size={19} />
            </span>
            <div>
              <Eyebrow>{chapters[evidence].label.toUpperCase()} / SOURCE INSPECTION</Eyebrow>
              <p>{chapters[evidence].copy}</p>
            </div>
            <span className="annotation-end">
              DOCUMENTED
              <br />≠ ASSUMED
            </span>
          </div>
        </section>
        <section className="consequence-chapter">
          <div className="launch-width">
            <div className="chapter-cap">
              <Eyebrow>02 / BEFORE THE NEXT DOMINO</Eyebrow>
              <span>EVERY POSSIBLE IMPACT HAS A PATH</span>
            </div>
            <div className="consequence-heading">
              <h2>
                Small change.
                <br />
                <span>Full perspective.</span>
              </h2>
              <p>
                Follow the structural paths behind a change.
                <br />
                Keep historical associations in view.
                <br />
                Know which questions the evidence leaves open.
              </p>
            </div>
            <ConsequenceStory />
            <div className="consequence-caption">
              <Badge tone="dark">ILLUSTRATIVE DEPENDENCY MODEL</Badge>
              <span>
                Possible impact describes where to investigate. It is not a prediction of a
                confirmed bug.
              </span>
              <Link to="/app">
                Trace your own change <ArrowUpRight size={17} />
              </Link>
            </div>
          </div>
        </section>
        <section className="workspace-chapter launch-width">
          <div className="chapter-cap">
            <Eyebrow>03 / OPEN THE INVESTIGATION</Eyebrow>
            <span>CONTEXT IS SOMETHING YOU CAN EXPLORE</span>
          </div>
          <div className="doorway-heading">
            <h2>
              From the bigger picture.
              <br />
              <em>Into your code.</em>
            </h2>
            <p>Start with a public repository. Follow its recorded history into the code.</p>
          </div>
          <div ref={doorway} className="doorway-mount">
            {doorwayVisible && (
              <Suspense fallback={<div className="doorway-loading">Opening the connection…</div>}>
                <WorkspaceDoorway />
              </Suspense>
            )}
          </div>
        </section>
        <section className="trust-chapter launch-width" id="trust">
          <div className="chapter-cap">
            <Eyebrow>04 / TRUST IS IN THE DETAILS</Eyebrow>
            <span>AN HONEST ANSWER INCLUDES ITS LIMITS</span>
          </div>
          <h2>
            Evidence over eloquence<span className="blue">.</span>
          </h2>
          <div className="trust-columns">
            <article>
              <span className="trust-icon">
                <Check size={23} />
              </span>
              <h3>Observe.</h3>
              <p>Inspect recorded relationships and static imports at a named revision.</p>
              <Badge tone="blue">OBSERVED</Badge>
            </article>
            <article>
              <span className="trust-icon derived">
                <Network size={23} />
              </span>
              <h3>Trace.</h3>
              <p>
                Follow dependency paths and historical associations, with their reasons attached.
              </p>
              <Badge>DERIVED</Badge>
            </article>
            <article>
              <span className="trust-icon inferred">
                <HelpCircle size={23} />
              </span>
              <h3>Question.</h3>
              <p>
                Keep interpretations labelled. When the history does not support an answer, say so.
              </p>
              <Badge tone="orange">INFERRED / NOT FOUND</Badge>
            </article>
          </div>
        </section>
        <footer className="final-chapter">
          <div className="launch-width">
            <Eyebrow>YOUR NEXT MOVE STARTS WITH THE BIGGER PICTURE.</Eyebrow>
            <div className="final-call">
              <h2>
                Make the
                <br />
                connection<span>↗</span>
              </h2>
              <Link className="button" to="/app">
                Enter Domino <ArrowUpRight size={19} />
              </Link>
            </div>
            <div className="final-meta">
              <Logo />
              <span>ENGINEERING MEMORY. CONNECTED.</span>
              <span>INNOVISTA / PS06 · 2026</span>
              <a href="#main">
                Back to the first domino <ArrowUpRight size={14} />
              </a>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
