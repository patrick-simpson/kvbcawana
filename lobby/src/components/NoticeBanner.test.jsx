import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import NoticeBanner, { noticeFit, noticeShowing } from './NoticeBanner.jsx';
import { NOTICE_MAX_AGE_MS } from '../lib/constants.js';
import { OVERLAY, bandRoom, plateChrome } from '../lib/overlayFit.js';

// Same rationale as TonightTicker.test.jsx / DataCycle.test.jsx: the
// staleness timer is what's under test, not framer-motion's tweening.
vi.mock('framer-motion', async (importOriginal) => {
  const mod = await importOriginal();
  return { ...mod, AnimatePresence: ({ children }) => children };
});

describe('NoticeBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 14, 18, 0, 0));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const notice = (overrides = {}) => ({
    level: 'info',
    message: 'Snacks are in the fellowship hall tonight.',
    at: Date.now(),
    ...overrides,
  });

  it('renders nothing without a notice', () => {
    const { container } = render(<NoticeBanner notice={null} />);
    expect(container.querySelector('.notice-banner')).toBeNull();
  });

  it('renders a critical notice as an unmissable, full-width, top alert', () => {
    const { container } = render(
      <NoticeBanner notice={notice({ level: 'critical', message: 'CLUB CANCELLED TONIGHT' })} />
    );
    const el = container.querySelector('.notice-banner--critical');
    expect(el).not.toBeNull();
    expect(el.textContent).toContain('CLUB CANCELLED TONIGHT');
    expect(screen.getByRole('alert').getAttribute('aria-live')).toBe('assertive');
  });

  it('renders a warn notice as a softer strip', () => {
    const { container } = render(
      <NoticeBanner notice={notice({ level: 'warn', message: 'Doors close at 6:15 tonight.' })} />
    );
    const el = container.querySelector('.notice-banner--warn');
    expect(el).not.toBeNull();
    expect(container.querySelector('.notice-banner--critical')).toBeNull();
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
  });

  it('renders an info notice as the quietest treatment', () => {
    const { container } = render(<NoticeBanner notice={notice({ level: 'info' })} />);
    const el = container.querySelector('.notice-banner--info');
    expect(el).not.toBeNull();
    expect(container.querySelector('.notice-banner--warn')).toBeNull();
    expect(container.querySelector('.notice-banner--critical')).toBeNull();
  });

  it('only one severity renders at a time, swapping as new notices arrive', () => {
    const { container, rerender } = render(<NoticeBanner notice={notice({ level: 'critical' })} />);
    expect(container.querySelector('.notice-banner--critical')).not.toBeNull();

    rerender(<NoticeBanner notice={notice({ level: 'warn', at: Date.now() + 1 })} />);
    expect(container.querySelector('.notice-banner--critical')).toBeNull();
    expect(container.querySelector('.notice-banner--warn')).not.toBeNull();
    // Never both at once.
    expect(container.querySelectorAll('.notice-banner')).toHaveLength(1);
  });

  it('renders the message as plain text — never HTML, even if markup-shaped', () => {
    const hostile = "<b>ALERT</b><script>window.__pwned = true;</script> club cancelled";
    const { container } = render(<NoticeBanner notice={notice({ level: 'critical', message: hostile })} />);
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain(hostile);
  });

  it('expires after NOTICE_MAX_AGE_MS so a stale cancellation does not haunt the screen', () => {
    const { container } = render(<NoticeBanner notice={notice({ level: 'critical' })} />);
    expect(container.querySelector('.notice-banner')).not.toBeNull();

    act(() => vi.advanceTimersByTime(NOTICE_MAX_AGE_MS + 60000));
    expect(container.querySelector('.notice-banner')).toBeNull();
  });

  it('stays visible just before the expiry threshold', () => {
    render(<NoticeBanner notice={notice({ level: 'warn' })} />);
    act(() => vi.advanceTimersByTime(NOTICE_MAX_AGE_MS - 60000));
    expect(screen.getByRole('status')).toBeTruthy();
  });
});

