import { useCallback, useEffect, useRef, useState } from 'react';
import Pusher from 'pusher-js';
import { useConfig } from './useConfig.js';
import { useDisplayKey } from './useDisplayKey.js';
import {
  ENCRYPTED_EVENTS,
  importDisplayKey,
  isEnvelope,
  openEnvelope,
} from '../lib/envelope.js';
import {
  PROVISION_CHANNEL,
  PROVISION_EVENT,
  noteCacheMiss,
  receiveProvisionFrame,
} from '../lib/displayLogin.js';
import { SYNC_CHANNEL, SYNC_EVENT, loadSyncSession } from '../lib/syncService.js';
import { ringSyncDoorbell, syncNow, useSync } from './useSync.js';
import {
  sanitizeBirthdays,
  sanitizeCanary,
  sanitizeCheckin,
  sanitizeCheckout,
  sanitizeNotice,
  sanitizeOps,
  sanitizePoints,
  sanitizeRecap,
  sanitizeSchedule,
  sanitizeSettings,
  sanitizeSlidesChunk,
  sanitizeTally,
  sanitizeTonight,
} from '../lib/eventSanitizers.js';

// PRIVACY INVARIANT — DO NOT relax. Every event type on the channel is
// bound through its own strict allowlist sanitizer from
// src/lib/eventSanitizers.js, so allergy/PII data can never reach the
// screen no matter what the producer (or an attacker with the publish
// key) sends. Payload shapes are pinned by the mirrored contract
// vectors — see CONTRACT.md.
const EVENT_SANITIZERS = {
  checkin: sanitizeCheckin,
  recap: sanitizeRecap,
  checkout: sanitizeCheckout,
  tally: sanitizeTally,
  birthdays: sanitizeBirthdays,
  ops: sanitizeOps,
  canary: sanitizeCanary,
  tonight: sanitizeTonight,
  points: sanitizePoints,
  schedule: sanitizeSchedule,
  notice: sanitizeNotice,
  slides: sanitizeSlidesChunk,
  settings: sanitizeSettings,
};

/**
 * The three events whose payloads carry a child's name arrive SEALED — see
 * src/lib/envelope.js for why and for the framing. Everything about the
 * decryption lives in this file and nowhere else, and it sits strictly IN FRONT
 * of `dispatchEvent`, never beside it, so an opened payload still passes its own
 * allowlist sanitizer exactly as a plaintext one does. `eventSanitizers.js` is
 * deliberately untouched by this change.
 */
const SEALED = new Set(ENCRYPTED_EVENTS);

/** The live channel's keep-alive, and its reconnect backoff in seconds. */
const LIVE_PING_MS = 25 * 1000;
const LIVE_BACKOFF_SEC = [1, 2, 5, 10, 30];
/**
 * Liveness. A socket that has heard nothing (no frame, no pong) for this long
 * is dead whatever its readyState says: after a Wi-Fi roam, a router reboot or
 * a NAT drop the TCP side can stay half-open for many minutes, with every ping
 * sent into a buffer and the screen reading "connected" while check-ins go
 * missing. Pusher-js carried its own activity timeout; this is the live
 * channel's. Two ping periods plus a margin, so one lost pong is forgiven.
 * And a socket that has not opened within LIVE_CONNECT_MS is dropped the same
 * way, rather than sitting in CONNECTING for the browser's own long timeout.
 */
const LIVE_DEAD_MS = 2 * LIVE_PING_MS + 10 * 1000;
const LIVE_CONNECT_MS = 10 * 1000;

/** Consecutive decrypt failures before a screen admits it cannot read names. */
const UNREADABLE_AFTER = 2;

// Handler-prop name for each wire event ('checkin' → onCheckin, …).
const HANDLER_NAMES = {
  checkin: 'onCheckin',
  recap: 'onRecap',
  checkout: 'onCheckout',
  tally: 'onTally',
  birthdays: 'onBirthdays',
  ops: 'onOps',
  canary: 'onCanary',
  tonight: 'onTonight',
  points: 'onPoints',
  schedule: 'onSchedule',
  notice: 'onNotice',
  slides: 'onSlides',
  settings: 'onSettings',
};

