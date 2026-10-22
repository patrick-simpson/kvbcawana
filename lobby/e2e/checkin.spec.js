import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { buildCheckinPages, CHECKIN_MODULES } from '../../site/checkin/checkin-page.mjs';
import * as cc from '../../shared/cloud-crypto.js';
import { mergeChurch, sanitizeChurch } from '../../shared/churchSettings.js';

// The one check-in page (awana.kvbchurch.org/checkin: the print app's phone page on
// the desk's online path, ROADMAP.md#online-check-in) in a real browser against a
// stand-in Worker: sign in (passphrase v2), a busy 429, families-first search,
// two siblings checked in together with Bible and Brought a friend, undo, check
// out, the walk-in, leader and custom labels, the queue, a late BARF friend, the youth page, and the
// error states (a refusal, already checked in, no internet, signed out). Every
// seal is the page's: the stand-in opens what it was sent with the station's and
// the history key's private keys, and checks that no child's name travelled in
// clear. The page is served from a made-up https origin by page.route, exactly as
// site/build.mjs builds it, so no port or build is needed.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHARED = path.join(HERE, '..', '..', 'shared');
const ORIGIN = 'https://checkin.test';
const PASS = 'kennebec';
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.json': 'application/json' };
const SESSION = 'v1.1.1760000000.abcdefghijklmnopqrstuvwxyz0123';
const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const PAGES = buildCheckinPages();
// Screenshots of the flows at 390x844 (CHECKIN_SHOTS names a folder; else the test's own output folder).
const SHOTS = process.env.CHECKIN_SHOTS || '';
const shot = (name) => (SHOTS ? path.join(SHOTS, name) : test.info().outputPath(name));
/** A screenshot once the sheets and pages have finished sliding. */
async function snap(page, name) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: shot(name) });
}

async function stubSite(page, { kids, barf = true, simple = false } = {}) {
  // BARF is off on the live page since 2026-10-15; these tests keep it working for next year.
  if (barf) await page.addInitScript(() => { window.AWANA_BARF = true; });
  // Simple check-in is ON by default on the live page (owner 2026-10-15); these older tests
  // drive the full flow (Bible, Brought a friend, the child's card), so they start with it off.
  if (!simple) await page.addInitScript(() => { try { if (localStorage.getItem('awanaSimpleCheckin.v1') === null) localStorage.setItem('awanaSimpleCheckin.v1', 'off'); } catch { /* none */ } });
  const history = await cc.createHistoryKey(PASS);
  const historyRing = await cc.keyRing(await cc.unwrapPrivateKey(history.wrapped, PASS, history.pub), history.pub);
  const kp = await cc.generateKeyPair();
  const station = { stationId: 'station-aaaaaaaa', name: 'Desk laptop', pub: kp.publicKey, kid: kp.kid, registeredAt: 1, lastSeenAt: new Date().toISOString(), printer: { state: 'ok' } };
  const stationRing = await cc.keyRing(await cc.importPrivateKey(kp.privateJwk), kp.publicKey);
  const salt = cc.bytesToBase64(cc.randomBytes(16));
  const world = {
    kids: kids || [
      { clubberId: '11', first: 'Ada', last: 'Tester', club: 'Cubbies', clubId: '1', checkedIn: false },
      { clubberId: '12', first: 'Ben', last: 'Tester', club: 'Sparks', clubId: '2', checkedIn: false },
      { clubberId: '13', first: 'Cy', last: 'Other', club: 'T&T', clubId: '3', checkedIn: false },
      { clubberId: '14', first: 'Tia', last: 'Youth', club: 'Trek', clubId: '6', checkedIn: false },
    ],
    posts: [], tags: [], logins: [], rosterCalls: 0, busyFirst: true, queued: 0, printed: 0, refuse: null, signedOut: false,
    history: null, historyCalls: [], church: null, churchPuts: [],
    /** A promise the desk routes wait on (a slow TwoTimTwo), per-child 429s, per-child refusals. */
    gate: null, busyFor: {}, refuseFor: {},
    /** GET /v1/desk/barf's answer (null: no route), and how the late-BARF redo goes ('ok' | 'fail'). */
    barf: null, barfRedo: 'ok', barfPosts: [],
    /** The households, and the Worker's optional `familiesAt` stamp (read-15s). */
    households: [['Ada Tester', 'Ben Tester']], familiesAt: null, familiesCalls: 0,
    /** A day with no club: the roster's `{noClub: true, today, next}` (routes.md 5); null = a club day. */
    noClub: null, tonightCalls: 0,
    /** A promise the roster answer waits on (a cold Worker signing in to TwoTimTwo). */
    rosterGate: null,
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
    if (world.signedOut || req.headers().authorization !== `Bearer ${SESSION}`) return route.fulfill(json(401, { error: 'signed out' }));
    if (p === '/v1/desk/roster') {
      world.rosterCalls += 1;
      if (world.rosterGate) await world.rosterGate;
      if (world.busyFirst) { world.busyFirst = false; return route.fulfill(json(429, { ok: false, reason: 'read-busy', retryAfterMs: 1500 })); }
      if (world.noClub) return route.fulfill(json(200, { noClub: true, ...world.noClub, readAt: new Date().toISOString(), kids: [], items: { bible: [], friend: [] } }));
      if (world.testDay) return route.fulfill(json(200, { readAt: new Date().toISOString(), testDay: world.testDay, kids: world.kids, items: { bible: ['Cubbies', 'Sparks'], friend: ['Sparks'] } }));
      return route.fulfill(json(200, { readAt: new Date().toISOString(), kids: world.kids, items: { bible: ['Cubbies', 'Sparks'], friend: ['Sparks'] }, ...(world.familiesAt ? { familiesAt: world.familiesAt } : {}), ...(world.awayReady ? { awayReady: true } : {}), ...(world.calendarId ? { calendarId: world.calendarId } : {}) }));
    }
    if (p === '/v1/desk/families') {
      world.familiesCalls += 1;
      return route.fulfill(json(200, { households: world.households, ...(world.familiesAt ? { familiesAt: world.familiesAt } : {}) }));
    }
    if (p === '/v1/desk/tonight') { world.tonightCalls += 1; return route.fulfill(json(404, { error: 'Not found.' })); }
    if (p === '/v1/stations') return route.fulfill(json(200, [station]));
    if (p === '/v1/print/status') {
      return route.fulfill(json(200, { queued: world.queued, leased: 0, done: world.printed, dead: 0, waitingToSeal: 0, checkThePrinter: [], pendingToSeal: 0, claims: { printed: world.printed }, stations: [station] }));
    }
    if (p === '/v1/history/nights') {
      world.historyCalls.push(p);
      return route.fulfill(world.history ? json(200, Object.keys(world.history).map((night) => ({ night, rows: world.history[night].length }))) : json(503, { reason: 'history-off' }));
    }
    if (p === '/v1/history/rows') {
      world.historyCalls.push(`${p}?${u.searchParams}`);
      return route.fulfill(json(200, { rows: (world.history && world.history[u.searchParams.get('night')]) || [], next: null }));
    }
    if (p === '/v1/church/settings') {
      if (!world.church) return route.fulfill(json(404, { error: 'Not found.' }));
      if (method === 'PUT') {
        world.churchPuts.push(body);
        world.church = { rev: world.church.rev + 1, settings: mergeChurch(world.church.settings, sanitizeChurch(body.settings).settings) };
        return route.fulfill(json(200, { ok: true, rev: world.church.rev, settings: world.church.settings }));
      }
      return route.fulfill(json(200, { rev: world.church.rev, settings: world.church.settings, switches: {} }));
    }
    if (p === '/v1/desk/barf') return route.fulfill(world.barf ? json(200, world.barf) : json(404, { error: 'Not found.' }));
    if (p === '/v1/desk/barf-late') {
      world.barfPosts.push(body);
      const items = { Bible: true, Friend: true };
      if (body.recheck) {
        const k = world.kids.find((x) => x.clubberId === body.clubberId); if (k) k.checkedIn = true;
        if (world.barf) world.barf.recheck = (world.barf.recheck || []).filter((w) => w.clubberId !== body.clubberId);
        return route.fulfill(json(200, { ok: true, checkedIn: true, items: body.items }));
      }
      if (world.barf) world.barf.friends = [...world.barf.friends, body.clubberId];
      if (world.barfRedo === 'fail') {
        const k = world.kids.find((x) => x.clubberId === body.clubberId); if (k) k.checkedIn = false;
        // The Worker keeps the child waiting to be checked in again: GET /v1/desk/barf lists them.
        if (world.barf) world.barf.recheck = [...(world.barf.recheck || []), { clubberId: body.clubberId, items }];
        return route.fulfill(json(200, { ok: true, checkedIn: false, items, jobId: body.tagJob.jobId, reason: 'checkin-refused', tries: 3 }));
      }
      return route.fulfill(json(200, { ok: true, checkedIn: true, items, jobId: body.tagJob.jobId, history: 'kept' }));
    }
    if (p === '/v1/print/reprint') { world.tags.push(body); return route.fulfill(json(200, { ok: true, jobId: body.jobId, existing: false })); }
    if (p === '/v1/desk/checkin' || p === '/v1/desk/undo' || p === '/v1/desk/checkout') {
      world.posts.push({ path: p, body });
      if (world.gate) await world.gate;
      const busyKey = `${p}:${body.clubberId}`;
      if (world.busyFor[busyKey] > 0) { world.busyFor[busyKey] -= 1; return route.fulfill(json(429, { ok: false, reason: 'read-busy', retryAfterMs: 1500 })); }
      if (world.refuseFor[body.clubberId]) return route.fulfill(json(409, { ok: false, reason: world.refuseFor[body.clubberId] }));
      // Answers to give this child first, in order (e.g. an early label's `printed: true`).
      const queued = world.answersFor && world.answersFor[body.clubberId];
      if (queued && queued.length) return route.fulfill(queued.shift());
      if (world.refuse) return route.fulfill(world.refuse);
      const kid = world.kids.find((k) => k.clubberId === body.clubberId);
      if (p === '/v1/desk/checkin') {
        if (kid && kid.checkedIn) return route.fulfill(json(200, { ok: true, already: true, state: 'queued', jobId: null }));
        if (kid) kid.checkedIn = true;
        world.queued += 1;
        return route.fulfill(json(200, { ok: true, already: false, jobId: body.job.id, gen: 1, history: 'hooked' }));
      }
      if (p === '/v1/desk/undo') { if (kid) kid.checkedIn = false; return route.fulfill(json(200, { ok: true, droppedJobs: 1 })); }
      return route.fulfill(json(200, { ok: true }));
    }
    return route.fulfill(json(404, { error: 'Not found.' }));
  };
  await page.route(`${ORIGIN}/**`, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.pathname.startsWith('/api/')) return api(route, req);
    if (u.pathname === '/checkin/') return route.fulfill({ status: 200, contentType: 'text/html', body: PAGES.index });
    if (u.pathname === '/checkin/ym/') return route.fulfill({ status: 200, contentType: 'text/html', body: PAGES.ym });
    const mod = CHECKIN_MODULES[u.pathname.slice('/checkin/'.length)];
    if (mod) return route.fulfill({ status: 200, contentType: MIME['.js'], body: readFileSync(mod) });
    if (u.pathname.startsWith('/checkin/brand/')) {
      // site/build.mjs serves the print server's copy of the kit; the kit's one committed copy is shared/brand.
      const file = path.join(SHARED, 'brand', u.pathname.slice('/checkin/brand/'.length));
      return route.fulfill({ status: 200, contentType: MIME[path.extname(file)] || 'application/octet-stream', body: readFileSync(file) });
    }
    return route.fulfill({ status: 404, body: 'no' });
  });
  return { world, historyRing, stationRing, history };
}

