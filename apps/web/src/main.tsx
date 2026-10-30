import React, { Component, Suspense, lazy, useEffect, type ReactNode } from 'react';
import ReactDOM, { type Root } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import './fonts.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import './styles.css';
import Landing from './pages/LandingV2';
import { Loading } from './components/ui';
const Workspace = lazy(() => import('./pages/Workspace'));
function NavigationFocus() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true });
  }, [pathname]);
  return null;
}
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="fatal">
        <h1>This view could not be opened.</h1>
        <p>Reload the workspace to recover. No repository data has been changed.</p>
        <button className="button button-primary" onClick={() => window.location.reload()}>
          Reload workspace
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
// Workspace modules share hooks, so an HMR update can reach this entry point.
// Reuse its React root rather than mounting a second application into the same DOM.
const root: Root =
  (import.meta.hot?.data.root as Root | undefined) ??
  ReactDOM.createRoot(document.getElementById('root')!);
if (import.meta.hot) import.meta.hot.data.root = root;
root.render(
  <React.StrictMode>
    <Boundary>
      <MotionConfig reducedMotion="user">
        <BrowserRouter>
          <NavigationFocus />
          <Suspense fallback={<Loading text="Opening Domino" />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/app/*" element={<Workspace />} />
              <Route
                path="*"
                element={
                  <main className="fatal">
                    <h1>This trail ends here.</h1>
                    <Link to="/app" className="button button-primary">
                      Open workspace
                    </Link>
                  </main>
                }
              />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </MotionConfig>
    </Boundary>
  </React.StrictMode>,
);
