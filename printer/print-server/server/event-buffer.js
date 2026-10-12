'use strict';
// Tonight's event buffer, greetings, print failures, self-test state.
// One of the modules server.js was split into (server.js loads them in the order the old
// file ran them). Another module's names are reached as $module.name.

const lazy = require('./lazy');
const events  = require('../events');
const fs    = require('fs');
const path  = require('path');
const $config = lazy('./config');

// What other modules (and server.js) read from this one; live bindings, so cycles are safe.
Object.defineProperties(exports, {
  calendarDaysBetween: { enumerable: true, get: () => calendarDaysBetween },
  EVENT_BUFFER_FILE: { enumerable: true, get: () => EVENT_BUFFER_FILE },
  eventBuffer: { enumerable: true, get: () => eventBuffer, set: (v) => { eventBuffer = v; } },
  fireOpsAlert: { enumerable: true, get: () => fireOpsAlert },
  greetingChild: { enumerable: true, get: () => greetingChild },
  greetLate: { enumerable: true, get: () => greetLate },
  isOnLocalDay: { enumerable: true, get: () => isOnLocalDay },
  lastCanary: { enumerable: true, get: () => lastCanary, set: (v) => { lastCanary = v; } },
  lastContractCanary: { enumerable: true, get: () => lastContractCanary, set: (v) => { lastContractCanary = v; } },
  lastExtensionReport: { enumerable: true, get: () => lastExtensionReport },
  lastSelfTest: { enumerable: true, get: () => lastSelfTest, set: (v) => { lastSelfTest = v; } },
  localDayISO: { enumerable: true, get: () => localDayISO },
  printFailures: { enumerable: true, get: () => printFailures },
  pruneEventBuffer: { enumerable: true, get: () => pruneEventBuffer },
  pushEventToBuffer: { enumerable: true, get: () => pushEventToBuffer },
  recapEntriesForTonight: { enumerable: true, get: () => recapEntriesForTonight },
  recordExtensionReport: { enumerable: true, get: () => recordExtensionReport },
  recordPrintFailure: { enumerable: true, get: () => recordPrintFailure },
  rememberGreeting: { enumerable: true, get: () => rememberGreeting },
  setOpsAlertHandler: { enumerable: true, get: () => setOpsAlertHandler },
});

// ── Tonight's event buffer ────────────────────────────────────────────────────
// The last ~50 checkin events, persisted so a mid-event server restart doesn't
// lose the recap replay window. Only today's events survive a reload.
// "Today" for a club night is the OPERATOR'S LOCAL calendar day. The UTC day
// flips at 7pm EST / 6pm CST — the middle of a winter club night — so any
// "today" derived from toISOString() splits one physical night in two:
// attendance streaks break, tonight's stats drop the early arrivals at the
// boundary, and opening-night connect-card gating misfires. Every today/
// tonight comparison below goes through these two helpers (the same local-day
// discipline the extension's todayIsoDate() has always used).
function localDayISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// Whole calendar days from one local day (YYYY-MM-DD) to another, zone-free:
// the two days' civil dates, never two Dates subtracted, because across
// spring-forward fourteen calendar days are 13.96 twenty-four-hour spans.
function calendarDaysBetween(fromDay, toDay) {
  const parse = (d) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || ''));
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
  };
  return Math.round((parse(toDay) - parse(fromDay)) / 86400000);
}
function isOnLocalDay(isoTimestamp, localDay) {
  if (typeof isoTimestamp !== 'string') return false;
  const t = new Date(isoTimestamp);
  return !Number.isNaN(t.getTime()) && localDayISO(t) === localDay;
}

const EVENT_BUFFER_FILE = path.join($config.DATA_DIR, 'events-buffer.json');
const EVENT_BUFFER_MAX = 50;
let eventBuffer = [];
try {
  if (fs.existsSync(EVENT_BUFFER_FILE)) {
    const raw = JSON.parse(fs.readFileSync(EVENT_BUFFER_FILE, 'utf8'));
    const today = localDayISO();
    if (Array.isArray(raw)) {
      eventBuffer = raw.filter(e => e && typeof e.at === 'string' && isOnLocalDay(e.at, today));
      if (eventBuffer.length) console.log(`[events] Restored ${eventBuffer.length} checkin event(s) from tonight's buffer`);
    }
  }
} catch (e) { /* corrupt buffer — start fresh */ }

// The recap is TONIGHT's check-ins. The buffer was filtered to today only
// when it was restored at startup, so in a process that ran from one club
// night into the next (the laptop is rarely restarted) last week's children
// were replayed onto the screens all through the following evening until
// the 50-entry cap pushed them out. Pure, so a test can hand it yesterday.
function recapEntriesForTonight(buffer, today = localDayISO()) {
  return (Array.isArray(buffer) ? buffer : []).filter((e) => e && typeof e.at === 'string' && isOnLocalDay(e.at, today));
}
function pruneEventBuffer() {
  const kept = recapEntriesForTonight(eventBuffer);
  if (kept.length !== eventBuffer.length) eventBuffer = kept;
}

