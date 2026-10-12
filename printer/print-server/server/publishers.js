'use strict';
// Event-bus publishers, still-here list, lobby slides, shared display settings.
// One of the modules server.js was split into (server.js loads them in the order the old
// file ran them). Another module's names are reached as $module.name.

const lazy = require('./lazy');
const events  = require('../events');
const pickup = require('../pickup');
const fs    = require('fs');
const path  = require('path');
const $config = lazy('./config');
const $eventBuffer = lazy('./event-buffer');
const $clubbers = lazy('./clubbers');
const $eligibility = lazy('./eligibility');
const $tonightCount = lazy('./tonight-count');
const $feedRoutes = lazy('./feed-routes');
const $relay = lazy('./relay');
const $station = lazy('./station');
const $configRoutes = lazy('./config-routes');

// What other modules (and server.js) read from this one; live bindings, so cycles are safe.
Object.defineProperties(exports, {
  acceptDisplaySettingsPublish: { enumerable: true, get: () => acceptDisplaySettingsPublish },
  acceptLobbySlidesPublish: { enumerable: true, get: () => acceptLobbySlidesPublish },
  displaySettings: { enumerable: true, get: () => displaySettings },
  lobbySlides: { enumerable: true, get: () => lobbySlides },
  onClubNight: { enumerable: true, get: () => onClubNight },
  onTallyWindow: { enumerable: true, get: () => onTallyWindow },
  publishBirthdays: { enumerable: true, get: () => publishBirthdays },
  publishDisplaySettings: { enumerable: true, get: () => publishDisplaySettings },
  publishLobbySlides: { enumerable: true, get: () => publishLobbySlides },
  publishRecap: { enumerable: true, get: () => publishRecap },
  publishStillHere: { enumerable: true, get: () => publishStillHere },
  publishTally: { enumerable: true, get: () => publishTally },
  stillHereChanged: { enumerable: true, get: () => stillHereChanged },
  stillHereEntries: { enumerable: true, get: () => stillHereEntries },
  stillHereWindowForTests: { enumerable: true, get: () => stillHereWindowForTests, set: (v) => { stillHereWindowForTests = v; } },
  TALLY_GRACE_MIN: { enumerable: true, get: () => TALLY_GRACE_MIN },
  TALLY_LEAD_MIN: { enumerable: true, get: () => TALLY_LEAD_MIN },
});

// ── Event-bus publishers ──────────────────────────────────────────────────────
// Interval publishers are gated by the church-config club-night window so the
// channel stays quiet the other ~165 hours a week. Every publisher is wrapped:
// a channel outage can never disturb printing.

function publishTally() {
  // Online check-in (P2): with this computer a registered station, the Worker
  // publishes the tally and the pickup list; ours stays quiet.
  if ($config.cloudStation) return;
  try {
    const st = $tonightCount.computeTonightStats();
    // Unified theming (#18): every tally carries the Screen season (already
    // resolved: pinned, calendar, or '' when the operator turned it off), so
    // the screens follow a change within a minute - and a display that boots
    // mid-night picks it up on the next tally without any handshake.
    events.publish($config.EVENT_CHANNEL, 'tally', events.buildTally(st.byClub, st.checkedIn, {
      season: $eligibility.currentScreenSeason(),
      rehearsal: $configRoutes.isRehearsalActive(),
    }));
  } catch (e) { console.warn('[events] tally publish skipped:', e.message); }
  // Everything that moves the count (a print, an undo, a check-out, a report
  // applied, a reset) calls this, so the still-here list follows it.
  stillHereChanged();
}

// ── The lobby's still-here list (7.16.0, owner 2026-10-08) ──────────────────
// At 7:30 the lobby screens show the children not yet picked up, then "<name>
// has checked out" as each leaves (the lobby diffs successive lists).
// TwoTimTwo's Checkout page lists nobody at KVBC, so THIS is the list: the
// children here now by the count's own rules (tonightHereNow: report plus
// newer history, minus undone, minus checked out; visitors only while the
// count is history-built, exactly as the count treats them), in the clubs
// ticked under "Clubs on the pickup list" (config `pickupClubs`, default every
// club but Trek and Journey), first name + club, sorted, capped at
// CHECKOUT_MAX. It rides the existing sealed `checkout` event with `printed`
// beside it, its payload shape unchanged (events.buildCheckout). Published
// every minute in the tally window and, coalesced, within seconds of any
// change; never outside that window (names have no business on the wire at
// 2 pm Tuesday). The lobby decides when to SHOW it.
const STILL_HERE_DEBOUNCE_MS = 2000;
let lastStillHereSig = null;
let stillHereTimer = null;

function stillHereEntries() {
  return pickup.buildStillHere($tonightCount.tonightHereNow().children, pickup.pickupClubsOf($config.config), events.CHECKOUT_MAX);
}