async function signIn(page, where = '/checkin/') {
  await page.goto(`${ORIGIN}${where}`);
  await page.getByLabel('Passphrase').fill(PASS);
  await page.getByRole('button', { name: 'Unlock' }).click();
}
const search = (page) => page.getByLabel('Search by first or last name');

test.use({ viewport: { width: 390, height: 844 } });

test('sign in, search, check two siblings in with Bible and a friend, undo one, check one out', async ({ page }) => {
  test.setTimeout(60_000);
  const { world, historyRing, stationRing } = await stubSite(page);
  await signIn(page);

  // The Worker's read clock: the first roster read is a 429, and the page says so and waits.
  await expect(page.locator('#busy')).toContainText(/Waiting for TwoTimTwo… \d+s/);
  await expect(page.locator('#list')).toContainText('families still to come', { timeout: 10_000 });
  await expect(page.locator('#print-led')).toHaveText('Printer ready');
  expect(world.logins).toHaveLength(1);
  expect(Object.keys(world.logins[0])).toEqual(['authKey']);
  expect(JSON.stringify(world.logins)).not.toContain(PASS);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(PASS);
  // Brothers and sisters are one family tile.
  await expect(page.locator('.fam', { hasText: 'Tester' })).toHaveCount(1);

  // Families-first search, with "did you mean" for a near spelling.
  await search(page).fill('teste');
  await expect(page.locator('.fcard')).toHaveCount(1);
  await expect(page.locator('.fcard .fn')).toHaveText('Tester');
  await search(page).fill('Tesler');
  await expect(page.getByText('Did you mean')).toBeVisible();
  await search(page).fill('tester');
  await page.locator('.fcard').click();

  // The family page: both tiles, Bible ticked, Brought a friend (Sparks) with the friend's first name.
  await expect(page.locator('#fampage .tile')).toHaveCount(2);
  const ben = page.locator('.tile', { hasText: 'Ben Tester' });
  await ben.getByRole('button', { name: 'Brought a friend' }).click();
  await ben.getByLabel('Friend’s first name').fill('Sam');
  await ben.getByLabel('Friend’s club').selectOption('Cubbies');
  await page.getByRole('button', { name: 'Both of them' }).click();
  await expect(page.locator('#toast')).toContainText('Tester: 2 checked in');
  expect(world.posts.map((p) => p.path)).toEqual(['/v1/desk/checkin', '/v1/desk/checkin']);

  // What was sent: the clubber id, the items, the friend's first name for the BARF list, and no child's name in clear.
  const sent = Object.fromEntries(world.posts.map((p) => [p.body.clubberId, p.body]));
  expect(sent['11'].items).toEqual({ Bible: true });
  expect(sent['12'].items).toEqual({ Bible: true, Friend: true });
  expect(sent['12'].friendName).toBe('Sam');
  expect(sent['12'].friendClub).toBe('Cubbies');
  expect(sent['11'].friendClub).toBeUndefined();
  expect(sent['11'].friendName).toBeUndefined();
  for (const post of world.posts) {
    const { job: _job, historyRow: _row, friendName: _friend, ...plain } = post.body;   // the sealed parts are random base64
    expect(JSON.stringify(plain)).not.toMatch(/Ada|Ben|Tester|Sam/);
    expect(post.body.night).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(post.body.job.kind).toBe('print-job');
    expect(post.body.historyRow.kind).toBe('checkin');
  }
  // exactly the print server's /print body, sealed to the station (routes.md section 5)
  expect(await cc.openAsStation(stationRing, sent['12'].job)).toEqual({ route: '/print', body: { name: 'Ben Tester', clubName: 'Sparks', clubberId: '12', friend: true, friendName: 'Sam' }, clubberId: '12', source: 'desk' });
  const row = await cc.openRow(historyRing, sent['11'].historyRow);
  expect(row).toMatchObject({ first: 'Ada', last: 'Tester', club: 'Cubbies', clubberId: '11', source: 'desk' });
  expect(typeof row.ts).toBe('number');
  await expect(page.locator('#print-led')).toHaveText('2 labels queued', { timeout: 15_000 });
  await expect(page.locator('#count-pill')).toHaveText('2 in');
  await expect(page.locator('.fam', { hasText: 'Tester' })).toHaveCount(0);

  // A second tap on a child another phone already checked in: "already", no second label.
  world.kids[2].checkedIn = true;   // Cy, checked in at the desk meanwhile; this page has not re-read yet
  await search(page).fill('Cy');
  await page.locator('.fcard').click();
  await page.locator('#kid-sheet').getByRole('button', { name: 'Check in' }).click();
  await expect(page.locator('#toast')).toContainText('Already checked in');

  // Tonight: undo Ben (TwoTimTwo's undo), then check Ada out.
  await page.locator('#count-pill').click();
  await expect(page.locator('#tonight-list .row')).toHaveCount(3);
  await page.locator('.row', { hasText: 'Ben Tester' }).getByRole('button', { name: 'Undo check-in' }).click();
  await expect(page.locator('#confirm-title')).toHaveText('Undo Ben Tester’s check-in on TwoTimTwo?');
  await page.locator('#confirm-ok').click();
  await expect(page.locator('#toast')).toContainText('Ben Tester’s check-in is undone');
  const undo = world.posts.find((p) => p.path === '/v1/desk/undo');
  expect(undo.body.clubberId).toBe('12');
  expect(undo.body.club).toBe('Sparks');
  expect(undo.body.historyRow.kind).toBe('undo');
  expect(await cc.openRow(historyRing, undo.body.historyRow)).toMatchObject({ first: 'Ben', last: 'Tester', club: 'Sparks' });
  await expect(page.locator('#tonight-list .row')).toHaveCount(2);
  await page.locator('.row', { hasText: 'Ada Tester' }).getByRole('button', { name: 'Check out' }).click();
  await page.locator('#confirm-ok').click();
  await expect(page.locator('#toast')).toContainText('Ada Tester is checked out');
  expect(world.posts.at(-1).path).toBe('/v1/desk/checkout');
  expect(world.posts.at(-1).body.historyRow.kind).toBe('checkout');
  expect(world.posts.at(-1).body.club).toBe('Cubbies');
  expect(await cc.openRow(historyRing, world.posts.at(-1).body.historyRow)).toMatchObject({ first: 'Ada', last: 'Tester' });
  await expect(page.locator('.row', { hasText: 'Ada Tester' })).toContainText('Checked out');
  await expect(page.locator('#count-pill')).toHaveText('1 in');
});

test('a walk-in name tag prints and is welcomed but never counted; leader and custom labels print without a check-in', async ({ page }) => {
  test.setTimeout(60_000);
  const { world, stationRing } = await stubSite(page);
  world.busyFirst = false;
  await signIn(page);
  await expect(page.locator('#list')).toContainText('families still to come', { timeout: 10_000 });
  // Not on the list: the page points to the walk-in tag (no visitor check-in any more).
  await search(page).fill('Zed');
  await expect(page.locator('#list')).toContainText('Not on the list? Tap + for a walk-in name tag.');
  await search(page).fill('');

  await page.locator('#menu-btn').click();
  await expect(page.locator('#oneoff-h')).toHaveText('Walk-in name tag');
  await expect(page.locator('#visitor-form')).toHaveCount(0);
  await page.getByLabel('Child’s first name').fill('Ava');
  await page.locator('#oneoff-clubs').getByRole('radio', { name: 'Puggles' }).click();
  await snap(page, 'walkin-menu.png');
  await page.locator('#oneoff-print').click();
  await expect(page.locator('#toast')).toContainText('Printing Ava’s tag');
  await page.getByLabel('Leader\'s name').fill('Pat Leader');
  await page.locator('#leader-club').selectOption('Sparks');
  await page.locator('#leader-print').click();
  await expect(page.locator('#toast')).toContainText('Leader tag for Pat Leader');
  await page.getByLabel('Custom label text').fill('KITCHEN');
  await page.locator('#custom-print').click();
  await expect(page.locator('#toast')).toContainText('Custom label sent');
  expect(world.tags.map((t) => t.jobId)).toEqual([expect.stringMatching(/^reprint:/), expect.stringMatching(/^reprint:/), expect.stringMatching(/^reprint:/)]);
  // the print server's own routes and bodies: what the station's puller runs (a walk-in is the one-off route: greeted, never counted)
  const opened = await Promise.all(world.tags.map((t) => cc.openAsStation(stationRing, t.bundle)));
  expect(opened.map((o) => [o.route, o.body])).toEqual([
    ['/print-oneoff', { firstName: 'Ava', clubName: 'Puggles' }],
    ['/print-leader', { name: 'Pat Leader', clubName: 'Sparks' }],
    ['/print-custom', { text: 'KITCHEN' }],
  ]);
  // Whole words only: the sealed bundle is random base64, which spells "Pat" now and then.
  for (const t of world.tags) expect(JSON.stringify(t)).not.toMatch(/(?<![A-Za-z0-9+/])(?:Ava|Pat|KITCHEN)(?![A-Za-z0-9+/])/);
  expect(world.posts).toHaveLength(0);   // nothing checked in, nothing counted

  // Tonight lists the walk-in so the volunteers remember to register them; the count stays 0.
  await page.locator('#menu-close').click();
  await expect(page.locator('#count-pill')).toHaveText('0 in');
  await page.locator('#count-pill').click();
  const row = page.locator('#tonight-list .row', { hasText: 'Ava' });
  await expect(row).toContainText('walk-in · not registered yet');
  await expect(row.locator('button')).toHaveCount(0);
  await expect(page.locator('#tonight-total')).toHaveText('0 here now · 1 walk-in');
  await snap(page, 'walkin-tonight.png');
});

test('/checkin/ym: the + menu is the walk-in tag alone, for Trek and Journey', async ({ page }) => {
  test.setTimeout(60_000);
  const { world, stationRing } = await stubSite(page);
  world.busyFirst = false;
  await signIn(page, '/checkin/ym/');
  await expect(page.locator('#list')).toContainText('still to come', { timeout: 10_000 });
  await page.locator('#menu-btn').click();
  await expect(page.locator('#oneoff-panel')).toBeVisible();
  await expect(page.locator('#leader-panel')).toBeHidden();
  await expect(page.locator('#custom-panel')).toBeHidden();
  await expect(page.locator('#oneoff-clubs').getByRole('radio')).toHaveText(['Trek', 'Journey']);
  await page.getByLabel('Child’s first name').fill('Rex');
  await page.locator('#oneoff-clubs').getByRole('radio', { name: 'Journey' }).click();
  await snap(page, 'ym-walkin-menu.png');
  await page.locator('#oneoff-print').click();
  await expect(page.locator('#toast')).toContainText('Printing Rex’s tag');
  expect((await cc.openAsStation(stationRing, world.tags[0].bundle)).body).toEqual({ firstName: 'Rex', clubName: 'Journey' });
  await page.locator('#menu-close').click();
  await page.locator('#count-pill').click();
  await expect(page.locator('#tonight-list .row', { hasText: 'Rex' })).toContainText('walk-in · not registered yet');
  await expect(page.locator('#count-pill')).toHaveText('0 in');
});

