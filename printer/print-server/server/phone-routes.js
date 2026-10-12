'use strict';
// Phone check-in routes.
// One of the modules server.js was split into (server.js loads them in the order the old
// file ran them). Another module's names are reached as $module.name.

const lazy = require('./lazy');
const security = require('../security');
const tonightRules = require('../tonight');
const {
  REPORT_FRESH_MS, normalizedName, displayClub, splitFullName, historyIdentityKey, reportEntryIdentityKey,
  identityKeysOfRow, identityKeysOfReportEntry, distinctReportChildren, reportIsPartial, massUndoRefused,
} = tonightRules;
const crypto = require('crypto');
const $config = lazy('./config');
const $eventBuffer = lazy('./event-buffer');
const $clubbers = lazy('./clubbers');
const $ledger = lazy('./ledger');
const $tags = lazy('./tags');
const $pendingActions = lazy('./pending-actions');
const $http = lazy('./http');
const $checkinPrint = lazy('./checkin-print');
const $history = lazy('./history');
const $tonightCount = lazy('./tonight-count');
const $attendanceAudit = lazy('./attendance-audit');
const $feedRoutes = lazy('./feed-routes');
const $publishers = lazy('./publishers');
const app = $http.app;

// ── Phone check-in (#17b) ─────────────────────────────────────────────────────
// The phone page is awana.kvbchurch.org/checkin (site/build.mjs makes it from
// public/phone.html). The sync Worker answers most of it itself and relays the
// rest, from the phone-relay loop on THIS computer, to the /phone/* routes
// below: loopback callers, so no credential here. The Wi-Fi phone page
// (/phone, /phone/ym) and its PIN were retired on 2026-10-12 (Online only).

// Every identity key (id: and name:) of a child who came tonight, for the
// phone's roster: the same children the count reads (TwoTimTwo's report when it
// is fresh, so a child checked in at the desk or on TwoTimTwo itself is never
// offered again; 2026-10-08, the youth page listed them), plus this printer's
// own active rows, plus anyone checked out tonight (they came; the 7:15 youth
// check-out must not put Trek and Journey back on the list).
function rosterCheckedInKeys(tonight = $tonightCount.tonightCheckins(), now = Date.now()) {
  const keys = new Set();
  tonight.active.forEach((row) => identityKeysOfRow(row).forEach((k) => keys.add(k)));
  $tonightCount.tonightHereNow(tonight, now).children.forEach((c) => c.keys.forEach((k) => keys.add(k)));
  if ($tonightCount.checkedOutTonight.date === tonight.date) {
    $tonightCount.checkedOutTonight.ids.forEach((id) => keys.add(`id:${id}`));
    ($tonightCount.checkedOutTonight.names || new Set()).forEach((n) => keys.add(`name:${n}`));
  }
  return keys;
}

// Roster + tonight's checked-in set for the phone page.
app.post('/phone/roster', (req, res) => {
  $clubbers.clubbers = $clubbers.loadClubbers();
  // Same active set the tally counts (tonightCheckins): an undo made on
  // TwoTimTwo (R-1) or on a phone (Remove) frees the kid for re-check-in here
  // instead of leaving them "checkedIn: true" all night.
  const t = $tonightCount.tonightCheckins();
  const nameOf = (e) => normalizedName(`${e.firstName || ''} ${e.lastName || ''}`);
  const checkedIn = rosterCheckedInKeys(t);
  const isIn = (keys) => keys.some((k) => checkedIn.has(k));
  // Kids a phone removed tonight (and who have not been checked in again
  // since) get an "Add back" affordance instead of "Check in": a driven
  // check-in for a kid still on TwoTimTwo would be short-circuited by the
  // station as already-checked-in, printing and counting nothing.
  const removedHere = new Set(
    t.entries.filter(e => e.undone && e.undoneBy === 'phone' && !isIn(identityKeysOfRow(e))).map(nameOf)
  );
  // `inactive` so the phone's Not-here-yet tab can leave former clubbers out
  // of a call list — loadClubbers() returns every row the CSV ever carried, so
  // without this a kid who left the program reads as missing forever. Same
  // idiom as twinDisambiguation(): any non-blank Inactive cell means inactive.
  const kids = $clubbers.clubbers.map(r => {
    const name = `${r.FirstName || ''} ${r.LastName || ''}`.trim();
    const key = normalizedName(name);
    const id = String(r.ClubberID || '').trim();
    return {
      name,
      club: r.Club || '',
      checkedIn: isIn(id ? [`id:${id}`, `name:${key}`] : [`name:${key}`]),
      removedHere: removedHere.has(key),
      inactive: !!String(r.Inactive || '').trim(),
    };
  }).filter(k => k.name);
  // 7.7.0: the touch check-in's families and Bible/Friend clubs (from the
  // laptop's extension) and who came the last two club nights.
  const ctx = $attendanceAudit.loadTouchContext();
  res.json({ kids, households: ctx.households, items: ctx.items, recent: $attendanceAudit.recentAttendance($ledger.loadAttendance()) });
});