/**
 * Subscribes to `awana-channel` and forwards each event type to its
 * handler after sanitizing:
 *
 *   useSocket({ onCheckin, onRecap, onTally, onBirthdays, onOps, onCanary,
 *              onTonight, onPoints, onSchedule, onNotice })
 *
 * A bare function is accepted as shorthand for `{ onCheckin }`.
 * Returns { status, lastEventAt, lastCheckinAt, retry }.
 * `retry` is { attempts, delaySec } while the pipe is down (pusher-js
 * announces each backoff via its 'connecting_in' event), null otherwise
 * — so the Signal sticker can say "retrying in ~Ns" instead of a bare
 * "disconnected".
 */
export function useSocket(handlers) {
  const { config } = useConfig();
  const { pusherAppKey, pusherCluster } = config;
  const { displayKey } = useDisplayKey();
  const enabled = Boolean(pusherAppKey && pusherCluster);
  // Signed in to the sync service, the screen listens on ITS live channel
  // instead of Pusher (the one-site move, step 3): only signed-in screens can
  // listen there, so arrival timing and headcount stop being public.
  const sync = useSync();
  const live = Boolean(sync.url && sync.signedIn);
  // A signed-in screen waits the moment it takes to read shared/sync.json
  // rather than open Pusher only to drop it.
  const resolving = sync.signedIn && sync.url === null;
  const active = enabled || live;
  const [socketStatus, setSocketStatus] = useState('connecting');
  const [lastEventAt, setLastEventAt] = useState(null);
  const [lastCheckinAt, setLastCheckinAt] = useState(null);
  const [retry, setRetry] = useState(null);
  const handlersRef = useRef(handlers);
  useEffect(() => { handlersRef.current = handlers; }, [handlers]);

  // ── Name readability ───────────────────────────────────────────────────────
  // A screen that simply stops showing banners is indistinguishable from a quiet
  // night, which is the single worst outcome of this whole change. So the socket
  // reports WHY names are missing, and App.jsx forces that onto the screen
  // regardless of the showConnectionStatus setting.
  //   'ok'          names are arriving and opening
  //   'no-key'      sealed frames are arriving but this screen has no key
  //   'bad-key'     sealed frames arrive and will not open (wrong/rotated key)
  //   'downgraded'  PLAINTEXT names arrived while a key is configured — refused
  const [nameStatus, setNameStatus] = useState('ok');
  // The synced slide deck rides the same sealed transport but must NEVER move
  // the name-readability needle: `slides` frames arrive as a weekly-scale
  // heartbeat too, and a keyless screen quietly skipping slide sync is normal,
  // not the "cannot read names" emergency the wall sticker exists for. So it
  // gets its own status, surfaced only in Settings:
  //   'idle'                no sealed slides frame seen yet
  //   'ok'                  the last slides frame opened
  //   'no-key'/'bad-key'    frames arrive but cannot be opened here
  //   'refused-plaintext'   a plaintext slides frame was refused (anti-downgrade)
  const [slidesStatus, setSlidesStatus] = useState('idle');
  const keyRef = useRef(null);
  const failuresRef = useRef(0);
  // One promise chain per sealed event. crypto.subtle.decrypt is async inside
  // what Pusher calls as a synchronous handler, so without this two check-ins
  // arriving milliseconds apart could resolve out of order and greet the second
  // child first. Chaining costs nothing at this volume and removes the whole
  // class of bug.
  const chainsRef = useRef({});

  useEffect(() => {
    let cancelled = false;
    failuresRef.current = 0;
    // Clear the ref synchronously so a frame arriving in the microtask gap
    // below is never opened with the PREVIOUS key.
    keyRef.current = null;
    (displayKey ? importDisplayKey(displayKey) : Promise.resolve(null)).then((imported) => {
      if (cancelled) return;
      keyRef.current = imported;
      if (displayKey && !imported) {
        console.error('[socket] The display key on this screen is not usable — names will not appear');
        setNameStatus('bad-key');
        setSlidesStatus('bad-key');
      } else {
        // A key change (fixed, replaced, or removed) resets the slide-sync
        // verdict too: slides frames are sparse (publish + 5-minute
        // heartbeat), so a stale 'bad-key' would keep telling the operator
        // to re-paste the key they just fixed until the next frame arrives.
        setSlidesStatus('idle');
        // No key is not an error yet: until the publisher starts sealing, this is
        // the normal state and plaintext is accepted. It only becomes visible
        // when a sealed frame actually shows up and cannot be opened.
        setNameStatus('ok');
      }
    });
    return () => { cancelled = true; };
  }, [displayKey]);

  // One handler per contract event, the same whichever transport carries it
  // (Pusher, or the sync Worker's live channel): decryption sits in front of
  // dispatchEvent, never beside it. Everything it touches is a ref or a state
  // setter, so it is built once.
  const bindEvents = useCallback((/** @type {(event: string, fn: (frame: any) => void) => void} */ bind) => {
    // Bind every contract event. The sanitizing + handler lookup lives in
    // dispatchEvent so the debug panel's simulated events use the identical
    // path — see simulateEvent below.
    const accept = (event, payload) => {
      const safe = dispatchEvent(event, payload, handlersRef.current);
      if (!safe) return;
      setLastEventAt(Date.now());
      if (event === 'checkin') setLastCheckinAt(Date.now());
    };

    for (const event of Object.keys(EVENT_SANITIZERS)) {
      if (!SEALED.has(event)) {
        bind(event, (payload) => accept(event, payload));
        continue;
      }

      bind(event, (frame) => {
        // ANTI-DOWNGRADE. Once this screen holds a key, a PLAINTEXT payload on a
        // name-bearing event is refused. Without this the encryption would be
        // decorative: anyone able to publish could simply send unsealed frames
        // and the screen would render them. (Publishing needs the Pusher app
        // SECRET, not the public app key, so this is defence in depth rather
        // than the only lock — but it is the lock that belongs on the consumer.)
        if (keyRef.current && !isEnvelope(frame)) {
          console.error(
            `[socket] REFUSED a plaintext '${event}' — this screen has a display key, so sealed events must arrive sealed`);
          // Refused slides mean a rollout-mode publisher, not unreadable
          // names — keep the wall sticker for the events it was built for.
          if (event === 'slides') setSlidesStatus('refused-plaintext');
          else if (event !== 'settings') setNameStatus('downgraded');
          return;
        }

        // No key configured: accept plaintext exactly as before. This is what
        // makes the rollout safe in either order — a screen that has not been
        // keyed yet keeps working against an unsealed publisher.
        if (!isEnvelope(frame)) {
          accept(event, frame);
          return;
        }

        const prev = chainsRef.current[event] || Promise.resolve();
        chainsRef.current[event] = prev
          .then(async () => {
            const result = await openEnvelope(keyRef.current, event, frame);
            if (result.ok) {
              if (event === 'slides') {
                setSlidesStatus('ok');
              } else if (event !== 'settings') {
                failuresRef.current = 0;
                setNameStatus('ok');
              }
              accept(event, result.payload);
              return;
            }
            if (event === 'settings') {
              // Shared settings are operator copy, not names: a frame this
              // screen cannot open changes nothing on the wall.
              console.warn(`[socket] Could not open 'settings': ${result.reason}`);
              return;
            }
            if (event === 'slides') {
              // Slides frames are sparse (publish + 5-minute heartbeat), so a
              // consecutive-failure counter would take ages to trip; this only
              // drives a Settings status row, never the public wall sticker.
              setSlidesStatus(result.reason === 'no-key' ? 'no-key' : 'bad-key');
              console.warn(`[socket] Could not open 'slides': ${result.reason}`);
              return;
            }
            // Count consecutive failures rather than reacting to one: a single
            // corrupt frame on a flaky TV Wi-Fi must not put a scary sticker on
            // the wall mid-service.
            failuresRef.current += 1;
            if (failuresRef.current >= UNREADABLE_AFTER) {
              setNameStatus(result.reason === 'no-key' ? 'no-key' : 'bad-key');
            }
            console.warn(`[socket] Could not open '${event}': ${result.reason}`);
          })
          // A throw here would poison the chain and silently stop every later
          // frame of this event for the rest of the night.
          .catch((err) => { console.error(`[socket] decrypt chain error on '${event}'`, err); });
      });
    }
  }, []);

  useEffect(() => {
    if (!enabled || live || resolving) return undefined;
    const pusher = new Pusher(pusherAppKey, { cluster: pusherCluster });
    const map = { initialized: 'connecting', connecting: 'connecting', connected: 'connected', unavailable: 'disconnected', failed: 'disconnected', disconnected: 'disconnected' };
    const onStateChange = ({ current }) => {
      setSocketStatus(map[current] || 'disconnected');
      if (current === 'connected') setRetry(null);
    };
    const onConnectingIn = (delaySec) => {
      setRetry((prev) => ({
        attempts: (prev?.attempts ?? 0) + 1,
        delaySec: Number.isFinite(delaySec) ? Math.round(delaySec) : null,
      }));
    };
    pusher.connection.bind('state_change', onStateChange);
    pusher.connection.bind('connecting_in', onConnectingIn);
    const channel = pusher.subscribe('awana-channel');
    channel.bind('pusher:subscription_error', (err) => {
      console.error('Pusher subscription failed:', err);
      setSocketStatus('disconnected');
    });

    // DEVICE PROVISIONING, NOT DISPLAY DATA. The print server publishes the
    // display key + publish token, sealed under a passphrase-derived key, on a
    // separate CACHE channel (a new subscriber gets the last frame at once).
    // Frames go to src/lib/displayLogin.js, which validates them strictly and
    // writes only into the displayKey/publishToken storage slots. Nothing from
    // this channel is ever sanitized-and-rendered, and it never reaches
    // dispatchEvent — it is not one of the contract events above. This is the
    // one file allowed to import pusher-js, which is why the subscription
    // lives here rather than in displayLogin.js.
    const provision = pusher.subscribe(PROVISION_CHANNEL);
    provision.bind(PROVISION_EVENT, (frame) => receiveProvisionFrame(frame));
    provision.bind('pusher:cache_miss', () => noteCacheMiss());

    // THE SYNC SERVICE'S DOORBELL, NOT DISPLAY DATA. The Worker (worker/)
    // rings `changed` {what} on its own channel when the calendar, the screen
    // template or Journey's settings change. It carries no content; the screen
    // fetches the change from the Worker, where it passes the same sanitizers.
    // Like `provision`, it never reaches dispatchEvent.
    const sync = pusher.subscribe(SYNC_CHANNEL);
    sync.bind(SYNC_EVENT, (payload) => ringSyncDoorbell(payload));

    bindEvents((event, fn) => channel.bind(event, fn));

    // When the TV wakes from sleep or the network returns, pusher-js can
    // take minutes to notice its socket is dead (activity-timeout + pong
    // cycle). Nudge it to reconnect immediately so the first kid through
    // the door still gets a banner.
    const nudge = () => {
      const state = pusher.connection.state;
      if (state === 'disconnected' || state === 'unavailable' || state === 'failed') {
        pusher.connect();
      }
    };
    const onVisible = () => { if (!document.hidden) nudge(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', nudge);
    window.addEventListener('focus', nudge);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', nudge);
      window.removeEventListener('focus', nudge);
      // Unbind before disconnecting so the dying connection's final
      // state events can't clobber the status of a replacement socket.
      pusher.connection.unbind('state_change', onStateChange);
      pusher.connection.unbind('connecting_in', onConnectingIn);
      channel.unbind_all();
      pusher.unsubscribe('awana-channel');
      provision.unbind_all();
      pusher.unsubscribe(PROVISION_CHANNEL);
      sync.unbind_all();
      pusher.unsubscribe(SYNC_CHANNEL);
      pusher.disconnect();
    };
  }, [enabled, live, resolving, pusherAppKey, pusherCluster, bindEvents]);

  // The sync Worker's live channel: one WebSocket, frames as {e, d}. A
  // keep-alive "ping" every LIVE_PING_MS (answered at the edge without waking
  // the Worker), and a backoff reconnect announced through `retry` exactly
  // as pusher-js's connecting_in was. A socket that never opens, or one closed
  // with 4001 (the passphrase was changed), asks the service whether this
  // sign-in still counts; if not, useSync drops it and this falls back.
  useEffect(() => {
    if (!live) return undefined;
    /** @type {Record<string, (frame: any) => void>} */
    const handlers = {};
    bindEvents((event, fn) => { handlers[event] = fn; });
    const base = String(sync.url).replace(/^http/, 'ws');
    /** @type {WebSocket | null} */
    let ws = null;
    let closed = false;
    let attempts = 0;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timer = null;
    /** @type {ReturnType<typeof setInterval> | null} */
    let ping = null;
    const open = () => {
      if (closed || ws) return;
      if (timer) { clearTimeout(timer); timer = null; }
      const session = loadSyncSession();
      if (!session) { setSocketStatus('disconnected'); return; }
      setSocketStatus('connecting');
      let opened = false;
      let lastRx = Date.now();
      const sock = new WebSocket(`${base}/v1/live?session=${encodeURIComponent(session)}`);
      ws = sock;
      // Our own verdict on a socket the browser still calls open (or still
      // connecting): detach it, close it, and take the close path ourselves,
      // because a half-open socket's close() may not report back for minutes.
      const drop = (why) => {
        if (ws !== sock) return;
        console.warn(`[live] ${why}; reconnecting`);
        sock.onopen = null; sock.onmessage = null; sock.onerror = null;
        const onclose = sock.onclose;
        sock.onclose = null;
        try { sock.close(4000, why); } catch { /* already gone */ }
        onclose?.({ code: 4000 });
      };
      const connectTimer = setTimeout(() => { if (!opened) drop('the live channel did not open in time'); }, LIVE_CONNECT_MS);
      sock.onopen = () => {
        opened = true;
        attempts = 0;
        lastRx = Date.now();
        setSocketStatus('connected');
        setRetry(null);
        ping = setInterval(() => {
          if (Date.now() - lastRx > LIVE_DEAD_MS) { drop('the live channel fell silent'); return; }
          try { sock.send('ping'); } catch { /* closing */ }
        }, LIVE_PING_MS);
      };
      sock.onmessage = (m) => {
        lastRx = Date.now();
        if (typeof m.data !== 'string' || m.data === 'pong') return;
        let frame;
        try { frame = JSON.parse(m.data); } catch { return; }
        if (!frame || typeof frame !== 'object' || typeof frame.e !== 'string') return;
        if (frame.e === SYNC_EVENT) { ringSyncDoorbell(frame.d); return; }
        const fn = Object.prototype.hasOwnProperty.call(handlers, frame.e) ? handlers[frame.e] : null;
        fn?.(frame.d);
      };
      sock.onclose = (ev) => {
        clearTimeout(connectTimer);
        if (ping) { clearInterval(ping); ping = null; }
        if (ws === sock) ws = null;
        if (closed) return;
        setSocketStatus('disconnected');
        if (ev.code === 4001 || !opened) syncNow();
        attempts += 1;
        const delaySec = LIVE_BACKOFF_SEC[Math.min(attempts, LIVE_BACKOFF_SEC.length) - 1];
        setRetry({ attempts, delaySec });
        timer = setTimeout(open, delaySec * 1000);
      };
    };
    open();
    // A TV waking from sleep, or the network coming back: try now, not at
    // the end of the backoff.
    const nudge = () => { if (!ws && !closed) { attempts = 0; open(); } };
    const onVisible = () => { if (!document.hidden) nudge(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', nudge);
    window.addEventListener('focus', nudge);
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      if (ping) clearInterval(ping);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', nudge);
      window.removeEventListener('focus', nudge);
      try { ws?.close(1000, 'bye'); } catch { /* already closed */ }
    };
  }, [live, sync.url, bindEvents]);

  // 'off' (not configured) is distinct from 'disconnected' (configured
  // but the pipe is down) so the UI can warn about the latter without
  // nagging brand-new installs.
  return {
    status: active ? socketStatus : 'off',
    lastEventAt,
    lastCheckinAt,
    retry: active && socketStatus !== 'connected' ? retry : null,
    // Independent of `status` on purpose: a screen can be perfectly connected,
    // showing a live clock, weather and climbing counts, and still be unable to
    // read a single name. Those are different faults with different fixes, so
    // they get different words on the wall.
    nameStatus: active ? nameStatus : 'ok',
    // Slide-sync readability, kept apart from nameStatus on purpose (see the
    // state's comment). Only Settings renders this.
    slidesStatus: active ? slidesStatus : 'idle',
    // Which pipe this screen listens on: 'live' (the sync Worker) or 'pusher'.
    transport: live ? 'live' : 'pusher',
    hasDisplayKey: Boolean(displayKey),
  };
}

// Historical export: the checkin sanitizer began life here and the
// privacy tests guard it under this name. It now lives with its five
// siblings in src/lib/eventSanitizers.js.
export { sanitizeCheckin as sanitize };

/**
 * Sanitize one wire payload and hand it to its bound handler.
 *
 * PRIVACY INVARIANT — this is the ONE dispatch path. The live Pusher binding
 * above calls it, and so does `simulateEvent()` below, so a simulated event is
 * filtered by exactly the same allowlist sanitizer as a real one. Before this
 * was factored out, the debug panel called the render handlers directly and
 * every simulated payload bypassed the privacy boundary entirely — the one
 * thing this app's docs insist is inviolable.
 *
 * Returns the sanitized payload, or null when the sanitizer rejected it.
 *
 * `meta` is IN-PROCESS ONLY and is never part of the wire payload. The live
 * Pusher binding above never passes it, so a handler can only ever see it from
 * a locally injected event. That is how Settings' "Preview a check-in" shows a
 * rehearsal banner without moving the public count: the fact that the event is
 * a rehearsal travels beside the payload, not inside it, where a producer (or
 * anyone able to publish) could set it and where the sanitizer would have to
 * grow a field that means nothing on the wire.
 *
 * @param {string} event Wire event name (a key of EVENT_SANITIZERS).
 * @param {unknown} payload Raw payload.
 * @param {*} handlers The handlers object (or bare checkin function).
 * @param {{countsTowardTally?: boolean}} [meta] Local-only delivery hints.
 * @returns {object|null}
 */
export function dispatchEvent(event, payload, handlers, meta) {
  const sanitizeEvent = EVENT_SANITIZERS[event];
  if (!sanitizeEvent) {
    console.warn(`[socket] Ignoring unknown event '${event}'`);
    return null;
  }
  const safe = sanitizeEvent(payload);
  if (!safe) return null;
  const fn = typeof handlers === 'function'
    ? (event === 'checkin' ? handlers : null)
    : handlers?.[HANDLER_NAMES[event]];
  fn?.(safe, meta);
  return safe;
}

/**
 * Inject a simulated event — the debug panel's only route to the screen.
 *
 * Goes through `dispatchEvent`, so a malformed fake payload is dropped exactly
 * as a malformed real one would be. That makes the debug panel double as a live
 * contract check: if a simulator's shape drifts from the sanitizer's allowlist,
 * pressing the button visibly does nothing instead of rendering something the
 * wire could never actually deliver.
 *
 * Logs rejections, because "I pressed the button and nothing happened" is
 * otherwise indistinguishable from a broken screen.
 *
 * @param {string} event
 * @param {unknown} payload
 * @param {*} handlers
 * @param {{countsTowardTally?: boolean}} [meta] Local-only delivery hints.
 * @returns {boolean} true when the event reached its handler.
 */
export function simulateEvent(event, payload, handlers, meta) {
  const safe = dispatchEvent(event, payload, handlers, meta);
  if (!safe) {
    console.warn(
      `[debug] Simulated '${event}' was REJECTED by its sanitizer — the fake payload does not match the contract`,
      payload,
    );
    return false;
  }
  return true;
}

/** Event names the debug panel may simulate. */
export const SIMULATABLE_EVENTS = Object.keys(EVENT_SANITIZERS);
