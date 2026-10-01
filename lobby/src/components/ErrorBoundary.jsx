import { Component } from 'react';

// Generic render-crash fence. The fallback defaults to null (an inert
// gap) so a broken widget simply vanishes instead of taking the whole
// stage down — on a signage display an empty corner beats a white
// screen every time. Keep fallbacks dependency-free so they can't fail.
//
// Pass `eventKey` to retry after a crash: App keys the long-lived stage
// layers on its 30 s boardNow tick, so a transient render error fences a
// layer for at most half a minute instead of for the rest of the display's
// uptime — and reports each crash through `onError` so the Signal sticker
// can say which layer is down (a dead background otherwise looks exactly
// like a quiet night).
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error(`ErrorBoundary${this.props.label ? ` (${this.props.label})` : ''}:`, error);
    this.props.onError?.();
  }

  componentDidUpdate(prevProps) {
    // Reset when the keyed content changes so the next render gets a clean slate.
    if (prevProps.eventKey !== this.props.eventKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) return this.props.fallback ?? null;
    return this.props.children;
  }
}