// Tonight's greetings by child (memory only, today's only): a TwoTimTwo-page job that
// meets a label already printed greets LATE with the very same event (the same id, so a
// screen that already showed it drops it), because the single publisher may have dropped
// the first one (lobby/worker/src/routes.md section 8).
let greetingsTonight = { day: null, byKey: new Map() };
function greetingKeys(firstName, lastName, clubberId) {
  const keys = [];
  if (clubberId !== null && clubberId !== undefined && String(clubberId).trim()) keys.push(`id:${String(clubberId).trim()}`);
  const name = `${firstName || ''} ${lastName || ''}`.replace(/\s+/g, ' ').trim().toLowerCase();
  if (name) keys.push(`name:${name}`);
  return keys;
}
function rememberGreeting(firstName, lastName, clubberId, checkinEvent) {
  const day = localDayISO();
  if (greetingsTonight.day !== day) greetingsTonight = { day, byKey: new Map() };
  for (const k of greetingKeys(firstName, lastName, clubberId)) greetingsTonight.byKey.set(k, checkinEvent);
}
function greetingFor(firstName, lastName, clubberId) {
  if (greetingsTonight.day !== localDayISO()) return null;
  for (const k of greetingKeys(firstName, lastName, clubberId)) if (greetingsTonight.byKey.has(k)) return greetingsTonight.byKey.get(k);
  return null;
}
// Who a job-less greeting is for, so the single publisher can greet each child once
// whichever path printed them: the clubber id, else a visitor's name and club. It rides
// the publish body to the Worker (never a screen), which keeps only a keyed hash of it.
function greetingChild(firstName, lastName, clubberId, clubName) {
  const id = clubberId !== null && clubberId !== undefined ? String(clubberId).trim() : '';
  if (/^\d{1,12}$/.test(id)) return { clubberId: id };
  const name = `${firstName || ''} ${lastName || ''}`.replace(/\s+/g, ' ').trim();
  return name ? { name, club: String(clubName || '').trim() } : null;
}
// A cloud job that found this child's label already printed tonight: no second label, but
// the child is greeted if no greeting reached the screens yet (the Worker decides, by child).
function greetLate(firstName, lastName, clubberId, clubName, greetJob) {
  if (!greetJob || !$config.cloudStation) return;
  const ev = greetingFor(firstName, lastName, clubberId) || events.buildCheckin({ firstName, club: clubName });
  events.publish($config.EVENT_CHANNEL, 'checkin', ev, { job: greetJob, late: true });
}

function pushEventToBuffer(checkinEvent) {
  pruneEventBuffer();
  eventBuffer.push(checkinEvent);
  if (eventBuffer.length > EVENT_BUFFER_MAX) eventBuffer.splice(0, eventBuffer.length - EVENT_BUFFER_MAX);
  $config.saveFileAtomic(EVENT_BUFFER_FILE, JSON.stringify(eventBuffer));
}

// ── Print-failure tracking ────────────────────────────────────────────────────
// The server used to record only successes; a jammed printer was invisible
// beyond the extension's toast. Failures now land in history (ok:false), in
// this in-memory list for the dashboard, and on the event bus as an `ops`
// event (type/club/at only — never a name on the channel).
const printFailures = [];  // { name, club, at, error } — name stays LOCAL only
const PRINT_FAILURES_MAX = 20;

function recordPrintFailure(name, club, error) {
  printFailures.unshift({ name, club: club || '', at: new Date().toISOString(), error: String(error || '').slice(0, 200) });
  if (printFailures.length > PRINT_FAILURES_MAX) printFailures.length = PRINT_FAILURES_MAX;
  events.publish($config.EVENT_CHANNEL, 'ops', events.buildOps('print-failure', club));
}

// ── Selector self-test + canary state ────────────────────────────────────────
let lastSelfTest = null;   // { ok, results, extensionVersion, at } — posted by the extension
let lastContractCanary = null; // { ok, results, extensionVersion, manual, at } — full daily sweep (#3)
// Version skew (#7): the RUNNING extension version, as the extension itself
// last reported it (every /selftest and /contract-canary post carries one).
// The app knows what it SYNCED to disk (extensionInfo.version); Chrome keeps
// running the old code until it restarts, and only the extension's own posts
// reveal which version is actually live in the browser.
let lastExtensionReport = null; // { version, at (ms) }
function recordExtensionReport(version) {
  const v = String(version || '').trim();
  if (/^\d+\.\d+\.\d+$/.test(v)) lastExtensionReport = { version: v, at: Date.now() };
}
// The Electron shell registers a handler here to surface operator alerts as
// tray/system notifications (contract drift, and anything else that must not
// wait for someone to open the dashboard). No-op when running headless.
let opsAlertHandler = null;
function setOpsAlertHandler(fn) { opsAlertHandler = typeof fn === 'function' ? fn : null; }
function fireOpsAlert(title, body) {
  try { if (opsAlertHandler) opsAlertHandler({ title, body }); } catch (e) { /* alerts never break serving */ }
}
let lastCanary   = null;   // { at, stages } — result of the last POST /canary