test('error states: a refusal puts the child back, no internet points to the paper sheet', async ({ page }) => {
  test.setTimeout(60_000);
  const { world } = await stubSite(page);
  world.busyFirst = false;
  await signIn(page);
  await expect(page.locator('#list')).toContainText('families still to come', { timeout: 10_000 });
  world.refuse = json(409, { ok: false, reason: 'no-attendance-item' });
  await search(page).fill('Cy');
  await page.locator('.fcard').click();
  await page.locator('#kid-sheet').getByRole('button', { name: 'Check in' }).click();
  await expect(page.locator('#toast')).toContainText('Couldn’t check in Cy Other: TwoTimTwo has no attendance item for that club tonight.');
  await search(page).fill('');
  await expect(page.locator('.fam', { hasText: 'Cy Other' })).toHaveCount(1);
  await expect(page.locator('#count-pill')).toHaveText('0 in');

  // No internet: the call cannot reach the service. A hiccup is tried again by itself
  // (2 s, 5 s, 10 s on the live page; a second each here), then the tile says so.
  await page.evaluate(() => { window.AWANA_CHECKIN_TUNING = { hiccupMs: [1000, 1000, 1000] }; });
  let tries = 0;
  await page.route(`${ORIGIN}/api/v1/desk/checkin`, (route) => { tries += 1; return route.abort(); });
  world.refuse = null;
  await page.locator('.fam', { hasText: 'Cy Other' }).click();
  await page.locator('#kid-sheet').getByRole('button', { name: 'Check in' }).click();
  await expect(page.locator('.fam', { hasText: 'Cy Other' })).toContainText(/Connection hiccup\. Trying again in \d+s/);
  await expect(page.locator('#toast')).toContainText('paper sheet', { timeout: 15_000 });
  expect(tries).toBe(4);
  await expect(page.locator('#offline-note')).toBeVisible();
  await expect(page.locator('#offline-note')).toContainText('paper sheet at the desk');
  await expect(page.locator('.fam', { hasText: 'Cy Other' })).toHaveCount(1);
});

// No club tonight (owner 2026-10-13: a Monday evening sat on "Reading the roster..."):
// the Worker answers the roster at once with `noClub`, and the page shows one note.
test('a slow first roster read (a cold sign-in to TwoTimTwo) says so after a few seconds, then the list comes', async ({ page }) => {
  test.setTimeout(60_000);
  const { world } = await stubSite(page);
  world.busyFirst = false;
  let open;
  world.rosterGate = new Promise((resolve) => { open = resolve; });
  await signIn(page);
  const list = page.locator('#list');
  await expect(list).toContainText('Reading the roster', { timeout: 10_000 });
  await expect(list).toContainText('Signing in to TwoTimTwo… this can take up to a minute.', { timeout: 10_000 });
  // The waiting Cubbies (owner 2026-10-15): the kit's mark over a sign whose line moves on.
  await expect(list.locator('.wait-cub')).toHaveAttribute('src', /\/brand\/logos\/cubbies-color\.svg$/);
  await expect(page.locator('#wait-line')).toHaveText('TwoTimTwo is stretching…');
  await expect(page.locator('#wait-line')).toHaveText('Finding everyone’s name tags…', { timeout: 8_000 });
  open();
  await search(page).fill('Ada');
  await expect(list).toContainText('Ada', { timeout: 10_000 });
  await expect(list).not.toContainText('Signing in to TwoTimTwo');
});

test('a slow read after the first: tonight\'s last list on this device shows at once, marked, then the live one replaces it (owner 2026-10-15)', async ({ page }) => {
  test.setTimeout(60_000);
  const { world } = await stubSite(page);
  world.busyFirst = false;
  await signIn(page);
  await search(page).fill('Ada');
  await expect(page.locator('#list')).toContainText('Ada', { timeout: 10_000 });
  // Saved sealed: no name readable in the browser's storage.
  await expect.poll(() => page.evaluate(() => localStorage.getItem('awanaCheckinRoster.v1'))).toContain('"ct"');
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toMatch(/Ada|Tester/);
  // The service restarts (a cold sign-in to TwoTimTwo): the next read hangs.
  let open;
  world.rosterGate = new Promise((resolve) => { open = resolve; });
  await page.reload();
  await expect(page.locator('#cached-note')).toContainText('Showing the list from', { timeout: 10_000 });
  await search(page).fill('Ada');
  await expect(page.locator('#list')).toContainText('Ada');
  await expect(page.locator('#list')).not.toContainText('Signing in to TwoTimTwo');
  open();
  await expect(page.locator('#cached-note')).toBeHidden({ timeout: 15_000 });
  // Sign out forgets it.
  await page.evaluate(() => { document.getElementById('signout').click(); });
  expect(await page.evaluate(() => localStorage.getItem('awanaCheckinRoster.v1'))).toBeNull();
});

test('no club tonight: one friendly note, no search, no error, asked again every minute, and the list comes by itself on the club day', async ({ page }) => {
  test.setTimeout(60_000);
  const { world } = await stubSite(page);
  world.busyFirst = false;
  world.noClub = { today: '2026-10-12', next: '2026-10-14' };
  await page.clock.install();
  await signIn(page);
  const note = page.locator('#list .noclub');
  await expect(note).toBeVisible({ timeout: 10_000 });
  await expect(note.locator('.noclub-title')).toHaveText('No club tonight');
  await expect(note.locator('.noclub-next')).toHaveText('Next club night: Wednesday, October 14');
  await expect(note.locator('.noclub-quip')).toHaveText(/\S/);
  await snap(page, 'checkin-no-club.png');
  await expect(page.locator('#list')).not.toContainText('Reading the roster');
  await expect(search(page)).toBeHidden();
  await expect(page.locator('#print-led')).toBeHidden();
  await expect(page.locator('#toast.on')).toHaveCount(0);
  await expect(page.locator('#count-pill')).toHaveText('0 in');
  // the families and the Worker's count are not asked for on a day with no club
  expect(world.familiesCalls).toBe(0);
  expect(world.tonightCalls).toBe(0);
  // Tonight and the + menu still open: leader and custom labels print, the walk-in tag waits for a club night
  await page.locator('#count-pill').click();
  await expect(page.locator('#tonight-check')).toHaveText('No club tonight.');
  await page.locator('#tonight-close').click();
  await page.locator('#menu-btn').click();
  await expect(page.locator('#leader-panel')).toBeVisible();
  await expect(page.locator('#custom-panel')).toBeVisible();
  await expect(page.locator('#oneoff-panel')).toBeHidden();
  await page.locator('#menu-close').click();

  // Asked again once a minute, not every 15 s.
  const asked = world.rosterCalls;
  await page.clock.fastForward(30_000);
  await page.waitForTimeout(300);
  expect(world.rosterCalls).toBe(asked);
  // The club day: the Worker answers the roster, and within the minute the list is back.
  world.noClub = null;
  await page.clock.fastForward(31_000);
  await expect(page.locator('#list')).toContainText('families still to come', { timeout: 10_000 });
  await expect(note).toHaveCount(0);
  await expect(search(page)).toBeVisible();
  await page.locator('#menu-btn').click();
  await expect(page.locator('#oneoff-panel')).toBeVisible();
});

