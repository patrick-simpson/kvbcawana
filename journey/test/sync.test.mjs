// The sync service from Journey's side (public/src/sync.js): hidden until the
// display site names a service, sign-in with the church passphrase into the
// slots the embedded lobby screen shares, the room settings following the
// service, a change here going back to it, and video quality never travelling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { bootKiosk, tick } from './kiosk-dom.mjs';
// The family's one sign-in (sync-protocol.js) and derivation (cloud-crypto.js): the page imports them as ES
// modules from src/shared/ (family-assets copies); jsdom cannot import(), so the harness hands them over.
import * as sp from '../../shared/sync-protocol.js';
import * as cc from '../../shared/cloud-crypto.js';
// The registry's own allowlist (the Worker applies exactly this to a hello's status).
import { isScreenId, sanitizeScreenStatus } from '../../lobby/src/lib/syncSpecs.js';

const REPO = path.dirname(new URL(import.meta.url).pathname).replace(/\/test$/, '');
const SYNC_JS = readFileSync(path.join(REPO, 'public', 'src', 'sync.js'), 'utf8');
const SERVICE = 'https://awana-sync.test.workers.dev';
const SESSION = 'v1.1.1790839331729.oWr6n92IJW5ldPGmtiyjPHAZpca-QGToNlKGXlKI6vc';
const KEY = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=';

const V2_PARAMS = { v: 2, salt: 'AAECAwQFBgcICQoLDA0ODw==', iter: 600000, legacy: true, upgrade: false };
const V2_AUTHKEY = await cc.deriveAuthKey('kennebec', V2_PARAMS.salt, V2_PARAMS.iter);

const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };

/** Boot the kiosk, then sync.js against a stand-in service. */
function boot({ url = SERVICE, journey = null, prefs = {}, stateStatus = 200, v2 = true, modules = true, pageUrl, screenName = '', tuning = null, helloAnswer = null, helloStatus = 200, nowAnswer = null } = {}) {
  const kiosk = bootKiosk({}, prefs, undefined, null, pageUrl);
  const { window } = kiosk;
  if (modules) window.journeyAuthModules = { sp, cc };
  if (tuning) window.journeyScreenTuning = tuning;
  const calls = [];
  const inner = window.fetch;
  const reply = (status, body) => Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
  window.fetch = (u, init = {}) => {
    const href = String(u);
    if (href.endsWith('/shared/sync.json')) return reply(200, { url });
    if (!href.startsWith(SERVICE)) return inner(u, init);
    const route = href.slice(SERVICE.length);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ route, method: init.method || 'GET', body, auth: (init.headers || {}).Authorization || null });
    if (route === '/v1/auth/params') return v2 ? reply(200, V2_PARAMS) : reply(404, {});
    if (route === '/v1/login' && body.authKey) {
      return body.authKey === V2_AUTHKEY && !body.passphrase
        ? reply(200, { session: SESSION, displayKey: KEY, pusher: { key: 'pk', cluster: 'us2' }, state: { journey }, history: null })
        : reply(401, { reason: 'wrong', triesLeft: 4 });
    }
    // The old {passphrase} login is gone (owner 2026-10-16): the service refuses it.
    if (route === '/v1/login') return reply(401, { reason: 'legacy-off' });
    if (route === '/v1/state') return reply(stateStatus, { journey });
    if (route === '/v1/journey') return reply(200, { savedAt: '2026-10-01T19:00:00.000Z', settings: body.settings });
    if (route === '/v1/screens/hello') {
      if (helloStatus !== 200) return reply(helloStatus, { error: 'unauthorized' });
      const extra = helloAnswer ? helloAnswer(body, calls) : { settings: null };
      return reply(200, { screen: { id: body.id, kind: body.kind, name: screenName || body.name }, ...extra });
    }
    // The phone remote's poll (worker/src/routes.md 10.9): [status, body].
    if (route === '/v1/screens/now' && nowAnswer) return reply(...nowAnswer(body, calls));
    if (/^\/v1\/screens\/[^/]+\/settings$/.test(route) && init.method === 'PUT') {
      return reply(200, { savedAt: `2026-10-12T20:00:0${calls.length % 10}.000Z`, settings: body.settings, dropped: [] });
    }
    return reply(404, {});
  };
  const script = window.document.createElement('script');
  script.textContent = SYNC_JS;
  window.document.body.appendChild(script);
  return { ...kiosk, calls };
}

