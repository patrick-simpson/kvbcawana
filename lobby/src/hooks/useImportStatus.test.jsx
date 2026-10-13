import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

const fetchImportStatus = vi.hoisted(() => vi.fn());
vi.mock('../lib/trendsClient.js', () => ({ fetchImportStatus, IMPORT_STATUS_POLL_MS: 60000 }));

const { useImportStatus } = await import('./useImportStatus.js');

const good = (state) => ({ ok: true, status: { state } });
const setVisible = (v) => {
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => { vi.useFakeTimers(); fetchImportStatus.mockReset(); setVisible('visible'); });
afterEach(() => { cleanup(); vi.useRealTimers(); setVisible('visible'); });

describe('the trends back-fill status, asked gently', () => {
  it('asks once when the section opens, then every 60 s while visible', async () => {
    fetchImportStatus.mockImplementation(async () => good('running'));
    const { result } = renderHook(() => useImportStatus({ enabled: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchImportStatus).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual({ state: 'running' });
    await act(async () => { await vi.advanceTimersByTimeAsync(59999); });
    expect(fetchImportStatus).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchImportStatus).toHaveBeenCalledTimes(2);
  });

  it('asks nothing while the tab is hidden, and asks at once on coming back after a minute', async () => {
    fetchImportStatus.mockImplementation(async () => good('done'));
    renderHook(() => useImportStatus({ enabled: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchImportStatus).toHaveBeenCalledTimes(1);
    await act(async () => { setVisible('hidden'); await vi.advanceTimersByTimeAsync(10 * 60000); });
    expect(fetchImportStatus).toHaveBeenCalledTimes(1);
    await act(async () => { setVisible('visible'); await vi.advanceTimersByTimeAsync(0); });
    expect(fetchImportStatus).toHaveBeenCalledTimes(2);
  });

  it('coming back sooner than a minute waits out the rest of it', async () => {
    fetchImportStatus.mockImplementation(async () => good('done'));
    renderHook(() => useImportStatus({ enabled: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { setVisible('hidden'); await vi.advanceTimersByTimeAsync(20000); });
    await act(async () => { setVisible('visible'); await vi.advanceTimersByTimeAsync(39000); });
    expect(fetchImportStatus).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(fetchImportStatus).toHaveBeenCalledTimes(2);
  });

  it('keeps the last good answer through a failure; a Worker without the route is not asked again', async () => {
    fetchImportStatus.mockResolvedValueOnce(good('done'));
    fetchImportStatus.mockResolvedValueOnce({ ok: false, missing: false, message: 'Could not reach the sync service.' });
    fetchImportStatus.mockResolvedValueOnce({ ok: false, missing: true, message: 'not yet' });
    const { result } = renderHook(() => useImportStatus({ enabled: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(result.current).toEqual({ state: 'done' });
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(fetchImportStatus).toHaveBeenCalledTimes(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60000); setVisible('hidden'); setVisible('visible'); });
    expect(fetchImportStatus).toHaveBeenCalledTimes(3);
  });

  it('asks nothing when not enabled (signed out), and stops when the section closes', async () => {
    fetchImportStatus.mockImplementation(async () => good('done'));
    renderHook(() => useImportStatus({ enabled: false }));
    await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
    expect(fetchImportStatus).not.toHaveBeenCalled();
    const open = renderHook(() => useImportStatus({ enabled: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    open.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(300000); });
    expect(fetchImportStatus).toHaveBeenCalledTimes(1);
  });
});