// The identity a phone request names: `clubberId` when the phone knows it (it
// does not today — the roster it sees is name-keyed — but the shape is ready),
// else first + last. Bounded like every other stored string.
function phoneIdentity(body) {
  const b = body || {};
  let firstName = security.sanitizeStoredText(b.firstName || '', 80);
  let lastName = security.sanitizeStoredText(b.lastName || '', 80);
  if (!firstName && !lastName && b.name) ({ firstName, lastName } = splitFullName(security.sanitizeStoredText(b.name, 160)));
  const clubberId = b.clubberId != null && String(b.clubberId).trim()
    ? security.sanitizeStoredText(String(b.clubberId), 40) : null;
  return { firstName, lastName, clubberId };
}

// Exactly who this server is counting tonight — the same deduped active set the
// lobby-screen tally is built from, so a volunteer can see the number AND the
// names behind it. Each entry is an explicit whitelist, never the raw row:
// rows carry `clubImageData` blobs, and nothing about allergies or birthdays
// belongs on this surface.
app.post('/phone/tonight', (req, res) => {
  const t = $tonightCount.tonightCheckins();
  const st = $tonightCount.computeTonightStats(t);
  res.json({
    date: t.date,
    checkedIn: st.checkedIn,
    checkedOut: st.checkedOut,
    visitors: st.visitors,
    byClub: st.byClub,
    // 'report' or 'history' — the phone shows the same number the lobby screen
    // does, so it has to be able to say where that number came from. Note the
    // list below is always this printer's own rows: in report mode it can hold
    // an unregistered visitor who is deliberately not in `checkedIn`.
    countSource: st.countSource,
    // What this print server can do from the Tonight list, so the website's
    // phone page (which may be newer than the laptop) offers only that.
    features: ['checkout'],
    entries: t.active.map(e => ({
      key: historyIdentityKey(e),
      firstName: e.firstName || '',
      lastName: e.lastName || '',
      clubName: (e.clubName || '').trim(),
      clubberId: e.clubberId != null ? String(e.clubberId) : null,
      // Checked out tonight (7.15.0; by name for an id-less row, 7.16.0):
      // still listed, off the count, and never offered Check out again.
      checkedOut: $tonightCount.checkedOutTonight.date === t.date && (
        (e.clubberId != null && $tonightCount.checkedOutTonight.ids.has(String(e.clubberId).trim()))
        || Boolean($tonightCount.checkedOutTonight.names && $tonightCount.checkedOutTonight.names.has(normalizedName(`${e.firstName || ''} ${e.lastName || ''}`)))),
      visitor: !!e.visitor,
      at: e.timestamp,
    })),
  });
});