let stillHereWindowForTests = null;
function stillHereInWindow() {
  if (typeof stillHereWindowForTests === 'function') return stillHereWindowForTests();
  return events.isClubNightNow($config.churchConfig.clubNights, undefined, TALLY_GRACE_MIN, TALLY_LEAD_MIN);
}

/** Publish the list now (the minute timer's job, and a change's). */
function publishStillHere() {
  if ($config.cloudStation) return;   // the Worker publishes the pickup list in cloud mode
  try {
    const entries = stillHereEntries();
    const payload = events.buildCheckout(entries, $feedRoutes.distinctChildrenPrintedToday());
    lastStillHereSig = JSON.stringify(payload.entries);
    events.publish($config.EVENT_CHANNEL, 'checkout', payload);
  } catch (e) { console.warn('[events] still-here publish skipped:', e.message); }
}

/** Something that may change the list happened: publish soon if it did. */
function stillHereChanged() {
  // A station does not publish the list; it keeps the Worker's copy of what only this computer
  // knows (season, rehearsal, pickup clubs) current instead.
  if ($config.cloudStation) { $station.sendStationExtras().catch(() => {}); return; }
  if (stillHereTimer) return;
  stillHereTimer = setTimeout(() => {
    stillHereTimer = null;
    try {
      if (!stillHereInWindow()) return;
      const sig = JSON.stringify(events.buildCheckout(stillHereEntries()).entries);
      if (sig !== lastStillHereSig) publishStillHere();
    } catch (e) { /* the minute timer tries again */ }
  }, STILL_HERE_DEBOUNCE_MS);
  if (stillHereTimer.unref) stillHereTimer.unref();
}

function publishRecap() {
  try {
    // An EMPTY recap is published on purpose once names are encrypted, where it
    // used to be skipped. It costs one sealed frame every two minutes and buys
    // the screens a continuous key-health heartbeat: a screen needs two failed
    // frames before it admits it cannot read names, so without this the first two
    // children of the night are silently missed before anything appears on the
    // wall. With it, a wrong key is on screen before the doors even open.
    // The consumer's handleRecap iterates `entries`, so [] is a clean no-op.
    $eventBuffer.pruneEventBuffer();
    if (!$eventBuffer.eventBuffer.length && !events.getDisplayKeyState().configured) return;
    events.publish($config.EVENT_CHANNEL, 'recap', events.buildRecap($eventBuffer.eventBuffer));
  } catch (e) { console.warn('[events] recap publish skipped:', e.message); }
}

function publishBirthdays() {
  try {
    const entries = [];
    for (const r of $clubbers.clubbers) {
      if (!$eligibility.isBirthdayWeek(r.Birthdate)) continue;
      const bd = $eligibility.parseBirthdate(r.Birthdate);
      if (!bd) continue;
      // First name + club + calendar month/day ONLY — no last name, no year.
      entries.push({
        firstName: r.FirstName || '',
        club: r.Club || '',
        month: bd.getMonth() + 1,
        day: bd.getDate(),
      });
    }
    events.publish($config.EVENT_CHANNEL, 'birthdays', events.buildBirthdays(entries));
  } catch (e) { console.warn('[events] birthdays publish skipped:', e.message); }
}

// ── Lobby slides (contract v5) ────────────────────────────────────────────────
// The displays' typed slide deck, published once by the operator and mirrored
// to every screen over the sealed `slides` event. State survives restarts in
// lobby-slides.json; losing that file is harmless BY DESIGN — deckRev may
// restart at 1, but consumers order solely on publishedAt, so the next publish
// (whose publishedAt is current) still wins. Never "fix" a restarted rev by
// re-seeding it.
const LOBBY_SLIDES_FILE = path.join($config.DATA_DIR, 'lobby-slides.json');
let lobbySlides = { deckRev: 0, publishedAt: '', slides: [] };
try {
  if (fs.existsSync(LOBBY_SLIDES_FILE)) {
    const raw = JSON.parse(fs.readFileSync(LOBBY_SLIDES_FILE, 'utf8'));
    const slides = events.buildSlidesDeck(raw.slides);
    const rev = Math.floor(Number(raw.deckRev));
    const at = Date.parse(raw.publishedAt);
    if (Number.isFinite(at) && rev >= 1) {
      lobbySlides = { deckRev: rev, publishedAt: new Date(at).toISOString(), slides };
      console.log(`[slides] Loaded lobby deck rev ${rev} (${slides.length} slide(s), published ${lobbySlides.publishedAt})`);
    }
  }
} catch (e) {
  console.warn('[slides] Could not load lobby-slides.json — starting with no deck:', e.message);
}

