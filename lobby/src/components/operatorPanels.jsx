import { useEffect } from 'react';
import { lazyPanel } from '../lib/lazyPanel.jsx';
import churchLogo from '../../shared/brand/logos/kvbc-awana-two-line-white.svg';

// The operator panels, each in its own chunk (src/lib/lazyPanel.jsx; App hands
// each its `fallback`). Nothing a TV shows on its own lives here: the check-in
// moment, the overlays, promos, the flagship and the first-run card stay in
// the main chunk, so a screen never waits on a chunk (and never shows a
// loading card) to do its job.
export const SettingsPanel = lazyPanel(() => import('./SettingsPanel.jsx'));
export const RemoteScreenPanel = lazyPanel(() => import('./RemoteScreenPanel.jsx'));
export const SlideEditorPanel = lazyPanel(() => import('./SlideEditorPanel.jsx'));
export const DebugPanel = lazyPanel(() => import('./DebugPanel.jsx'));

/** Every operator panel; resolves when all have landed (or failed). Tests await it. */
export function preloadOperatorPanels() {
  return Promise.all([SettingsPanel, RemoteScreenPanel, SlideEditorPanel, DebugPanel].map((p) => p.preload()));
}

/**
 * The panel's own chrome while its chunk lands (normally a few milliseconds
 * from the service worker's cache): the backdrop and a white card with a
 * one-line status, like the settings page's "Opening <screen>…". No entrance
 * of its own (`.panel--opening` is not `.panel--tabbed`), so the real panel's
 * entrance plays once, when it arrives. Nothing is typed in it yet, so Escape
 * or the backdrop simply closes it, as they would the panel.
 * @param {{ label: string, onClose: () => void }} props
 */
export function PanelOpening({ label, onClose }) {
  useEffect(() => {
    const onKey = (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="panel-backdrop" onClick={onClose}>
      <div className="panel panel--settings panel--opening" role="dialog" aria-modal="true" aria-label={label} aria-busy="true">
        <p className="hint" role="status">Opening {label.toLowerCase()}…</p>
      </div>
    </div>
  );
}

/** The debug panel's box while its chunk lands; no entrance (`.debug--opening`). */
export function DebugOpening() {
  return (
    <div className="debug debug--opening" aria-busy="true">
      <div className="debug-header">
        <img className="panel-mark" src={churchLogo} alt="" draggable="false" />
        <h3>Debug · Simulate check-ins</h3>
        <div className="debug-stats" role="status"><span>Opening…</span></div>
      </div>
    </div>
  );
}
