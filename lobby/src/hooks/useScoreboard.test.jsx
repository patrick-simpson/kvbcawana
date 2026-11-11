import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { emptyBoard, nightOf } from '../../../shared/scoreboard.js';

const syncAuthed = vi.hoisted(() => vi.fn());
const rings = vi.hoisted(() => ({ fn: null }));
vi.mock('./useSync.js', () => ({
  syncAuthed,
  onSyncDoorbell: (fn) => { rings.fn = fn; return () => { rings.fn = null; }; },
  useSync: () => ({ signedIn: true }),
}));

const { useScoreboard } = await import('./useScoreboard.js');

const DAY = 24 * 60 * 60 * 1000;
const boardFor = (night, extra = {}) => ({ ...emptyBoard(night), rev: 1, active: 'tnt', ...extra });
const answer = (board, serverNow) => ({ ok: true, status: 200, body: { board, serverNow } });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });

beforeEach(() => { syncAuthed.mockReset(); });
afterEach(() => cleanup());

describe('the scoreboard hook: a board from another night is no board', () => {
  it('shows tonight\'s board (Eastern date) and hides last night\'s', async () => {
    syncAuthed.mockResolvedValue(answer(boardFor(nightOf(Date.now())), Date.now()));
    const a = renderHook(() => useScoreboard({ enabled: true }));
    await flush();
    expect(a.result.current.board?.active).toBe('tnt');
    cleanup();

    syncAuthed.mockResolvedValue(answer(boardFor(nightOf(Date.now() - 2 * DAY)), Date.now()));
    const b = renderHook(() => useScoreboard({ enabled: true }));
    await flush();
    expect(b.result.current.board).toBeNull();
    expect(syncAuthed).toHaveBeenCalledTimes(2);
  });

  it('judges the night on the Worker clock once it is known', async () => {
    // The Worker says it is two days from now, so tonight's device date is already another night.
    syncAuthed.mockResolvedValue(answer(boardFor(nightOf(Date.now())), Date.now() + 2 * DAY));
    const { result } = renderHook(() => useScoreboard({ enabled: true }));
    await flush();
    expect(result.current.board).toBeNull();
  });

  it('a ring carrying last night\'s board shows nothing, with no extra request', async () => {
    syncAuthed.mockResolvedValue({ ok: true, status: 200, body: { board: null, serverNow: Date.now() } });
    const { result } = renderHook(() => useScoreboard({ enabled: true }));
    await flush();
    const calls = syncAuthed.mock.calls.length;
    act(() => rings.fn('scoreboard', { board: boardFor(nightOf(Date.now() - 2 * DAY), { rev: 5 }), now: Date.now() }));
    expect(result.current.board).toBeNull();
    expect(syncAuthed.mock.calls.length).toBe(calls);
  });
});
