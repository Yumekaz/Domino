import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  FileCode2,
  GitCommitHorizontal,
  GitPullRequest,
  HelpCircle,
  Network,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { Badge, Button, Eyebrow, Logo } from '../components/ui';
import '../launch.css';
import '../desktop-northstar.css';
const DominoScene = lazy(() => import('../components/launch/DominoScene'));
const chapters = [
  {
    label: 'Issue',
    icon: HelpCircle,
    title: 'Start with a question.',
    copy: 'A reported problem is the first piece of context. Preserve what was asked, when it was raised, and the discussion around it.',
  },
  {
    label: 'Pull request',
    icon: GitPullRequest,
    title: 'Recover the reasoning.',
    copy: 'A linked pull request preserves the proposal and review. Read what was documented, and distinguish it from a later interpretation.',
  },
  {
    label: 'Commit',
    icon: GitCommitHorizontal,
    title: 'Anchor it to a change.',
    copy: 'The recorded commit connects the discussion to an exact revision. Follow its source, rather than relying on someone’s recollection.',
  },
  {
    label: 'File',
    icon: FileCode2,
    title: 'Meet the code.',
    copy: 'See the files that the change actually touched. Join that history to the static relationships at the indexed revision.',
  },
  {
    label: 'Dependents',
    icon: Network,
    title: 'See what could follow.',
    copy: 'Trace direct and transitive import paths. Possible impact is a reason to investigate, with the evidence and blind spots attached.',
  },
];
export default function LandingV2() {
  const reduce = useReducedMotion();
  const navigate = useNavigate();
  const [progress, updateProgress] = useState(0);
  const current = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [connected, setConnected] = useState(false);
  const [evidence, setEvidence] = useState(1);
  const [launching, setLaunching] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [controlled, setControlled] = useState(false);
  const markReady = useCallback(() => setSceneReady(true), []);
  const stage = Math.min(4, Math.floor(progress / 20));
  const setProgress = useCallback((p: number) => {
    current.current = p;
    updateProgress(p);
  }, []);
  const play = () => {
    setControlled(true);
    setProgress(0);
    setPlaying(true);
  };
  useEffect(() => {
    if (controlled) {
      try {
        sessionStorage.setItem('domino.launch-intro', 'seen');
      } catch {
        /* A manual interaction still cancels the optional cue in this view. */
      }
      return;
    }
    if (reduce || !sceneReady) return;
    try {
      if (sessionStorage.getItem('domino.launch-intro')) return;
    } catch {
      return;
    }
    const timer = window.setTimeout(() => {
      try {
        sessionStorage.setItem('domino.launch-intro', 'seen');
      } catch {
        /* Optional first-visit cue. */
      }
      setPlaying(true);
    }, 1800);
    return () => clearTimeout(timer);
  }, [reduce, sceneReady, controlled]);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = 0;
    const tick = (time: number) => {
      if (!last) last = time;
      const delta = Math.min(40, time - last);
      last = time;
      if (!document.hidden) {
        const next = reduce ? 100 : Math.min(100, current.current + delta / 45);
        setProgress(next);
        if (next >= 100) {
          setPlaying(false);
          return;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, reduce, setProgress]);
  useEffect(() => {
    if (!launching) return;
    const timer = window.setTimeout(() => navigate('/app'), reduce ? 0 : 850);
    return () => clearTimeout(timer);
  }, [launching, navigate, reduce]);
  const selected = chapters[stage];
  return (
    <div className="launch-v2 desktop-northstar">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="launch-masthead">
        <Logo />
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
        <section className="opening" id="mechanism">
          <motion.div
            className="opening-type"
            initial={{ opacity: 0, transform: reduce ? 'none' : 'translateY(18px)' }}
            animate={{ opacity: 1, transform: 'translateY(0)' }}
            transition={{ duration: 0.8, ease: [0.23, 1, 0.32, 1] }}
          >
            <Eyebrow>
              <span className="live-dot" /> ENGINEERING MEMORY / CONNECTED
            </Eyebrow>
            <h1 tabIndex={-1}>
              Know why.
              <br />
              See what
              <br />
              <em>
                falls next<span>.</span>
              </em>
            </h1>
            <p>
              Connect the decisions behind your code to the possible consequences of your next
              change.
            </p>
            <div className="northstar-actions">
              <Link className="button button-primary" to="/app">
                Explore Domino <ArrowUpRight size={18} />
              </Link>
              <button onClick={play}>
                <Play size={14} />
                Watch the chain reaction
              </button>
            </div>
            <span className="northstar-platforms">PUBLIC GITHUB / JAVASCRIPT & TYPESCRIPT</span>
          </motion.div>
          <div className="opening-scene">
            <Suspense
              fallback={
                <div className="scene-loading">
                  <img src="/assets/domino-midnight.webp" alt="Sculptural domino chain" />
                  <span>Assembling the chain…</span>
                </div>
              }
            >
              <DominoScene progress={progress} onPush={play} onReady={markReady} cinematic />
            </Suspense>
          </div>
          <div className="opening-console">
            <div className="scene-playback">
              <button
                onClick={() => {
                  setControlled(true);
                  if (progress >= 100) setProgress(0);
                  setPlaying(!playing);
                }}
                aria-label={playing ? 'Pause chain reaction' : 'Play chain reaction'}
              >
                {playing ? <Pause size={16} /> : <Play size={16} />}
              </button>
              <label>
                <span className="sr-only">Chain reaction progress</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={progress}
                  onChange={(e) => {
                    setControlled(true);
                    setPlaying(false);
                    setProgress(Number(e.target.value));
                  }}
                />
              </label>
              <span>{String(Math.round(progress)).padStart(3, '0')}</span>
              <button
                aria-label="Reset chain reaction"
                onClick={() => {
                  setControlled(true);
                  setPlaying(false);
                  setProgress(0);
                }}
              >
                <RotateCcw size={15} />
              </button>
            </div>
            <div className="chain-stations" aria-label="Explore the illustrative evidence chain">
              {chapters.map((c, i) => (
                <button
                  key={c.label}
                  aria-pressed={i === stage}
                  onClick={() => {
                    setControlled(true);
                    setPlaying(false);
                    setProgress(i * 20 + 1);
                  }}
                >
                  <span>0{i + 1}</span>
                  <c.icon size={15} />
                  <b>{c.label}</b>
                  {i < 4 && <ArrowRight size={13} />}
                </button>
              ))}
            </div>
            <span className="northstar-console-label">A CHANGE STARTS A CHAIN REACTION.</span>
          </div>
          <div className="chain-explanation" aria-live="polite">
            <span className="explanation-index">0{stage + 1}</span>
            <h2>{selected.title}</h2>
            <p>{selected.copy}</p>
            <Badge>ILLUSTRATIVE MODEL</Badge>
          </div>
        </section>
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
            <div className="consequence-stage">
              <div className="change-origin">
                <FileCode2 size={24} />
                <small>PROPOSED CHANGE</small>
                <strong>auth.ts</strong>
                <span>Illustrative file</span>
              </div>
              <svg viewBox="0 0 1000 330" preserveAspectRatio="none" aria-hidden="true">
                <path d="M170 165 C340 165 290 75 490 75 S660 75 850 75" />
                <path className="secondary-path" d="M490 75 C660 75 660 255 850 255" />
              </svg>
              <div className="impact-sample sample-direct">
                <span>01</span>
                <div>
                  <small>DIRECT DEPENDENT</small>
                  <strong>session.ts</strong>
                </div>
                <Badge tone="blue">1 HOP</Badge>
              </div>
              <div className="impact-sample sample-transitive">
                <span>02</span>
                <div>
                  <small>TRANSITIVE DEPENDENT</small>
                  <strong>dashboard.tsx</strong>
                </div>
                <Badge tone="orange">2 HOPS</Badge>
              </div>
              <div className="impact-sample sample-test">
                <span>↔</span>
                <div>
                  <small>HISTORICAL ASSOCIATION</small>
                  <strong>Co-changed files</strong>
                </div>
                <Badge>SEPARATE SIGNAL</Badge>
              </div>
            </div>
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
          <div className="workspace-manifesto">
            <h2>
              Less guessing.
              <br />
              <span>
                More following
                <br />
                the evidence.
              </span>
            </h2>
            <div>
              <p>A connected space for the questions engineers actually ask.</p>
              <ol>
                <li>
                  <b>01</b>
                  <span>Why was it built this way?</span>
                  <small>CITED PROJECT HISTORY</small>
                </li>
                <li>
                  <b>02</b>
                  <span>What might this change affect?</span>
                  <small>INSPECTABLE DEPENDENCY PATHS</small>
                </li>
                <li>
                  <b>03</b>
                  <span>Where is context concentrated?</span>
                  <small>OBSERVED CONTRIBUTOR HISTORY</small>
                </li>
              </ol>
              <Button
                onClick={(e) => {
                  if (e.detail === 0 || reduce) navigate('/app');
                  else setLaunching(true);
                }}
              >
                Open the workspace <ArrowUpRight size={18} />
              </Button>
              <span className="workspace-scope">PUBLIC GITHUB · JAVASCRIPT & TYPESCRIPT</span>
            </div>
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
      {launching && (
        <div className="launch-portal" role="status">
          <div className="portal-bars">
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
          <Eyebrow>FROM CONTEXT TO CONSEQUENCE</Eyebrow>
          <h2>Follow the connection.</h2>
          <Button variant="secondary" onClick={() => navigate('/app')}>
            Skip to workspace <ArrowRight size={15} />
          </Button>
        </div>
      )}
    </div>
  );
}
