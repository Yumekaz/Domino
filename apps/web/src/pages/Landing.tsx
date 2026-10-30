import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  Code2,
  GitCommitHorizontal,
  GitPullRequest,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { Badge, Button, Eyebrow, Logo } from '../components/ui';

const history = [
  {
    type: 'Issue',
    icon: '01',
    title: 'The question',
    detail:
      'An issue captures a problem. Its discussion preserves the context that a diff alone cannot.',
  },
  {
    type: 'Pull request',
    icon: '02',
    title: 'The decision',
    detail:
      'A linked pull request records a proposed solution, review discussion, and documented tradeoffs.',
  },
  {
    type: 'Commit',
    icon: '03',
    title: 'The change',
    detail:
      'The commit anchors that decision to a specific revision. No invented connections in between.',
  },
  {
    type: 'File',
    icon: '04',
    title: 'The consequence',
    detail:
      'The changed file joins history to its static dependency neighborhood. Follow the evidence forward.',
  },
];
export default function Landing() {
  const reduce = useReducedMotion();
  const navigate = useNavigate();
  const [active, setActive] = useState(1);
  const [progress, setProgressState] = useState(0);
  const progressRef = useRef(0);
  const setProgress = useCallback((value: number) => {
    progressRef.current = value;
    setProgressState(value);
  }, []);
  const [playing, setPlaying] = useState(false);
  const [launching, setLaunching] = useState(false);
  const cascade = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let previous = 0;
    const tick = (time: number) => {
      if (!previous) previous = time;
      const delta = Math.min(time - previous, 40);
      previous = time;
      if (document.hidden) {
        frame = requestAnimationFrame(tick);
        return;
      }
      const next = reduce ? 100 : Math.min(100, progressRef.current + delta / 38);
      setProgress(next);
      if (next >= 100) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, reduce, setProgress]);
  useEffect(() => {
    if (!launching) return;
    const t = window.setTimeout(() => navigate('/app'), reduce ? 0 : 640);
    return () => clearTimeout(t);
  }, [launching, navigate, reduce]);
  const watch = () => {
    cascade.current?.scrollIntoView({ behavior: reduce ? 'instant' : 'smooth', block: 'center' });
    setProgress(0);
    setPlaying(true);
  };
  return (
    <div className="landing">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="launch-nav">
        <Logo />
        <nav aria-label="Main navigation">
          <a href="#story">The idea</a>
          <a href="#cascade">The domino effect</a>
          <a href="#principles">Built on evidence</a>
        </nav>
        <Link className="nav-cta" to="/app">
          Open workspace <ArrowUpRight size={17} />
        </Link>
      </header>
      <main id="main">
        <section className="hero">
          <motion.div
            className="hero-copy"
            initial={{ opacity: 0, transform: reduce ? 'none' : 'translateY(18px)' }}
            animate={{ opacity: 1, transform: 'translateY(0)' }}
            transition={{ duration: 0.7, ease: [0.23, 1, 0.32, 1] }}
          >
            <Eyebrow>
              <span className="live-dot" /> ENGINEERING MEMORY. CONNECTED.
            </Eyebrow>
            <h1 tabIndex={-1}>
              Know why.
              <br />
              See what’s{' '}
              <span className="next-word">
                next<span className="blue">.</span>
                <svg viewBox="0 0 280 18" aria-hidden="true">
                  <path d="M3 12 Q125 -2 277 6" />
                </svg>
              </span>
            </h1>
            <p>
              Your code has a past. Your next change has a ripple effect. Connect the decisions
              behind you to the possibilities ahead.
            </p>
            <div className="hero-actions">
              <Link className="button button-primary" to="/app">
                Explore Domino <ArrowUpRight size={18} />
              </Link>
              <button className="watch-button" onClick={watch}>
                <span>
                  <Play size={13} fill="currentColor" />
                </span>
                Watch the chain reaction
              </button>
            </div>
            <div className="hero-footnote">
              <span>PUBLIC GITHUB REPOSITORIES</span>
              <span>JS / TS / JSX / TSX</span>
            </div>
          </motion.div>
          <motion.div
            className="hero-art"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1.1, delay: 0.12 }}
          >
            <img
              src="/assets/domino-hero.webp"
              alt="Sculptural cobalt, orange and yellow dominoes leaning into a chain reaction"
              width="1672"
              height="941"
              fetchPriority="high"
            />
            <span className="art-index">FIG. 01 — NOTHING CHANGES IN ISOLATION</span>
            <div className="art-callout">
              <span className="callout-cross">+</span>
              <span>
                A small change.
                <br />
                <b>A bigger picture.</b>
              </span>
            </div>
          </motion.div>
          <div className="hero-bottom">
            <span>
              <span className="small-square" /> FROM CONTEXT TO CONSEQUENCE
            </span>
            <a href="#story">
              FOLLOW THE CONNECTIONS <ArrowDown size={15} />
            </a>
            <span>INNOVISTA / PS06</span>
          </div>
        </section>

        <section className="story-section page-width" id="story">
          <div className="chapter-line">
            <Eyebrow>01 / RECONNECT THE PAST</Eyebrow>
            <span>THE REASON IS IN THE RELATIONSHIPS</span>
          </div>
          <div className="story-heading">
            <h2>
              A codebase remembers
              <br />
              the <span className="muted-word">what.</span>
              <br />
              Bring back the <span className="blue">why.</span>
            </h2>
            <p>
              The commit is still there. The reasoning is scattered across issues, pull requests,
              and conversations.
              <br />
              <br />
              Domino brings those threads together. So the next person can follow a decision,
              instead of guessing at one.
            </p>
          </div>
          <div className="history-rail" aria-label="Illustrative evidence chain">
            {history.map((item, i) => (
              <button
                aria-pressed={active === i}
                key={item.type}
                onClick={() => setActive(i)}
                className={active === i ? 'history-step active' : 'history-step'}
              >
                <span className="step-index">{item.icon}</span>
                <span>{item.type}</span>
                <ArrowRight size={21} />
              </button>
            ))}
          </div>
          <div className="history-insight">
            <div>
              <Badge tone="blue">ILLUSTRATIVE WORKFLOW</Badge>
              <h3>{history[active].title}</h3>
            </div>
            <p>{history[active].detail}</p>
            <span className="history-insight-number">{history[active].icon}</span>
          </div>
        </section>

        <section id="cascade" className="cascade-section" ref={cascade}>
          <div className="page-width">
            <div className="chapter-line">
              <Eyebrow>02 / UNDERSTAND THE NEXT MOVE</Eyebrow>
              <Badge tone="dark">INTERACTIVE CONCEPT · NOT REPOSITORY DATA</Badge>
            </div>
            <div className="cascade-grid">
              <div className="cascade-copy">
                <h2>
                  One change.
                  <br />A whole <span>chain.</span>
                </h2>
                <p>
                  A file is never just a file. Trace its direct and transitive dependents, and see
                  the path behind each possible impact.
                </p>
                <div className="cascade-states">
                  <span className={progress > 10 ? 'lit' : ''}>
                    <i />
                    Changed file
                  </span>
                  <span className={progress > 43 ? 'lit orange-text' : ''}>
                    <i />
                    Direct dependent
                  </span>
                  <span className={progress > 76 ? 'lit yellow-text' : ''}>
                    <i />
                    Transitive dependent
                  </span>
                </div>
              </div>
              <div className="cascade-stage">
                <svg className="cascade-lines" viewBox="0 0 600 340" aria-hidden="true">
                  <path d="M115 190 C200 190 210 130 300 130 S410 240 500 240" />
                  <path
                    className="active-path"
                    strokeDasharray="600"
                    strokeDashoffset={600 * (1 - progress / 100)}
                    d="M115 190 C200 190 210 130 300 130 S410 240 500 240"
                  />
                </svg>
                {['auth.ts', 'session.ts', 'dashboard.tsx'].map((file, i) => {
                  const amount = Math.max(0, Math.min(1, (progress - i * 32) / 25));
                  return (
                    <div
                      key={file}
                      className={`cascade-tile tile-${i} ${amount > 0.5 ? 'activated' : ''}`}
                      style={{
                        transform: `perspective(900px) rotateY(-23deg) rotateZ(${-6 + i * 6}deg) rotateX(${amount * 22}deg) translateY(${-amount * 9}px)`,
                      }}
                    >
                      <div className="tile-number">0{i + 1}</div>
                      <Code2 size={32} strokeWidth={1} />
                      <strong>{file}</strong>
                      <span>{i === 0 ? 'THE CHANGE' : `${i} HOP${i === 2 ? 'S' : ''} AWAY`}</span>
                    </div>
                  );
                })}
                <span className="stage-note">POSSIBLE IMPACT ≠ CONFIRMED BREAKAGE</span>
              </div>
            </div>
            <div className="cascade-controls">
              <Button
                variant="secondary"
                onClick={() => {
                  if (progress >= 100) setProgress(0);
                  setPlaying(!playing);
                }}
                aria-label={playing ? 'Pause chain reaction' : 'Play chain reaction'}
              >
                {playing ? <Pause size={16} /> : <Play size={16} />}
                <span>{playing ? 'Pause' : progress === 100 ? 'Replay' : 'Play'}</span>
              </Button>
              <label className="scrubber">
                <span className="sr-only">Chain reaction progress</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={progress}
                  onChange={(e) => {
                    setPlaying(false);
                    setProgress(Number(e.target.value));
                  }}
                />
              </label>
              <span className="mono">{String(Math.round(progress)).padStart(3, '0')} / 100</span>
              <button
                className="icon-button"
                aria-label="Reset chain reaction"
                onClick={() => {
                  setProgress(0);
                  setPlaying(false);
                }}
              >
                <RotateCcw size={17} />
              </button>
            </div>
          </div>
        </section>

        <section className="workspace-reveal page-width">
          <div className="chapter-line">
            <Eyebrow>03 / MAKE THE CONNECTION</Eyebrow>
            <span>AN INVESTIGATION SPACE, NOT ANOTHER CHAT WINDOW</span>
          </div>
          <div className="workspace-intro">
            <h2>
              The whole story.
              <br />
              <span className="blue">One workspace.</span>
            </h2>
            <p>
              Move from a question to its sources.
              <br />
              From a file to its blast radius.
              <br />
              From an isolated detail to a connected view.
            </p>
          </div>
          <div className="workspace-door">
            <div className="door-image">
              <img
                src="/assets/blueprint.webp"
                loading="lazy"
                alt="Conceptual architectural chain joined to a precise blue network"
                width="1672"
                height="941"
              />
              <span>CONCEPT STUDY / CONNECTED MEMORY</span>
            </div>
            <div className="door-content">
              <Eyebrow>YOUR NEXT INVESTIGATION STARTS HERE</Eyebrow>
              <h3>
                Give your code
                <br />
                some context.
              </h3>
              <div className="door-features">
                <span>
                  <GitCommitHorizontal size={17} /> Connected history
                </span>
                <span>
                  <ShieldCheck size={17} /> Cited answers
                </span>
                <span>
                  <GitPullRequest size={17} /> Change & PR impact
                </span>
              </div>
              <Button
                onClick={(e) => {
                  if (e.detail === 0 || reduce) navigate('/app');
                  else setLaunching(true);
                }}
              >
                Enter the workspace <ArrowUpRight size={18} />
              </Button>
              <p>
                Start with a public GitHub repository.
                <br />
                Your sources stay one click away.
              </p>
            </div>
          </div>
        </section>

        <section className="principles page-width" id="principles">
          <Eyebrow>04 / EVIDENCE BEFORE CONFIDENCE</Eyebrow>
          <h2>
            Clarity includes
            <br />
            knowing the <span className="muted-word">limits.</span>
          </h2>
          <div className="principle-rows">
            <div>
              <span className="evidence-symbol observed">
                <Check size={15} />
              </span>
              <h3>Observed</h3>
              <p>
                A recorded relationship or static import. Inspect its source and indexed revision.
              </p>
            </div>
            <div>
              <span className="evidence-symbol derived">↗</span>
              <h3>Derived</h3>
              <p>
                A dependency path or historical co-change. A signal to investigate, with a reason
                attached.
              </p>
            </div>
            <div>
              <span className="evidence-symbol inferred">?</span>
              <h3>Inferred</h3>
              <p>
                An interpretation, clearly labelled. When the history does not support an answer,
                Domino says so.
              </p>
            </div>
          </div>
        </section>
        <footer className="launch-footer page-width">
          <div>
            <Logo />
            <span>Every change has a consequence.</span>
          </div>
          <Link to="/app">
            Find the connection <ArrowUpRight size={22} />
          </Link>
          <div className="footer-bottom">
            <span>DOMINO © 2026</span>
            <span>BUILT FOR INNOVISTA · PS06</span>
            <a href="#main">BACK TO THE FIRST DOMINO ↑</a>
          </div>
        </footer>
      </main>
      {launching && (
        <div className="launch-transition" role="status">
          <div className="transition-dominoes">
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
          <p>Follow the connection.</p>
          <Button variant="secondary" onClick={() => navigate('/app')}>
            Skip to workspace <ArrowRight size={15} />
          </Button>
        </div>
      )}
    </div>
  );
}