test('no club tonight: a tap the Worker refuses no-club puts the child back and shows the note at once; the youth page hides its + menu', async ({ page }) => {
  test.setTimeout(60_000);
  const { world } = await stubSite(page);
  world.busyFirst = false;
  await signIn(page);
  await expect(page.locator('#list')).toContainText('families still to come', { timeout: 10_000 });
  // Past midnight on a cancelled night: the list on screen is stale, and the Worker refuses the tap.
  world.refuse = json(409, { ok: false, reason: 'no-club', today: '2026-10-14', next: '2026-10-21' });
  world.noClub = { today: '2026-10-14', next: '2026-10-21' };
  await search(page).fill('Cy');
  await page.locator('.fcard').click();
  await page.locator('#kid-sheet').getByRole('button', { name: 'Check in' }).click();
  await expect(page.locator('#toast')).toContainText('Couldn’t check in Cy Other: There is no club tonight.');
  await expect(page.locator('#list .noclub-next')).toHaveText('Next club night: Wednesday, October 21', { timeout: 5_000 });
  await expect(page.locator('#count-pill')).toHaveText('0 in');

  // The youth page (this device is signed in, so it opens straight on the list's place).
  await page.goto(`${ORIGIN}/checkin/ym/`);
  await expect(page.locator('#list .noclub')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#menu-btn')).toBeHidden();   // its + is the walk-in tag alone
  await expect(page.locator('#count-pill')).toBeVisible();
});

test('the youth leaders\' page shows Trek and Journey only, on the same path', async ({ page }) => {
  const { world, stationRing } = await stubSite(page);
  world.busyFirst = false;
  await signIn(page, '/checkin/ym/');
  await expect(page.locator('h1')).toHaveText('Trek & Journey');
  await expect(page.locator('#list')).toContainText('1 family still to come', { timeout: 10_000 });
  await expect(page.locator('.fam')).toHaveText(/Tia Youth/);
  await expect(page.locator('#count-pill')).toBeVisible();   // its own Tonight, with Undo check-in
  await expect(page.locator('#menu-btn')).toBeVisible();   // the walk-in tag alone
  await expect(page.locator('#mode-btn')).toBeHidden();   // no Check out: the Worker checks Trek and Journey out
  await page.locator('.fam').click();
  await page.locator('#kid-sheet').getByRole('button', { name: 'Check in' }).click();
  await expect(page.locator('#toast')).toContainText('Tia Youth is checked in');
  expect(world.posts.map((p) => [p.path, p.body.clubberId])).toEqual([['/v1/desk/checkin', '14']]);
  // No label from the youth page (owner 2026-10-15): the job is the TV's welcome alone.
  expect((await cc.openAsStation(stationRing, world.posts[0].body.job)).route).toBe('/print-welcome');
});

test('an early label (printed before TwoTimTwo answered): a hiccup is retried by itself, a refusal stays red until a tap', async ({ page }) => {
  test.setTimeout(60_000);
  const { world } = await stubSite(page);
  world.busyFirst = false;
  world.kids.push({ clubberId: '20', first: 'Zed', last: 'Solo', club: 'T&T', clubId: '3', checkedIn: false });
  await signIn(page);
  await expect(page.locator('#list')).toContainText('families still to come', { timeout: 10_000 });
  // TwoTimTwo timed out after Cy's label printed: the page tries again on its own.
  world.answersFor = { '13': [json(504, { ok: false, reason: 'unsure', retry: true, printed: true })] };
  await search(page).fill('Cy');
  await page.locator('.fcard').click();
  await page.locator('#kid-sheet').getByRole('button', { name: 'Check in' }).click();
  await expect(page.locator('#toast')).toContainText('Cy Other is checked in', { timeout: 15_000 });
  expect(world.posts.filter((p) => p.body.clubberId === '13')).toHaveLength(2);

  // A flat refusal after Zed's label printed: red, and it stays until a tap.
  world.answersFor = { '20': [json(409, { ok: false, reason: 'checkin-refused', printed: true })] };
  await search(page).fill('Zed');
  await page.locator('.fcard').click();
  await page.locator('#kid-sheet').getByRole('button', { name: 'Check in' }).click();
  await expect(page.locator('#toast')).toContainText('Label printed, but TwoTimTwo didn’t take it. Tap to try again.');
  await page.waitForTimeout(10_000);   // past FAILED_SHOW_MS (9 s), when an ordinary refusal clears
  await expect(page.locator('.fam', { hasText: 'Zed Solo' })).toContainText('Label printed, but TwoTimTwo didn’t take it');
  expect(world.posts.filter((p) => p.body.clubberId === '20')).toHaveLength(1);
  await page.locator('.fam', { hasText: 'Zed Solo' }).click();
  await page.locator('#kid-sheet').getByRole('button', { name: 'Check in' }).click();
  await expect(page.locator('#toast')).toContainText('Zed Solo is checked in', { timeout: 10_000 });
  expect(world.posts.filter((p) => p.body.clubberId === '20')).toHaveLength(2);
});

// Reliability (owner request 2026-10-17): a hiccup is retried by itself, a check-in nobody
// answers settles from the roster's checked-in marks or is sent again after a minute, and a
// reload sends the check-ins it had not confirmed yet (sealed in storage, tonight only).
test('a connection hiccup is sent again by itself; `unsure` and refusals are not', async ({ page }) => {
  test.setTimeout(60_000);
  const { world } = await stubSite(page);
  world.busyFirst = false;
  world.kids.push({ clubberId: '20', first: 'Zed', last: 'Solo', club: 'T&T', clubId: '3', checkedIn: false });
  await page.addInitScript(() => { window.AWANA_CHECKIN_TUNING = { hiccupMs: [1000, 1000, 1000] }; });
  await signIn(page);
  await expect(page.locator('#list')).toContainText('families still to come', { timeout: 10_000 });
  // Two dropped connections, then a 503 that is not the Worker's own refusal (a restart): the fourth try takes.
  let dropped = 0;
  await page.route(`${ORIGIN}/api/v1/desk/checkin`, (route) => (dropped < 2 ? (dropped += 1, route.abort()) : route.fallback()));
  world.answersFor = { '13': [json(503, { error: 'Something went wrong on the sync service.' })] };
  await search(page).fill('Cy');
  await page.locator('.fcard').click();
  await page.locator('#kid-sheet').getByRole('button', { name: 'Check in' }).click();
  await expect(page.locator('.fam', { hasText: 'Cy Other' })).toContainText(/Connection hiccup\. Trying again in \d+s/);
  await expect(page.locator('#toast')).toContainText('Cy Other is checked in', { timeout: 15_000 });
  expect(dropped).toBe(2);
  expect(world.posts.filter((p) => p.body.clubberId === '13')).toHaveLength(2);   // the 503, then the one that took
  // TwoTimTwo timed out (`unsure`): ambiguous by design, so it is NOT sent again by itself.
  world.answersFor = { '20': [json(504, { ok: false, reason: 'unsure', retry: true })] };
  await search(page).fill('Zed');
  await page.locator('.fcard').click();
  await page.locator('#kid-sheet').getByRole('button', { name: 'Check in' }).click();
  await expect(page.locator('#toast')).toContainText('Couldn’t check in Zed Solo: TwoTimTwo did not answer in time.');
  await page.waitForTimeout(2500);
  expect(world.posts.filter((p) => p.body.clubberId === '20')).toHaveLength(1);
});

test('a check-in nobody answers: after half a minute the roster says whether it landed; after a minute it is sent again', async ({ page }) => {
  test.setTimeout(90_000);
  const { world } = await stubSite(page);
  world.busyFirst = false;
  await page.addInitScript(() => { window.AWANA_CHECKIN_TUNING = { slowMs: 1500, noAnswerMs: 5000, hiccupMs: [1000, 1000, 1000] }; });
  await signIn(page);
  await expect(page.locator('#list')).toContainText('families still to come', { timeout: 10_000 });
  // Cy's check-in reaches the Worker and TwoTimTwo takes it, but the answer never comes back.
  let hung = 0;
  await page.route(`${ORIGIN}/api/v1/desk/checkin`, (route) => {
    const body = route.request().postDataJSON();
    if (body.clubberId === '13') { hung += 1; world.kids.find((k) => k.clubberId === '13').checkedIn = true; return new Promise(() => {}); }
    if (body.clubberId === '14' && hung < 2) { hung += 1; return new Promise(() => {}); }   // Tia's first try: nothing at all
    return route.fallback();
  });
  await search(page).fill('Cy');
  await page.locator('.fcard').click();
  await page.locator('#kid-sheet').getByRole('button', { name: 'Check in' }).click();
  // The roster's checked-in mark settles it: checked in, one post, its place in the queue free.
  await expect(page.locator('#toast')).toContainText('Cy Other is checked in', { timeout: 10_000 });
  expect(hung).toBe(1);
  // Tia's never arrived: the roster does not show her, so after the minute it goes again (safe: the claim).
  await search(page).fill('Tia');
  await page.locator('.fcard').click();
  await page.locator('#kid-sheet').getByRole('button', { name: 'Check in' }).click();
  await search(page).fill('');
  await expect(page.locator('.fam', { hasText: 'Tia Youth' })).toContainText('Still checking in (slow connection)…');
  await expect(page.locator('#toast')).toContainText('Tia Youth is checked in', { timeout: 15_000 });
  expect(hung).toBe(2);
  expect(world.posts.filter((p) => p.body.clubberId === '14')).toHaveLength(1);   // the one the stand-in answered
});

test('a reload sends the check-ins it had not confirmed yet, sealed in storage for tonight; Sign out forgets them', async ({ page }) => {
  test.setTimeout(60_000);
  const { world } = await stubSite(page);
  world.busyFirst = false;
  page.on('dialog', (d) => d.accept());   // "leave the page?" while the queue is busy
  await signIn(page);
  await expect(page.locator('#list')).toContainText('families still to come', { timeout: 10_000 });
  // The Worker is busy for a long while: Cy's check-in waits its turn to try again.
  world.answersFor = { '13': [json(429, { ok: false, reason: 'read-busy', retryAfterMs: 60_000 })] };
  await search(page).fill('Cy');
  await page.locator('.fcard').click();
  await page.locator('#kid-sheet').getByRole('button', { name: 'Check in' }).click();
  await expect(page.locator('.fam', { hasText: 'Cy Other' })).toContainText(/Waiting for TwoTimTwo… \d+s/);
  // Kept sealed: no name readable in the browser's storage.
  await expect.poll(() => page.evaluate(() => localStorage.getItem('awanaCheckinPending.v1'))).toContain('"ct"');
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toContain('Cy Other');
  expect(stored).not.toMatch(/clubberId|"choice"|"name"/);
  expect(Object.keys(JSON.parse(await page.evaluate(() => localStorage.getItem('awanaCheckinPending.v1')))).sort()).toEqual(['ct', 'iv', 'night']);
  await page.reload();
  // After the reload it goes again by itself, and TwoTimTwo takes it.
  await expect(page.locator('#toast')).toContainText(/Cy Other is checked in|from before the page reloaded/, { timeout: 15_000 });
  await expect(page.locator('#toast')).toContainText('Cy Other is checked in', { timeout: 15_000 });
  expect(world.posts.filter((p) => p.body.clubberId === '13')).toHaveLength(2);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('awanaCheckinPending.v1'))).toBeNull();
  // Another one left waiting, then Sign out: the slot goes.
  world.answersFor = { '14': [json(429, { ok: false, reason: 'read-busy', retryAfterMs: 60_000 })] };
  await search(page).fill('Tia');
  await page.locator('.fcard').click();
  await page.locator('#kid-sheet').getByRole('button', { name: 'Check in' }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('awanaCheckinPending.v1'))).toContain('"ct"');
  await page.evaluate(() => { document.getElementById('signout').click(); });
  expect(await page.evaluate(() => localStorage.getItem('awanaCheckinPending.v1'))).toBeNull();
});

