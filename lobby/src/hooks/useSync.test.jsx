import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSync, useSyncDriver, ringSyncDoorbell, signIn, syncNow, _resetSyncForTest } from './useSync.js';
import { dispatchEvent } from './useSocket.js';
import { _resetForTest as resetConfig, receiveSharedSettings, useConfig } from './useConfig.js';
import { loadSyncSession, saveSyncSession } from '../lib/syncService.js';
import { BarfBagsField, CloudCheckinTestField, FriendsListField, SyncSignInField } from '../components/settings/fields.jsx';
import { useCalendar } from './useCalendar.js';

const BASE = 'https://awana-sync.example.workers.dev';
const SESSION = 'v1.1.1790839331729.oWr6n92IJW5ldPGmtiyjPHAZpca-QGToNlKGXlKI6vc';
const KEY = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=';
const STATE = {
  settings: { rev: 7, publishedAt: '2026-10-01T18:00:00.000Z', settings: { checkoutBoardNamesAbove: 7 } },
  slides: { deckRev: 3, publishedAt: '2026-10-01T18:00:00.000Z', slides: [{ text: 'Store next week', eyebrow: '', theme: 'auto', textSize: 'auto', durationSec: 0 }] },
  template: { savedAt: '2026-10-01T17:00:00.000Z', config: { audioMuted: true } },
  journey: null,
  calendar: null,
  kid: 'abcd1234',
};

/** A fake sync service: routes by path, records calls. */
function fakeService(overrides = {}) {
  const calls = [];
  const routes = {
    'shared/sync.json': () => [200, { url: BASE }],
    '/v1/login': (init) => (JSON.parse(init.body).passphrase === 'kennebec'
      ? [200, { session: SESSION, displayKey: KEY, pusher: { key: 'pk', cluster: 'us2' }, state: STATE }]
      : [401, { reason: 'wrong', triesLeft: 4 }]),
    '/v1/state': () => [200, STATE],
    ...overrides,
  };
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const route = Object.keys(routes).find((r) => String(url).endsWith(r));
    if (!route) return new Response('{}', { status: 404 });
    const [status, body] = routes[route](init);
    return new Response(JSON.stringify(body), { status });
  });
  return calls;
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  localStorage.clear();
  resetConfig();
  _resetSyncForTest();
});
afterEach(() => { globalThis.fetch = realFetch; });

function Driver({ onSlides }) {
  const handlers = { onSettings: receiveSharedSettings, onSlides };
  useSyncDriver({ handlers, dispatch: dispatchEvent });
  return null;
}

describe('signing in with the passphrase', () => {
  it('"kennebec" applies the template and the shared settings, and ignores the Pusher keys the service still sends', async () => {
    fakeService();
    const onSlides = vi.fn();
    render(<Driver onSlides={onSlides} />);
    const { result } = renderHook(() => useConfig());
    let res;
    await act(async () => {
      res = await signIn('kennebec', { config: result.current.config, overrides: result.current.overrides, updateConfig: result.current.updateConfig });
    });
    expect(res).toMatchObject({ ok: true });
    expect(loadSyncSession()).toBe(SESSION);
    expect('pusherAppKey' in result.current.config).toBe(false);
    expect(result.current.config.audioMuted).toBe(true);
    // Through the same sanitizers a live frame takes.
    expect(result.current.shared).toMatchObject({ rev: 7, settings: { checkoutBoardNamesAbove: 7 } });
    expect(result.current.config.checkoutBoardNamesAbove).toBe(7);
    expect(onSlides).toHaveBeenCalledWith(expect.objectContaining({ deckRev: 3, slides: [expect.objectContaining({ text: 'Store next week' })] }), undefined);
  });

  it('the template never overrides what this screen already chose', async () => {
    fakeService();
    render(<Driver onSlides={vi.fn()} />);
    const { result } = renderHook(() => useConfig());
    act(() => { result.current.updateConfig({ audioMuted: false }); });
    await act(async () => {
      await signIn('kennebec', { config: result.current.config, overrides: result.current.overrides, updateConfig: result.current.updateConfig });
    });
    expect(result.current.config.audioMuted).toBe(false);
  });
});