const ROOM = {
  savedAt: '2026-10-01T18:00:00.000Z',
  settings: {
    captions: true, captionSize: '1.3', captionBackdrop: true, slidesAutoAdvanceSec: 30,
    slideExtras: { questions: false, takeaways: true, challenges: true },
    slideNotes: { 5: { questions: ['What is grace?'] } },
  },
};

test('hidden, and silent, until the display site names a service', async () => {
  const k = boot({ url: '' });
  await settle();
  assert.ok(k.document.getElementById('settings-sync').classList.contains('hidden'));
  assert.equal(k.calls.length, 0);
  k.close();
});

test('"kennebec" signs in into the slots the lobby screen shares, and takes the room\'s settings', async () => {
  const k = boot({ journey: ROOM });
  await settle();
  const doc = k.document;
  assert.ok(!doc.getElementById('settings-sync').classList.contains('hidden'));

  doc.getElementById('sync-passphrase').value = 'kenebec';
  doc.getElementById('sync-signin-btn').click();
  // passphrase v2: the kiosk derives the authKey first (600000 rounds), so wait for the answer
  for (let i = 0; i < 60 && !/4 tries left/.test(doc.getElementById('sync-status').textContent); i++) await new Promise((r) => setTimeout(r, 100));
  assert.match(doc.getElementById('sync-status').textContent, /4 tries left/);

  doc.getElementById('sync-passphrase').value = '  Kennebec ';
  doc.getElementById('sync-signin-btn').click();
  for (let i = 0; i < 60 && !k.window.localStorage.getItem('awanaSyncSession.v1'); i++) await new Promise((r) => setTimeout(r, 100));
  await settle();
  const ls = k.window.localStorage;
  assert.equal(ls.getItem('awanaSyncSession.v1'), SESSION);
  assert.equal(ls.getItem('awanaDisplayKey.v1'), KEY);
  // An old service's Pusher key is never copied into the lobby's config slot (Pusher is gone).
  assert.ok(!(JSON.parse(ls.getItem('awanaConfig.v1') || '{}')).pusherAppKey);
  assert.ok(doc.getElementById('sync-signin').classList.contains('hidden'));

  assert.equal(ls.getItem('journey.captions'), 'on');
  assert.equal(ls.getItem('journey.captions.size'), '1.3');
  assert.equal(ls.getItem('journey.captions.backdrop'), 'on');
  assert.equal(ls.getItem('journey.slides.autoAdvanceSec'), '30');
  assert.deepEqual(JSON.parse(ls.getItem('journey.slides.notesOverride')), { 5: { questions: ['What is grace?'] } });
  // The live controls follow, through schedule.js's own helpers.
  assert.equal(doc.getElementById('captions-size').value, '1.3');
  assert.equal(doc.getElementById('captions-backdrop').checked, true);
  assert.equal(doc.getElementById('slides-auto-advance').value, '30');
  assert.equal(doc.getElementById('slides-extra-questions').checked, false);
  k.close();
});

test('a signed-in screen pulls the room\'s settings at start', async () => {
  const k = boot({ journey: ROOM, prefs: { 'awanaSyncSession.v1': SESSION } });
  await settle();
  const pull = k.calls.find((c) => c.route === '/v1/state');
  assert.equal(pull.auth, `Bearer ${SESSION}`);
  assert.equal(k.window.localStorage.getItem('journey.captions.size'), '1.3');
  k.close();
});

