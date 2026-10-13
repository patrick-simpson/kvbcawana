import { SYNC_BASE, liveChannel } from './liveChannel.js';

// A stand-in for the sync Worker's overhaul routes (lobby/worker/src/routes.md
// section 10) for the settings page's specs, built beside the real Worker and
// coded to the documented contract: the overview, the switches, the notice,
// the change log, the church settings document and the cloud status. A plain
// module (Playwright refuses a spec that imports another spec): shared by
// settings-page.spec.js, settings-tonight.spec.js, settings-printing.spec.js
// and the screenshots.
//
// Signed in is a seeded session (liveChannel), so every spec starts as the
// owner does after typing the passphrase.

export { SYNC_BASE };

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
};

/** The state every route answers from; a spec edits it, and reads `calls`. */
export function makeWorld(over = {}) {
  const now = Date.now();
  return {
    calls: [],
    headers: [],
    overview: {
      at: new Date(now).toISOString(), night: '2026-10-14', clubNight: true,
      window: { open: true, opensInMin: 0, closesInMin: 90 },
      count: { source: 'report', checkedIn: 42, checkedOut: 3, byClub: { Sparks: 18, Cubbies: 14, Puggles: 10 }, reportAgeMs: 4000, enabled: true },
      read: { mode: 'watch', configured: true, signedIn: true, lastReadAt: new Date(now - 4000).toISOString(), lastOkAt: new Date(now - 4000).toISOString(), lastError: null, loginBlockedForSec: 0, watchIntervalSec: 5 },
      print: { queued: 0, leased: 0, dead: 0, checkThePrinter: 0, claims: {}, pendingToSeal: 0, stations: [{ stationId: 'st1', name: 'Check-in laptop', lastSeenAt: new Date(now - 15000).toISOString(), printer: { state: 'ok' }, version: '9.3.0', churchRev: 2 }] },
      ym: { enabled: true, due: false, checkedOut: 4, failed: 0, gaveUp: 0, pending: 1, lastError: null },
      switches: [], notice: null, church: { rev: 2, savedAt: new Date(now - 3600_000).toISOString(), seeded: true, paused: false },
      history: { db: true, pending: 0 }, changes: { head: 3, last: null },
    },
    switches: {
      rev: 1, updatedAt: null, by: null, stored: true,
      list: [
        { name: 'CLOUD_PRINT', group: 'online', value: 'off', default: 'off', source: 'default' },
        { name: 'SINGLE_PUBLISHER', group: 'online', value: 'on', default: 'on', source: 'default' },
        { name: 'YM_CHECKOUT', group: 'online', value: 'off', default: 'off', source: 'default' },
        { name: 'CHURCH_SETTINGS', group: 'safety', value: 'on', default: 'on', source: 'default' },
        { name: 'NOTICES', group: 'safety', value: 'on', default: 'on', source: 'default' },
        { name: 'CHANGE_LOG', group: 'safety', value: 'on', default: 'on', source: 'default' },
      ],
      stations: [{ stationId: 'st1', name: 'Check-in laptop', lastSeenAt: new Date(now - 15000).toISOString(), version: '9.3.0', churchRev: 2 }],
      warnings: [],
    },
    notice: null,
    changes: [
      { seq: 3, at: new Date(now - 600_000).toISOString(), device: { kind: 'page', name: 'Chrome on Android' }, what: 'shared', keys: ['standardDisplayMs'], before: { standardDisplayMs: 6000 }, after: { standardDisplayMs: 7000 }, undoable: true },
      { seq: 2, at: new Date(now - 7200_000).toISOString(), device: { kind: 'page', name: 'Chrome on Windows' }, what: 'switch', target: 'CLOUD_PRINT', keys: ['CLOUD_PRINT'], after: { CLOUD_PRINT: 'off' }, undoable: true },
      { seq: 1, at: new Date(now - 86400_000).toISOString(), device: { kind: 'station', name: 'Check-in laptop' }, what: 'church', keys: ['labelFooter'], undoable: false },
    ],
    undo: { status: 200, body: { ok: true, seq: 4 } },
    church: { rev: 2, savedAt: new Date(now - 3600_000).toISOString(), by: null, seeded: true, paused: false, settings: { labelFooter: 'KVBC Awana', lateGraceMin: 10, pickupClubs: ['Sparks', 'Cubbies'], barfNights: ['2026-10-28'] }, switches: {}, switchesRev: 1 },
    churchStale: false,
    stations: [{ stationId: 'st1', name: 'Check-in laptop', pub: 'AAAA', kid: 'k1', registeredAt: 1, lastSeenAt: now, printer: { state: 'ok' } }],
    auth: { v2: true, legacy: false, legacyOn: false, legacyLastAt: null },
    screens: [],
    journey: null,
    nights: [],
    summary: [],
    // GET /v1/history/import-status (routes.md 3, the trends back-fill); null answers 404 (an older Worker).
    importStatus: null,
    ...over,
  };
}

