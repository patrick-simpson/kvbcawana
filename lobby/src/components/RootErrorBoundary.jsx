import { Component } from 'react';
import { selfReload } from '../lib/reloadLedger.js';

/** How long a crashed page shows its card before it reloads itself. */
export const ROOT_CRASH_RELOAD_MS = 10 * 1000;

/**
 * The page's last fence. The stage layers each sit behind their own
 * ErrorBoundary, but App computes plenty in its own render (the calendar
 * slides, the skin, the room, the board decision, the corner chips), and a
 * throw there unmounted the whole tree: a blank screen, with the self-update
 * poller and the watchdog gone with it, so nothing ever brought it back.
 *
 * This shows a plain card (no kit components, no framer-motion: nothing here
 * may fail) and reloads the page after ROOT_CRASH_RELOAD_MS, under the same
 * hourly cap as the realtime watchdog, so a crash that comes straight back
 * cannot spin the screen. The button is for a person standing there.
 */
export class RootErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
    this.timer = null;
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('[root] the page crashed:', error, info);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!selfReload()) console.error('[root] not reloading: the hourly cap on self-reloads is spent');
    }, this.props.reloadAfterMs ?? ROOT_CRASH_RELOAD_MS);
  }

  componentWillUnmount() {
    if (this.timer) clearTimeout(this.timer);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div
        role="alert"
        data-root-crash
        style={{
          position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: '1rem', padding: '2rem', textAlign: 'center', background: '#1D2A6B', color: '#FFFFFF',
          fontFamily: 'Figtree, "Segoe UI", system-ui, sans-serif',
        }}
      >
        <div style={{ fontSize: 'clamp(2rem, 6vw, 5rem)', fontWeight: 800, letterSpacing: '0.02em' }}>Back in a moment</div>
        <div style={{ fontSize: 'clamp(1rem, 2vw, 1.6rem)', opacity: 0.85 }}>This screen hit a snag and is restarting itself.</div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            marginTop: '1rem', padding: '0.7em 1.8em', fontSize: 'clamp(1rem, 2vw, 1.4rem)', fontWeight: 700,
            borderRadius: '999px', border: 0, background: '#F15A28', color: '#FFFFFF', cursor: 'pointer',
          }}
        >
          Reload now
        </button>
      </div>
    );
  }
}
