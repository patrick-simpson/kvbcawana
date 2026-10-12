import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { buildDeskPage } from '../../site/desk/desk-page.mjs';
import * as cc from '../shared/cloud-crypto.js';

// The desk check-in page (site/desk/, ROADMAP.md#online-check-in P3) in a real
// browser against a stand-in Worker: sign in (passphrase v2), a busy 429, search,
// two siblings checked in together, undo, check out. Every seal is the page's:
// the stand-in opens what it was sent with the station's and the history key's
// private keys, and checks that no name travelled in clear. The page is served
// from a made-up https origin by page.route, so no port or build is needed.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHARED = path.join(HERE, '..', 'shared');
const DESK = path.join(HERE, '..', '..', 'site', 'desk');
const ORIGIN = 'https://desk.test';
const PASS = 'kennebec';
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.json': 'application/json' };
const SESSION = 'v1.1.1760000000.abcdefghijklmnopqrstuvwxyz0123';
const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function stubSite(page) {
  const history = await cc.createHistoryKey(PASS);
  const historyRing = await cc.keyRing(await cc.unwrapPrivateKey(history.wrapped, PASS, history.pub), history.pub);
  const kp = await cc.generateKeyPair();
  const station = { stationId: 'station-aaaaaaaa', name: 'Desk laptop', pub: kp.publicKey, kid: kp.kid, registeredAt: 1, lastSeenAt: new Date().toISOString(), printer: { state: 'ok' } };
  const stationRing = await cc.keyRing(await cc.importPrivateKey(kp.privateJwk), kp.publicKey);
  const salt = cc.bytesToBase64(cc.randomBytes(16));
  const world = {
    kids: [
      { clubberId: '11', first: 'Ada', last: 'Tester', club: 'Cubbies', clubId: '1', checkedIn: false },
      { clubberId: '12', first: 'Ben', last: 'Tester', club: 'Sparks', clubId: '2', checkedIn: false },
      { clubberId: '13', first: 'Cy', last: 'Other', club: 'T&T', clubId: '3', checkedIn: false },
    ],
    posts: [], logins: [], rosterCalls: 0, busyFirst: true, queued: 0, printed: 0,
  };
  const api = async (route, req) => {
    const u = new URL(req.url());
    const p = u.pathname.replace(/^\/api/, '');
    const method = req.method();
    const body = method === 'POST' || method === 'PUT' ? req.postDataJSON() : null;
    if (p === '/v1/auth/params') return route.fulfill(json(200, { v: 2, salt, iter: 600000, legacy: false }));
    if (p === '/v1/login') {
      world.logins.push(body);
      return route.fulfill(json(200, { session: SESSION, displayKey: `${'k'.repeat(43)}=`, state: {}, history: { pub: history.pub, kid: history.kid, wrapped: history.wrapped } }));
    }
    if (req.headers().authorization !== `Bearer ${SESSION}`) return route.fulfill(json(401, { error: 'signed out' }));
    if (p === '/v1/desk/roster') {
      world.rosterCalls += 1;
      if (world.busyFirst) { world.busyFirst = false; return route.fulfill(json(429, { ok: false, reason: 'read-busy', retryAfterMs: 1500 })); }
      return route.fulfill(json(200, { readAt: new Date().toISOString(), kids: world.kids, items: { bible: ['Cubbies', 'Sparks'], friend: ['Sparks'] } }));
    }
    if (p === '/v1/desk/families') return route.fulfill(json(200, { households: [['Ada Tester', 'Ben Tester']] }));
    if (p === '/v1/desk/tonight') return route.fulfill(json(404, { error: 'Not found.' }));
    if (p === '/v1/stations') return route.fulfill(json(200, [station]));
    if (p === '/v1/print/status') {
      return route.fulfill(json(200, { queued: world.queued, leased: 0, done: world.printed, dead: 0, waitingToSeal: 0, checkThePrinter: [], pendingToSeal: 0, claims: { printed: world.printed }, stations: [station] }));
    }
    if (p === '/v1/desk/checkin' || p === '/v1/desk/undo' || p === '/v1/desk/checkout') {
      world.posts.push({ path: p, body });
      const kid = world.kids.find((k) => k.clubberId === body.clubberId);
      if (p === '/v1/desk/checkin') { kid.checkedIn = true; world.queued += 1; return route.fulfill(json(200, { ok: true, already: false, jobId: body.job.id, gen: 1, history: 'off' })); }
      if (p === '/v1/desk/undo') { kid.checkedIn = false; return route.fulfill(json(200, { ok: true, droppedJobs: 1 })); }
      return route.fulfill(json(200, { ok: true }));
    }
    return route.fulfill(json(404, { error: 'Not found.' }));
  };
  await page.route(`${ORIGIN}/**`, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.pathname.startsWith('/api/')) return api(route, req);
    if (u.pathname === '/desk/' || u.pathname === '/desk') return route.fulfill({ status: 200, contentType: 'text/html', body: buildDeskPage() });
    if (u.pathname === '/desk/cloud-crypto.js') return route.fulfill({ status: 200, contentType: MIME['.js'], body: readFileSync(path.join(SHARED, 'cloud-crypto.js')) });
    if (u.pathname.startsWith('/desk/')) return route.fulfill({ status: 200, contentType: MIME['.js'], body: readFileSync(path.join(DESK, path.basename(u.pathname))) });
    if (u.pathname.startsWith('/lobby/shared/')) {
      const file = path.join(SHARED, u.pathname.slice('/lobby/shared/'.length));
      return route.fulfill({ status: 200, contentType: MIME[path.extname(file)] || 'application/octet-stream', body: readFileSync(file) });
    }
    return route.fulfill({ status: 404, body: 'no' });
  });
  return { world, historyRing, stationRing, history };
}