// Remove a child from tonight's count. LOCAL ONLY: history rows are marked
// undone (never deleted — history is the print log), tonight comes out of the
// child's season ledger, and a fresh tally goes out. Nothing is sent to
// TwoTimTwo; the phone page says so, and the volunteer undoes there too if
// the child really left. reconcileHistoryWithReport() respects the `undoneBy`
// marker, so the kid staying on TwoTimTwo's report cannot re-count them.
//
// With `inTwoTimTwo: true` (7.14.0, the phone's "Undo check-in") it is the
// REAL undo instead: queued for the check-in page's extension like a phone
// check-in, and nothing here changes until that extension reports TwoTimTwo's
// own "(checkin undone)" (applyTwoTimTwoUndo, from the result route). It rides
// this route, not a new one, because the website's /checkin page reaches the
// laptop only through the sync service's relay, whose allowlist already
// carries /phone/undo and /phone/status/:id. An older print server ignores
// the flag and Removes; its answer has no `id`, and the phone says so.
app.post('/phone/undo', (req, res) => {
  const ident = phoneIdentity(req.body);
  if (req.body && req.body.checkout === true) return phoneCheckout(ident, res);
  if (req.body && req.body.inTwoTimTwo === true) return queueTwoTimTwoUndo(ident, res);
  if (!ident.firstName && !ident.lastName && !ident.clubberId) {
    return res.status(400).json({ error: 'firstName/lastName or clubberId is required' });
  }
  const out = $history.markManualUndo($history.loadHistory(), ident);
  if (!out.changed) return res.status(404).json({ error: 'Nobody by that name is checked in tonight' });
  $history.saveHistory(out.history);
  $history.stripDayFromLedger($history.ledgerKeysFor(ident.firstName, ident.lastName, ident.clubberId), $eventBuffer.localDayISO());
  $publishers.publishTally();
  console.log(`[phone] Removed from tonight: ${ident.firstName} ${ident.lastName}`.trim());
  const st = $tonightCount.computeTonightStats();
  res.json({ ok: true, undone: out.changed, checkedIn: st.checkedIn, byClub: st.byClub });
});

// The phone's "Undo check-in" (7.14.0). TwoTimTwo's undo takes the meeting
// and the clubber id, so a child with no id here (an unregistered visitor, a
// row printed before the roster knew them) can only be Removed. The "Allow
// driven check-ins" switch covers it exactly as it covers a phone check-in.
function queueTwoTimTwoUndo(ident, res) {
  if (!ident.clubberId) {
    return res.status(400).json({ error: 'This child has no TwoTimTwo id on the check-in laptop, so it cannot undo them there. Use Remove, and undo at the desk.' });
  }
  if ($config.config.enableDrivenCheckin === false) {
    return res.status(409).json({ error: 'Undo on TwoTimTwo is turned off with phone check-ins on the check-in laptop (awana.kvbchurch.org/settings → Laptop → "Allow driven check-ins from phones").' });
  }
  $pendingActions.prunePendingActions();
  // One undo in flight per child: a double-tap must not post twice.
  const existing = $pendingActions.pendingActions.find(a => $pendingActions.actionType(a) === 'undo' && a.clubberId === ident.clubberId
    && (a.status === 'pending' || a.status === 'claimed'));
  if (existing) return res.json({ id: existing.id, queued: true });
  const name = `${ident.firstName} ${ident.lastName}`.trim() || `clubber ${ident.clubberId}`;
  const action = {
    id: crypto.randomUUID(),
    type: 'undo',
    name,
    firstName: ident.firstName,
    lastName: ident.lastName,
    clubberId: ident.clubberId,
    at: new Date().toISOString(),
    status: 'pending',
    detail: '',
  };
  $pendingActions.pendingActions.push(action);
  console.log(`[phone] Undo queued: ${name}`);
  $pendingActions.wakePendingWaiters();
  return res.json({ id: action.id, queued: true });
}

