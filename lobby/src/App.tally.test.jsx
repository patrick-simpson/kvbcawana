import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';

// TONIGHT COUNTER: the four ways it used to drift ABOVE the printer's number.
//
// These are deliberately whole-App tests rather than hook tests: every one of
// them is a collaboration between useSocket's dispatch, App's handleCheckIn /
// handleRecap and useTally's bump/sync, and each bug lived in the seam between
// two of them rather than inside any one. The printer's `tally` total is the
// source of truth; a local bump is only an optimistic tick.
//
// The assertion is on the PERSISTED count (`awanaTally.v1`) rather than the
// rendered chip: that is the same number a reload comes back to, and it does
// not depend on which widget mode the display happens to be in.

let bound = {};
vi.mock('pusher-js', () => ({
  default: class FakePusher {
    constructor() {
      this.connection = { state: 'connected', bind: () => {}, unbind: () => {} };
    }
    subscribe() { return { bind: (evt, fn) => { bound[evt] = fn; }, unbind_all: () => {} }; }
    unsubscribe() {}
    disconnect() {}
    connect() {}
  },
}));

const App = (await import('./App.jsx')).default;
const cfg = await import('./hooks/useConfig.js');

function todayKey(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function storedCount() {
  const raw = localStorage.getItem('awanaTally.v1');
  return raw ? JSON.parse(raw).count : 0;
}

async function mount() {
  await act(async () => { render(<App />); });
  await waitFor(() => expect(bound.checkin).toBeTypeOf('function'));
}

const kid = (over = {}) => ({
  firstName: 'Ann', club: 'Sparks', id: 'a1', at: Date.now(), ...over,
});

beforeEach(() => {
  bound = {};
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('awanaConfig.v1', JSON.stringify({
    pusherAppKey: 'k',
    pusherCluster: 'us2',
    // Confetti draws to a real canvas, which jsdom has no 2d context for, and
    // the first-arrival flourish would fire one on the very first check-in.
    confettiLevel: 'off',
    firstArrivalMoment: false,
  }));
  cfg._resetForTest();
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("tonight's counter never runs above the printer's total", () => {
  // O-1. Plaintext `tally` dispatches synchronously; sealed `checkin` goes
  // through an async decrypt chain. The printer publishes the check-in first
  // and the tally milliseconds later, so the display routinely adopts a total
  // that ALREADY counts the child and only then sees the check-in.
  it('a tally stamped after the check-in absorbs it instead of double counting', async () => {
    await mount();
    const t = Date.now();

    await act(async () => {
      bound.tally({ counts: { Sparks: 5 }, total: 5, at: t + 5 });
      bound.checkin(kid({ at: t }));
    });

    expect(storedCount()).toBe(5);
  });

  // The other order must still tick up instantly, which is the whole point of
  // keeping a local bump at all.
  it('a check-in ahead of any tally still ticks the counter up at once', async () => {
    await mount();
    const t = Date.now();

    await act(async () => { bound.checkin(kid({ at: t })); });
    expect(storedCount()).toBe(1);

    await act(async () => {
      bound.tally({ counts: { Sparks: 9 }, total: 9, at: t + 1000 });
    });
    expect(storedCount()).toBe(9);
  });

  // O-4. Two stations, or a recap racing the live event on a separate decrypt
  // chain, can deliver the same check-in twice. markSeen was called but never
  // consulted, so the second delivery counted a second child.
  it('the same check-in id delivered twice counts once', async () => {
    await mount();
    const payload = kid({ at: Date.now() });

    await act(async () => { bound.checkin(payload); });
    await act(async () => { bound.checkin({ ...payload }); });

    expect(storedCount()).toBe(1);
  });

  // O-3. The count lived in localStorage and the seen set in sessionStorage,
  // so a kiosk relaunch kept the number and forgot who it had already counted
  // and the next recap replayed the whole window back into the total.
  it('survives a kiosk relaunch: a recap of already-counted kids adds nothing', async () => {
    const t = Date.now() - 60 * 1000;
    const ids = ['a1', 'a2', 'a3'];
    // What the previous run left behind: three kids counted, three ids seen.
    localStorage.setItem('awanaTally.v1', JSON.stringify({ date: todayKey(), count: 3 }));
    localStorage.setItem('awanaSeenEvents.v1', JSON.stringify({
      date: todayKey(),
      entries: ids.map((id) => [id, t]),
    }));

    await mount();
    await act(async () => {
      bound.recap({
        entries: ids.map((id, i) => ({ firstName: `Kid${i}`, club: 'Sparks', id, at: t })),
        at: Date.now(),
      });
    });

    expect(storedCount()).toBe(3);
  });

  // A recap is aged against its own newest entry, never this screen's clock:
  // a TV twenty minutes fast used to discard every child a recap carried, and
  // one twenty minutes slow replayed a window it should not have.
  it('a recap from a printer whose clock is far off this screen\'s is still replayed', async () => {
    await mount();
    const fast = Date.now() + 25 * 60 * 1000;    // the printer's clock, 25 minutes ahead
    await act(async () => {
      bound.recap({
        entries: ['f1', 'f2', 'f3'].map((id, i) => ({ firstName: `Fast${i}`, club: 'Sparks', id, at: fast - i * 1000 })),
        at: fast,
      });
    });
    expect(storedCount()).toBe(3);
    const slow = Date.now() - 25 * 60 * 1000;    // or 25 minutes behind
    await act(async () => {
      bound.recap({
        entries: ['s1', 's2'].map((id, i) => ({ firstName: `Slow${i}`, club: 'Sparks', id, at: slow - i * 1000 })),
        at: slow,
      });
    });
    expect(storedCount()).toBe(5);
    // But an entry older than the window, measured against the recap's own newest, is left out.
    await act(async () => {
      bound.recap({
        entries: [
          { firstName: 'New', club: 'Sparks', id: 'n1', at: slow },
          { firstName: 'Old', club: 'Sparks', id: 'o1', at: slow - 40 * 60 * 1000 },
        ],
        at: slow,
      });
    });
    expect(storedCount()).toBe(6);
    // And a recap replayed from another night entirely greets nobody.
    const lastWeek = Date.now() - 7 * 24 * 60 * 60 * 1000;
    await act(async () => {
      bound.recap({ entries: [{ firstName: 'Ghost', club: 'Sparks', id: 'g1', at: lastWeek }], at: lastWeek });
    });
    expect(storedCount()).toBe(6);
  });

  // C-4. Settings → "Preview a check-in" is a rehearsal for the operator. It
  // must show the banner and mark the screen demo mode without touching the
  // number on the lobby wall.
  it('the Settings preview banner does not move the public count', async () => {
    await mount();
    await act(async () => { bound.checkin(kid({ at: Date.now() })); });
    expect(storedCount()).toBe(1);

    await act(async () => { screen.getByLabelText('Open settings').click(); });
    await act(async () => { screen.getByRole('tab', { name: 'Check-ins' }).click(); });
    await act(async () => { screen.getByText('Preview a check-in').click(); });

    // The rehearsal really happened...
    await waitFor(() => expect(document.querySelector('.demo-pill')).not.toBeNull());
    // ...and the count is still the one real child.
    expect(storedCount()).toBe(1);
  });
});