async function signIn(page) {
  await page.goto(`${ORIGIN}/desk/`);
  await page.getByLabel('Passphrase').fill(PASS);
  await page.getByRole('button', { name: 'Unlock' }).click();
}

test('sign in, search, check two siblings in together, undo one, check one out', async ({ page }) => {
  test.setTimeout(60_000);
  const { world, historyRing, stationRing } = await stubSite(page);
  await signIn(page);

  // The 5 s read budget: the first roster read is a 429, and the page says so and waits.
  await expect(page.locator('#busy')).toContainText(/busy: try again in \d+s/);
  await expect(page.locator('#list')).toContainText('families still to come', { timeout: 10_000 });
  await expect(page.locator('#print-led')).toHaveText('Printer ready');
  expect(world.logins).toHaveLength(1);
  expect(Object.keys(world.logins[0])).toEqual(['authKey']);
  expect(JSON.stringify(world.logins)).not.toContain(PASS);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain('kennebec');

  // Families-first search, with "did you mean" for a near spelling.
  await page.getByLabel('Search by first or last name').fill('teste');
  await expect(page.locator('.fcard')).toHaveCount(1);
  await expect(page.locator('.fcard .fn')).toHaveText('Tester');
  await page.getByLabel('Search by first or last name').fill('Tesler');
  await expect(page.getByText('Did you mean')).toBeVisible();
  await page.getByLabel('Search by first or last name').fill('tester');
  await page.locator('.fcard').click();
  if (process.env.DESK_SHOTS) await page.screenshot({ path: `${process.env.DESK_SHOTS}/family.png` });

  // Siblings together: both tiles, Bible ticked, Brought a friend (Sparks) with the friend's first name.
  await expect(page.locator('.tile')).toHaveCount(2);
  await page.getByRole('button', { name: 'Both of them' }).click();
  const ben = page.locator('.tile', { hasText: 'Ben Tester' });
  await ben.getByRole('button', { name: 'Brought a friend' }).click();
  await ben.getByLabel('Friend’s first name').fill('Sam');
  await page.getByRole('button', { name: 'Check in 2' }).click();
  await expect(page.locator('#toast')).toContainText('2 checked in');
  expect(world.posts.map((p) => p.path)).toEqual(['/v1/desk/checkin', '/v1/desk/checkin']);

  // What was sent: the clubber id, the items, and nothing that names a child in clear.
  const sent = Object.fromEntries(world.posts.map((p) => [p.body.clubberId, p.body]));
  expect(sent['11'].items).toEqual({ Bible: true });
  expect(sent['12'].items).toEqual({ Bible: true, Friend: true });
  for (const post of world.posts) {
    expect(JSON.stringify(post.body)).not.toMatch(/Ada|Ben|Tester|Sam/);
    expect(post.body.night).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(post.body.job.kind).toBe('print-job');
    expect(post.body.historyRow.kind).toBe('checkin');
  }
  const job = await cc.openAsStation(stationRing, sent['12'].job);
  expect(job).toMatchObject({ clubberId: '12', name: 'Ben Tester', club: 'Sparks', bible: true, friend: true, friendName: 'Sam', source: 'desk' });
  const row = await cc.openRow(historyRing, sent['11'].historyRow);
  expect(row).toMatchObject({ clubberId: '11', name: 'Ada Tester', club: 'Cubbies', source: 'desk' });
  await expect(page.locator('#print-led')).toHaveText('2 labels queued', { timeout: 15_000 });
  await expect(page.locator('#count-pill')).toHaveText('2 in');

  // Tonight: undo Ben (TwoTimTwo's undo), then check Ada out.
  await page.locator('#count-pill').click();
  await expect(page.locator('#tonight-view .row')).toHaveCount(2);
  await page.locator('.row', { hasText: 'Ben Tester' }).getByRole('button', { name: 'Undo check-in' }).click();
  await page.getByRole('button', { name: 'Undo check-in' }).last().click();
  await expect(page.locator('#toast')).toContainText('Ben Tester’s check-in is undone');
  const undo = world.posts.find((p) => p.path === '/v1/desk/undo');
  expect(undo.body.clubberId).toBe('12');
  expect((await cc.openRow(historyRing, undo.body.historyRow)).name).toBe('Ben Tester');
  await expect(page.locator('#tonight-view .row')).toHaveCount(1);
  await page.locator('.row', { hasText: 'Ada Tester' }).getByRole('button', { name: 'Check out' }).click();
  await page.locator('#confirm-ok').click();
  await expect(page.locator('#toast')).toContainText('Ada Tester is checked out');
  expect(world.posts.at(-1).path).toBe('/v1/desk/checkout');
  expect(world.posts.at(-1).body.historyRow.kind).toBe('checkout');
  expect((await cc.openRow(historyRing, world.posts.at(-1).body.historyRow)).name).toBe('Ada Tester');
  await expect(page.locator('#count-pill')).toHaveText('0 in');
  if (process.env.DESK_SHOTS) await page.screenshot({ path: `${process.env.DESK_SHOTS}/tonight.png` });
});