function persistLobbySlides() {
  $config.saveFileAtomic(LOBBY_SLIDES_FILE, JSON.stringify(lobbySlides));
}

// Broadcast the CURRENT deck: every chunk of one publish shares its
// {deckRev, publishedAt} byte-identically, on first publish and on every
// rebroadcast — publishedAt is the consumers' ordering authority, so a
// rebroadcast that re-stamped it would masquerade as a new publish.
async function publishLobbySlides() {
  if (lobbySlides.deckRev < 1) return false;    // nothing ever published
  // Signed in to the sync service, it is the deck's one home and publishes it
  // itself: a rebroadcast from here would only repeat an older deck.
  if ($relay.signedInToSync()) return false;
  const chunks = events.buildSlidesChunks(lobbySlides.slides, lobbySlides.deckRev, lobbySlides.publishedAt);
  if (!chunks) {
    console.error('[slides] Deck no longer fits the chunk ceiling — NOT published (fail closed)');
    return false;
  }
  let ok = true;
  for (const chunk of chunks) {
    // Sequential on purpose: chunks of one deck should not race each other.
    // publish() seals (slides is an ENCRYPTED_EVENT) and never throws.
    ok = (await events.publish($config.EVENT_CHANNEL, 'slides', chunk)) && ok;
  }
  return ok;
}

/**
 * Accept an operator publish: sanitize, gate on total size, stamp, persist,
 * broadcast. Returns {ok:true, ...summary} or {ok:false, error}.
 */
function acceptLobbySlidesPublish(rawSlides) {
  if (!Array.isArray(rawSlides)) {
    return { ok: false, status: 400, error: 'Body must be { slides: [...] }' };
  }
  const slides = events.buildSlidesDeck(rawSlides);
  const bytes = events.slidesDeckJsonBytes(slides);
  if (bytes > events.SLIDES_DECK_JSON_MAX) {
    return {
      ok: false, status: 413,
      error: `Deck too large to broadcast (${bytes} bytes of slide text; limit ${events.SLIDES_DECK_JSON_MAX}). Shorten or remove slides.`,
    };
  }
  // Strictly-increasing stamp even across rapid re-publishes or a clock that
  // lost a second; consumers commit only on publishedAt strictly newer.
  const lastMs = Date.parse(lobbySlides.publishedAt);
  const stampMs = Math.max(Date.now(), (Number.isFinite(lastMs) ? lastMs : 0) + 1000);
  const nextRev = (lobbySlides.deckRev || 0) + 1;
  const nextStamp = new Date(stampMs).toISOString();
  // Dry-run the chunker BEFORE committing anything. The byte gate above is a
  // coarse guard, not a guarantee: greedy packing can strand nearly a full
  // slide of slack per chunk, so a deck of mid-sized (e.g. non-Latin) slides
  // can pass 40 KB yet need more than SLIDES_TOTAL_MAX chunks. Accepting such
  // a deck would be the worst kind of failure — ok:true to the operator, the
  // deck persisted, and every broadcast (now and every heartbeat after)
  // silently failing closed. Refuse it here instead, with nothing committed.
  const chunks = events.buildSlidesChunks(slides, nextRev, nextStamp);
  if (!chunks) {
    return {
      ok: false, status: 413,
      error: `Deck too large to broadcast (needs more than ${events.SLIDES_TOTAL_MAX} chunks). Shorten or remove slides.`,
    };
  }
  lobbySlides = {
    deckRev: nextRev,
    publishedAt: nextStamp,
    slides,
  };
  persistLobbySlides();
  publishLobbySlides();
  const dropped = rawSlides.length - slides.length;
  console.log(`[slides] Published lobby deck rev ${lobbySlides.deckRev} (${slides.length} slide(s)${dropped > 0 ? `, ${dropped} device-local/blank entr${dropped === 1 ? 'y' : 'ies'} dropped` : ''})`);
  return {
    ok: true,
    deckRev: lobbySlides.deckRev,
    publishedAt: lobbySlides.publishedAt,
    slideCount: slides.length,
    droppedCount: Math.max(0, dropped),
  };
}

// ── Shared display settings (contract v6) ─────────────────────────────────────
// Same shape of state as the lobby deck: one {rev, publishedAt, settings},
// persisted in display-settings.json, rebroadcast whole every ~5 minutes so a
// rebooted screen converges, and ordered by consumers on publishedAt alone.
const DISPLAY_SETTINGS_FILE = path.join($config.DATA_DIR, 'display-settings.json');
let displaySettings = { rev: 0, publishedAt: '', settings: {} };
try {
  if (fs.existsSync(DISPLAY_SETTINGS_FILE)) {
    const raw = JSON.parse(fs.readFileSync(DISPLAY_SETTINGS_FILE, 'utf8'));
    const rev = Math.floor(Number(raw.rev));
    const at = Date.parse(raw.publishedAt);
    if (Number.isFinite(at) && rev >= 1) {
      displaySettings = { rev, publishedAt: new Date(at).toISOString(), settings: events.buildDisplaySettings(raw.settings) };
      console.log(`[settings] Loaded display settings rev ${rev} (${Object.keys(displaySettings.settings).length} key(s))`);
    }
  }
} catch (e) {
  console.warn('[settings] Could not load display-settings.json — starting with none:', e.message);
}