test('a pull never overwrites a change made here that has not gone up yet', async () => {
  const journey = structuredClone(ROOM);
  const k = boot({ journey, prefs: { 'awanaSyncSession.v1': SESSION } });
  await settle();
  // An edit made here, its push not yet sent...
  k.window.localStorage.setItem('journey.captions.size', '0.8');
  // ...while the room has moved on.
  journey.savedAt = '2026-10-02T18:00:00.000Z';
  journey.settings = { ...journey.settings, captionSize: '1.6' };
  await k.window.journeySync.pull();
  await settle();
  assert.equal(k.window.localStorage.getItem('journey.captions.size'), '0.8', 'the local edit survives the pull');
  const put = k.calls.filter((c) => c.route === '/v1/journey' && c.method === 'PUT').at(-1);
  assert.ok(put && put.body.settings.captionSize === '0.8', 'and it is sent up');
  k.close();
});

test('a change here goes to every Journey screen, and a leftover quality choice never does', async () => {
  const k = boot({ journey: ROOM, prefs: { 'awanaSyncSession.v1': SESSION, 'journey.playback.quality': 'low' } });
  await settle();
  const size = k.document.getElementById('captions-size');
  size.value = '0.8';
  size.dispatchEvent(new k.window.Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 1200));
  await settle();
  const put = k.calls.filter((c) => c.route === '/v1/journey' && c.method === 'PUT').at(-1);
  assert.ok(put, 'a PUT went out');
  assert.equal(put.body.settings.captionSize, '0.8');
  assert.equal(JSON.stringify(put.body).includes('quality'), false);
  assert.equal(JSON.stringify(put.body).includes('playback'), false);
  k.close();
});

test('a passphrase change elsewhere signs this screen out and says so', async () => {
  const k = boot({ journey: ROOM, prefs: { 'awanaSyncSession.v1': SESSION }, stateStatus: 401 });
  await settle();
  assert.equal(k.window.localStorage.getItem('awanaSyncSession.v1'), null);
  assert.match(k.document.getElementById('sync-status').textContent, /passphrase was changed/);
  assert.ok(!k.document.getElementById('sync-signin').classList.contains('hidden'));
  k.close();
});

test('a sign-in made in another window (the configure page) signs this screen in, without a reload', async () => {
  const k = boot({ journey: ROOM });
  await settle();
  const doc = k.document;
  assert.ok(!doc.getElementById('sync-signin').classList.contains('hidden'), 'signed out to begin with');
  assert.equal(k.calls.filter((c) => c.route === '/v1/state').length, 0);
  // The other window writes the shared slot; this one only hears the event.
  k.window.localStorage.setItem('awanaSyncSession.v1', SESSION);
  k.window.dispatchEvent(new k.window.StorageEvent('storage', { key: 'awanaSyncSession.v1' }));
  await settle();
  assert.ok(doc.getElementById('sync-signin').classList.contains('hidden'));
  assert.ok(!doc.getElementById('sync-signed-in').classList.contains('hidden'));
  const pull = k.calls.find((c) => c.route === '/v1/state');
  assert.equal(pull.auth, `Bearer ${SESSION}`, 'the room is pulled now, not at the next ten-minute tick');
  assert.equal(doc.getElementById('captions-size').value, '1.3');
  // And a sign-out there signs this one out.
  k.window.localStorage.removeItem('awanaSyncSession.v1');
  k.window.dispatchEvent(new k.window.StorageEvent('storage', { key: 'awanaSyncSession.v1' }));
  assert.ok(!doc.getElementById('sync-signin').classList.contains('hidden'));
  k.close();
});