const json = (body, status = 200) => ({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });

/**
 * Sign the page in, open the live channel and answer the Worker's routes.
 * @returns {Promise<(event: string, data: unknown) => Promise<void>>} send a live frame
 */
export async function installWorker(page, w) {
  const send = await liveChannel(page);
  await page.route(`${SYNC_BASE}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const path = new URL(req.url()).pathname.replace(/^\/api/, '');
    const body = req.postData() ? JSON.parse(req.postData()) : undefined;
    w.calls.push({ method: req.method(), path, body });
    w.headers.push({ path, auth: Boolean(req.headers().authorization), device: req.headers()['x-device'], name: req.headers()['x-device-name'] });
    const m = req.method();
    if (path === '/v1/state') return route.fulfill(json({ settings: null, slides: null, template: null, journey: w.journey, calendar: null, kid: 'abcd1234' }));
    if (path === '/v1/screens') return route.fulfill(json({ screens: w.screens, max: 40 }));
    // The Journey room document and a kiosk's queued download buttons (routes.md 10.8).
    if (path === '/v1/journey' && m === 'GET') return route.fulfill(json({ journey: w.journey }));
    if (path === '/v1/journey' && m === 'PUT') {
      w.journey = { savedAt: new Date().toISOString(), settings: body.settings };
      return route.fulfill(json(w.journey));
    }
    if (/^\/v1\/screens\/[^/]+\/action$/.test(path) && m === 'POST') return route.fulfill(json({ ok: true, delivered: false, queued: true }));
    if (/^\/v1\/screens\/[^/]+\/settings$/.test(path) && m === 'PUT') return route.fulfill(json({ savedAt: new Date().toISOString(), settings: body.settings, dropped: [] }));
    if (path === '/v1/tonight/overview') return route.fulfill(json(w.overview));
    if (path === '/v1/switches' && m === 'GET') {
      return route.fulfill(json({ rev: w.switches.rev, updatedAt: w.switches.updatedAt, by: w.switches.by, stored: true, switches: w.switches.list, stations: w.switches.stations }));
    }
    if (path === '/v1/switches' && m === 'PUT') {
      const row = w.switches.list.find((s) => s.name === body.name);
      if (!row) return route.fulfill(json({ error: 'bad-name', reason: 'bad-name' }, 400));
      if (body.rev !== undefined && body.rev !== w.switches.rev) return route.fulfill(json({ reason: 'stale', rev: w.switches.rev }, 409));
      const oldStations = (w.switches.warnings || []).some((c) => c.startsWith('station-old')) ? (w.switches.stations || []).map((s) => ({ stationId: s.stationId, name: s.name, version: s.version ?? null })) : [];
      if (body.dryRun === true) return route.fulfill(json({ ok: true, dryRun: true, rev: w.switches.rev, switch: { ...row, value: body.value === 'default' ? row.default : body.value }, warnings: w.switches.warnings, oldStations }));
      row.value = body.value === 'default' ? row.default : body.value;
      row.source = body.value === 'default' ? 'default' : 'worker';
      w.switches.rev += 1;
      w.switches.updatedAt = new Date().toISOString();
      w.switches.by = { kind: 'page', name: 'Chrome on Linux' };
      return route.fulfill(json({ ok: true, rev: w.switches.rev, switch: row, warnings: w.switches.warnings, oldStations }));
    }
    if (path === '/v1/notice' && m === 'GET') return route.fulfill(json({ notice: w.notice }));
    if (path === '/v1/notice' && m === 'POST') {
      if (!body.message) return route.fulfill(json({ error: 'empty' }, 400));
      w.notice = { level: body.level, message: body.message, at: new Date().toISOString(), durationSec: body.durationMin * 60, until: new Date(Date.now() + body.durationMin * 60000).toISOString() };
      w.overview = { ...w.overview, notice: w.notice };
      return route.fulfill(json({ ok: true, notice: w.notice, until: w.notice.until, screens: 3 }));
    }
    if (path === '/v1/notice' && m === 'DELETE') {
      w.notice = null;
      w.overview = { ...w.overview, notice: null };
      return route.fulfill(json({ ok: true, cleared: true }));
    }
    if (path === '/v1/changes' && m === 'GET') return route.fulfill(json({ entries: w.changes, next: null, head: w.changes.length, off: false }));
    const undo = /^\/v1\/changes\/(\d+)\/undo$/.exec(path);
    if (undo && m === 'POST') {
      if (w.undo.status === 200) { const e = w.changes.find((c) => c.seq === Number(undo[1])); if (e) e.undoneBy = 99; }
      return route.fulfill(json(w.undo.body, w.undo.status));
    }
    if (path === '/v1/church/settings' && m === 'GET') return route.fulfill(json(w.church));
    if (path === '/v1/church/settings' && m === 'PUT') {
      if (w.churchStale) {
        w.churchStale = false;
        w.church = { ...w.church, rev: w.church.rev + 1, settings: { ...w.church.settings, labelFooter: 'Changed elsewhere' } };
        return route.fulfill(json({ reason: 'stale', rev: w.church.rev, settings: w.church.settings }, 409));
      }
      if (w.church.rev === 0 && !body.fromDefaults) return route.fulfill(json({ reason: 'not-seeded' }, 409));
      if (body.baseRev !== w.church.rev) return route.fulfill(json({ reason: 'stale', rev: w.church.rev, settings: w.church.settings }, 409));
      const next = { ...(w.church.settings || {}) };
      for (const [k, v] of Object.entries(body.settings)) { if (v === null) delete next[k]; else next[k] = v; }
      w.church = { ...w.church, rev: w.church.rev + 1, settings: next, savedAt: new Date().toISOString() };
      return route.fulfill(json({ ok: true, rev: w.church.rev, savedAt: w.church.savedAt, settings: next }));
    }
    if (path === '/v1/stations') return route.fulfill(json(w.stations));
    if (path === '/v1/print/reprint' && m === 'POST') return route.fulfill(json({ ok: true, jobId: body.jobId, existing: false }));
    if (path === '/v1/history/rows' && m === 'POST') return route.fulfill(json({ stored: body.rows.length, duplicates: 0 }));
    if (path === '/v1/cloud/status') return route.fulfill(json({ auth: w.auth }));
    if (path === '/v1/history/key') return route.fulfill(json({ pub: 'AAAA', kid: 'h1', wrapped: null, prev: null }));
    if (path === '/v1/history/nights') return route.fulfill(json(w.nights));
    if (path === '/v1/history/summary') return route.fulfill(json(w.summary));
    if (path === '/v1/history/import-status') return route.fulfill(w.importStatus ? json(w.importStatus) : json({ error: 'Not found.' }, 404));
    if (path === '/v1/history/rows' && m === 'GET') return route.fulfill(json({ rows: [], next: null }));
    return route.fulfill(json({ error: 'Not found.' }, 404));
  });
  return send;
}
