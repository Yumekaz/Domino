import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { MotionConfig } from 'motion/react';
import { Activity, Minus } from 'lucide-react';
import './motion-policy.css';

const preferenceKey = 'domino.reduced-motion';
const mediaQuery = '(prefers-reduced-motion: reduce)';
const systemReduced = () => window.matchMedia(mediaQuery).matches;
const snapshot = () => {
  try {
    return systemReduced() || localStorage.getItem(preferenceKey) === 'true';
  } catch {
    return systemReduced();
  }
};
const subscribe = (changed: () => void) => {
  const media = window.matchMedia(mediaQuery);
  media.addEventListener('change', changed);
  window.addEventListener('domino:motion', changed);
  window.addEventListener('storage', changed);
  return () => {
    media.removeEventListener('change', changed);
    window.removeEventListener('domino:motion', changed);
    window.removeEventListener('storage', changed);
  };
};
export const useDominoMotion = () => useSyncExternalStore(subscribe, snapshot, () => false);
export function MotionPolicy({ children }: { children: ReactNode }) {
  const reduced = useDominoMotion();
  useEffect(() => {
    document.documentElement.dataset.motion = reduced ? 'reduced' : 'full';
  }, [reduced]);
  useEffect(() => {
    const keyboard = () => {
      document.documentElement.dataset.input = 'keyboard';
    };
    const pointer = () => {
      document.documentElement.dataset.input = 'pointer';
    };
    window.addEventListener('keydown', keyboard);
    window.addEventListener('pointerdown', pointer);
    return () => {
      window.removeEventListener('keydown', keyboard);
      window.removeEventListener('pointerdown', pointer);
    };
  }, []);
  return <MotionConfig reducedMotion={reduced ? 'always' : 'user'}>{children}</MotionConfig>;
}
export function MotionToggle() {
  const reduced = useDominoMotion();
  return (
    <button
      className="motion-toggle"
      aria-label="Reduce motion"
      aria-pressed={reduced}
      title={
        systemReduced()
          ? 'Reduced motion follows your system preference'
          : 'Choose a quieter experience'
      }
      disabled={systemReduced()}
      onClick={() => {
        try {
          localStorage.setItem(preferenceKey, String(!reduced));
        } catch {
          return;
        }
        window.dispatchEvent(new Event('domino:motion'));
      }}
    >
      {reduced ? <Minus size={14} /> : <Activity size={14} />}
      <span>Motion / {reduced ? 'reduced' : 'full'}</span>
    </button>
  );
}
