import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';

// ORDERING UNDER ASYNC DECRYPT — its own file because it needs the envelope
// module mocked, which is module-wide.
//
// Why this exists as a separate, deliberately artificial test: sealing made the
// name events async. `crypto.subtle.decrypt` returns a promise inside what
// pusher-js calls as a SYNCHRONOUS handler, so ten children arriving in a burst
// become ten in-flight decrypts. If they are dispatched as they resolve rather
// than in arrival order, the lobby wall greets the wrong child first — a bug
// nobody would reproduce at a desk and everybody would notice at 6:05pm.
//
// A test against real WebCrypto CANNOT catch this: in practice those decrypts
// resolve in submission order, so removing the per-event promise chain leaves
// such a test passing. I verified exactly that before writing this file. So the
// latency is injected here instead — the first frame decrypts slowly, the rest
// instantly, which is precisely the interleaving the chain exists to prevent.

/** Per-name artificial decrypt latency, in ms. */
let latency = {};
/** Names whose decrypt should THROW rather than resolve. */
let throwFor = new Set();
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

vi.mock('../lib/envelope.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    // A frame here is { __name } rather than real ciphertext — this test is
    // about the scheduling, and the real crypto is covered in envelope.test.js.
    importDisplayKey: async () => ({ key: 'fake', kid: 'deadbeef' }),
    isEnvelope: (p) => Boolean(p && typeof p === 'object' && p.__sealed),
    openEnvelope: async (_key, _event, frame) => {
      const wait = latency[frame.__name] ?? 0;
      if (wait) await new Promise((r) => setTimeout(r, wait));
      if (throwFor.has(frame.__name)) throw new Error('decrypt exploded');
      return { ok: true, payload: { firstName: frame.__name, club: 'Sparks' } };
    },
  };
});

const { useSocket } = await import('./useSocket.js');
const cfg = await import('./useConfig.js');
const { saveDisplayKey } = await import('../lib/displayKey.js');

beforeEach(() => {
  bound = {};
  latency = {};
  throwFor = new Set();
  localStorage.clear();
  cfg._resetForTest(); // one config store per page — start each case clean
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); /* no global RTL cleanup in this repo — hooks share one config store */ vi.restoreAllMocks(); });

describe('arrival order survives out-of-order decrypts', () => {
  it('greets children in the order they arrived, not the order they decrypted', async () => {
    saveDisplayKey('AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=');
    localStorage.setItem('awanaConfig.v1', JSON.stringify({
      pusherAppKey: 'k', pusherCluster: 'us2',
    }));
    const seen = [];
    const { result } = renderHook(() => useSocket({ onCheckin: (c) => seen.push(c.firstName) }));
    await waitFor(() => expect(bound.checkin).toBeTypeOf('function'));
    await waitFor(() => expect(result.current.hasDisplayKey).toBe(true));

    // Ann's decrypt takes 60ms; everyone behind her is instant. Without the
    // per-event chain, Ann is greeted LAST despite arriving first.
    const names = ['Ann', 'Ben', 'Cara', 'Dan', 'Eve'];
    latency = { Ann: 60 };

    await act(async () => {
      for (const n of names) bound.checkin({ __sealed: true, __name: n });
      await new Promise((r) => setTimeout(r, 200));
    });

    await waitFor(() => expect(seen).toHaveLength(names.length));
    expect(seen).toEqual(names);
  });

  it('a failed decrypt does not stall every later frame of that event', async () => {
    saveDisplayKey('AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=');
    localStorage.setItem('awanaConfig.v1', JSON.stringify({
      pusherAppKey: 'k', pusherCluster: 'us2',
    }));
    const seen = [];
    const { result } = renderHook(() => useSocket({ onCheckin: (c) => seen.push(c.firstName) }));
    await waitFor(() => expect(bound.checkin).toBeTypeOf('function'));
    await waitFor(() => expect(result.current.hasDisplayKey).toBe(true));

    // The chain is one long promise per event, so a THROW inside it would poison
    // the chain and silently kill every later check-in for the rest of the
    // night. The .catch() in useSocket is what prevents that; this proves it.
    throwFor = new Set(['Poison']);

    await act(async () => {
      bound.checkin({ __sealed: true, __name: 'Poison' });
      await new Promise((r) => setTimeout(r, 20));
      bound.checkin({ __sealed: true, __name: 'After' });
      await new Promise((r) => setTimeout(r, 20));
    });

    await waitFor(() => expect(seen).toEqual(['After']));
  });
});
