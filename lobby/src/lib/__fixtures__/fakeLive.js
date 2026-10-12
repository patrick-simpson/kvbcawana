// A stand-in for the sync Worker's live channel, for the tests that drive real
// frames through useSocket (and so through App). Shared so each test file does
// not carry its own copy; never imported by shipped code.
//
//   const live = fakeLive();           // installs a fake WebSocket + sync.json
//   beforeEach(() => { localStorage.clear(); live.reset(); live.signIn(); });
//   live.bound.checkin({ ... })        // delivers a `checkin` frame {e, d}
//
// `bound.<event>` is a function once the screen has opened its socket (so
// `waitFor(() => expect(bound.tonight).toBeTypeOf('function'))` still means
// "the socket is listening"), and undefined before. The fake socket opens by
// itself on the next tick after it is made and answers every ping with a pong, as
// the Worker does, so a test that runs the clock for minutes is not dropped as
// silent.
import { SYNC_URL_STORAGE, saveSyncSession } from '../syncService.js';
import { _resetSyncForTest } from '../../hooks/useSync.js';

export const LIVE_BASE = 'https://awana.kvbchurch.org/api';
export const LIVE_SESSION = 'v1.1.1790839331729.oWr6n92IJW5ldPGmtiyjPHAZpca-QGToNlKGXlKI6vc';

export function fakeLive() {
  /** @type {any[]} */
  const sockets = [];
  class FakeSocket {
    /** @param {string} url */
    constructor(url) {
      this.url = url;
      this.sent = [];
      this.closed = null;
      sockets.push(this);
      setTimeout(() => { if (this.closed === null) this.onopen?.(); }, 0);
    }
    /** @param {string} data */
    send(data) {
      this.sent.push(data);
      if (data === 'ping') this.onmessage?.({ data: 'pong' });
    }
    close(code = 1000) { this.closed = code; this.onclose?.({ code }); }
  }
  const current = () => sockets[sockets.length - 1];
  /** @param {string} e @param {unknown} d */
  const frame = (e, d) => current().onmessage({ data: JSON.stringify({ e, d }) });

  const bound = new Proxy(/** @type {Record<string, (d: unknown) => void>} */ ({}), {
    get(_t, evt) {
      if (typeof evt !== 'string' || !current()?.onmessage) return undefined;
      return (/** @type {unknown} */ d) => frame(evt, d);
    },
  });

  const realFetch = globalThis.fetch;
  const install = () => {
    globalThis.WebSocket = /** @type {any} */ (FakeSocket);
    globalThis.fetch = /** @type {any} */ (async (/** @type {any} */ url, /** @type {any} */ init) => {
      const u = String(url);
      if (u.endsWith('shared/sync.json')) return new Response(JSON.stringify({ url: LIVE_BASE }), { status: 200 });
      if (u.startsWith(LIVE_BASE)) return new Response('{}', { status: 503 });
      if (realFetch) return realFetch(url, init);
      throw new Error(`unexpected fetch ${u}`);
    });
  };
  install();

  return {
    sockets,
    bound,
    frame,
    /** Forget every socket (between tests). */
    reset: () => { sockets.length = 0; },
    /** This screen is not signed in to the sync service (the check-in laptop's own page). */
    signOut: () => {
      saveSyncSession('');
      _resetSyncForTest();
    },
    /** This screen has signed in to the sync service. Call after localStorage.clear(). */
    signIn: () => {
      // The address is cached too, so a test that stubs fetch to fail still finds the service.
      localStorage.setItem(SYNC_URL_STORAGE, LIVE_BASE);
      saveSyncSession(LIVE_SESSION);
      _resetSyncForTest();
    },
  };
}