// The phone's "Check out" (7.16.0, owner 2026-10-08). Rides /phone/undo with
// `checkout: true` for the same reason Undo check-in does: the website's
// relay allowlist (lobby/worker/src/relay.js) already carries /phone/undo and
// /phone/status/:id. (An older print server ignores the flag and Removes; the
// phone shows Check out only when /phone/tonight lists 'checkout' in
// `features`, so that cannot happen from a page that knows to look.)
//
// With a clubber id it is TwoTimTwo's own check-out, queued for the check-in
// page's extension as a `{type:'checkout'}` pending action that nothing here
// applies until the extension reports TwoTimTwo's exact "OK"
// (applyTwoTimTwoCheckout). Without one (a visitor, a row printed before the
// roster knew the child) TwoTimTwo has nothing to check out, so it is a LOCAL
// mark, applied at once and said so: off the count and the still-here list,
// nothing sent anywhere.
function phoneCheckout(ident, res) {
  if (!ident.clubberId) {
    if (!ident.firstName && !ident.lastName) {
      return res.status(400).json({ error: 'firstName/lastName or clubberId is required' });
    }
    const t = $tonightCount.tonightCheckins();
    const name = normalizedName(`${ident.firstName} ${ident.lastName}`);
    const row = t.active.find((e) => normalizedName(`${e.firstName || ''} ${e.lastName || ''}`) === name);
    if (!row) return res.status(404).json({ error: 'Nobody by that name is checked in tonight' });
    // A row that does carry an id goes through TwoTimTwo like any other.
    if (row.clubberId != null && String(row.clubberId).trim()) {
      return phoneCheckout({ ...ident, clubberId: String(row.clubberId).trim() }, res);
    }
    if ($feedRoutes.markCheckedOut(t.date, [], [name])) $publishers.publishTally();
    console.log(`[phone] Marked checked out (here only): ${ident.firstName} ${ident.lastName}`.trim());
    const st = $tonightCount.computeTonightStats();
    return res.json({ ok: true, checkedOut: true, local: true, checkedIn: st.checkedIn, byClub: st.byClub });
  }
  if ($config.config.enableDrivenCheckin === false) {
    return res.status(409).json({ error: 'Check-out on TwoTimTwo is turned off with phone check-ins on the check-in laptop (awana.kvbchurch.org/settings → Laptop → "Allow driven check-ins from phones").' });
  }
  $pendingActions.prunePendingActions();
  const existing = $pendingActions.pendingActions.find(a => $pendingActions.actionType(a) === 'checkout' && a.clubberId === ident.clubberId
    && (a.status === 'pending' || a.status === 'claimed'));
  if (existing) return res.json({ id: existing.id, queued: true });
  const name = `${ident.firstName} ${ident.lastName}`.trim() || `clubber ${ident.clubberId}`;
  const action = {
    id: crypto.randomUUID(),
    type: 'checkout',
    name,
    firstName: ident.firstName,
    lastName: ident.lastName,
    clubberId: ident.clubberId,
    at: new Date().toISOString(),
    status: 'pending',
    detail: '',
  };
  $pendingActions.pendingActions.push(action);
  console.log(`[phone] Check-out queued: ${name}`);
  $pendingActions.wakePendingWaiters();
  return res.json({ id: action.id, queued: true });
}

// TwoTimTwo answered "OK": the child is checked out. Off tonight's count (the
// 7.15.0 checked-out set, which the extension also re-posts after every pass,
// so a restart of this server catches up), and off the still-here list, which
// publishTally() republishes. The attendance ledger keeps them: they came.
function applyTwoTimTwoCheckout(action) {
  const changed = $feedRoutes.markCheckedOut($eventBuffer.localDayISO(), [action.clubberId], []);
  $publishers.publishTally();
  console.log(`[phone] Checked out on TwoTimTwo: ${action.name}`);
  return changed;
}

// TwoTimTwo has undone the check-in, so this laptop does what Remove does: the
// child's rows tonight are marked undone (by 'twotimtwo', so the phone offers
// Check in again, never "Add back", which would count a child TwoTimTwo no
// longer has), tonight leaves their ledger and the screens drop them at once.
// The marker also holds the count down until the next report, which still
// lists the child, is replaced by one that does not.
function applyTwoTimTwoUndo(action) {
  const ident = { firstName: action.firstName || '', lastName: action.lastName || '', clubberId: action.clubberId || null };
  const out = $history.markManualUndo($history.loadHistory(), ident, Date.now(), 'twotimtwo');
  if (out.changed) $history.saveHistory(out.history);
  try { $history.stripDayFromLedger($history.ledgerKeysFor(ident.firstName, ident.lastName, ident.clubberId), $eventBuffer.localDayISO()); } catch { /* ledger trouble never blocks the undo */ }
  $publishers.publishTally();
  console.log(`[phone] Undone on TwoTimTwo: ${action.name} (${out.changed} row(s) here)`);
  return out.changed;
}