test('a test day (no club today, owner 2026-10-15): the real list, a yellow strip, a real check-in, no Check out', async ({ page }) => {
  test.setTimeout(60_000);
  const { world } = await stubSite(page);
  world.busyFirst = false;
  world.testDay = { today: '2026-10-15', next: '2026-10-21', meeting: null };
  await signIn(page);
  await expect(page.locator('#test-note')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#test-note')).toHaveText(/^Test day: check-ins go on TwoTimTwo’s next meeting \(Wed, Oct 21\)\. They’re undone by themselves overnight\.$/);
  await expect(page.locator('#list')).not.toContainText('No club tonight');
  await expect(page.locator('#mode-btn')).toBeHidden();
  await expect(search(page)).toBeVisible();
  await search(page).fill('Cy');
  await page.locator('.fcard').click();
  await page.locator('#kid-sheet').getByRole('button', { name: 'Check in' }).click();
  await expect(page.locator('#toast')).toContainText('Cy Other is checked in');
  expect(world.posts.map((p) => [p.path, p.body.clubberId])).toEqual([['/v1/desk/checkin', '13']]);
  await snap(page, 'checkin-test-day.png');
  // A club day again: the strip goes.
  world.testDay = null;
  await page.reload();
  await expect(page.locator('#list')).toContainText('still to come', { timeout: 10_000 });
  await expect(page.locator('#test-note')).toBeHidden();
  await expect(page.locator('#mode-btn')).toBeVisible();
});

test('"Not here the last two club nights" from the service (owner 2026-10-15): every phone, even a restored session with no history key', async ({ page }) => {
  test.setTimeout(60_000);
  const { world } = await stubSite(page);
  world.busyFirst = false;
  world.awayReady = true;
  // Cy was not here the last two club nights; the Testers and Tia were.
  for (const k of world.kids) k.away = k.clubberId === '13';
  await signIn(page);
  await expect(page.locator('#list')).toContainText('still to come', { timeout: 10_000 });
  // A reload restores the session WITHOUT the history key: the page's own reading is off, the service's still works.
  await page.reload();
  await expect(page.locator('#list')).toContainText('Not here the last two club nights', { timeout: 10_000 });
  const lead = page.locator('#list .lead', { hasText: 'still to come' });
  await expect(lead).toHaveText(/^2 families still to come$/);
  await expect(page.locator('#list')).toContainText('Cy Other');
  expect(world.historyCalls).toHaveLength(0);
  // Before both nights are known, nobody is sent to the bottom.
  world.awayReady = false;
  await page.reload();
  await expect(page.locator('#list')).toContainText('3 families still to come', { timeout: 10_000 });
  await expect(page.locator('#list')).not.toContainText('Not here the last two club nights');
});

test('simple check-in (owner 2026-10-15): on by default, one tap for a child, "Check in all" for a family, attendance only, Undo', async ({ page }) => {
  test.setTimeout(60_000);
  const { world } = await stubSite(page, { simple: true });
  world.busyFirst = false;
  world.kids.push({ clubberId: '20', first: 'Zed', last: 'Solo', club: 'Sparks', clubId: '2', checkedIn: false },
    { clubberId: '30', first: 'Amy', last: 'Pair', club: 'Cubbies', clubId: '1', checkedIn: false }, { clubberId: '31', first: 'Bo', last: 'Pair', club: 'Sparks', clubId: '2', checkedIn: false });
  world.households = [...world.households, ['Amy Pair', 'Bo Pair']];
  await signIn(page);
  await expect(page.locator('#list')).toContainText('still to come', { timeout: 10_000 });
  await snap(page, 'checkin-simple.png');
  // One tap on a single child: checked in, nothing ticked, no card to confirm.
  await page.locator('.fam', { hasText: 'Zed Solo' }).click();
  await expect(page.locator('#kid-sheet')).not.toHaveClass(/on/);
  await expect(page.locator('#toast')).toContainText('Zed Solo is checked in');
  const zed = world.posts.find((p) => p.body.clubberId === '20');
  expect(zed.path).toBe('/v1/desk/checkin');
  expect(zed.body.items).toEqual({});
  // ...with the big Undo at the bottom, which really undoes it (no confirm), then goes.
  await expect(page.locator('#undo-bar')).toBeVisible();
  await expect(page.locator('#undo-msg')).toHaveText('Checked in: Zed Solo');
  await snap(page, 'checkin-big-undo.png');
  await page.locator('#undo-btn').click();
  await expect.poll(() => world.posts.filter((p) => p.path === '/v1/desk/undo' && p.body.clubberId === '20').length).toBe(1);
  await expect(page.locator('#undo-bar')).toBeHidden();
  // A family: its own "Check in all 2" strip, one tap, both in, nothing ticked.
  const all = page.locator('.famw', { hasText: 'Tester' }).getByRole('button', { name: /^Check in all 2/ });
  await expect(all).toBeVisible();
  await all.click();
  await expect(page.locator('#toast')).toContainText('Tester: 2 checked in', { timeout: 10_000 });
  // The bar names the whole tap; the next tap ends it.
  await expect(page.locator('#undo-msg')).toHaveText('Checked in: Tester family, 2');
  const testers = world.posts.filter((p) => p.path === '/v1/desk/checkin' && ['11', '12'].includes(p.body.clubberId));
  expect(testers).toHaveLength(2);
  expect(testers.every((p) => JSON.stringify(p.body.items) === '{}')).toBe(true);
  // The family's name still opens its page (to pick some), with no Bible or friend boxes.
  await page.locator('.famw', { hasText: 'Pair' }).locator('.fam').click();
  await expect(page.locator('#fampage')).toHaveClass(/on/);
  await expect(page.locator('#fampage')).not.toContainText('Bible');
  await expect(page.locator('#fampage')).not.toContainText('Brought a friend');
  await page.locator('#fampage').getByRole('button', { name: 'Done' }).click();
  // The switch in the + menu turns it off: the card and its boxes come back.
  await page.locator('#menu-btn').click();
  await expect(page.locator('#simple-toggle')).toBeChecked();
  await page.locator('label[for="simple-toggle"]').click();
  await expect(page.locator('#simple-toggle')).not.toBeChecked();
  await page.locator('#menu-close').click();
  await expect(page.locator('.famw')).toHaveCount(0);
  await page.locator('.fam', { hasText: 'Pair' }).click();
  await expect(page.locator('#fampage')).toContainText('Bible');
  expect(await page.evaluate(() => localStorage.getItem('awanaSimpleCheckin.v1'))).toBe('off');
});

test('family order (owner 2026-10-15): earliest usual arrival first by default, last name from the + menu', async ({ page }) => {
  const { world } = await stubSite(page, { simple: true });
  world.busyFirst = false;
  // Tester (no times), Zed Solo usually 6:20, the Pairs usually 6:05 (Bo) and 6:40 (Amy).
  world.kids.push({ clubberId: '20', first: 'Zed', last: 'Solo', club: 'Sparks', clubId: '2', checkedIn: false, usual: 18 * 60 + 20 },
    { clubberId: '30', first: 'Amy', last: 'Pair', club: 'Cubbies', clubId: '1', checkedIn: false, usual: 18 * 60 + 40 },
    { clubberId: '31', first: 'Bo', last: 'Pair', club: 'Sparks', clubId: '2', checkedIn: false, usual: 18 * 60 + 5 });
  world.households = [...world.households, ['Amy Pair', 'Bo Pair']];
  await signIn(page);
  await expect(page.locator('#list')).toContainText('earliest arrivals first', { timeout: 10_000 });
  const order = () => page.locator('#list .fams .fam').evaluateAll((els) => els.map((e) => e.textContent));
  const firstOf = async (names) => { const o = await order(); return names.map((n) => o.findIndex((t) => t.includes(n))); };
  const [pair, solo, tester] = await firstOf(['Pair', 'Zed Solo', 'Tester']);
  expect(pair).toBeLessThan(solo);
  expect(solo).toBeLessThan(tester);
  // Last name, from the + menu, kept on this phone.
  await page.locator('#menu-btn').click();
  await expect(page.getByRole('radio', { name: 'Usually first' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: 'Last name' }).click();
  await page.locator('#menu-close').click();
  await expect(page.locator('#list')).not.toContainText('earliest arrivals first');
  const [pair2, solo2, tester2] = await firstOf(['Pair', 'Zed Solo', 'Tester']);
  expect(pair2).toBeLessThan(solo2);
  expect(solo2).toBeLessThan(tester2);   // P, S, T: alphabetical happens to agree here...
  world.kids.find((k) => k.clubberId === '20').last = 'Aaron';   // ...so move Zed to the front of the alphabet
  await page.reload();
  await expect(page.locator('#list')).toContainText('still to come', { timeout: 10_000 });
  const [pair3, solo3] = await firstOf(['Pair', 'Zed Aaron']);
  expect(solo3).toBeLessThan(pair3);
  expect(await page.evaluate(() => localStorage.getItem('awanaCheckinSort.v1'))).toBe('name');
});

test('the youth page has the big Undo and the family order too', async ({ page }) => {
  const { world } = await stubSite(page, { simple: true });
  world.busyFirst = false;
  // Tia Youth (no times) and Max Early, usually 6:02.
  world.kids.push({ clubberId: '40', first: 'Max', last: 'Early', club: 'Journey', clubId: '6', checkedIn: false, usual: 18 * 60 + 2 });
  await signIn(page, '/checkin/ym/');
  await expect(page.locator('#list')).toContainText('2 families still to come · earliest arrivals first', { timeout: 10_000 });
  await expect(page.locator('#list .fams .fam').first()).toHaveText(/Max Early/);
  // One tap, then the big Undo, which undoes it on TwoTimTwo.
  await page.locator('.fam', { hasText: 'Max Early' }).click();
  await expect(page.locator('#undo-msg')).toHaveText('Checked in: Max Early', { timeout: 10_000 });
  await page.locator('#undo-btn').click();
  await expect.poll(() => world.posts.filter((p) => p.path === '/v1/desk/undo' && p.body.clubberId === '40').length).toBe(1);
  // The order is in its + menu.
  await page.locator('#menu-btn').click();
  await expect(page.getByRole('radio', { name: 'Last name' })).toBeVisible();
});

test('a wrong passphrase stays on the sign-in, and a signed-out session returns to it', async ({ page }) => {
  const { world } = await stubSite(page);
  world.busyFirst = false;
  await page.route(`${ORIGIN}/api/v1/login`, (route) => route.fulfill(json(401, { error: 'no' })), { times: 1 });
  await signIn(page);
  await expect(page.locator('#pin-err')).toHaveText('That is not the passphrase.');
  await expect(page.locator('#main-screen')).toBeHidden();
  await page.getByLabel('Passphrase').fill(PASS);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.locator('#list')).toContainText('families still to come', { timeout: 10_000 });
  // A reload takes up the session (this device has checked the history key once).
  await page.reload();
  await expect(page.locator('#list')).toContainText('families still to come', { timeout: 10_000 });
  expect(world.logins).toHaveLength(1);
  // The passphrase changed: the next call is a 401 and the page asks again.
  world.signedOut = true;
  await search(page).fill('Cy');
  await page.locator('.fcard').click();
  await page.locator('#kid-sheet').getByRole('button', { name: 'Check in' }).click();
  await expect(page.locator('#pin-screen')).toBeVisible();
  await expect(page.locator('#pin-err')).toContainText('Signed out');
});

/** A history row sealed to the history key, as the desk or the laptop's import wrote it. */
async function sealedRow(history, night, kind, record) {
  const id = cc.newRowId();
  return { id, night, kind, ...(await cc.sealRow(history.pub, { id, night, kind, record })) };
}

test('"Not here the last two club nights" is rebuilt in the page from the sealed history, memory only', async ({ page }) => {
  test.setTimeout(60_000);
  const { world, history } = await stubSite(page);
  world.busyFirst = false;
  // Ada was here last week; Cy two weeks ago; Ben checked in and was undone; Tia never came.
  world.history = {
    '2026-01-14': [
      await sealedRow(history, '2026-01-14', 'checkin', { ts: 1, first: 'Ada', last: 'Tester', club: 'Cubbies', clubberId: '11', source: 'desk' }),
      await sealedRow(history, '2026-01-14', 'checkin', { ts: 2, first: 'Ben', last: 'Tester', club: 'Sparks', clubberId: '12', source: 'desk' }),
      await sealedRow(history, '2026-01-14', 'undo', { ts: 3, first: 'Ben', last: 'Tester', club: 'Sparks', clubberId: '12', source: 'desk' }),
    ],
    '2026-01-07': [await sealedRow(history, '2026-01-07', 'checkin', { ts: 1, first: 'Cy', last: 'Other', club: 'T&T', clubberId: '13', source: 'ttt' })],
  };
  await signIn(page);
  const away = page.locator('.away', { hasText: 'Not here the last two club nights · 1' });
  await expect(away).toBeVisible({ timeout: 10_000 });
  await expect(away.locator('.famsm')).toHaveText(/Tia Youth/);
  await expect(page.locator('.fam', { hasText: 'Tester' })).toHaveCount(1);   // Ada was here: the family is not away
  await expect(page.locator('.fam', { hasText: 'Cy Other' })).toHaveCount(1);
  // Typing finds her at the bottom, and her card says so; she checks in like anyone else.
  await search(page).fill('Tia');
  await expect(page.locator('.away .lead')).toHaveText('Not here the last two club nights');
  await page.locator('.away .famsm').click();
  await expect(page.locator('#kid-sheet .sub')).toHaveText('Not here the last two club nights');
  await page.locator('#kid-sheet').getByRole('button', { name: 'Check in' }).click();
  await expect(page.locator('#toast')).toContainText('Tia Youth is checked in');
  // Worker (D1) reads only: one nights list and each night's rows, once; nothing kept in storage.
  expect(world.historyCalls.filter((c) => c === '/v1/history/nights')).toHaveLength(1);
  expect(world.historyCalls.filter((c) => c.startsWith('/v1/history/rows'))).toHaveLength(2);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toMatch(/Tia|Cy Other|Ada|privateKey|d":/);
  // A reload takes up the session without the passphrase: no key, so nobody is shown away.
  await page.reload();
  await expect(page.locator('#list')).toContainText('families still to come', { timeout: 10_000 });
  await page.waitForTimeout(500);
  await expect(page.locator('.away')).toHaveCount(0);
});

test('remembered leaders come from the church settings; a new leader tag adds one; no route, no chips', async ({ page }) => {
  test.setTimeout(60_000);
  const { world, stationRing } = await stubSite(page);
  world.busyFirst = false;
  world.church = { rev: 3, settings: sanitizeChurch({ labelFooter: 'Welcome', leaders: [{ firstName: 'Ann', lastName: 'Lead', clubName: 'Cubbies', lastPrintedAt: 1760000000000, printCount: 4 }] }).settings };
  await signIn(page);
  await expect(page.locator('#list')).toContainText('families still to come', { timeout: 10_000 });
  await page.locator('#menu-btn').click();
  await expect(page.locator('#leader-chips .leader-chip')).toHaveText([/Ann Lead · Cubbies/]);
  await page.locator('.leader-chip', { hasText: 'Ann Lead' }).getByRole('button', { name: 'Print', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('1 leader tag sent');
  expect(await cc.openAsStation(stationRing, world.tags[0].bundle)).toMatchObject({ route: '/print-leader', body: { name: 'Ann Lead', clubName: 'Cubbies' } });
  // A typed leader's tag prints, then the name joins the list (only the leaders key is written, on the current rev).
  await page.getByLabel('Leader\'s name').fill('Pat Leader');
  await page.locator('#leader-club').selectOption('Sparks');
  await page.locator('#leader-print').click();
  await expect(page.locator('#leader-chips .leader-chip')).toHaveCount(2);
  expect(world.churchPuts).toEqual([{ baseRev: 3, settings: { leaders: [
    { firstName: 'Ann', lastName: 'Lead', clubName: 'Cubbies', lastPrintedAt: 1760000000000, printCount: 4 },
    { firstName: 'Pat', lastName: 'Leader', clubName: 'Sparks' },
  ] } }]);
  expect(world.church.settings.labelFooter).toBe('Welcome');
  // Tick both and Print selected: one sealed leader job each.
  for (const chip of await page.locator('.leader-chip input[type=checkbox]').all()) await chip.check();
  await page.locator('#leader-print-selected').click();
  await expect(page.locator('#toast')).toContainText('2 leader tags sent');
  expect(world.tags).toHaveLength(4);
  // Forget one.
  page.once('dialog', (d) => d.accept());
  await page.locator('.leader-chip', { hasText: 'Ann Lead' }).getByRole('button', { name: 'Forget Ann Lead' }).click();
  await expect(page.locator('#leader-chips .leader-chip')).toHaveText([/Pat Leader · Sparks/]);

  // The Worker has no church settings yet (404): no chips, and the print still works.
  world.church = null;
  await page.locator('#menu-close').click();
  await page.locator('#menu-btn').click();
  await expect(page.locator('#leader-chips-wrap')).toBeHidden();
  await page.getByLabel('Leader\'s name').fill('Quinn New');
  await page.locator('#leader-print').click();
  await expect(page.locator('#toast')).toContainText('Leader tag for Quinn New');
  expect(world.churchPuts).toHaveLength(2);   // the add and the forget above; nothing for Quinn
});

/** The child's own line on its tile in the list (data-state while the queue holds them). */
const kidState = (page, name) => page.locator(`#list .kid[data-name="${name}"]`);

for (const where of ['/checkin/', '/checkin/ym/']) {
  const ym = where === '/checkin/ym/';
  test(`the queue on ${where}: taps at once, each pending until TwoTimTwo confirms; a refusal reverts one; busy retries by itself`, async ({ page }) => {
    test.setTimeout(60_000);
    const kids = ym ? [
      { clubberId: '21', first: 'Tia', last: 'Youth', club: 'Trek', clubId: '6', checkedIn: false },
      { clubberId: '22', first: 'Jo', last: 'Journey', club: 'Journey', clubId: '7', checkedIn: false },
      { clubberId: '23', first: 'Max', last: 'Trekker', club: 'Trek', clubId: '6', checkedIn: false },
    ] : undefined;
    const { world } = await stubSite(page, { kids });
    world.busyFirst = false;
    await signIn(page, where);
    await expect(page.locator('#list')).toContainText('still to come', { timeout: 10_000 });
    let release;
    world.gate = new Promise((r) => { release = r; });
    const [refused, busy, third] = ym ? [['21', 'Tia Youth'], ['22', 'Jo Journey'], ['23', 'Max Trekker']] : [['13', 'Cy Other'], ['14', 'Tia Youth'], ['11', 'Ada Tester']];
    world.refuseFor[refused[0]] = 'no-attendance-item';
    world.busyFor[`/v1/desk/checkin:${busy[0]}`] = 1;

    // Three children, one after the other: the volunteer never waits.
    for (const [, name] of [refused, busy]) {
      await page.locator('.fam', { hasText: name }).click();
      await page.locator('#kid-sheet').getByRole('button', { name: 'Check in' }).click();
    }
    if (ym) {
      await page.locator('.fam', { hasText: third[1] }).click();
      await page.locator('#kid-sheet').getByRole('button', { name: 'Check in' }).click();
    } else {
      await page.locator('.fam', { hasText: 'Tester' }).click();
      await page.getByRole('button', { name: 'Both of them' }).click();
    }
    // Every tapped child shows "Checking in…"; none says checked in before TwoTimTwo does.
    for (const name of [refused[1], busy[1], third[1]]) await expect(kidState(page, name)).toHaveAttribute('data-state', 'pending');
    await expect(kidState(page, refused[1])).toHaveText('Checking in…');
    await expect(page.locator('#list')).not.toContainText('Checked in ✓');
    await expect(page.locator('#count-pill')).toHaveText('0 in');
    await snap(page, `${ym ? 'ym-' : ''}queue-pending.png`);
    // Up to six at the Worker at once (owner 2026-10-15: big families at once), in tap order.
    await expect.poll(() => world.posts.length).toBe(ym ? 3 : 4);
    expect(world.posts.map((p) => p.body.clubberId)).toEqual(ym ? [refused[0], busy[0], third[0]] : [refused[0], busy[0], third[0], '12']);

    release();
    world.gate = null;
    // The refused child alone reverts, with the reason.
    await expect(kidState(page, refused[1])).toHaveAttribute('data-state', 'failed');
    await expect(kidState(page, refused[1])).toHaveText('Not checked in: TwoTimTwo has no attendance item for that club tonight.');
    await expect(page.locator('#toast')).toContainText(`Couldn’t check in ${refused[1]}: TwoTimTwo has no attendance item for that club tonight.`);
    // The busy one: a calm countdown, then the page tries again by itself.
    await expect(kidState(page, busy[1])).toContainText(/Waiting for TwoTimTwo… \d+s/);
    await snap(page, `${ym ? 'ym-' : ''}queue-waiting.png`);
    await expect(kidState(page, busy[1])).toHaveText('Checked in ✓', { timeout: 8000 });
    await expect(page.locator('#count-pill')).toHaveText(ym ? '2 in' : '3 in', { timeout: 8000 });
    const order = world.posts.filter((p) => p.path === '/v1/desk/checkin').map((p) => p.body.clubberId);
    expect(order.slice(0, 3)).toEqual([refused[0], busy[0], third[0]]);
    expect(order.filter((id) => id === busy[0])).toHaveLength(2);   // the automatic retry, once
    await expect(page.locator('.fam', { hasText: refused[1] })).toHaveCount(1);

    // Undo through the same queue: busy, a countdown, then done by itself.
    world.busyFor[`/v1/desk/undo:${third[0]}`] = 1;
    await page.locator('#count-pill').click();
    const row = page.locator('.row', { hasText: third[1] });
    if (ym) await expect(row.getByRole('button', { name: 'Check out' })).toHaveCount(0);   // the Worker checks Trek and Journey out
    await row.getByRole('button', { name: 'Undo check-in' }).click();
    await page.locator('#confirm-ok').click();
    await expect(row).toContainText(/Waiting for TwoTimTwo… \d+s/);
    await expect(page.locator('#toast')).toContainText(`${third[1]}’s check-in is undone`, { timeout: 8000 });
    expect(world.posts.filter((p) => p.path === '/v1/desk/undo')).toHaveLength(2);
  });
}

for (const where of ['/checkin/', '/checkin/ym/']) {
  const ym = where === '/checkin/ym/';
  const tag = ym ? 'ym-' : '';
  test(`BARF on ${where}: the green button only on a BARF night; a late friend redoes the check-in, prints the BARF tag, and a failed redo offers one tap`, async ({ page }) => {
    test.setTimeout(90_000);
    const kids = ym ? [
      { clubberId: '21', first: 'Tia', last: 'Youth', club: 'Trek', clubId: '6', checkedIn: true },
      { clubberId: '22', first: 'Jo', last: 'Journey', club: 'Journey', clubId: '7', checkedIn: true },
      { clubberId: '23', first: 'Max', last: 'Trekker', club: 'Trek', clubId: '6', checkedIn: true },
      { clubberId: '24', first: 'Una', last: 'Late', club: 'Journey', clubId: '7', checkedIn: false },
    ] : [
      { clubberId: '11', first: 'Ada', last: 'Tester', club: 'Cubbies', clubId: '1', checkedIn: true },
      { clubberId: '12', first: 'Ben', last: 'Tester', club: 'Sparks', clubId: '2', checkedIn: true },
      { clubberId: '13', first: 'Cy', last: 'Other', club: 'T&T', clubId: '3', checkedIn: true },
      { clubberId: '14', first: 'Tia', last: 'Youth', club: 'Trek', clubId: '6', checkedIn: false },
    ];
    const [pick, hasFriend, failing] = ym ? [['21', 'Tia Youth', 'Tia', 'Trek'], ['22', 'Jo Journey'], ['23', 'Max Trekker']] : [['11', 'Ada Tester', 'Ada', 'Cubbies'], ['12', 'Ben Tester'], ['13', 'Cy Other']];
    const { world, stationRing, historyRing } = await stubSite(page, { kids });
    world.busyFirst = false;

    // Not a BARF night, or the Worker cannot say: no button.
    world.barf = { night: '2026-10-14', barfNight: false, friends: [], tagRoute: '/print-barf-tag', stations: 1 };
    await signIn(page, where);
    await expect(page.locator('#list')).toContainText(/still to come|Everyone/, { timeout: 10_000 });
    await expect(page.locator('#barf-btn')).toBeHidden();
    world.barf = null;
    await page.reload();
    await expect(page.locator('#list')).toContainText(/still to come|Everyone/, { timeout: 10_000 });
    await expect(page.locator('#barf-btn')).toBeHidden();

    // A BARF night: the green button at the top.
    world.barf = { night: '2026-10-14', barfNight: true, friends: [hasFriend[0]], tagRoute: '/print-barf-tag', stations: 1 };
    await page.reload();
    await expect(page.locator('#barf-btn')).toBeVisible({ timeout: 10_000 });
    await snap(page, `${tag}barf-button.png`);
    await page.locator('#barf-btn').click();
    await expect(page.locator('#barf-title')).toHaveText('Who brought the friend?');
    // Tonight's checked-in children; one who already brought a friend is greyed out; the others wait behind the search box.
    const kidsListed = page.locator('#barf-body .barf-kid');
    await expect(kidsListed).toHaveCount(3);
    await expect(page.locator('.barf-kid', { hasText: hasFriend[1] })).toBeDisabled();
    await expect(page.locator('.barf-kid', { hasText: hasFriend[1] })).toContainText('Has a friend');
    await snap(page, `${tag}barf-who.png`);
    await page.locator('.barf-kid', { hasText: pick[1] }).click();
    // The friend's first name is required.
    await page.locator('#barf-body').getByRole('button', { name: 'Next' }).click();
    await expect(page.locator('#barf-body .err')).toHaveText('Type the friend’s first name.');
    await page.locator('#barf-body').getByLabel('Friend’s first name').fill('  Sam  ');
    await page.locator('#barf-body').getByLabel('Friend’s club').selectOption('Sparks');
    await snap(page, `${tag}barf-friend-name.png`);
    await page.locator('#barf-body').getByRole('button', { name: 'Next' }).click();
    await expect(page.locator('#barf-title')).toHaveText(`${pick[1]} brought Sam`);
    await snap(page, `${tag}barf-confirm.png`);
    await page.locator('#barf-body').getByRole('button', { name: 'Confirm' }).click();
    await expect(page.locator('#toast')).toContainText(`${pick[2]}’s BARF tag is printing. Sam is on the BARF list.`);
    await snap(page, `${tag}barf-done.png`);
    // What was sent: the child's id, the friend's first name, the BARF tag sealed to the station, the row to the history key.
    const sent = world.barfPosts[0];
    expect(sent.clubberId).toBe(pick[0]);
    expect(sent.friendName).toBe('Sam');
    expect(sent.friendClub).toBe('Sparks');
    const { tagJob: _j, historyRow: _r, ...plain } = sent;
    expect(JSON.stringify(plain)).not.toContain(pick[2]);
    expect(sent.tagJob.jobId).toMatch(/^reprint:/);
    const job = await cc.openAsStation(stationRing, sent.tagJob.bundle);
    expect([job.route, job.body]).toEqual(['/print-barf-tag', { firstName: pick[2], clubName: pick[3] }]);
    expect(sent.historyRow.kind).toBe('barf-friend');
    expect(await cc.openRow(historyRing, sent.historyRow)).toMatchObject({ first: pick[2], clubberId: pick[0], friend: true, friendFirst: 'Sam' });
    expect(world.posts).toHaveLength(0);   // no check-in of the friend, no second check-in of the child

    // The redo does not take: a red line, and one tap checks them in again (no label).
    world.barfRedo = 'fail';
    await page.locator('#barf-btn').click();
    await expect(page.locator('.barf-kid', { hasText: pick[1] })).toBeDisabled();   // a second friend: not offered
    await page.locator('.barf-kid', { hasText: failing[1] }).click();
    await page.locator('#barf-body').getByLabel('Friend’s first name').fill('Lu');
    await page.locator('#barf-body').getByRole('button', { name: 'Next' }).click();
    await page.locator('#barf-body').getByRole('button', { name: 'Confirm' }).click();
    const red = page.locator('#barf-alert .ba.bad');
    await expect(red).toContainText(`${failing[1]} is NOT checked in on TwoTimTwo — check them in again.`);
    await snap(page, `${tag}barf-not-checked-in.png`);
    // A reload keeps the red line: the Worker says who still waits to be checked in again.
    await page.reload();
    await expect(red).toContainText(`${failing[1]} is NOT checked in on TwoTimTwo — check them in again.`, { timeout: 15_000 });
    await red.getByRole('button', { name: `Check ${failing[1].split(' ')[0]} in again` }).click();
    await expect(page.locator('#toast')).toContainText(`${failing[1]} is checked in on TwoTimTwo again.`);
    await expect(page.locator('#barf-alert')).toBeHidden();
    expect(world.barfPosts.at(-1)).toMatchObject({ clubberId: failing[0], recheck: true, items: { Bible: true, Friend: true } });
    expect(world.barfPosts.at(-1).tagJob).toBeUndefined();
  });
}

test('BARF: a child who is not checked in yet is found by typing a name, and confirming checks them in with Brought a friend and the friend\'s club', async ({ page }) => {
  test.setTimeout(60_000);
  const kids = [
    { clubberId: '11', first: 'Ada', last: 'Tester', club: 'Cubbies', clubId: '1', checkedIn: true },
    { clubberId: '12', first: 'Ben', last: 'Tester', club: 'Sparks', clubId: '2', checkedIn: false },
  ];
  const { world } = await stubSite(page, { kids });
  world.busyFirst = false;
  world.barf = { night: '2026-10-14', barfNight: true, friends: [], tagRoute: '/print-barf-tag', stations: 1 };
  await signIn(page, '/checkin/');
  await expect(page.locator('#barf-btn')).toBeVisible({ timeout: 10_000 });
  await page.locator('#barf-btn').click();
  // Only the checked-in child until a name is typed.
  await expect(page.locator('#barf-body .barf-kid')).toHaveCount(1);
  await page.locator('#barf-body').getByLabel('Find a child').fill('ben');
  const ben = page.locator('.barf-kid', { hasText: 'Ben Tester' });
  await expect(ben).toContainText('not checked in yet');
  await ben.click();
  await page.locator('#barf-body').getByLabel('Friend’s first name').fill('Sam');
  await page.locator('#barf-body').getByLabel('Friend’s club').selectOption('Cubbies');
  await page.locator('#barf-body').getByRole('button', { name: 'Next' }).click();
  await expect(page.locator('#barf-body')).toContainText('is not checked in yet');
  await page.locator('#barf-body').getByRole('button', { name: 'Confirm' }).click();
  await expect.poll(() => world.posts.length).toBe(1);
  expect(world.posts[0].path).toBe('/v1/desk/checkin');
  expect(world.posts[0].body).toMatchObject({ clubberId: '12', items: { Bible: true, Friend: true }, friendName: 'Sam', friendClub: 'Cubbies' });
  expect(world.barfPosts).toHaveLength(0);   // an ordinary check-in, not the late-friend redo
});

test('BARF switched off (owner 2026-10-15): no green button, no friend name or club, the Brought a friend box stays', async ({ page }) => {
  test.setTimeout(60_000);
  const { world } = await stubSite(page, { barf: false });
  world.busyFirst = false;
  world.barf = { night: '2026-10-14', barfNight: true, friends: [], tagRoute: '/print-barf-tag', stations: 1 };
  await signIn(page, '/checkin/');
  await expect(page.locator('#list')).toContainText(/still to come|Everyone/, { timeout: 10_000 });
  await expect(page.locator('#barf-btn')).toBeHidden();
  await search(page).fill('tester');
  await page.locator('.fcard').click();
  const ben = page.locator('.tile', { hasText: 'Ben Tester' });
  await ben.getByRole('button', { name: 'Brought a friend' }).click();
  await expect(ben.getByLabel('Friend’s first name')).toHaveCount(0);
  await expect(ben.getByLabel('Friend’s club')).toHaveCount(0);
});

// Check out (owner 2026-10-15): a mode of /checkin. The big button at the top switches; the
// grid is the check-in's family tiles holding only children checked in and not checked out yet,
// Puggles to T&T (the Worker checks Trek and Journey out); one tap checks out the whole household
// (one desk check-out per child, after the Undo time: TwoTimTwo's check-out cannot be taken back);
// the tiles grow as families leave.
test('check out: the big button switches modes; one tap checks out a whole household after an Undo window; tiles grow as families leave', async ({ page }) => {
  test.setTimeout(90_000);
  const kids = [
    { clubberId: '11', first: 'Ada', last: 'Tester', club: 'Cubbies', clubId: '1', checkedIn: true },
    { clubberId: '12', first: 'Ben', last: 'Tester', club: 'Sparks', clubId: '2', checkedIn: true },
    { clubberId: '13', first: 'Cy', last: 'Other', club: 'T&T', clubId: '3', checkedIn: true },
    { clubberId: '15', first: 'Dee', last: 'Small', club: 'Puggles', clubId: '4', checkedIn: true },
    { clubberId: '16', first: 'Gus', last: 'Grand', club: 'T&T', clubId: '3', checkedIn: true },
    { clubberId: '17', first: 'Hal', last: 'Hill', club: 'Cubbies', clubId: '1', checkedIn: true },
    { clubberId: '18', first: 'Eve', last: 'Later', club: 'Sparks', clubId: '2', checkedIn: false },
    { clubberId: '14', first: 'Tia', last: 'Youth', club: 'Trek', clubId: '6', checkedIn: true },
    { clubberId: '19', first: 'Jo', last: 'Journey', club: 'Journey', clubId: '7', checkedIn: true },
  ];
  const { world, historyRing } = await stubSite(page, { kids, barf: false });
  world.busyFirst = false;
  await page.clock.install();
  await signIn(page);
  const list = page.locator('#list');
  await expect(list).toContainText('1 family still to come', { timeout: 10_000 });
  const modeBtn = page.locator('#mode-btn');
  await expect(modeBtn).toHaveText('Check out');
  await expect(page.locator('h1')).toHaveText('Check in');

  // The big button: checkout mode, and the same place goes back.
  await modeBtn.click();
  await expect(page.locator('h1')).toHaveText('Check out');
  await expect(modeBtn).toHaveText('← Check in');
  const tiles = list.locator('.fams.out .fam');
  // Only children checked in and not checked out, Puggles to T&T, grouped by household.
  await expect(tiles).toHaveCount(5);
  await expect(tiles.locator('.fn')).toHaveText(['Gus Grand', 'Hal Hill', 'Cy Other', 'Dee Small', 'Tester']);
  const tester = tiles.filter({ hasText: 'Tester' });
  await expect(tester.locator('.kid')).toHaveText(['Ada', 'Ben']);
  await expect(list).not.toContainText(/Tia|Jo Journey|Eve/);
  await expect(list.locator('.lead')).toHaveText('6 children not checked out yet · tap a family to check them out');
  const tileHeight = () => tiles.first().evaluate((e) => e.offsetHeight);
  const fiveHigh = await tileHeight();
  await snap(page, 'checkout-mode.png');

  // Search filters the tiles.
  await search(page).fill('gus');
  await expect(tiles).toHaveCount(1);
  await expect(tiles.locator('.fn')).toHaveText('Gus Grand');
  await search(page).fill('tester');
  await expect(tiles.locator('.fn')).toHaveText(['Tester']);
  await search(page).fill('');
  await expect(tiles).toHaveCount(5);

  // One tap: the household is held for the Undo time; nothing reaches TwoTimTwo yet.
  await tester.click();
  const undoBar = page.locator('#undo-bar');
  await expect(undoBar).toBeVisible();
  await expect(page.locator('#undo-msg')).toHaveText('Checking out the Tester family: Ada, Ben');
  await expect(kidState(page, 'Ada Tester')).toHaveAttribute('data-state', 'held');
  await expect(kidState(page, 'Ben Tester')).toContainText('Checking out…');
  await snap(page, 'checkout-undo.png');
  expect(world.posts).toHaveLength(0);
  // Undo inside the window puts them back, and nothing is ever sent.
  await page.locator('#undo-btn').click();
  await expect(undoBar).toBeHidden();
  await expect(page.locator('#toast')).toContainText('The Tester family is not checked out.');
  await expect(tester.locator('.kid')).toHaveText(['Ada', 'Ben']);
  await page.clock.fastForward(12_000);
  await page.waitForTimeout(300);
  expect(world.posts).toHaveLength(0);

  // Tapped again and left alone: when the Undo time ends, one desk check-out per child.
  await tester.click();
  await page.clock.fastForward(10_500);
  await expect.poll(() => world.posts.length).toBe(2);
  await expect(undoBar).toBeHidden();
  expect(world.posts.map((p) => [p.path, p.body.clubberId])).toEqual([['/v1/desk/checkout', '11'], ['/v1/desk/checkout', '12']]);
  for (const post of world.posts) {
    const { historyRow: _row, ...plain } = post.body;
    expect(JSON.stringify(plain)).not.toMatch(/Ada|Ben|Tester/);
    expect(post.body.historyRow.kind).toBe('checkout');
  }
  expect(await cc.openRow(historyRing, world.posts[0].body.historyRow)).toMatchObject({ first: 'Ada', last: 'Tester', club: 'Cubbies', clubberId: '11' });
  await expect(page.locator('#toast')).toContainText('Tester: 2 checked out');
  await expect(tiles.filter({ hasText: 'Tester' })).toHaveCount(0, { timeout: 8000 });
  await expect(list.locator('.lead')).toHaveText('4 children not checked out yet · tap a family to check them out');
  // Checked out comes off the count (Trek and Journey stay: the Worker checks them out).
  await expect(page.locator('#count-pill')).toHaveText('6 in');

  // A refusal shows on that child alone, and their tile stays.
  world.refuseFor['13'] = 'no-attendance-item';
  await tiles.filter({ hasText: 'Cy Other' }).click();
  await page.clock.fastForward(10_500);
  await expect(kidState(page, 'Cy Other')).toHaveAttribute('data-state', 'failed');
  await expect(kidState(page, 'Cy Other')).toHaveText('Not checked out: TwoTimTwo has no attendance item for that club tonight.');
  await expect(page.locator('#toast')).toContainText('Couldn’t check out Cy Other');
  delete world.refuseFor['13'];

  // Families leave one tap at a time (each its own Undo): the tiles grow.
  for (const name of ['Gus Grand', 'Hal Hill']) await tiles.filter({ hasText: name }).click();
  await page.clock.fastForward(10_500);
  await expect(tiles).toHaveCount(2, { timeout: 8000 });
  await expect(list.locator('.fams.out')).toHaveClass(/\bs4\b/);
  const twoHigh = await tileHeight();
  expect(twoHigh).toBeGreaterThan(fiveHigh);
  await tiles.filter({ hasText: 'Dee Small' }).click();
  await page.clock.fastForward(10_500);
  await expect(tiles).toHaveCount(1, { timeout: 8000 });
  await expect(list.locator('.fams.out')).toHaveClass(/\bs5\b/);
  expect(await tileHeight()).toBeGreaterThan(twoHigh);
  await snap(page, 'checkout-last.png');
  await tiles.filter({ hasText: 'Cy Other' }).click();
  await page.clock.fastForward(10_500);

  // Nobody left: the friendly state.
  await expect(list.locator('.out-done')).toContainText('Everyone has been checked out', { timeout: 8000 });
  await expect(page.locator('#count-pill')).toHaveText('2 in');
  await snap(page, 'checkout-everyone.png');
  expect(world.posts.filter((p) => p.path === '/v1/desk/checkout').map((p) => p.body.clubberId)).toEqual(['11', '12', '13', '16', '17', '15', '13']);
  expect(world.posts.filter((p) => p.path !== '/v1/desk/checkout')).toHaveLength(0);
  // Nothing with a name kept in the browser's storage.
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toMatch(/Ada Tester|Ben Tester|Cy Other|Gus Grand|Hal Hill|Dee Small/);

  // Back to Check in: the same place, the check-in list.
  await modeBtn.click();
  await expect(page.locator('h1')).toHaveText('Check in');
  await expect(modeBtn).toHaveText('Check out');
  await expect(list).toContainText('1 family still to come');
  await expect(list.locator('.fams.out')).toHaveCount(0);
});

test('the desk laptop (owner 2026-10-22): a click goes full screen, the big Exit button leaves it; Record keeping opens tonight\'s meeting; check-out tiles fill the screen', async ({ page }) => {
  const kids = [
    { clubberId: '11', first: 'Ada', last: 'Tester', club: 'Cubbies', clubId: '1', checkedIn: true },
    { clubberId: '13', first: 'Cy', last: 'Other', club: 'T&T', clubId: '3', checkedIn: true },
    { clubberId: '18', first: 'Eve', last: 'Later', club: 'Sparks', clubId: '2', checkedIn: false },
  ];
  const { world } = await stubSite(page, { kids, barf: false });
  world.busyFirst = false;
  world.calendarId = '412';
  await page.setViewportSize({ width: 1500, height: 1000 });   // the Surface Laptop 2 at its usual scale
  await signIn(page);
  const list = page.locator('#list');
  await expect(list).toContainText('1 family still to come', { timeout: 10_000 });

  // Record keeping: tonight's meeting from the roster, in a new tab, never re-entering full screen.
  const record = page.locator('#record-btn');
  await expect(record).toBeVisible();
  await expect(record).toHaveText('Record keeping');
  await expect(record).toHaveAttribute('href', 'https://kvbchurch.twotimtwo.com/meeting/record?calendar_id=412&club_id=3');
  await expect(record).toHaveAttribute('target', '_blank');

  // A click anywhere puts the page full screen; the big button takes it out; the next click puts it back.
  // (Unlock was the first click: the page is already full screen.)
  const exit = page.locator('#fs-exit');
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await expect(exit).toBeVisible();
  await expect(exit).toHaveText('Exit full screen');
  await exit.click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await expect(exit).toBeHidden();
  await page.locator('#search').click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  // Record keeping leaves full screen (the link opens its tab; the stub keeps it from going anywhere).
  await page.route('https://kvbchurch.twotimtwo.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>record</p>' }));
  const popup = page.waitForEvent('popup');
  await record.click();
  await (await popup).close();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);

  // Check out: two families fill the room under the list's header.
  await page.locator('#mode-btn').click();
  const tiles = list.locator('.fams.out .fam');
  await expect(tiles).toHaveCount(2, { timeout: 8000 });
  const room = await page.evaluate(() => {
    const grid = document.querySelector('.fams.out');
    const r = grid.getBoundingClientRect();
    return { bottom: r.bottom, width: r.width, viewH: window.innerHeight, listW: document.getElementById('list').clientWidth };
  });
  expect(room.viewH - room.bottom).toBeLessThan(120);
  expect(room.width).toBeGreaterThan(room.listW - 40);
  await snap(page, 'checkout-fill.png');
});

test('the top bar (owner 2026-10-22): Check out lives there, another device\'s check-ins and check-outs show for 10 s, the logo gives way first; the + menu reprints a tag; the big Undo stays 30 s', async ({ page }) => {
  test.setTimeout(90_000);
  const kids = [
    { clubberId: '11', first: 'Ada', last: 'Tester', club: 'Cubbies', clubId: '1', checkedIn: true },
    { clubberId: '13', first: 'Cy', last: 'Other', club: 'T&T', clubId: '3', checkedIn: true },
    { clubberId: '18', first: 'Eve', last: 'Later', club: 'Sparks', clubId: '2', checkedIn: false },
    { clubberId: '20', first: 'Zed', last: 'Solo', club: 'Sparks', clubId: '2', checkedIn: false },
  ];
  const { world, stationRing } = await stubSite(page, { kids, barf: false, simple: true });
  world.busyFirst = false;
  world.households = [];
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.clock.install();
  await signIn(page);
  const list = page.locator('#list');
  await expect(list).toContainText('2 families still to come', { timeout: 10_000 });
  const top = page.locator('header.top');
  const news = page.locator('#hdr-news');
  // Check out is a button in the blue bar now, not a bar above the search.
  await expect(top.locator('#mode-btn')).toHaveText('Check out');
  await expect(page.locator('main #mode-btn')).toHaveCount(0);
  // At 1500 wide everything fits, logo included, with room left for names.
  await expect(page.locator('#fs-exit')).toBeVisible();
  await expect(page.locator('.top .brand')).toBeVisible();
  expect(await news.evaluate((e) => e.clientWidth)).toBeGreaterThanOrEqual(140);
  await expect(news).toBeEmpty();
  // A narrower window: the logo is the first thing to go, the title stays.
  await page.setViewportSize({ width: 1050, height: 1000 });
  await expect(page.locator('.top .brand')).toBeHidden();
  await expect(page.locator('.top h1')).toBeVisible();
  await page.setViewportSize({ width: 1500, height: 1000 });
  await expect(page.locator('.top .brand')).toBeVisible();

  // Eve is checked in on another phone: her name shows in the bar for 10 s, then goes.
  world.kids = world.kids.map((k) => (k.clubberId === '18' ? { ...k, checkedIn: true } : k));
  await page.clock.fastForward(16_000);
  await expect(news.locator('.news')).toHaveText(['INEve Later'], { timeout: 8000 });
  await page.clock.fastForward(11_000);
  await expect(news.locator('.news')).toHaveCount(0);
  // Ada is checked out on another phone: OUT, then gone.
  world.kids = world.kids.map((k) => (k.clubberId === '11' ? { ...k, checkedOut: true } : k));
  await page.clock.fastForward(16_000);
  await expect(news.locator('.news.out')).toHaveText('OUTAda Tester', { timeout: 8000 });
  await page.clock.fastForward(11_000);
  await expect(news.locator('.news')).toHaveCount(0);
  // This page's own check-in is never news; its big Undo stays 30 s now (was a minute).
  await list.locator('.fam', { hasText: 'Zed Solo' }).click();
  await expect(page.locator('#undo-bar')).toBeVisible();
  await page.clock.fastForward(16_000);
  await expect(news.locator('.news')).toHaveCount(0);
  await page.clock.fastForward(15_000);
  await expect(page.locator('#undo-bar')).toBeHidden();


  // The + menu: Reprint a name tag, tonight's checked-in children only, one tap.
  await page.locator('#menu-btn').click();
  const reprint = page.locator('#reprint-list');
  await expect(reprint.getByRole('button')).toHaveText([/Cy Other/, /Eve Later/, /Zed Solo/]);   // Ada was checked out
  await page.locator('#reprint-q').fill('ev');
  await expect(reprint.getByRole('button')).toHaveCount(1);
  await reprint.getByRole('button', { name: 'Reprint Eve Later’s name tag' }).click();
  await expect(page.locator('#toast')).toContainText('Eve Later’s name tag sent to the printer.');
  expect(world.tags).toHaveLength(1);
  expect(await cc.openAsStation(stationRing, world.tags[0].bundle)).toMatchObject({ route: '/reprint', body: { name: 'Eve Later', clubberId: '18' }, source: 'desk' });
  await page.locator('#reprint-q').fill('nobody');
  await expect(reprint).toContainText('Nobody checked in tonight matches “nobody”.');
});

test('scrolled down, the roster refresh keeps the page where it is (owner 2026-10-22)', async ({ page }) => {
  const names = ['Ava', 'Ben', 'Cara', 'Dan', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jon'];
  const kids = [];
  for (let i = 0; i < 60; i++) kids.push({ clubberId: String(500 + i), first: names[i % 10], last: `Family${String(i).padStart(2, '0')}`, club: 'Sparks', clubId: '2', checkedIn: false });
  const { world } = await stubSite(page, { kids, barf: false, simple: true });
  world.busyFirst = false;
  world.households = [];
  await page.clock.install();
  await signIn(page);
  const list = page.locator('#list');
  await expect(list).toContainText('60 families still to come', { timeout: 10_000 });
  await page.evaluate(() => window.scrollTo(0, 1500));
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(1500);
  const calls = world.rosterCalls;
  await page.clock.fastForward(20_000);   // past the 15 s roster refresh
  await expect.poll(() => world.rosterCalls).toBeGreaterThan(calls);
  await page.waitForTimeout(300);
  expect(Math.round(await page.evaluate(() => window.scrollY))).toBe(1500);
  // A child checked in elsewhere (the next refresh redraws the list): still in place.
  world.kids = world.kids.map((k) => (k.clubberId === '501' ? { ...k, checkedIn: true } : k));
  await page.clock.fastForward(20_000);
  await expect(list).toContainText('59 families still to come', { timeout: 8000 });
  expect(Math.round(await page.evaluate(() => window.scrollY))).toBe(1500);
});

test('a new familiesAt on the roster answer reads the families again, so a newly registered child joins their family', async ({ page }) => {
  test.setTimeout(60_000);
  const { world } = await stubSite(page);
  world.busyFirst = false;
  world.familiesAt = '2026-10-14T21:00:00.000Z';
  await signIn(page);
  await expect(page.locator('.fam', { hasText: 'Tester' })).toHaveCount(1, { timeout: 10_000 });
  expect(world.familiesCalls).toBe(1);
  // The same familiesAt on the next roster answer: no second read (the half-hour rule stands).
  const before = world.rosterCalls;
  await page.locator('.fam', { hasText: 'Cy Other' }).click();
  await page.locator('#kid-sheet').getByRole('button', { name: 'Check in' }).click();   // the page re-reads the roster 6 s later
  await expect.poll(() => world.rosterCalls, { timeout: 15_000 }).toBeGreaterThan(before);
  expect(world.familiesCalls).toBe(1);
  // Dee is registered on TwoTimTwo: the Worker's households change, and its roster says so.
  world.kids.push({ clubberId: '15', first: 'Dee', last: 'Tester', club: 'Puggles', clubId: '4', checkedIn: false });
  world.households = [['Ada Tester', 'Ben Tester', 'Dee Tester']];
  world.familiesAt = '2026-10-14T22:05:00.000Z';
  await page.locator('.fam', { hasText: 'Tia Youth' }).click();
  await page.locator('#kid-sheet').getByRole('button', { name: 'Check in' }).click();
  await expect.poll(() => world.familiesCalls, { timeout: 15_000 }).toBe(2);
  await expect(page.locator('.fam', { hasText: 'Tester' })).toHaveCount(1);
  await expect(page.locator('.fam', { hasText: 'Tester' })).toContainText('Dee');
});
