// The church settings, pulled from the sync Worker (docs/SETTINGS-OVERHAUL.md
// section 4; wire: lobby/worker/src/routes.md section 10.3).
//
// The check-in laptop's church-wide printing settings (label footer, connect
// card, label templates, schedule, late grace, pickup list, Screen season, BARF
// nights) live in the Worker since 9.3.0 and are edited from
// awana.kvbchurch.org/settings. This module keeps THIS computer's config.json in
// step with them:
//
//   fetch       GET /v1/church/settings 5 s after sign-in; again whenever the
//               print lease (GET /v1/print/next `church`) says the doc or the
//               switches moved (a station: within seconds); every 60 s when this
//               computer is not a station.
//   precedence  a key the Worker's doc HAS wins over config.json; a key it never
//               had keeps config.json's. A key the doc held at the last apply and
//               no longer holds (the owner's "back to default") is removed from
//               config.json, so it reads its default again.
//   apply       only a rev other than the applied one; every value through the
//               shared allowlist (churchSettings.js, generated) and then the print
//               server's own per-key cleaner (cleanChurchPatch), ONE config.json
//               write (tmp + fsync + rename + .bak). A key the cleaner refuses
//               keeps its config.json value and raises a /health warning.
//   offline     config.json always holds the last applied values, so a restart
//               with no internet prints exactly as last night. Nothing here is
//               ever awaited by a print, and nothing throws into one.
//   first run   the doc is empty (rev 0): a STATION seeds it with its config.json
//               church part (first writer wins); any other computer waits.
//   switches    the effective Worker switches ride every answer; kept in memory
//               only (never fetched = unknown = the behaviour before 9.3.0).
//   off         not signed in, Worker unreachable, `paused` (CHURCH_SETTINGS
//               off) or config.json `churchSync: false`: config.json alone.
//
// No secret is ever sent: the seed and every fetch carry church-authored values
// only (the shared allowlist has no printer, token, key or session key).
'use strict';

const church = require('./churchSettings');

const START_DELAY_MS = 5 * 1000;
const POLL_MS = 60 * 1000;
const TICK_MS = 5 * 1000;
const RETRY_MS = 30 * 1000;
const SWITCH_NAMES = ['CLOUD_PRINT', 'SINGLE_PUBLISHER', 'YM_CHECKOUT', 'CHURCH_SETTINGS', 'NOTICES', 'CHANGE_LOG'];

function revOf(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

function cleanSwitches(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const name of SWITCH_NAMES) if (raw[name] === 'on' || raw[name] === 'off') out[name] = raw[name];
  return out;
}

// Keys that do not live in config.json: the remembered leaders are leaders.json's
// (the station's applyPatch writes them there). A doc that drops one leaves the
// local copy alone (an empty list is how the doc says "none").
const NOT_IN_CONFIG = ['leaders'];

/** The church part of a config.json (and the leaders list), for the first-run seed. */
function seedFrom(cfg, churchConfig, extras) {
  const raw = {};
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  for (const key of church.CHURCH_KEYS) {
    if (key === 'schedule') {
      // Only rows of its own: the built-in default schedule is not the church's choice.
      if (Array.isArray(c.schedule) && c.schedule.length) raw.schedule = c.schedule;
    } else if (key === 'barfNights') {
      if (Array.isArray(c.barfNights)) raw.barfNights = c.barfNights;
      else if (churchConfig && Array.isArray(churchConfig.barfNights)) raw.barfNights = churchConfig.barfNights;
    } else if (NOT_IN_CONFIG.includes(key)) {
      if (extras && extras[key] !== undefined && extras[key] !== null) raw[key] = extras[key];
    } else if (c[key] !== undefined && c[key] !== null) {
      raw[key] = c[key];
    }
  }
  return church.sanitizeChurch(raw).settings;
}