function persistDisplaySettings() {
  $config.saveFileAtomic(DISPLAY_SETTINGS_FILE, JSON.stringify(displaySettings));
}

// Rebroadcasts reuse publishedAt byte-identically, like the deck's.
async function publishDisplaySettings() {
  if (displaySettings.rev < 1) return false;    // nothing ever published
  if ($relay.signedInToSync()) return false;            // the sync service publishes them
  const payload = events.buildSettingsPayload(displaySettings.settings, displaySettings.rev, displaySettings.publishedAt);
  if (!payload) {
    console.error('[settings] Settings no longer fit one sealed frame — NOT published (fail closed)');
    return false;
  }
  // publish() seals (settings is an ENCRYPTED_EVENT) and never throws.
  return events.publish($config.EVENT_CHANNEL, 'settings', payload);
}

/** Accept a publish: sanitize, gate on size, stamp, persist, broadcast. */
function acceptDisplaySettingsPublish(rawSettings) {
  if (!rawSettings || typeof rawSettings !== 'object' || Array.isArray(rawSettings)) {
    return { ok: false, status: 400, error: 'Body must be { settings: { ... } }' };
  }
  const settings = events.buildDisplaySettings(rawSettings);
  const bytes = events.displaySettingsJsonBytes(settings);
  if (bytes > events.SETTINGS_JSON_MAX) {
    return { ok: false, status: 413, error: `Settings too large to broadcast (${bytes} bytes; limit ${events.SETTINGS_JSON_MAX}). Shorten the club lines.` };
  }
  const lastMs = Date.parse(displaySettings.publishedAt);
  const stampMs = Math.max(Date.now(), (Number.isFinite(lastMs) ? lastMs : 0) + 1000);
  const nextRev = (displaySettings.rev || 0) + 1;
  const nextStamp = new Date(stampMs).toISOString();
  if (!events.buildSettingsPayload(settings, nextRev, nextStamp)) {
    return { ok: false, status: 413, error: 'Settings too large to broadcast in one sealed frame. Shorten the club lines.' };
  }
  displaySettings = { rev: nextRev, publishedAt: nextStamp, settings };
  persistDisplaySettings();
  publishDisplaySettings();
  const dropped = Object.keys(rawSettings).length - Object.keys(settings).length;
  console.log(`[settings] Published display settings rev ${nextRev} (${Object.keys(settings).length} key(s)${dropped > 0 ? `, ${dropped} per-screen/unknown dropped` : ''})`);
  return {
    ok: true,
    rev: nextRev,
    publishedAt: nextStamp,
    keyCount: Object.keys(settings).length,
    droppedCount: Math.max(0, dropped),
  };
}

function onClubNight(fn) {
  return () => {
    try {
      if (!events.isClubNightNow($config.churchConfig.clubNights)) return;
      fn();
    } catch (e) { /* scheduler must never die */ }
  };
}

// An hour past the published end of club. The window in church-config.json is
// when club RUNS, and it is load-bearing for other behaviour (the dashboard's
// club-night badge, the extension's own polling cadence), so it is not the
// thing to widen. But the last children are checked out after it, and the R-1
// report keeps correcting the count for a while yet - and a lobby screen whose
// tally simply stops arriving shows the 8 o'clock number all evening. So the
// TALLY, and only the tally, keeps going for an extra hour.
const TALLY_GRACE_MIN = 60;
// And an hour BEFORE the published start (7.13.0). Children are checked in
// from the moment the doors open, well ahead of 6:30, and the lobby screens are
// up from 5:00: on 2026-10-07 the first kids arrived at 5:22, and with the
// tally's own tick not starting until 5:30 a screen that missed one check-in
// sat on the wrong count until the next one got through.
const TALLY_LEAD_MIN = 60;

function onTallyWindow(fn) {
  return () => {
    try {
      if (!events.isClubNightNow($config.churchConfig.clubNights, undefined, TALLY_GRACE_MIN, TALLY_LEAD_MIN)) return;
      fn();
    } catch (e) { /* scheduler must never die */ }
  };
}

// Club-night publish timers are started by startListening() so a bare
// require() of this module never spins up background work — but embedders
// (the Electron shell) still get them the moment the server actually starts.
