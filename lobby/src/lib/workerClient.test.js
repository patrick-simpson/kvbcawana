import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = [];
let answer = () => ({ ok: true, status: 200, body: {} });
vi.mock('../hooks/useSync.js', () => ({
  syncAuthed: async (path, opts) => { calls.push({ path, ...opts }); return answer(path, opts); },
}));

const w = await import('./workerClient.js');

beforeEach(() => { calls.length = 0; answer = () => ({ ok: true, status: 200, body: {} }); });

describe('the overhaul routes (routes.md section 10)', () => {
  it('calls each documented path', async () => {
    await w.getOverview();
    await w.getSwitches();
    await w.putSwitch({ name: 'CLOUD_PRINT', value: 'on', rev: 3 });
    await w.postNotice({ level: 'warn', message: 'Hi', durationMin: 30 });
    await w.deleteNotice();
    await w.getChanges({ before: 40 });
    await w.undoChange(41);
    expect(calls.map((c) => `${c.method || 'GET'} ${c.path}`)).toEqual([
      'GET /v1/tonight/overview',
      'GET /v1/switches',
      'PUT /v1/switches',
      'POST /v1/notice',
      'DELETE /v1/notice',
      'GET /v1/changes?before=40&limit=50',
      'POST /v1/changes/41/undo',
    ]);
    expect(calls[2].body).toEqual({ name: 'CLOUD_PRINT', value: 'on', rev: 3 });
  });

  it('turns a failure into words, and a route not built yet into "arrives with its next update"', async () => {
    answer = () => ({ ok: false, status: 404, body: null });
    expect((await w.getSwitches()).message).toMatch(/does not have this yet/);
    answer = () => ({ ok: false, status: 0, body: null });
    expect((await w.getOverview()).message).toMatch(/Could not reach/);
    answer = () => ({ ok: false, status: 401, body: null });
    expect((await w.getOverview()).message).toMatch(/Signed out/);
    answer = () => ({ ok: false, status: -1, body: null });
    expect((await w.getOverview()).message).toBe('Sign in first.');
  });

  it('words the switch warnings, the notice refusals and the undo refusals', () => {
    for (const code of ['no-station', 'station-old', 'window-open', 'ym-tab-reload']) expect(w.warningWords(code)).not.toBe(code);
    expect(w.noticeFailure({ status: 503, body: { reason: 'notices-off' }, message: '' })).toMatch(/switched off/);
    expect(w.undoFailure({ status: 409, body: { reason: 'changed-since' }, message: '' })).toBe('Changed again since; nothing undone.');
    expect(w.undoFailure({ status: 410, body: {}, message: '' })).toMatch(/too old/);
  });
});