describe('noticeFit / the band', () => {
  afterEach(cleanup);
  const long = 'Parents: pick-up tonight moves to the gym doors on the north side because of the parking lot work. Please drive around the back and wait in the loop — volunteers in orange will walk each child out.';
  const medium = 'Bring your Bible next week for double shares, and bring a friend along too!';
  // How far down a band plate reaches (u), from the band's top: its pill,
  // its padding and its lines (app.css .notice-banner--info / .is-band).
  const reach = (fit, label, lineHeight) => plateChrome(label) + 1.15 + fit.lines * fit.size * lineHeight;

  it('shouts a critical notice bigger than a band notice, and steps long ones down', () => {
    const band = noticeFit('info', 'Doors close at 6:15 tonight.');
    const takeover = noticeFit('critical', 'CLUB CANCELLED TONIGHT');
    expect(takeover.size).toBeGreaterThan(band.size);
    expect(noticeFit('info', long).size).toBeLessThan(band.size);
    expect(noticeFit('critical', long).size).toBeLessThan(takeover.size);
    // Under the flag strip the band is shorter: a two-line notice comes down.
    expect(noticeFit('info', medium, { compact: true }).size).toBeLessThan(noticeFit('info', medium).size);
  });

  it('fits every band plate to end where the band ends, with or without the flag strip', () => {
    for (const compact of [false, true]) {
      for (const message of ['Doors close at 6:15 tonight.', medium, long]) {
        const info = noticeFit('info', message, { compact });
        expect(info.fits).toBe(true);
        expect(reach(info, 1.25, 1.2)).toBeLessThanOrEqual(bandRoom(compact));
        // A critical notice kept to the band (an OBS feed, or over the pickup
        // board) is fitted to the band too, not to the middle it is not in.
        const critical = noticeFit('critical', message, { compact, place: 'band' });
        expect(critical.fits).toBe(true);
        expect(reach(critical, 1.4, 1.15)).toBeLessThanOrEqual(bandRoom(compact));
      }
    }
    expect(noticeFit('critical', long, { place: 'band' }).size)
      .toBeLessThan(noticeFit('critical', long, { place: 'centre' }).size);
    expect(OVERLAY.band.bottom).toBeLessThan(OVERLAY.centre.top);
  });

  it('keeps every word of the message, in order, across its lines', () => {
    const { container } = render(<NoticeBanner notice={{ level: 'warn', message: long, at: Date.now() }} />);
    expect(container.querySelector('.notice-banner-message').textContent).toBe(long);
  });

  it('marks a critical notice kept to the band, and only a critical one', () => {
    const { container, rerender } = render(<NoticeBanner notice={{ level: 'critical', message: 'Hi', at: Date.now() }} place="band" />);
    expect(container.querySelector('.notice-banner--critical').classList.contains('is-band')).toBe(true);
    rerender(<NoticeBanner notice={{ level: 'critical', message: 'Hi', at: Date.now() + 1 }} />);
    expect(container.querySelector('.notice-banner--critical').classList.contains('is-band')).toBe(false);
    rerender(<NoticeBanner notice={{ level: 'info', message: 'Hi', at: Date.now() + 2 }} place="band" />);
    expect(container.querySelector('.notice-banner--info').classList.contains('is-band')).toBe(false);
  });
});

describe('one clock', () => {
  afterEach(cleanup);
  it('is judged on the clock it is handed, so App and the banner can never disagree', () => {
    const at = 1_000_000;
    expect(noticeShowing({ level: 'critical', message: 'x', at }, at + NOTICE_MAX_AGE_MS)).toBe(true);
    expect(noticeShowing({ level: 'critical', message: 'x', at }, at + NOTICE_MAX_AGE_MS + 1)).toBe(false);
    expect(noticeShowing({ level: 'critical', message: '', at }, at)).toBe(false);
    expect(noticeShowing(null, at)).toBe(false);
    // Fresh by the wall clock, stale by the clock it is given: it hides.
    const notice = { level: 'critical', message: 'CLUB CANCELLED', at: Date.now() };
    const { container, rerender } = render(<NoticeBanner notice={notice} now={notice.at + 1000} />);
    expect(container.querySelector('.notice-banner--critical')).not.toBeNull();
    rerender(<NoticeBanner notice={notice} now={notice.at + NOTICE_MAX_AGE_MS + 1} />);
    expect(container.querySelector('.notice-banner--critical')).toBeNull();
  });
});
