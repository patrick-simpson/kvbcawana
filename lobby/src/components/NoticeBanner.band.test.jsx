import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { ZeroAnimationContext } from '../lib/motion.jsx';
import NoticeBanner from './NoticeBanner.jsx';

// The band's turn-taking, through the real framer-motion and real timers
// (framer-motion keeps its own frame clock, which a file that fakes timers
// leaves stalled; see NoticeBanner.test.jsx for the fake-timer expiry tests).

describe('the band, one at a time', () => {
  afterEach(cleanup);
  const zero = (ui) => render(<ZeroAnimationContext.Provider value>{ui}</ZeroAnimationContext.Provider>);
  const opacity = (el) => Number(el.style.opacity === '' ? 1 : el.style.opacity);

  it('a band notice is out of sight while a toast holds the band; a critical one never moves', async () => {
    const at = Date.now();
    const { container, rerender } = zero(<NoticeBanner notice={{ level: 'info', message: 'Hi', at }} yielding />);
    await waitFor(() => expect(opacity(container.querySelector('.notice-banner--info'))).toBe(0));
    rerender(<ZeroAnimationContext.Provider value><NoticeBanner notice={{ level: 'info', message: 'Hi', at }} /></ZeroAnimationContext.Provider>);
    await waitFor(() => expect(opacity(container.querySelector('.notice-banner--info'))).toBe(1));
    rerender(<ZeroAnimationContext.Provider value><NoticeBanner notice={{ level: 'critical', message: 'Hi', at: at + 1 }} yielding /></ZeroAnimationContext.Provider>);
    await new Promise((r) => setTimeout(r, 60));
    expect(opacity(container.querySelector('.notice-banner--critical'))).toBe(1);
  });

  it('comes back only once the toast has had time to leave, not over it', async () => {
    const at = Date.now();
    const { container, rerender } = render(<NoticeBanner notice={{ level: 'info', message: 'Hi', at }} yielding />);
    const el = () => container.querySelector('.notice-banner--info');
    await waitFor(() => expect(opacity(el())).toBe(0), { timeout: 1500 });
    rerender(<NoticeBanner notice={{ level: 'info', message: 'Hi', at }} />);
    // The toast's exit is DUR.exit (280 ms): the notice holds out of sight
    // for it. An immediate pop would already be most of the way in here.
    await new Promise((r) => setTimeout(r, 150));
    expect(opacity(el())).toBeLessThan(0.05);
    await waitFor(() => expect(opacity(el())).toBe(1), { timeout: 2000 });
  });
});

