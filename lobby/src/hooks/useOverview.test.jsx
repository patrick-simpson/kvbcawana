import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

const getOverview = vi.hoisted(() => vi.fn());
vi.mock('../lib/workerClient.js', () => ({ getOverview }));

const { useOverview } = await import('./useOverview.js');
const { OVERVIEW_MAX_FAILURES, OVERVIEW_POLL_MS, OVERVIEW_SLOW_POLL_MS } = await import('../lib/missionControl.js');

const good = (n) => ({ ok: true, status: 200, body: { n }, message: '' });
const down = () => ({ ok: false, status: 0, body: null, message: 'Could not reach the sync service.' });
const setVisible = (v) => Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });

beforeEach(() => { vi.useFakeTimers(); getOverview.mockReset(); setVisible('visible'); });
afterEach(() => { cleanup(); vi.useRealTimers(); setVisible('visible'); });

describe('the overview poll (routes.md 10.6)', () => {
  it('reads at once, then every 10 s while visible', async () => {
    let n = 0;
    getOverview.mockImplementation(async () => good(++n));
    const { result } = renderHook(() => useOverview({ enabled: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(getOverview).toHaveBeenCalledTimes(1);
    expect(result.current.overview).toEqual({ n: 1 });
    await act(async () => { await vi.advanceTimersByTimeAsync(OVERVIEW_POLL_MS); });
    expect(getOverview).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(OVERVIEW_POLL_MS - 1); });
    expect(getOverview).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(getOverview).toHaveBeenCalledTimes(3);
  });

  it('slows to every 60 s while the tab is hidden', async () => {
    getOverview.mockImplementation(async () => good(1));
    setVisible('hidden');
    renderHook(() => useOverview({ enabled: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(getOverview).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(OVERVIEW_POLL_MS * 3); });
    expect(getOverview).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(OVERVIEW_SLOW_POLL_MS); });
    expect(getOverview).toHaveBeenCalledTimes(2);
  });

  it('stops after 3 failures in a row, keeps the last good numbers, and Try again restarts it', async () => {
    getOverview.mockResolvedValueOnce(good(1));
    getOverview.mockImplementation(async () => down());
    const { result } = renderHook(() => useOverview({ enabled: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    for (let i = 0; i < OVERVIEW_MAX_FAILURES; i += 1) await act(async () => { await vi.advanceTimersByTimeAsync(OVERVIEW_POLL_MS); });
    expect(result.current.stopped).toBe(true);
    expect(result.current.overview).toEqual({ n: 1 });
    expect(result.current.error).toMatch(/Could not reach/);
    const seen = getOverview.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(OVERVIEW_POLL_MS * 5); });
    expect(getOverview).toHaveBeenCalledTimes(seen);
    getOverview.mockImplementation(async () => good(9));
    await act(async () => { result.current.retry(); await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.stopped).toBe(false);
    expect(result.current.overview).toEqual({ n: 9 });
  });

  it('a success between failures resets the count', async () => {
    const script = [down(), down(), good(1), down(), down()];
    getOverview.mockImplementation(async () => script.shift() ?? good(2));
    const { result } = renderHook(() => useOverview({ enabled: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    for (let i = 0; i < 4; i += 1) await act(async () => { await vi.advanceTimersByTimeAsync(OVERVIEW_POLL_MS); });
    expect(result.current.stopped).toBe(false);
  });

  it('does nothing while Tonight is not open (or not signed in)', async () => {
    renderHook(() => useOverview({ enabled: false }));
    await act(async () => { await vi.advanceTimersByTimeAsync(OVERVIEW_POLL_MS * 3); });
    expect(getOverview).not.toHaveBeenCalled();
  });

  it('stops polling when it unmounts', async () => {
    getOverview.mockImplementation(async () => good(1));
    const { unmount } = renderHook(() => useOverview({ enabled: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(OVERVIEW_POLL_MS * 3); });
    expect(getOverview).toHaveBeenCalledTimes(1);
  });

  it('visibility toggles never start a second chain or shorten the interval', async () => {
    let release;
    getOverview.mockImplementationOnce(() => new Promise((r) => { release = () => r(good(1)); }));
    getOverview.mockImplementation(async () => good(2));
    renderHook(() => useOverview({ enabled: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(getOverview).toHaveBeenCalledTimes(1);   // the first read is still out
    // hide / show while it is in flight: no second read
    for (let i = 0; i < 3; i += 1) { setVisible('hidden'); document.dispatchEvent(new Event('visibilitychange')); setVisible('visible'); document.dispatchEvent(new Event('visibilitychange')); }
    expect(getOverview).toHaveBeenCalledTimes(1);
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(0); });
    // toggling soon after a read does not read again before the normal interval
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    setVisible('hidden'); document.dispatchEvent(new Event('visibilitychange'));
    setVisible('visible'); document.dispatchEvent(new Event('visibilitychange'));
    await act(async () => { await vi.advanceTimersByTimeAsync(OVERVIEW_POLL_MS - 3000 - 1); });
    expect(getOverview).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(getOverview).toHaveBeenCalledTimes(2);
    // and exactly one chain keeps going: one read per interval
    await act(async () => { await vi.advanceTimersByTimeAsync(OVERVIEW_POLL_MS * 3); });
    expect(getOverview).toHaveBeenCalledTimes(5);
  });
});