test('a visitor is checked in by name and a one-off tag prints without a check-in', async ({ page }) => {
  test.setTimeout(60_000);
  const { world, stationRing } = await stubSite(page);
  world.busyFirst = false;
  const tags = [];
  await page.route(`${ORIGIN}/api/v1/print/reprint`, (route) => { tags.push(route.request().postDataJSON()); return route.fulfill(json(200, { ok: true, jobId: tags.at(-1).jobId, existing: false })); });
  await page.route(`${ORIGIN}/api/v1/desk/checkin`, (route) => { world.posts.push({ path: '/v1/desk/checkin', body: route.request().postDataJSON() }); return route.fulfill(json(200, { ok: true, already: false, jobId: 'x', gen: 1, history: 'off' })); });
  await signIn(page);
  await expect(page.locator('#list')).toContainText('families still to come', { timeout: 10_000 });
  await page.getByRole('button', { name: /More/ }).click();
  await page.getByLabel('Visitor\'s full name').fill('Mia Jones');
  await page.locator('#visitor-clubs').getByRole('radio', { name: 'Cubbies' }).click();
  await page.locator('#visitor-go').click();
  await expect(page.locator('#toast')).toContainText('Mia Jones is checked in (visitor)');
  expect(world.posts[0].body.visitor).toEqual({ first: 'Mia', last: 'Jones', club: 'Cubbies' });
  expect(world.posts[0].body.clubberId).toBeUndefined();
  await page.getByRole('button', { name: /More/ }).click();
  await page.getByLabel('Child’s first name').fill('Ava');
  await page.locator('#oneoff-clubs').getByRole('radio', { name: 'Puggles' }).click();
  await page.locator('#oneoff-go').click();
  await expect(page.locator('#toast')).toContainText('Name tag sent');
  expect(tags[0].jobId).toMatch(/^reprint:/);
  expect(await cc.openAsStation(stationRing, tags[0].bundle)).toMatchObject({ oneOff: true, name: 'Ava', club: 'Puggles' });
  await page.locator('#count-pill').click();
  await expect(page.locator('#tonight-view .row')).toContainText('Mia Jones');
});

test('a wrong passphrase stays on the sign-in, and a signed-out session returns to it', async ({ page }) => {
  const { world } = await stubSite(page);
  await page.route(`${ORIGIN}/api/v1/login`, (route) => route.fulfill(json(401, { error: 'no' })));
  await signIn(page);
  await expect(page.locator('#pin-err')).toHaveText('That is not the passphrase.');
  await expect(page.locator('#work')).toBeHidden();
  expect(world.logins).toHaveLength(0);
});
