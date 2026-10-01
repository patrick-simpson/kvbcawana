import React from 'react';
import { Headline } from './Headline.jsx';

/**
 * The on-brand "the show goes on" screen both error boundaries show: the
 * kit's headline in sunflower, a Figtree line, and the one hot button.
 * Deliberately dependency-free (plain elements and CSS only; the headline's
 * static path never touches framer-motion) so the fallback itself can't
 * fail.
 */
export const ErrorScreen = ({ message, detail, fullScreen = false }) => (
  <div
    className={`flex flex-col items-center justify-center p-8 ${fullScreen ? 'h-screen w-screen' : 'w-full h-full'}`}
    style={{ background: '#000000', gap: 'calc(2 * var(--u))' }}
  >
    <Headline text="Oops!" color="var(--brand-sun)" size="var(--text-headline)" />
    <p className="pj-body" style={{ fontSize: 'var(--text-body)', color: 'rgb(255 255 255 / 0.8)', fontWeight: 500 }}>
      {message}
    </p>
    {detail && (
      <p
        className="pj-panel-note text-white/35 max-w-2xl overflow-auto text-center"
        style={{ fontSize: 'calc(1.1 * var(--u))' }}
      >
        {detail}
      </p>
    )}
    <button
      onClick={() => window.location.reload()}
      className="pj-hot-button"
      style={{ fontSize: 'var(--pj-reload-size, calc(1.8 * var(--u)))', padding: '0.7em 1.8em', marginTop: 'calc(1 * var(--u))' }}
    >
      Reload
    </button>
  </div>
);

/**
 * Per-view crash isolation with an on-brand fallback.
 */
export class ViewErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, errorInfo) {
    console.error(`View crashed (${this.props.label}):`, error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return <ErrorScreen message={`The ${this.props.label} screen hit a snag — the show goes on.`} />;
    }
    return this.props.children;
  }
}
