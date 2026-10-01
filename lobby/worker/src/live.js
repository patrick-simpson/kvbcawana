// The live channel's rules (step 3 of the one-site move: the Worker carries
// what Pusher carried). Pure, so the tests can check every edge without a
// socket.
//
// WHAT CHANGES FOR PRIVACY: on Pusher anyone with the public app key could
// subscribe and see WHEN each child arrived and how many came (the names were
// already sealed). Here only a signed-in screen can open the channel, so the
// timing and the headcount stop being public too. What does NOT change: the
// sealed events stay sealed end to end (the laptop seals, the screen opens;
// the Worker only ever relays ciphertext, and refuses a plaintext one), and
// every frame still passes the screen's own allowlist sanitizer.

import { ENCRYPTED_EVENTS, isEnvelope } from '../../src/lib/envelope.js';

/** The contract's events (CONTRACT.md), and only those, may ride the channel. */
export const LIVE_EVENTS = Object.freeze([
  'checkin', 'recap', 'checkout', 'tally', 'birthdays', 'ops', 'canary',
  'tonight', 'points', 'schedule', 'notice', 'slides', 'settings',
]);
const LIVE = new Set(LIVE_EVENTS);
const SEALED = new Set(ENCRYPTED_EVENTS);

/**
 * The last frame of these is kept and handed to a screen the moment it
 * connects, the way the printer's rebroadcasts would within minutes. Never
 * `checkin` (a reconnecting screen would greet a child twice; `recap` exists
 * for catching up, and screens dedupe it by id), never `canary`/`ops` (they
 * describe a moment), and `slides` keeps every chunk of the latest deck.
 */
export const REPLAYED = Object.freeze([
  'recap', 'checkout', 'tally', 'birthdays', 'tonight', 'points', 'schedule', 'notice', 'settings',
]);

/** Pusher's per-message ceiling, kept so nothing the screens accept changes. */
export const LIVE_MAX_BYTES = 10240;

/** The doorbell for things screens fetch (calendar, template, Journey). */
export const DOORBELL_EVENT = 'changed';

/**
 * Check one publish. Returns the frame to broadcast, or an error to answer.
 * @param {unknown} body  the parsed request: {event, payload}
 * @returns {{ok: true, event: string, payload: unknown, text: string} | {ok: false, status: number, error: string}}
 */
export function checkPublish(body) {
  const b = /** @type {any} */ (body);
  const event = b && typeof b.event === 'string' ? b.event : '';
  if (!LIVE.has(event)) return { ok: false, status: 400, error: `"${event}" is not an event the screens take.` };
  if (b.payload === undefined || b.payload === null) return { ok: false, status: 400, error: 'No payload.' };
  // Defence in depth: the screens refuse a plaintext name-bearing frame once
  // they hold a key, and the relay refuses to carry one at all.
  if (SEALED.has(event) && !isEnvelope(b.payload)) {
    return { ok: false, status: 400, error: `"${event}" must be sealed.` };
  }
  const text = frameText(event, b.payload);
  if (new TextEncoder().encode(text).length > LIVE_MAX_BYTES) {
    return { ok: false, status: 413, error: 'That frame is too big for the live channel.' };
  }
  return { ok: true, event, payload: b.payload, text };
}

/** The wire form a screen receives: one JSON object per message. */
export function frameText(event, payload) {
  return JSON.stringify({ e: event, d: payload });
}

/** The storage key a replayed event's last frame lives under. */
export const replayKey = (event) => `live:${event}`;