describe('staying in sync', () => {
  it('a signed-in screen fetches the state when it starts', async () => {
    saveSyncSession(SESSION);
    _resetSyncForTest();
    const calls = fakeService();
    render(<Driver onSlides={vi.fn()} />);
    const { result } = renderHook(() => useConfig());
    await waitFor(() => expect(result.current.shared?.rev).toBe(7));
    const state = calls.find((c) => c.url.endsWith('/v1/state'));
    expect(state.init.headers.Authorization).toBe(`Bearer ${SESSION}`);
  });

  it('a 401 means the passphrase changed: the session goes and the screen says so', async () => {
    saveSyncSession(SESSION);
    _resetSyncForTest();
    fakeService({ '/v1/state': () => [401, { reason: 'signed-out' }] });
    const { result } = renderHook(() => useSync());
    render(<Driver onSlides={vi.fn()} />);
    await waitFor(() => expect(result.current.phase).toBe('expired'));
    expect(result.current.signedIn).toBe(false);
    expect(loadSyncSession()).toBe('');
  });

  it('the template doorbell refetches; an unknown one does nothing', async () => {
    saveSyncSession(SESSION);
    _resetSyncForTest();
    const calls = fakeService();
    render(<Driver onSlides={vi.fn()} />);
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith('/v1/state'))).toHaveLength(1));
    await act(async () => { ringSyncDoorbell({ what: 'nonsense' }); ringSyncDoorbell('junk'); });
    expect(calls.filter((c) => c.url.endsWith('/v1/state'))).toHaveLength(1);
    await act(async () => { ringSyncDoorbell({ what: 'template' }); await syncNow(); });
    expect(calls.filter((c) => c.url.endsWith('/v1/state')).length).toBeGreaterThanOrEqual(2);
  });
});

