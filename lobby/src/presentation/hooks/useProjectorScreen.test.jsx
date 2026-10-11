import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectorScreen } from './useProjectorScreen.js';
import { lowPowerPreference, setLowPowerPreference } from './useLowPower.js';
import { setStingersEnabled, stingersEnabled } from '../lib/stingers.js';
import { _resetThisScreenForTest } from '../../hooks/useScreenSync.js';
import { _resetSyncForTest, ringSyncDoorbell } from '../../hooks/useSync.js';
import { saveSyncSession } from '../../lib/syncService.js';
import { loadScreenSlot } from '../../lib/screenSync.js';

// The projector managed from /settings: its two switches are its layer, and
// a wall pick or Resume from /settings reaches the same handlers as the menu.

const BASE = 'https://awana-sync.example.workers.dev';
const SESSION = 'v1.1.1790839331729.oWr6n92IJW5ldPGmtiyjPHAZpca-QGToNlKGXlKI6vc';

function fakeWorker() {
  const w = { puts: [], settings: null };
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    const ok = (b) => new Response(JSON.stringify(b), { status: 200 });
    if (u.endsWith('shared/sync.json')) return ok({ url: BASE });
    if (u.endsWith('/v1/screens/hello')) return ok({ screen: { id: body.id, name: 'Gym projector' }, settings: w.settings });
    if (u.endsWith('/settings') && init.method === 'PUT') {
      w.puts.push(body.settings);
      w.settings = { savedAt: `2026-10-11T18:00:0${w.puts.length}.000Z`, settings: body.settings };
      return ok(w.settings);
    }
    if (u.endsWith('/settings')) return ok({ screen: { name: 'Gym projector' }, settings: w.settings });
    return new Response('{}', { status: 404 });
  });
  return w;
}

function Projector({ onAction = () => {} }) {
  useProjectorScreen({ enabled: true, onAction });
  return null;
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  localStorage.clear();
  setLowPowerPreference(false);
  setStingersEnabled(false);
  saveSyncSession(SESSION);
  _resetSyncForTest();
  _resetThisScreenForTest();
});
afterEach(() => { cleanup(); globalThis.fetch = realFetch; });

describe('the projector managed from /settings', () => {
  it('registers, sends both switches up, and takes a change made on /settings', async () => {
    const w = fakeWorker();
    render(<Projector />);
    await waitFor(() => expect(w.puts).toEqual([{ lowPower: false, stingers: false }]));
    w.settings = { savedAt: '2026-10-11T19:00:00.000Z', settings: { lowPower: true } };
    await act(async () => { ringSyncDoorbell({ what: 'screen', id: loadScreenSlot('projector').id }); });
    await waitFor(() => expect(lowPowerPreference()).toBe(true));
    expect(stingersEnabled()).toBe(false);
  });

  it('passes a wall pick and Resume to the menu\'s own handlers, its own id only', async () => {
    fakeWorker();
    const onAction = vi.fn();
    render(<Projector onAction={onAction} />);
    await waitFor(() => expect(loadScreenSlot('projector')?.synced).toBeTruthy());
    const id = loadScreenSlot('projector').id;
    act(() => {
      ringSyncDoorbell({ what: 'screen-action', id, action: 'select', data: { type: 'window', index: 2 } });
      ringSyncDoorbell({ what: 'screen-action', id, action: 'select', data: { type: 'window', index: 'x' } });
      ringSyncDoorbell({ what: 'screen-action', id: 'tv_aaaaaaaaaaaaaaaaaaaa', action: 'resume' });
      ringSyncDoorbell({ what: 'screen-action', id, action: 'resume' });
    });
    expect(onAction.mock.calls).toEqual([['select', { type: 'window', index: 2 }], ['resume', undefined]]);
  });
});