// Reverse a phone Remove ("Add back"). Only rows the phone itself undid are
// eligible — an undo detected from TwoTimTwo's report is TwoTimTwo's truth and
// stays; the way back from that is a real re-check-in.
app.post('/phone/restore', (req, res) => {
  const ident = phoneIdentity(req.body);
  if (!ident.firstName && !ident.lastName && !ident.clubberId) {
    return res.status(400).json({ error: 'firstName/lastName or clubberId is required' });
  }
  const out = $history.clearManualUndo($history.loadHistory(), ident);
  if (!out.changed) return res.status(404).json({ error: 'Nothing to add back — this child was not removed from a phone' });
  $history.saveHistory(out.history);
  try { $ledger.recordAttendance(ident.firstName, ident.lastName, ident.clubberId); } catch { /* ledger trouble never blocks the restore */ }
  $publishers.publishTally();
  console.log(`[phone] Added back to tonight: ${ident.firstName} ${ident.lastName}`.trim());
  const st = $tonightCount.computeTonightStats();
  res.json({ ok: true, restored: out.changed, checkedIn: st.checkedIn, byClub: st.byClub });
});

// A first-timer label for someone NOT on the roster, straight from the phone.
// This is the one place the phone prints a check-in label directly, and it is
// safe precisely because the child has no TwoTimTwo row: roster-diff,
// reconcile and the last-check-in observer can never see them, so no second
// label is possible. A roster name is refused (409) — those go through Check
// in, so the door laptop records the real check-in; otherwise the same kid
// would get a name-keyed visitor row AND an id-keyed detection row and count
// twice. Rehearsal mode still yields a TEST label with nothing recorded, and
// the duplicate window inside performCheckinPrint absorbs a double-tap.
app.post('/phone/visitor', async (req, res) => {
  const b = req.body || {};
  const { firstName, lastName } = splitFullName(security.sanitizeStoredText(b.name || '', 160));
  if (!firstName) return res.status(400).json({ error: 'name is required' });
  const clubName = security.sanitizeStoredText(b.clubName || '', 40);
  $clubbers.clubbers = $clubbers.loadClubbers();
  if ($clubbers.findClubber(firstName, lastName)) {
    return res.status(409).json({
      error: `${firstName} ${lastName}`.trim() + ' is on the roster — use Check in instead so the door laptop checks them in.',
    });
  }
  const out = await $checkinPrint.performCheckinPrint({ firstName, lastName, clubName, visitor: true });
  res.status(out.status).json(out.body);
});

app.post('/phone/checkin', (req, res) => {
  const name = String((req.body && req.body.name) || '').trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: 'name is required' });
  // The dashboard's "Allow driven check-ins" switch. Off, the check-in page
  // never collects these, so a phone used to wait 90 s and hear "the laptop
  // is not answering"; it now hears what is really wrong, at once.
  if ($config.config.enableDrivenCheckin === false) {
    return res.status(409).json({ error: 'Phone check-ins are turned off on the check-in laptop (awana.kvbchurch.org/settings → Laptop → "Allow driven check-ins from phones").' });
  }
  // Bible / Brought a friend from the phone's card (7.7.0): booleans only, and
  // only the two the laptop knows how to tick.
  const o = (req.body && req.body.options) || {};
  const options = {};
  if (typeof o.Bible === 'boolean') options.Bible = o.Bible;
  if (typeof o.Friend === 'boolean') options.Friend = o.Friend;
  // BARF Night (8.1.0): the friend's first name, when Brought a friend is on.
  if (options.Friend === true && $tags.cleanFriendName(o.FriendName)) options.FriendName = $tags.cleanFriendName(o.FriendName);
  $pendingActions.prunePendingActions();
  // One pending action per kid — a double-tap must not double-drive.
  const existing = $pendingActions.pendingActions.find(a => $pendingActions.actionType(a) === 'checkin' && a.name.toLowerCase() === name.toLowerCase() && a.status === 'pending');
  if (existing) return res.json({ id: existing.id, queued: true });
  const action = {
    id: crypto.randomUUID(),
    type: 'checkin',
    name,
    options,
    at: new Date().toISOString(),
    status: 'pending',
    detail: '',
  };
  $pendingActions.pendingActions.push(action);
  console.log(`[phone] Check-in queued: ${name}`);
  $pendingActions.wakePendingWaiters();
  res.json({ id: action.id, queued: true });
});