describe('the passphrase box', () => {
  it('signs in, and says how many tries are left after a wrong word', async () => {
    fakeService();
    render(<><Driver onSlides={vi.fn()} /><SyncSignInField secure /></>);
    const box = screen.getByLabelText('Passphrase');
    fireEvent.change(box, { target: { value: 'kenebec' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in' })); });
    expect(await screen.findByText(/4 tries left/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'Kennebec' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in' })); });
    expect(await screen.findByText(/signed in · key abcd1234/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });
});

describe('the calendar from the sync service', () => {
  const FEED = {
    version: 1,
    generatedAt: new Date().toISOString(),
    checkedAt: new Date().toISOString(),
    events: [{ date: '2026-10-07', kind: 'club', title: 'Awana meeting', isCancelled: false, isSpecial: false }],
  };

  it('comes first, and Refresh signed in asks the service to read the church page', async () => {
    saveSyncSession(SESSION);
    _resetSyncForTest();
    const calls = fakeService({
      '/v1/calendar': () => [200, FEED],
      '/v1/calendar/refresh': () => [200, { changed: true, generatedAt: FEED.generatedAt, checkedAt: FEED.checkedAt }],
    });
    const { result } = renderHook(() => useCalendar({ calendarEnabled: true, calendarUrl: '' }));
    await waitFor(() => expect(result.current.source).toBe('sync'));
    expect(result.current.events).toHaveLength(1);
    let out;
    await act(async () => { out = await result.current.refresh(); });
    expect(out).toMatchObject({ ok: true, changed: true, viaSync: true, source: 'sync' });
    expect(calls.some((c) => c.url.endsWith('/v1/calendar/refresh') && c.init.method === 'POST')).toBe(true);
  });

  it('Refresh says what went wrong instead of doing nothing', async () => {
    saveSyncSession(SESSION);
    _resetSyncForTest();
    fakeService({
      '/v1/calendar': () => [200, FEED],
      '/v1/calendar/refresh': () => [502, { error: 'Only 2 club nights were found.' }],
    });
    const { result } = renderHook(() => useCalendar({ calendarEnabled: true, calendarUrl: '' }));
    await waitFor(() => expect(result.current.source).toBe('sync'));
    let out;
    await act(async () => { out = await result.current.refresh(); });
    expect(out).toMatchObject({ ok: false, message: 'Only 2 club nights were found.' });
  });
});

describe('Setup: Test TwoTimTwo sign-in', () => {
  it('is only offered on a signed-in screen', () => {
    fakeService();
    const { container } = render(<CloudCheckinTestField />);
    expect(container.innerHTML).toBe('');
  });

  it('asks the service for one read and says what it found', async () => {
    const calls = fakeService({
      '/v1/cloud/read-now': (init) => [200, JSON.parse(init.body).test === true
        ? { ok: true, test: { ok: true, date: '2026-10-07', checkedIn: 3, partial: false, checkinPage: { ok: true, calendarId: '368', events: 2 } }, status: {} }
        : { ok: false, error: 'wrong-route', status: {} }],
    });
    saveSyncSession(SESSION);
    _resetSyncForTest();
    const view = within(render(<CloudCheckinTestField />).container);
    fireEvent.click(view.getByRole('button', { name: 'Test TwoTimTwo sign-in' }));
    await waitFor(() => expect(view.getByRole('status').textContent).toContain('read the report for Wednesday, Oct 7: 3 children checked in'));
    const call = calls.find((c) => c.url.endsWith('/v1/cloud/read-now'));
    expect(call.init.method).toBe('POST');
    expect(call.init.headers.Authorization).toBe(`Bearer ${SESSION}`);
  });

  it('a refused password is shown as a warning', async () => {
    fakeService({ '/v1/cloud/read-now': () => [200, { ok: false, test: { ok: false, date: '2026-10-07', error: 'login-refused' }, status: {} }] });
    saveSyncSession(SESSION);
    _resetSyncForTest();
    const view = within(render(<CloudCheckinTestField />).container);
    fireEvent.click(view.getByRole('button', { name: 'Test TwoTimTwo sign-in' }));
    await waitFor(() => expect(view.getByRole('status').querySelector('.hint--warn')?.textContent).toContain('refused the user name or password'));
  });
});

describe('Setup: BARF Night', () => {
  it('shows tonight\'s list grouped by club', async () => {
    fakeService({ '/v1/cloud/friends': () => [200, { date: '2026-10-14', total: 2, clubs: [
      { club: 'Sparks', kids: [{ name: 'Kit Tester', friend: 'Maya' }] },
      { club: 'Trek', kids: [{ name: 'Al Tester', friend: '' }] },
    ] }] });
    saveSyncSession(SESSION);
    _resetSyncForTest();
    const view = within(render(<FriendsListField />).container);
    fireEvent.click(view.getByRole('button', { name: 'Show tonight’s list' }));
    await waitFor(() => expect(view.getByRole('status').textContent).toContain('2 children brought a friend tonight.'));
    expect(view.getByRole('status').textContent).toContain('Kit Tester: brought Maya');
    expect(view.getByRole('status').textContent).toContain('Al Tester: friend’s name not given');
  });

  it('asks before printing the BARF Bag labels, then says what went', async () => {
    const calls = fakeService({ '/v1/cloud/barf-bags': () => [200, { ok: true, labels: 3, kids: 2, friends: 1, unnamed: 1, date: '2026-10-14' }] });
    saveSyncSession(SESSION);
    _resetSyncForTest();
    const confirm = vi.spyOn(window, 'confirm');
    confirm.mockReturnValueOnce(false);
    const view = within(render(<BarfBagsField />).container);
    fireEvent.click(view.getByRole('button', { name: 'Print BARF Bag labels' }));
    expect(calls.some((c) => c.url.endsWith('/v1/cloud/barf-bags'))).toBe(false);
    confirm.mockReturnValueOnce(true);
    fireEvent.click(view.getByRole('button', { name: 'Print BARF Bag labels' }));
    await waitFor(() => expect(view.getByRole('status').textContent).toContain('Sent 3 BARF Bag labels to the label printer as one job: 2 children and 1 friend.'));
    expect(view.getByRole('status').textContent).toContain('1 friend was checked in at TwoTimTwo’s desk box with no name');
    confirm.mockRestore();
  });
});
