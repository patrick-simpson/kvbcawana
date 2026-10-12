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
import * as sp from '../../lobby/shared/sync-protocol.js';
import * as cc from '../../lobby/shared/cloud-crypto.js';

const REPO = path.dirname(new URL(import.meta.url).pathname).replace(/\/test$/, '');
const SYNC_JS = readFileSync(path.join(REPO, 'public', 'src', 'sync.js'), 'utf8');
const SERVICE = 'https://awana-sync.test.workers.dev';
const SESSION = 'v1.1.1790839331729.oWr6n92IJW5ldPGmtiyjPHAZpca-QGToNlKGXlKI6vc';
const KEY = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=';

const V2_PARAMS = { v: 2, salt: 'AAECAwQFBgcICQoLDA0ODw==', iter: 600000, legacy: true, upgrade: false };
const V2_AUTHKEY = await cc.deriveAuthKey('kennebec', V2_PARAMS.salt, V2_PARAMS.iter);

const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };

/** Boot the kiosk, then sync.js against a stand-in service. */
function boot({ url = SERVICE, journey = null, prefs = {}, stateStatus = 200, v2 = false, modules = true } = {}) {
  const kiosk = bootKiosk({}, prefs);
  const { window } = kiosk;
  if (modules) window.journeyAuthModules = { sp, cc };
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
        ? reply(200, { session: SESSION, displayKey: KEY, state: { journey }, history: null })
        : reply(401, { reason: 'wrong', triesLeft: 4 });
    }
    if (route === '/v1/login') {
      if (body.passphrase !== 'kennebec') return reply(401, { triesLeft: 4 });
      return reply(200, { session: SESSION, displayKey: KEY, pusher: { key: 'pk', cluster: 'us2' }, state: { journey } });
    }
    if (route === '/v1/state') return reply(stateStatus, { journey });
    if (route === '/v1/journey') return reply(200, { savedAt: '2026-10-01T19:00:00.000Z', settings: body.settings });
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
  await settle();
  assert.match(doc.getElementById('sync-status').textContent, /4 tries left/);

  doc.getElementById('sync-passphrase').value = '  Kennebec ';
  doc.getElementById('sync-signin-btn').click();
  await settle();
  const ls = k.window.localStorage;
  assert.equal(ls.getItem('awanaSyncSession.v1'), SESSION);
  assert.equal(ls.getItem('awanaDisplayKey.v1'), KEY);
  assert.equal(JSON.parse(ls.getItem('awanaConfig.v1')).pusherAppKey, 'pk');
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

test('if the shared modules cannot load, the kiosk still signs in the old way', async () => {
  const k = boot({ journey: ROOM, modules: false });
  k.window.journeyAuthModules = undefined;
  // jsdom cannot import(), so loading fails: that is the "old browser / missing file" case
  await settle();
  k.document.getElementById('sync-passphrase').value = 'kennebec';
  k.document.getElementById('sync-signin-btn').click();
  for (let i = 0; i < 40 && !k.window.localStorage.getItem('awanaSyncSession.v1'); i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(k.window.localStorage.getItem('awanaSyncSession.v1'), SESSION);
  assert.deepEqual(k.calls.find((c) => c.route === '/v1/login').body, { passphrase: 'kennebec' });
  k.close();
});