// Extension long-poll: returns pending actions immediately if any exist,
// otherwise holds the request up to 25 s waiting for one. `?accept=undo` is
// how a 7.14.0+ extension says it can also undo (see pendingFor).
app.get('/pending-actions', (req, res) => {
  $pendingActions.prunePendingActions();
  const accept = typeof req.query.accept === 'string' ? req.query.accept.slice(0, 40) : '';
  const pending = $pendingActions.pendingFor(accept);
  if (pending.length || $pendingActions.pendingWaiters.length >= $pendingActions.PENDING_WAITERS_MAX) {
    return res.json({ actions: pending });
  }
  const waiter = { res, timer: null, accept };
  waiter.timer = setTimeout(() => {
    $pendingActions.pendingWaiters = $pendingActions.pendingWaiters.filter(w => w !== waiter);
    try { res.json({ actions: [] }); } catch { /* client gone */ }
  }, 25000);
  req.on('close', () => {
    clearTimeout(waiter.timer);
    $pendingActions.pendingWaiters = $pendingActions.pendingWaiters.filter(w => w !== waiter);
  });
  $pendingActions.pendingWaiters.push(waiter);
});

app.post('/pending-actions/:id/claim', (req, res) => {
  $pendingActions.prunePendingActions();
  const action = $pendingActions.pendingActions.find(a => a.id === req.params.id);
  if (!action) return res.status(404).json({ error: 'unknown action' });
  if (action.status !== 'pending') return res.status(409).json({ error: `already ${action.status}`, status: action.status });
  action.status = 'claimed';
  action.claimedAt = Date.now();
  res.json({ ok: true, leaseMs: $pendingActions.PENDING_CLAIM_MS });
});

app.post('/pending-actions/:id/result', (req, res) => {
  const action = $pendingActions.pendingActions.find(a => a.id === req.params.id);
  if (!action) return res.status(404).json({ error: 'unknown action' });
  if ($pendingActions.isOneShot(action)) {
    // Answered once. A late or repeated result (a second tab, a retry after a
    // timeout) never re-marks the night or flips a reported failure to done.
    if (action.status === 'done' || action.status === 'failed') return res.json({ ok: true, already: action.status });
    // Only a literal true, the extension's verdict on TwoTimTwo's own
    // "(checkin undone)" reply (or, for a check-out, its exact "OK"),
    // changes anything here.
    const ok = !!req.body && req.body.ok === true;
    action.status = ok ? 'done' : 'failed';
    action.detail = String((req.body && req.body.detail) || '').slice(0, 200);
    const co = $pendingActions.actionType(action) === 'checkout';
    if (ok) { if (co) applyTwoTimTwoCheckout(action); else applyTwoTimTwoUndo(action); }
    else console.log(`[phone] ${co ? 'Check-out' : 'Undo'} for ${action.name} failed${action.detail ? ' — ' + action.detail : ''}`);
    return res.json({ ok: true });
  }
  action.status = (req.body && req.body.ok) ? 'done' : 'failed';
  action.detail = String((req.body && req.body.detail) || '').slice(0, 200);
  console.log(`[phone] ${action.name}: ${action.status}${action.detail ? ' — ' + action.detail : ''}`);
  res.json({ ok: true });
});

app.get('/phone/status/:id', (req, res) => {
  $pendingActions.prunePendingActions();   // so an undo nobody picked up reads as failed, with why
  const action = $pendingActions.pendingActions.find(a => a.id === req.params.id);
  if (!action) return res.status(404).json({ error: 'unknown action' });
  res.json({ status: action.status, detail: action.detail });
});
