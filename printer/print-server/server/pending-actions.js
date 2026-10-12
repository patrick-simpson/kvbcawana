'use strict';
// Phone check-in queue.
// One of the modules server.js was split into (server.js loads them in the order the old
// file ran them). Another module's names are reached as $module.name.


// What other modules (and server.js) read from this one; live bindings, so cycles are safe.
Object.defineProperties(exports, {
  actionType: { enumerable: true, get: () => actionType },
  isOneShot: { enumerable: true, get: () => isOneShot },
  PENDING_CLAIM_MS: { enumerable: true, get: () => PENDING_CLAIM_MS },
  PENDING_TTL_MS: { enumerable: true, get: () => PENDING_TTL_MS },
  PENDING_WAITERS_MAX: { enumerable: true, get: () => PENDING_WAITERS_MAX },
  pendingActions: { enumerable: true, get: () => pendingActions },
  pendingFor: { enumerable: true, get: () => pendingFor },
  pendingWaiters: { enumerable: true, get: () => pendingWaiters, set: (v) => { pendingWaiters = v; } },
  prunePendingActions: { enumerable: true, get: () => prunePendingActions },
  wakePendingWaiters: { enumerable: true, get: () => wakePendingWaiters },
});

// ── Phone check-in queue (#17b) ───────────────────────────────────────────────
// A phone (through the sync Worker's relay) posts a check-in request; the extension (which has the
// authenticated TwoTimTwo session) long-polls for pending actions and drives
// the real check-in in the browser. The label then flows through the normal
// detection path — for a ROSTER kid the phone page never prints directly, so
// the existing dedup guarantees a single label. The two exceptions are
// deliberate and cannot double-print: a visitor label (POST /phone/visitor)
// is for a child with no TwoTimTwo row, whom roster-diff, reconcile and the
// last-check-in observer can therefore never see; a leader tag (POST
// /print-leader) is not a check-in at all.
let pendingActions = [];      // { id, type, name, at, status, detail } (type 'checkin' | 'undo')
let pendingWaiters = [];      // long-poll responders
const PENDING_MAX = 100;
const PENDING_WAITERS_MAX = 4;
const PENDING_TTL_MS = 10 * 60 * 1000;

// A claim is a lease. The extension claims an action before driving it, so a
// second tab (or the same tab's next poll) never drives the same child twice,
// and a claimed action is not handed out again; one that is never answered
// within PENDING_CLAIM_MS goes back to pending for the next poll to take.
const PENDING_CLAIM_MS = 90 * 1000;

// An undo (7.14.0) is never left waiting and never driven twice. One nobody
// picks up within UNDO_PICKUP_MS fails with the reason, so a phone that gave up
// is never contradicted by a laptop that undoes the child ten minutes later;
// a claimed one whose lease runs out fails too, because the post may already
// have reached TwoTimTwo and a second one would only read as a refusal.
const UNDO_PICKUP_MS = 60 * 1000;
const UNDO_NOT_PICKED_UP = 'The check-in laptop did not pick it up: no TwoTimTwo tab open there, or its extension is older than 7.14. Nothing was changed.';
const UNDO_NO_ANSWER = 'The check-in laptop started the undo but never reported back. Check TwoTimTwo\'s report before trying again.';
// A phone "Check out" (7.16.0) is driven exactly like an undo: one shot, never
// left waiting, never driven twice, and only a 7.16 extension takes one.
const CHECKOUT_NOT_PICKED_UP = 'The check-in laptop did not pick it up: no TwoTimTwo tab open there, or its extension is older than 7.16. Nothing was changed.';
const CHECKOUT_NO_ANSWER = 'The check-in laptop started the check-out but never reported back. Check TwoTimTwo before trying again.';
const actionType = (a) => (a && (a.type === 'undo' || a.type === 'checkout') ? a.type : 'checkin');
const isOneShot = (a) => actionType(a) !== 'checkin';

function prunePendingActions() {
  const now = Date.now();
  const cutoff = now - PENDING_TTL_MS;
  pendingActions = pendingActions.filter(a => new Date(a.at).getTime() >= cutoff).slice(-PENDING_MAX);
  for (const a of pendingActions) {
    if (isOneShot(a)) {
      const co = actionType(a) === 'checkout';
      if (a.status === 'pending' && now - new Date(a.at).getTime() > UNDO_PICKUP_MS) {
        a.status = 'failed';
        a.detail = co ? CHECKOUT_NOT_PICKED_UP : UNDO_NOT_PICKED_UP;
        console.warn(`[phone] ${co ? 'Check-out' : 'Undo'} for ${a.name}: nobody picked it up`);
      } else if (a.status === 'claimed' && now - a.claimedAt > PENDING_CLAIM_MS) {
        a.status = 'failed';
        a.detail = co ? CHECKOUT_NO_ANSWER : UNDO_NO_ANSWER;
        console.warn(`[phone] ${co ? 'Check-out' : 'Undo'} for ${a.name}: claimed, never answered`);
      }
      continue;
    }
    if (a.status === 'claimed' && now - a.claimedAt > PENDING_CLAIM_MS) {
      a.status = 'pending';
      delete a.claimedAt;
      console.warn(`[phone] ${a.name}: claim expired without a result, offered again`);
    }
  }
}

// What one poller is handed. An undo goes only to an extension that says it
// can do one (`?accept=undo`, 7.14.0): an older one would take it for a
// check-in, find no row for a child already in, and answer "Already checked
// in at this station" with ok:true, which here would read as a done undo.
// A check-out likewise only with `checkout` in the list (7.16.0).
function pendingFor(accept) {
  const kinds = new Set(String(accept || '').split(',').map(s => s.trim()));
  return pendingActions.filter(a => a.status === 'pending' && (actionType(a) === 'checkin' || kinds.has(actionType(a))));
}

function wakePendingWaiters() {
  const waiters = pendingWaiters.splice(0);
  waiters.forEach(w => {
    clearTimeout(w.timer);
    try { w.res.json({ actions: pendingFor(w.accept) }); } catch { /* client gone */ }
  });
}
