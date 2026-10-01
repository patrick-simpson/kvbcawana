import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import TonightTicker, { tickerRows, tonightRows } from './TonightTicker.jsx';
import { TONIGHT_STALE_MS } from '../lib/constants.js';

// The staleness re-check timer is the only thing under test here, not
// framer-motion's tweening — AnimatePresence's exit lifecycle waits on
// requestAnimationFrame, which fake timers can't drive. Passthrough it,
// same as DataCycle.test.jsx.
vi.mock('framer-motion', async (importOriginal) => {
  const mod = await importOriginal();
  return { ...mod, AnimatePresence: ({ children }) => children };
});

describe('tonightRows', () => {
  it('returns nothing for a missing payload', () => {
    expect(tonightRows(null)).toEqual([]);
    expect(tonightRows(undefined)).toEqual([]);
  });

  it('includes every stat with its label when all are positive', () => {
    const rows = tonightRows({ checkedIn: 63, booksCompleted: 4, awardsEarned: 11, friendsBrought: 2, at: 1 });
    expect(rows).toEqual([
      { key: 'checkedIn', label: 'checked in', value: 63 },
      { key: 'booksCompleted', label: 'books finished', value: 4 },
      { key: 'awardsEarned', label: 'awards earned', value: 11 },
      { key: 'friendsBrought', label: 'friends brought', value: 2 },
    ]);
  });

  it('omits a zero row rather than showing it as "0 awards earned"', () => {
    const rows = tonightRows({ checkedIn: 63, booksCompleted: 0, awardsEarned: 11, friendsBrought: 0, at: 1 });
    expect(rows.map((r) => r.key)).toEqual(['checkedIn', 'awardsEarned']);
  });

  it('returns nothing when every stat is zero', () => {
    expect(tonightRows({ checkedIn: 0, booksCompleted: 0, awardsEarned: 0, friendsBrought: 0, at: 1 })).toEqual([]);
  });
});

describe('tickerRows', () => {
  const at = 1_000_000;
  const all = { checkedIn: 63, booksCompleted: 4, awardsEarned: 0, friendsBrought: 0, at };

  it('is what the strip would draw at a given moment: the rows while the feed is fresh, none once it is stale', () => {
    expect(tickerRows(all, at + 1000).map((r) => r.key)).toEqual(['checkedIn', 'booksCompleted']);
    expect(tickerRows(all, at + TONIGHT_STALE_MS).length).toBe(2);
    expect(tickerRows(all, at + TONIGHT_STALE_MS + 1)).toEqual([]);
  });

  it('is nothing before a broadcast, and nothing when every stat is zero', () => {
    expect(tickerRows(null, at)).toEqual([]);
    expect(tickerRows({ ...all, checkedIn: 0, booksCompleted: 0 }, at)).toEqual([]);
  });
});

describe('TonightTicker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 14, 18, 0, 0));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const payload = (overrides = {}) => ({
    checkedIn: 63,
    booksCompleted: 4,
    awardsEarned: 11,
    friendsBrought: 2,
    at: Date.now(),
    ...overrides,
  });

  it('renders nothing until a tonight event has arrived', () => {
    const { container } = render(<TonightTicker tonight={null} active />);
    expect(container.querySelector('.tonight-ticker')).toBeNull();
  });

  it('shows big numbers with labels for a representative payload', () => {
    render(<TonightTicker tonight={payload()} active />);
    expect(screen.getByText('63')).toBeTruthy();
    expect(screen.getByText(/checked in/i)).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByText(/books finished/i)).toBeTruthy();
    expect(screen.getByText('11')).toBeTruthy();
    expect(screen.getByText(/awards earned/i)).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText(/friends brought/i)).toBeTruthy();
  });

  it('softens a zero stat by leaving its row out entirely', () => {
    render(<TonightTicker tonight={payload({ awardsEarned: 0 })} active />);
    expect(screen.getByText('63')).toBeTruthy();
    expect(screen.queryByText(/awards earned/i)).toBeNull();
  });

  it('hides entirely when every stat is zero, even with a fresh event', () => {
    const { container } = render(
      <TonightTicker
        tonight={payload({ checkedIn: 0, booksCompleted: 0, awardsEarned: 0, friendsBrought: 0 })}
        active
      />
    );
    expect(container.querySelector('.tonight-ticker')).toBeNull();
  });

  it('yields while a banner is on screen (active=false)', () => {
    const { container, rerender } = render(<TonightTicker tonight={payload()} active={false} />);
    expect(container.querySelector('.tonight-ticker')).toBeNull();

    rerender(<TonightTicker tonight={payload()} active />);
    expect(screen.getByText('63')).toBeTruthy();
  });

  it('hides once the feed goes stale (print server gone quiet)', () => {
    const { container } = render(<TonightTicker tonight={payload()} active />);
    expect(screen.getByText('63')).toBeTruthy();

    act(() => vi.advanceTimersByTime(TONIGHT_STALE_MS + 60000));
    expect(container.querySelector('.tonight-ticker')).toBeNull();
  });

  it('judges staleness on the clock its caller hands it, and runs none of its own then', () => {
    const t = payload();
    const { container, rerender } = render(<TonightTicker tonight={t} active now={t.at} />);
    expect(screen.getByText('63')).toBeTruthy();
    // Wall-clock time passing changes nothing: the caller's clock rules.
    act(() => vi.advanceTimersByTime(TONIGHT_STALE_MS + 60000));
    expect(screen.getByText('63')).toBeTruthy();
    rerender(<TonightTicker tonight={t} active now={t.at + TONIGHT_STALE_MS + 1} />);
    expect(container.querySelector('.tonight-ticker')).toBeNull();
  });

  it('stays visible just before the staleness threshold', () => {
    render(<TonightTicker tonight={payload()} active />);
    act(() => vi.advanceTimersByTime(TONIGHT_STALE_MS - 60000));
    expect(screen.getByText('63')).toBeTruthy();
  });
});