/**
 * @param {{
 *   signedIn: () => ({ base: string, session: string } | null),
 *   request: (base: string, path: string, opts?: any) => Promise<{ ok: boolean, status: number, body: any }>,
 *   isStation: () => boolean,
 *   stationId: () => (string | null),
 *   readConfig: () => any,
 *   churchConfig?: () => any,
 *   seedExtras?: () => Record<string, any>,
 *   localOff?: () => boolean,
 *   applyPatch: (patch: Record<string, any>, deletes: string[]) => { errors: {key: string, error: string}[], changed: string[], pickupChanged: boolean, seasonChanged: boolean },
 *   onApplied?: (result: any) => void,
 *   onSwitches?: (prev: Record<string, string> | null, next: Record<string, string>) => void,
 *   loadApplied?: () => any,
 *   saveApplied?: (state: any) => void,
 *   now?: () => number,
 *   log?: (m: string) => void,
 * }} o
 */
function createChurchSync(o) {
  const now = o.now || Date.now;
  const log = o.log || (() => {});
  const localOff = o.localOff || (() => false);
  let applied = { rev: 0, switchesRev: 0, appliedAt: null, keys: [] };
  try {
    const saved = o.loadApplied ? o.loadApplied() : null;
    if (saved && typeof saved === 'object') {
      applied = {
        rev: revOf(saved.rev), switchesRev: revOf(saved.switchesRev),
        appliedAt: typeof saved.appliedAt === 'string' ? saved.appliedAt : null,
        keys: Array.isArray(saved.keys) ? saved.keys.filter((k) => church.CHURCH_KEYS.includes(k)) : [],
      };
    }
  } catch { /* a damaged file is a fresh start: the next fetch applies the doc */ }
  let switches = null;
  let switchesRev = applied.switchesRev;
  let paused = false;
  let lastOk = false;
  let lastDoc = null;   // {rev, settings}: the Worker's doc as last seen (for this computer's own edits)
  let seenRev = -1;
  let unseeded = false;   // the last answer was an empty doc (rev 0) this computer did not seed
  let busy = null;
  let again = false;
  let lastFetchAt = 0;
  let signedInSince = 0;
  let startFetchDone = false;
  let lastError = null;
  let warnings = [];

  function save() {
    try { if (o.saveApplied) o.saveApplied({ rev: applied.rev, switchesRev, appliedAt: applied.appliedAt, keys: applied.keys }); } catch (e) { log(`[church] could not save the applied state: ${e && e.message}`); }
  }

  function call(method, body) {
    const s = o.signedIn();
    if (!s) return Promise.resolve({ ok: false, status: 0, body: null });
    const station = o.isStation() ? o.stationId() : null;
    return o.request(s.base, '/v1/church/settings', { method, ...(body ? { body } : {}), session: s.session, ...(station ? { station } : {}) });
  }

  function takeSwitches(doc) {
    const next = cleanSwitches(doc.switches);
    if (!next) return;
    const prev = switches;
    switches = next;
    const sr = revOf(doc.switchesRev);
    if (sr !== switchesRev) { switchesRev = sr; save(); }
    if (typeof o.onSwitches === 'function' && JSON.stringify(prev) !== JSON.stringify(next)) {
      try { o.onSwitches(prev, next); } catch (e) { log(`[church] switches hook: ${e && e.message}`); }
    }
  }

  function apply(doc, rev) {
    const { settings, dropped } = church.sanitizeChurch(doc.settings);
    const patch = {};
    const deletes = [];
    for (const key of church.CHURCH_KEYS) {
      if (Object.prototype.hasOwnProperty.call(settings, key)) {
        if (settings[key] === null) { if (!NOT_IN_CONFIG.includes(key)) deletes.push(key); }
        else patch[key] = settings[key];
      } else if (applied.keys.includes(key) && !dropped.includes(key) && !NOT_IN_CONFIG.includes(key)) {
        deletes.push(key);   // the doc held it at the last apply and no longer does: back to the default
      }
    }
    let result;
    try {
      result = o.applyPatch(patch, deletes);
    } catch (e) {
      lastError = `could not write config.json: ${e && e.message}`;
      warnings = [{ type: 'church-settings', message: `The church settings from awana.kvbchurch.org could not be saved on this computer (${e && e.message}). It keeps printing with its own settings.` }];
      log(`[church] ${lastError}`);
      seenRev = -1;   // the next lease asks again
      return 'write-failed';
    }
    const refused = [...dropped.filter((k) => church.CHURCH_KEYS.includes(k)).map((key) => ({ key, error: 'not a value this setting can hold' })), ...result.errors];
    warnings = refused.length ? [{
      type: 'church-settings',
      message: `${refused.length === 1 ? 'A church setting' : `${refused.length} church settings`} from awana.kvbchurch.org could not be used on this computer (${refused.map((r) => `${r.key}: ${r.error}`).join('; ').slice(0, 300)}); it keeps its own value${refused.length === 1 ? '' : 's'}. Change ${refused.length === 1 ? 'it' : 'them'} under Printing.`,
    }] : [];
    const keys = Object.keys(settings).filter((k) => settings[k] !== null);
    for (const k of dropped) if (applied.keys.includes(k) && church.CHURCH_KEYS.includes(k) && !keys.includes(k)) keys.push(k);
    applied = { rev, switchesRev, appliedAt: new Date(now()).toISOString(), keys };
    save();
    log(`[church] Applied the church settings (rev ${rev}${result.changed.length ? `: ${result.changed.join(', ')}` : ', nothing changed'})`);
    if (typeof o.onApplied === 'function') {
      try { o.onApplied(result); } catch (e) { log(`[church] after-apply hook: ${e && e.message}`); }
    }
    return 'applied';
  }

  async function seed(depth) {
    const settings = seedFrom(o.readConfig(), o.churchConfig ? o.churchConfig() : null, o.seedExtras ? o.seedExtras() : null);
    if (JSON.stringify(settings).length > church.CHURCH_JSON_MAX) { lastError = 'the settings are too large to send'; return 'too-large'; }
    const r = await call('PUT', { seed: true, settings });
    if (r.status === 201) {
      seenRev = revOf(r.body && r.body.rev) || 1;
      lastDoc = { rev: seenRev, settings };
      applied = { rev: seenRev, switchesRev, appliedAt: new Date(now()).toISOString(), keys: Object.keys(settings) };
      save();
      log(`[church] Sent this computer's settings to awana.kvbchurch.org (the first copy, rev ${applied.rev})`);
      return 'seeded';
    }
    if (r.ok && r.body && r.body.already) return depth ? 'already' : fetchOnce(1);   // another station was first
    lastError = r.status ? `the seed was refused (HTTP ${r.status})` : 'the service is unreachable';
    seenRev = -1;   // the next lease asks again
    return 'seed-failed';
  }

  async function fetchOnce(depth = 0) {
    if (!o.signedIn()) return 'signed-out';
    const r = await call('GET');
    lastFetchAt = now();
    if (!r.ok || !r.body || typeof r.body !== 'object') {
      lastError = r.status ? `HTTP ${r.status}` : 'unreachable';
      lastOk = false;
      return 'error';
    }
    const doc = r.body;
    lastError = null;
    lastOk = true;
    seenRev = revOf(doc.rev);
    takeSwitches(doc);
    paused = doc.paused === true;
    if (localOff()) return 'local-off';
    if (paused) return 'paused';
    const rev = revOf(doc.rev);
    if (doc.settings && typeof doc.settings === 'object' && rev > 0) lastDoc = { rev, settings: doc.settings };
    if (rev === 0 || !doc.settings || typeof doc.settings !== 'object') {
      if (o.isStation()) { unseeded = false; return seed(depth); }
      unseeded = true;   // asked again once this computer is a station (stationActive, the lease)
      return 'not-seeded';
    }
    unseeded = false;
    // A rev other than the applied one (a lower one: the doc was made again).
    if (rev === applied.rev) return 'current';
    return apply(doc, rev);
  }

  /** One fetch (and apply or seed); a call while one runs makes it run once more. Never throws. */
  function syncNow() {
    if (busy) { again = true; return busy; }
    busy = (async () => {
      let out;
      do {
        again = false;
        try { out = await fetchOnce(); } catch (e) { lastError = e && e.message; out = 'error'; log(`[church] ${lastError}`); }
      } while (again);
      return out;
    })().finally(() => { busy = null; });
    return busy;
  }

  /**
   * This computer's own change to the church doc (a new remembered leader): the
   * edit route, `{baseRev, settings: patch}` where `build(docSettings)` makes the
   * patch from the doc as the Worker holds it (null: nothing to change). A stale
   * base applies the Worker's newer doc first and builds again, at most twice.
   * Only while the Worker is the one writer; never throws, never awaited by a print.
   * @param {(settings: Record<string, any>) => (Record<string, any> | null)} build
   */
  async function edit(build) {
    if (!managed()) return 'not-managed';
    for (let attempt = 0; attempt < 3; attempt++) {
      if (busy) { try { await busy; } catch { /* its own result */ } }
      if (!lastDoc) { const f = await syncNow(); if (!lastDoc) return f; }
      const patch = build({ ...lastDoc.settings });
      if (!patch) return 'unchanged';
      const base = lastDoc.rev;
      const r = await call('PUT', { baseRev: base, settings: patch });
      if (r.ok && r.body) {
        const rev = revOf(r.body.rev);
        const merged = r.body.settings && typeof r.body.settings === 'object' ? r.body.settings : church.mergeChurch(lastDoc.settings, patch);
        lastDoc = { rev, settings: merged };
        seenRev = rev;
        // Our own change: config / leaders.json already hold it. Counted as applied only when
        // nothing else landed in between (else the next fetch applies the whole doc).
        if (applied.rev === base) { applied = { ...applied, rev, appliedAt: new Date(now()).toISOString() }; save(); }
        return 'saved';
      }
      if (r.status === 409 && r.body && r.body.reason === 'stale') { await syncNow(); continue; }
      lastError = r.status ? `the change was refused (HTTP ${r.status})` : 'the service is unreachable';
      return 'failed';
    }
    return 'stale';
  }

  /** The print lease's `church: {rev, switchesRev}`: fetch when either moved. */
  function onChurch(rev, sRev) {
    const r = revOf(rev);
    const s = revOf(sRev);
    // An empty doc this computer saw before it was a station: every lease asks
    // again (and seeds) until the doc holds settings.
    if (lastOk && r === seenRev && s === switchesRev && !(unseeded && r === 0)) return;
    // A failed fetch is not tried again on every lease (one every 5 s): at most every 30 s.
    if (!lastOk && lastFetchAt && now() - lastFetchAt < RETRY_MS) return;
    syncNow().catch(() => {});
  }

  /**
   * The station role just became active (configureCloud). A first fetch made
   * before it left an empty doc unseeded, and a station does not poll: ask
   * again now, so it seeds. Never throws.
   */
  function stationActive() {
    if (!unseeded || !o.signedIn() || !o.isStation()) return null;
    return syncNow().catch(() => {});
  }

  /** The loop's step (every 5 s): the first fetch after sign-in, the non-station poll. */
  function tick() {
    if (!o.signedIn()) { signedInSince = 0; startFetchDone = false; return null; }
    const t = now();
    if (!signedInSince) signedInSince = t;
    if (!startFetchDone) {
      if (t - signedInSince < START_DELAY_MS) return null;
      startFetchDone = true;
      return syncNow();
    }
    if (!o.isStation() && t - lastFetchAt >= POLL_MS) return syncNow();
    return null;
  }

  function start({ setIntervalFn = setInterval, clearIntervalFn = clearInterval } = {}) {
    const timer = setIntervalFn(() => { try { const p = tick(); if (p && p.catch) p.catch(() => {}); } catch { /* never */ } }, TICK_MS);
    if (timer && timer.unref) timer.unref();
    return () => clearIntervalFn(timer);
  }

  /** Is the Worker the one writer of the church keys right now? */
  function managed() {
    return !!o.signedIn() && !localOff() && !paused && applied.rev >= 1;
  }

  function status() {
    return { rev: applied.rev, appliedAt: applied.appliedAt, source: managed() ? 'worker' : 'config', paused };
  }

  return {
    syncNow, onChurch, stationActive, tick, start, managed, status, edit,
    appliedRev: () => applied.rev,
    switches: () => (switches ? { ...switches } : null),
    warnings: () => warnings.slice(),
    lastError: () => lastError,
  };
}

module.exports = { createChurchSync, seedFrom, NOT_IN_CONFIG, cleanSwitches, SWITCH_NAMES, START_DELAY_MS, POLL_MS, TICK_MS };