test('passphrase v2: the kiosk derives the authKey itself and sends only that', async () => {
  const k = boot({ journey: ROOM, v2: true });
  await settle();
  const doc = k.document;
  doc.getElementById('sync-passphrase').value = '  Kennebec ';
  doc.getElementById('sync-signin-btn').click();
  for (let i = 0; i < 40 && !k.window.localStorage.getItem('awanaSyncSession.v1'); i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(k.window.localStorage.getItem('awanaSyncSession.v1'), SESSION);
  assert.equal(k.window.localStorage.getItem('awanaDisplayKey.v1'), KEY);
  const login = k.calls.find((c) => c.route === '/v1/login');
  assert.deepEqual(Object.keys(login.body), ['authKey']);
  assert.equal(JSON.stringify(k.calls).includes('ennebec'), false, 'the passphrase never leaves the kiosk');
  k.close();
});

test('passphrase v2: a wrong word is refused and counted, and the session stays empty', async () => {
  const k = boot({ journey: ROOM, v2: true });
  await settle();
  k.document.getElementById('sync-passphrase').value = 'kenebec';
  k.document.getElementById('sync-signin-btn').click();
  for (let i = 0; i < 40 && !/not the passphrase/.test(k.document.getElementById('sync-status').textContent); i++) await new Promise((r) => setTimeout(r, 100));
  assert.match(k.document.getElementById('sync-status').textContent, /not the passphrase.*4 tries left/);
  assert.equal(k.window.localStorage.getItem('awanaSyncSession.v1'), null);
  k.close();
});

test('if the shared modules cannot load, the kiosk says to reload and sends no sign-in at all', async () => {
  const k = boot({ journey: ROOM, modules: false });
  k.window.journeyAuthModules = undefined;
  // jsdom cannot import(), so loading fails: that is the "old browser / missing file / stale page" case
  await settle();
  k.document.getElementById('sync-passphrase').value = 'kennebec';
  k.document.getElementById('sync-signin-btn').click();
  for (let i = 0; i < 40 && !/newest page/.test(k.document.getElementById('sync-status').textContent); i++) await new Promise((r) => setTimeout(r, 100));
  assert.match(k.document.getElementById('sync-status').textContent, /Sign-in needs the newest page\. Reload this page/);
  assert.equal(k.window.localStorage.getItem('awanaSyncSession.v1'), null);
  assert.equal(k.calls.filter((c) => c.route === '/v1/login').length, 0);
  assert.ok(!JSON.stringify(k.calls).includes('kennebec'));
  k.close();
});

test('a service with no passphrase v2 is never sent the passphrase', async () => {
  const k = boot({ journey: ROOM, v2: false });
  await settle();
  k.document.getElementById('sync-passphrase').value = 'kennebec';
  k.document.getElementById('sync-signin-btn').click();
  for (let i = 0; i < 40 && !/older than this app/.test(k.document.getElementById('sync-status').textContent); i++) await new Promise((r) => setTimeout(r, 100));
  assert.match(k.document.getElementById('sync-status').textContent, /older than this app/);
  assert.equal(k.calls.filter((c) => c.route === '/v1/login').length, 0);
  assert.equal(k.window.localStorage.getItem('awanaSyncSession.v1'), null);
  k.close();
});

// ── This kiosk on the settings page (the screen registry) ──

const hellos = (k) => k.calls.filter((c) => c.route === '/v1/screens/hello');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const GIB = 1024 ** 3;
/** What schedule.js's journeyDownloadStatus() answers, as it shapes it. */
const DOWNLOADS = {
  total: 63, saved: 24, bytesSaved: 11.2 * GIB, bytesTotal: 13.9 * GIB, downloading: true, waiting: null, paused: false,
  percent: 42, currentWeek: 7, lastSavedAt: '2026-10-12T14:00:00.000Z', error: null, auto: true, supported: true, known: true,
};

test('signed in, the kiosk says hello as a Journey kiosk under an id it keeps in the lobby\'s slot', async () => {
  const other = { id: 'tv_aaaaaaaaaaaaaaaaaaaa', synced: null };
  const k = boot({ journey: ROOM, prefs: { 'awanaSyncSession.v1': SESSION, 'awanaScreens.v1': JSON.stringify({ lobby: other }) }, screenName: 'Journey room' });
  await settle();
  const [hi] = hellos(k);
  assert.ok(hi, 'a hello went out at start');
  assert.equal(hi.method, 'POST');
  assert.equal(hi.auth, `Bearer ${SESSION}`);
  assert.equal(hi.body.kind, 'journey');
  assert.equal(hi.body.name, 'Journey kiosk');
  assert.ok(isScreenId(hi.body.id), 'an id the Worker accepts');
  // jsdom cannot save lessons: the kiosk still reports, and says so.
  assert.equal(hi.body.status.lessons.supported, false, 'a browser that cannot save lessons says so');
  assert.equal(hi.body.status.lessons.known, false);
  assert.deepEqual(sanitizeScreenStatus('journey', hi.body.status), hi.body.status);
  const slot = JSON.parse(k.window.localStorage.getItem('awanaScreens.v1'));
  assert.deepEqual(slot.lobby, other, 'the lobby\'s own entry is left alone');
  assert.equal(slot.journey.id, hi.body.id);
  assert.equal(slot.journey.name, 'Journey room', 'the name /settings gave it is kept');
  // The same id at the next hello, under the name it was given.
  await k.window.journeySync.hello();
  assert.equal(hellos(k).at(-1).body.id, hi.body.id);
  assert.equal(hellos(k).at(-1).body.name, 'Journey room');
  k.close();
});

test('its saved lessons ride the hello, trimmed to exactly what the registry keeps, never twice in a minute', async () => {
  const k = boot({ journey: ROOM, prefs: { 'awanaSyncSession.v1': SESSION }, tuning: { minGapMs: 300, helloMs: 60_000 } });
  let status = { ...DOWNLOADS, error: `Week 7 · Leader: ${'x'.repeat(400)}` };
  k.window.journeyDownloadStatus = () => status;
  await settle();
  const first = hellos(k)[0];
  assert.ok(first.body.status, 'the first hello carries it');
  const sent = first.body.status;
  assert.deepEqual(Object.keys(sent), ['lessons']);
  assert.equal(sent.lessons.supported, true);
  assert.equal(sent.lessons.known, true);
  assert.ok(sent.lessons.error.length <= 120);
  assert.deepEqual(sanitizeScreenStatus('journey', sent), sent, 'the Worker keeps every field the kiosk sends, unchanged');
  assert.equal(sent.lessons.currentWeek, 7);

  // Bytes arriving: one hello once the minute (here 300 ms) is up, not one per event.
  for (let i = 1; i <= 5; i++) {
    status = { ...status, bytesSaved: status.bytesSaved + i * 1e6 };
    k.window.dispatchEvent(new k.window.CustomEvent('journey-download-status', { detail: status }));
  }
  await settle();
  assert.equal(hellos(k).length, 1, 'not before the gap');
  await wait(400);
  await settle();
  assert.equal(hellos(k).length, 2);
  assert.equal(hellos(k)[1].body.status.lessons.bytesSaved, Math.floor(status.bytesSaved));
  // Nothing changed: nothing sent.
  k.window.dispatchEvent(new k.window.CustomEvent('journey-download-status', { detail: status }));
  await wait(400);
  await settle();
  assert.equal(hellos(k).length, 2);
  k.close();
});

test('a kiosk that does not know yet, or cannot save lessons, still reports, and says which', async () => {
  const k = boot({ journey: ROOM, prefs: { 'awanaSyncSession.v1': SESSION } });
  k.window.journeyDownloadStatus = () => ({ ...DOWNLOADS, known: false, total: 0, saved: 0 });
  await settle();
  const checking = hellos(k)[0].body.status;
  assert.equal(checking.lessons.known, false);
  assert.equal(checking.lessons.supported, true);
  assert.deepEqual(sanitizeScreenStatus('journey', checking), checking);
  k.window.journeyDownloadStatus = () => ({ ...DOWNLOADS, supported: false, known: true });
  assert.deepEqual(
    [k.window.journeySync.lessonsStatus().supported, k.window.journeySync.lessonsStatus().known], [false, false],
    'nothing is "known" where nothing can be saved',
  );
  // A browser (automatic download off), nothing saved yet: reported as it is.
  k.window.journeyDownloadStatus = () => ({ ...DOWNLOADS, saved: 0, bytesSaved: 0, downloading: false, percent: 0, auto: false });
  const browser = JSON.parse(JSON.stringify(k.window.journeySync.lessonsStatus()));
  assert.deepEqual(sanitizeScreenStatus('journey', { lessons: browser }).lessons, browser);
  assert.equal(k.window.journeySync.lessonsStatus().auto, false);
  // No schedule.js to ask: no status (the Worker keeps the last).
  k.window.journeyDownloadStatus = undefined;
  assert.equal(k.window.journeySync.lessonsStatus(), null);
  k.close();
});

test('silent when signed out, and the configure window is never a second kiosk', async () => {
  const out = boot({ journey: ROOM });
  await settle();
  await out.window.journeySync.hello();
  assert.equal(hellos(out).length, 0);
  out.close();
  const cfg = boot({ journey: ROOM, prefs: { 'awanaSyncSession.v1': SESSION }, pageUrl: 'https://example.test/?configure=1' });
  await settle();
  await cfg.window.journeySync.hello();
  assert.equal(hellos(cfg).length, 0);
  assert.equal(cfg.window.localStorage.getItem('awanaScreens.v1'), null);
  cfg.close();
});

test('signing in says hello at once', async () => {
  const k = boot({ journey: ROOM });
  await settle();
  k.document.getElementById('sync-passphrase').value = 'kennebec';
  k.document.getElementById('sync-signin-btn').click();
  for (let i = 0; i < 40 && !hellos(k).length; i++) await wait(50);
  assert.equal(hellos(k).length, 1);
  assert.equal(hellos(k)[0].body.kind, 'journey');
  k.close();
});

/* ── The settings page (/settings → Journey): commands and the two switches ── */

/** A stand-in for schedule.js's window.journeySettingsPage (27-settings-page.js; tested there for real). */
function fakePage(k, prefs = { auto: true, leaders: true }) {
  const ran = [];
  const state = { ...prefs };
  k.window.journeySettingsPage = {
    command: (a) => { ran.push(a); return true; },
    prefs: () => ({ ...state }),
    setPrefs: (p) => { if (typeof p.auto === 'boolean') state.auto = p.auto; if (typeof p.leaders === 'boolean') state.leaders = p.leaders; },
  };
  return { ran, state };
}
const settingsPuts = (k) => k.calls.filter((c) => /\/v1\/screens\/[^/]+\/settings$/.test(c.route) && c.method === 'PUT');

test('a hello\'s actions run once each, only the five allowlisted, then a quick hello reports the new state', async () => {
  let queue = [
    { action: 'pause-downloads', at: '2026-10-12T20:00:00Z' },
    { action: 'format-disk', at: '2026-10-12T20:00:00Z' },
    'junk',
    { action: 'delete-downloads', at: '2026-10-12T20:00:01Z' },
  ];
  const k = boot({
    journey: ROOM, prefs: { 'awanaSyncSession.v1': SESSION }, tuning: { helloMs: 60_000, ackMs: 50 },
    // The service hands a queue over once (worker/src/screens.js).
    helloAnswer: () => { const actions = queue; queue = []; return { settings: null, actions }; },
  });
  const page = fakePage(k);
  await settle();
  for (let i = 0; i < 40 && page.ran.length < 2; i++) await wait(10);
  assert.deepEqual(page.ran, ['pause-downloads', 'delete-downloads'], 'in order, nothing off the list');
  for (let i = 0; i < 40 && hellos(k).length < 2; i++) await wait(10);
  assert.equal(hellos(k).length, 2, 'a hello soon after, so the page sees what happened');
  await settle();
  assert.deepEqual(page.ran, ['pause-downloads', 'delete-downloads'], 'never twice');
  assert.equal(k.window.journeySync.runActions(new Array(9).fill({ action: 'stop-downloads' })), 5, 'at most five from one answer');
  k.close();
});

test('the two switches: the service\'s newer copy is taken, a change made here goes up, a service with none gets this kiosk\'s', async () => {
  let remote = null;
  const k = boot({ journey: ROOM, prefs: { 'awanaSyncSession.v1': SESSION }, tuning: { helloMs: 60_000, prefsDelayMs: 20 }, helloAnswer: () => ({ settings: remote }) });
  const page = fakePage(k, { auto: true, leaders: true });
  await settle();
  for (let i = 0; i < 40 && !settingsPuts(k).length; i++) await wait(10);
  // No copy on the service yet: this kiosk's values go up.
  assert.deepEqual(settingsPuts(k)[0].body, { settings: { downloadsAuto: true, downloadsLeader: true } });
  const slot = () => JSON.parse(k.window.localStorage.getItem('awanaScreens.v1')).journey;
  assert.equal(typeof slot().synced.savedAt, 'string');

  // Changed on /settings: taken, and nothing sent back.
  remote = { savedAt: '2026-10-12T21:00:00.000Z', settings: { downloadsAuto: false, downloadsLeader: false, captions: true } };
  const before = settingsPuts(k).length;
  await k.window.journeySync.hello();
  await settle();
  assert.deepEqual(page.state, { auto: false, leaders: false });
  assert.equal(settingsPuts(k).length, before, 'agreed: nothing to send');
  assert.deepEqual(slot().synced, { savedAt: remote.savedAt, settings: { downloadsAuto: false, downloadsLeader: false } });

  // The same copy again: left alone (a press here since then is not undone).
  page.state.auto = true;
  await k.window.journeySync.hello();
  await settle();
  assert.equal(page.state.auto, true, 'an older copy never overwrites a change made here');
  assert.deepEqual(settingsPuts(k).at(-1).body.settings, { downloadsAuto: true, downloadsLeader: false }, 'it goes up instead');

  // A tick box here: up a moment later.
  page.state.leaders = true;
  const n = settingsPuts(k).length;
  const box = k.document.getElementById('downloads-leaders');
  box.dispatchEvent(new k.window.Event('change', { bubbles: true }));
  for (let i = 0; i < 40 && settingsPuts(k).length === n; i++) await wait(10);
  assert.deepEqual(settingsPuts(k).at(-1).body.settings, { downloadsAuto: true, downloadsLeader: true });
  k.close();
});

test('the embedded Check-in Display\'s doorbell: a hello now for this kiosk, a pull for the room; anything else ignored', async () => {
  const k = boot({ journey: ROOM, prefs: { 'awanaSyncSession.v1': SESSION }, tuning: { helloMs: 60_000, bellGapMs: 30 } });
  fakePage(k);
  await settle();
  const id = JSON.parse(k.window.localStorage.getItem('awanaScreens.v1')).journey.id;
  const frame = k.document.querySelector('#checkin-view iframe');
  const ring = (data, { source = frame ? frame.contentWindow : null, origin = k.window.location.origin } = {}) =>
    k.window.dispatchEvent(new k.window.MessageEvent('message', { data, source, origin }));
  const pulls = () => k.calls.filter((c) => c.route === '/v1/state').length;
  const h0 = hellos(k).length;
  const p0 = pulls();
  if (frame) {
    ring({ type: 'awana-display:sync-doorbell', what: 'screen-action', id });
    ring({ type: 'awana-display:sync-doorbell', what: 'screen-action', id }); // a burst is one hello
    await wait(80);
    await settle();
    assert.equal(hellos(k).length, h0 + 1);
    ring({ type: 'awana-display:sync-doorbell', what: 'journey' });
    await wait(300);
    await settle();
    assert.equal(pulls(), p0 + 1);
    // Another screen's id, another sender, another origin, or another message: nothing.
    ring({ type: 'awana-display:sync-doorbell', what: 'screen-action', id: 'tv_aaaaaaaaaaaaaaaaaaaa' });
    ring({ type: 'awana-display:sync-doorbell', what: 'screen-action', id }, { source: k.window });
    ring({ type: 'awana-display:sync-doorbell', what: 'screen-action', id }, { origin: 'https://evil.example' });
    ring({ type: 'awana-display:toggle-fullscreen', what: 'screen-action', id });
    await wait(80);
    await settle();
    assert.equal(hellos(k).length, h0 + 1);
  } else {
    assert.fail('the kiosk page has its Check-in Display iframe');
  }
  k.close();
});

/* ── A session the service refuses: signed out, and nothing keeps asking ── */

const nows = (k) => k.calls.filter((c) => c.route === '/v1/screens/now');
// Fast remote timers: a timed poll every 40 ms while a phone watches.
const REMOTE_FAST = { helloMs: 60_000, nowGapMs: 10, playingMs: 40, pollGapMs: 10, bellGapMs: 30 };

test('the phone remote\'s poll refused (401): signed out at once, and not one more poll until a new sign-in', async () => {
  const answer = { now: [401, { error: 'unauthorized' }] };
  const k = boot({
    journey: ROOM,
    prefs: { 'awanaSyncSession.v1': SESSION },
    tuning: REMOTE_FAST,
    helloAnswer: () => ({ settings: null, watch: true }), // a phone is watching
    nowAnswer: () => answer.now,
  });
  try {
    for (let i = 0; i < 40 && !nows(k).length; i++) await wait(10);
    assert.equal(nows(k).length, 1, 'the report a watching phone asks for');
    // Many timed polls' worth of time (in the field: 10 s each, about 360 an hour).
    await wait(600);
    await settle();
    assert.equal(nows(k).length, 1, `no poll after the 401 (${nows(k).length} sent)`);
    assert.equal(k.window.localStorage.getItem('awanaSyncSession.v1'), null, 'the session is dropped, as the pull drops it');
    assert.match(k.document.getElementById('sync-status').textContent, /passphrase was changed/);
    assert.ok(!k.document.getElementById('sync-signin').classList.contains('hidden'));
    assert.equal(k.window.journeySync.watching(), false);
    // Screen changes and the doorbell ask nothing while signed out.
    k.window.dispatchEvent(new k.window.CustomEvent('journey-remote-change'));
    await wait(100);
    assert.equal(nows(k).length, 1);

    // A new sign-in: the hello says a phone watches, and the polls resume.
    answer.now = [200, { actions: [], watch: true, hello: false }];
    k.document.getElementById('sync-passphrase').value = 'kennebec';
    k.document.getElementById('sync-signin-btn').click();
    for (let i = 0; i < 60 && nows(k).length < 3; i++) await wait(20);
    assert.ok(nows(k).length >= 3, `polling again after the new sign-in (${nows(k).length})`);
    assert.equal(nows(k).at(-1).auth, `Bearer ${SESSION}`);
  } finally {
    k.close();
  }
});

test('a hello refused (401) signs this screen out the same way, without waiting for the ten-minute pull', async () => {
  const k = boot({ journey: ROOM, prefs: { 'awanaSyncSession.v1': SESSION }, tuning: REMOTE_FAST, helloStatus: 401, nowAnswer: () => [200, { actions: [], watch: true }] });
  try {
    for (let i = 0; i < 40 && !hellos(k).length; i++) await wait(10);
    await settle();
    assert.equal(hellos(k).length, 1);
    assert.equal(k.window.localStorage.getItem('awanaSyncSession.v1'), null);
    assert.match(k.document.getElementById('sync-status').textContent, /passphrase was changed/);
    await wait(200);
    assert.equal(nows(k).length, 0);
  } finally {
    k.close();
  }
});

test('signing out while a phone watches leaves no remote timer running', async () => {
  const k = boot({
    journey: ROOM,
    prefs: { 'awanaSyncSession.v1': SESSION },
    tuning: REMOTE_FAST,
    helloAnswer: () => ({ settings: null, watch: true }),
    nowAnswer: () => [200, { actions: [], watch: true, hello: false }],
  });
  try {
    for (let i = 0; i < 40 && nows(k).length < 2; i++) await wait(10);
    assert.ok(nows(k).length >= 2, 'timed polls while watched');
    assert.equal(k.window.journeySync.watching(), true);
    k.document.getElementById('sync-signout-btn').click();
    assert.equal(k.window.journeySync.watching(), false, 'nobody watching as far as a signed-out kiosk knows');
    const n = nows(k).length;
    await wait(300);
    assert.equal(nows(k).length, n);
  } finally {
    k.close();
  }
});
