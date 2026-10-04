import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { RootErrorBoundary } from './RootErrorBoundary.jsx';
import { WATCHDOG_MAX_RELOADS_PER_HOUR } from '../lib/constants.js';

function Bomb({ explode }) {
  if (explode) throw new Error('kaboom');
  return <div data-testid="fine">fine</div>;
}

let reloads = 0;
beforeEach(() => {
  reloads = 0;
  sessionStorage.clear();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  Object.defineProperty(window, 'location', { value: { reload: () => { reloads += 1; } }, writable: true, configurable: true });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('RootErrorBoundary', () => {
  it('renders its children while nothing is wrong', () => {
    const { getByTestId } = render(<RootErrorBoundary><Bomb explode={false} /></RootErrorBoundary>);
    expect(getByTestId('fine')).toBeTruthy();
  });

  it('a crash shows the plain card and reloads the page after ten seconds', () => {
    const { container } = render(<RootErrorBoundary><Bomb explode /></RootErrorBoundary>);
    expect(container.querySelector('[data-root-crash]')).not.toBeNull();
    expect(container.textContent).toContain('Back in a moment');
    vi.advanceTimersByTime(9_000);
    expect(reloads).toBe(0);
    vi.advanceTimersByTime(1_500);
    expect(reloads).toBe(1);
    expect(JSON.parse(sessionStorage.getItem('awanaWatchdogReloads.v1'))).toHaveLength(1);
  });

  it('the button reloads at once', () => {
    const { container } = render(<RootErrorBoundary><Bomb explode /></RootErrorBoundary>);
    container.querySelector('button').click();
    expect(reloads).toBe(1);
  });

  it('a crash that keeps coming back stops reloading at the hourly cap', () => {
    for (let i = 0; i < WATCHDOG_MAX_RELOADS_PER_HOUR + 2; i++) {
      const { unmount } = render(<RootErrorBoundary><Bomb explode /></RootErrorBoundary>);
      vi.advanceTimersByTime(11_000);
      unmount();
    }
    expect(reloads).toBe(WATCHDOG_MAX_RELOADS_PER_HOUR);
  });

  it('shares the ledger with the realtime watchdog', () => {
    sessionStorage.setItem('awanaWatchdogReloads.v1', JSON.stringify([Date.now() - 1000, Date.now() - 2000]));
    render(<RootErrorBoundary><Bomb explode /></RootErrorBoundary>);
    vi.advanceTimersByTime(11_000);
    expect(reloads).toBe(0);
  });
});
