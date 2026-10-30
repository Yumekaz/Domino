import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, Pause, Play, RotateCcw } from 'lucide-react';
import { motion } from 'motion/react';
import { useDominoMotion } from '../MotionPolicy';
import { Badge, Eyebrow } from '../ui';
import { chapters } from './chapters';
const DominoScene = lazy(() => import('./DominoScene'));
export default function HeroExperience() {
  const reduce = useDominoMotion();
  const [progress, updateProgress] = useState(0);
  const current = useRef(0);
  const slider = useRef<HTMLInputElement>(null);
  const readout = useRef<HTMLSpanElement>(null);
  const [playing, setPlaying] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [controlled, setControlled] = useState(false);
  const markReady = useCallback(() => setSceneReady(true), []);
  const stage = Math.min(4, Math.floor(progress / 20));
  const setProgress = useCallback((p: number, commit = true) => {
    current.current = p;
    if (slider.current) slider.current.value = String(p);
    if (readout.current) readout.current.textContent = String(Math.round(p)).padStart(3, '0');
    if (commit) updateProgress(p);
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
    const resetClock = () => {
      last = 0;
    };
    document.addEventListener('visibilitychange', resetClock);
    const tick = (time: number) => {
      if (!last) last = time;
      const delta = time - last;
      last = time;
      if (!document.hidden) {
        const next = reduce ? 100 : Math.min(100, current.current + delta / 45);
        // Geometry reads the ref directly. React only updates the explanatory chapter.
        setProgress(
          next,
          Math.floor(next / 20) !== Math.floor(current.current / 20) || next >= 100,
        );
        if (next >= 100) {
          setPlaying(false);
          return;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', resetClock);
    };
  }, [playing, reduce, setProgress]);
  const selected = chapters[stage];
  return (
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
          Connect the decisions behind your code to the possible consequences of your next change.
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
          <DominoScene
            progress={progress}
            progressSource={current}
            onPush={play}
            onReady={markReady}
            cinematic
          />
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
              ref={slider}
              defaultValue={0}
              onChange={(e) => {
                setControlled(true);
                setPlaying(false);
                setProgress(Number(e.target.value));
              }}
            />
          </label>
          <span ref={readout}>{String(Math.round(progress)).padStart(3, '0')}</span>
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
  );
}
