#!/usr/bin/env node
// The lobby's still-here list and the phone's Check out (7.16.0), against a
// REALLY running print server plus the extension code lifted out of
// content.js / feeds.js.
//
// What it guards:
// * The setting. config.json `pickupClubs` ("Clubs on the pickup list" on the
//   dashboard): default every club but Trek and Journey, a club we do not know
//   is a 400, spellings are stored canonical, null goes back to the default.
// * The list. The children here now by the COUNT's rules (report plus newer
//   history, minus undone, minus checked out, one child per identity, visitors
//   only while the count is history-built), in the ticked clubs, first name +
//   club only, sorted, published as the existing `checkout` event (entries +
//   at + printed, nothing else) when it changes and only inside the window.
//   /feed/checkout (an older extension's scrape) is accepted, never published.
// * The phone's Check out. /phone/undo with checkout:true queues a
//   `{type:'checkout'}` action only a 7.16 extension is handed, and nothing
//   changes until a literal ok:true; then the child is off the count and the
//   list. A row with no TwoTimTwo id is marked here at once.
// * The extension. Its check-out counts only TwoTimTwo's exact "OK", and the
//   Checkout page's disappearances are read only between two genuine reads.
//
// Run: node scripts/test-pickup-board.cjs

'use strict';

let __suiteFinished = false;
process.on('exit', (code) => {
  if (code === 0 && !__suiteFinished) {
    console.error('✗ Test suite terminated before completing (crash swallowed?) — failing.');
    process.exitCode = 1;
  }
});

const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const PORT = Number(process.env.AWANA_TEST_PORT || 34621);
const BASE = `http://127.0.0.1:${PORT}`;
const CONTENT = fs.readFileSync(path.join(root, 'chrome-extension', 'content.js'), 'utf8');
const FEEDS = fs.readFileSync(path.join(root, 'chrome-extension', 'feeds.js'), 'utf8');

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

function extractFrom(src, name, file) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error(`${file} no longer defines function ${name}() — update this test with the refactor`);
  let depth = 0;
  let opened = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') { depth++; opened = true; } else if (ch === '}') {
      depth--;
      if (opened && depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces while extracting ${name}() from ${file}`);
}
const fromContent = (n) => extractFrom(CONTENT, n, 'content.js');
const fromFeeds = (n) => extractFrom(FEEDS, n, 'feeds.js');

const wire = [];
const realLoad = Module._load;
Module._load = function patched(request) {
  if (request === 'pusher') {
    return class FakePusher {
      trigger(channel, event, payload) { wire.push({ channel, event, payload }); return Promise.resolve(); }
    };
  }
  // eslint-disable-next-line prefer-rest-params
  return realLoad.apply(this, arguments);
};

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function settingSuite() {
  console.log('\npickup list: the setting');
  const pickup = require(path.join(root, 'print-server', 'pickup.js'));
  check('the default is every club but Trek and Journey',
    JSON.stringify(pickup.pickupClubsOf({})) === JSON.stringify(['Puggles', 'Cubbies', 'Sparks', 'T&T']));
  check('a saved list wins, an empty one included',
    JSON.stringify(pickup.pickupClubsOf({ pickupClubs: ['Trek'] })) === '["Trek"]' && JSON.stringify(pickup.pickupClubsOf({ pickupClubs: [] })) === '[]');
  check('a damaged saved value falls back to the default', pickup.pickupClubsOf({ pickupClubs: 'Trek' }).length === 4);
  let n = pickup.normalizePickupClubs(['t & t', 'sparks ', 'Sparks', 'Journey']);
  check('spellings are stored canonical, once each, in display order', n.ok && JSON.stringify(n.value) === '["Sparks","T&T","Journey"]', JSON.stringify(n));
  n = pickup.normalizePickupClubs(['Sparks', 'Rangers']);
  check('a club we do not know is refused, by name', !n.ok && /Rangers/.test(n.reason));
  check('not a list is refused', !pickup.normalizePickupClubs('Sparks').ok && !pickup.normalizePickupClubs([7]).ok);
  check('null means back to the default', pickup.normalizePickupClubs(null).ok && pickup.normalizePickupClubs(null).value === null);
  const dash = fs.readFileSync(path.join(root, 'print-server', 'public', 'index.html'), 'utf8');
  check('the dashboard offers the same clubs and the same default',
    dash.includes(`var PICKUP_CLUBS = ${JSON.stringify(pickup.PICKUP_CLUBS).replace(/"/g, "'").replace(/,/g, ', ')};`)
    && dash.includes(`var PICKUP_DEFAULT = ${JSON.stringify(pickup.PICKUP_DEFAULT).replace(/"/g, "'").replace(/,/g, ', ')};`));
  check('and saves it with the other settings', /pickupClubs: readPickupClubs\(\),/.test(dash) && /renderPickupClubs\(config\.pickupClubs\);/.test(dash));

  console.log('\npickup list: composition');
  const kids = [
    { firstName: 'Zoe', club: 'Sparks ' }, { firstName: 'ava', club: 'T&amp;T' }, { firstName: 'Tom', club: 'Trek' },
    { firstName: 'Ava', club: 'Cubbies' }, { firstName: '', club: 'Sparks' }, { firstName: 'Neo', club: '' },
  ];
  const list = pickup.buildStillHere(kids, pickup.PICKUP_DEFAULT, 60);
  check('ticked clubs only, nameless dropped, sorted by first name then club',
    JSON.stringify(list) === JSON.stringify([{ firstName: 'Ava', club: 'Cubbies' }, { firstName: 'ava', club: 'T&T' }, { firstName: 'Neo', club: '' }, { firstName: 'Zoe', club: 'Sparks' }]), JSON.stringify(list));
  check('a child whose club cannot be read is listed while any club is ticked, never with none',
    list.some((k) => k.firstName === 'Neo') && pickup.buildStillHere(kids, [], 60).length === 0);
  check('capped', pickup.buildStillHere(kids, pickup.PICKUP_CLUBS, 2).length === 2);
  check('first name and club only', list.every((k) => Object.keys(k).join() === 'firstName,club'));
}

async function extensionSuite() {
  console.log('\nextension check-out: what counts as checked out');
  {
    const calls = [];
    const mk = (reply) => new Function('fetch', 'AbortSignal', fromContent('postClubberCheckout') + '; return postClubberCheckout;')(
      (url, init) => { calls.push({ url, init }); return typeof reply === 'function' ? reply() : Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(reply) }); },
      { timeout: () => undefined });
    check('TwoTimTwo\'s exact "OK" is a check-out', await mk('OK')('368', '4821') === true && await mk(' OK\n')('368', '4821') === true);
    const c = calls[0];
    check('it posts the Checkout page\'s own call: calendar_id and clubber_id, as a form',
      c.url === '/clubber/checkout' && c.init.method === 'POST' && c.init.credentials === 'same-origin'
      && c.init.headers['Content-Type'] === 'application/x-www-form-urlencoded' && c.init.body === 'calendar_id=368&clubber_id=4821', JSON.stringify(c));
    for (const [what, reply] of [['"ok"', 'ok'], ['"OK!"', 'OK!'], ['a page carrying OK', '<!DOCTYPE html><html><body>OK</body></html>'], ['"Login Required"', 'Login Required'], ['an empty reply', '']]) {
      check(`${what} is not`, await mk(reply)('368', '4821') === false);
    }
    check('an HTTP error is not', await mk(() => Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('OK') }))('368', '4821') === false);
    check('no network is not, and never a rejection', await mk(() => Promise.reject(new Error('offline')))('368', '4821') === false);
  }
  check('the youth sweep and the phone share that one call',
    /return postClubberCheckout\(page\.cal, id\)\.then/.test(fromContent('ymSweep')) && /postClubberCheckout\(page\.cal, id\)/.test(fromContent('checkoutOnTwoTimTwo')));

  console.log('\nextension check-out: reading the Checkout page');
  {
    const page = (title, script, date) => `<!doctype html><html><head><title>${title}</title><script>${script}</script></head><body>
      <select id="date"><option value="2026-10-01">1</option><option value="${date}" selected>8</option></select></body></html>`;
    const mk = (res) => new Function('fetch', 'AbortSignal', 'DOMParser', fromContent('readCheckoutPage') + '; return readCheckoutPage;')(
      () => (res instanceof Error ? Promise.reject(res) : Promise.resolve(res)), { timeout: () => undefined }, new JSDOM('').window.DOMParser);
    const ok = (html, url) => ({ ok: true, status: 200, url: url || 'https://kvbchurch.twotimtwo.com/clubber/checkout', text: () => Promise.resolve(html) });
    let r = await mk(ok(page('KVBC - Checkout Clubber', 'var o = { calendar_id: 368 };', '2026-10-08')))();
    check('the meeting id and date come off the page', r.ok && r.cal === '368' && r.date === '2026-10-08', JSON.stringify({ ok: r.ok, cal: r.cal, date: r.date }));
    r = await mk(ok(page('Login', 'calendar_id: 368', '2026-10-08')))();
    check('another page (signed out) is refused', !r.ok && /signed out/.test(r.error));
    r = await mk(ok(page('KVBC - Checkout Clubber', 'calendar_id: 368', '2026-10-08'), 'https://x.twotimtwo.com/site/login'))();
    check('a redirect to the login page is refused', !r.ok);
    r = await mk(ok(page('KVBC - Checkout Clubber', 'nothing here', '2026-10-08')))();
    check('no meeting id is refused', !r.ok && /no meeting/.test(r.error));
  }

  console.log('\nextension check-out: the whole check-out');
  {
    const SAY = CONTENT.slice(CONTENT.indexOf('var CHECKOUT_SAY = {'), CONTENT.indexOf('};', CONTENT.indexOf('var CHECKOUT_SAY = {')) + 2);
    const run = async ({ page = { ok: true, cal: '368', date: '2026-10-08' }, answer = true, driven = true, id = '4821', done = [] }) => {
      const env = { posts: 0, marked: null, posted: null };
      const fn = new Function('CHURCH_CFG', 'readCheckoutPage', 'postClubberCheckout', 'ymDone', 'ymMarkDone', 'postCheckedOut', 'console',
        SAY + '\n' + fromContent('checkoutOnTwoTimTwo') + '; return checkoutOnTwoTimTwo;')(
        { enableDrivenCheckin: driven },
        () => (page instanceof Error ? Promise.reject(page) : Promise.resolve(page)),
        (cal, cid) => { env.posts++; env.cal = cal; env.cid = cid; return Promise.resolve(answer); },
        () => done.slice(),
        (date, ids) => { env.marked = { date, ids }; },
        (date, ids) => { env.posted = { date, ids }; },
        { log() {} });
      env.out = await fn(id, 'Ava Stone');
      return env;
    };
    let e = await run({ done: ['900'] });
    check('OK: done, with the page\'s meeting and the child\'s id', e.out.ok === true && e.cal === '368' && e.cid === '4821', JSON.stringify(e));
    check('and the child joins tonight\'s checked-out list, posted to the print server', e.marked && e.marked.ids.join() === '900,4821' && e.posted && e.posted.date === '2026-10-08' && e.posted.ids.join() === '900,4821');
    e = await run({ answer: false });
    check('anything but OK: not done, saying so, and nothing recorded', e.out.ok === false && /did not answer OK/.test(e.out.detail) && !e.marked && !e.posted);
    e = await run({ page: { ok: false, error: 'not the checkout page (signed out?)' } });
    check('the Checkout page unreadable: nothing posted, signed out said', e.out.ok === false && e.posts === 0 && /signed out/.test(e.out.detail));
    e = await run({ page: { ok: false, error: 'no meeting on the checkout page' } });
    check('no meeting on it: said', e.out.ok === false && e.posts === 0 && /no meeting/.test(e.out.detail));
    e = await run({ page: new Error('offline') });
    check('no network: said, never a rejection', e.out.ok === false && /could not reach/.test(e.out.detail));
    e = await run({ driven: false });
    check('driven check-ins off on the laptop: nothing posted, and why', e.out.ok === false && e.posts === 0 && /switched off/.test(e.out.detail));
    e = await run({ id: '' });
    check('no id: nothing posted', e.out.ok === false && e.posts === 0);
    check('every reason fits the 200 characters the server keeps', Object.values(new Function(SAY + '; return CHECKOUT_SAY;')()).every((t) => t.length <= 200));
    check('a claimed check-out action is driven as one, its result a strict ok',
      /if \(action\.type === 'checkout'\) \{ driveCheckoutAction\(action\); return; \}/.test(fromContent('drivePhoneAction'))
      && /reportPhoneAction\(action\.id, r\.ok === true, r\.detail\)/.test(fromContent('driveCheckoutAction')));
    check('the poll tells the print server it can check out', /'\/pending-actions\?accept=undo,checkout'/.test(fromContent('pollPendingActions')));
  }

  console.log('\nextension: check-outs made on TwoTimTwo\'s Checkout page');
  {
    const factory = new Function('DOMParser', 'isLoginPage', 'console', 'LOG_PREFIX',
      fromFeeds('parseCheckoutHtml') + '\n' + fromFeeds('parseCheckoutIds') + '\n' + fromFeeds('checkoutDisappearances') + '; return { parseCheckoutIds, checkoutDisappearances };');
    const { parseCheckoutIds, checkoutDisappearances } = factory(new JSDOM('').window.DOMParser, (h) => /name="LoginForm/.test(h), { log() {} }, '[t]');
    const row = (name, club, id) => `<tr class="clubber-row"><td><a class="checkout" href="#" clubber_id="${id}">Check out</a></td><td class="clubber name F">${name}</td><td class="center"><img class="club-icon-20" alt="${club} "></td><td>G</td><td>P</td><td>S</td></tr>`;
    const pg = (rows, opts = {}) => `<!doctype html><html><head><title>${opts.title || 'KVBC - Checkout Clubber'}</title></head><body>
      <table class="items table"><tr><th>Title</th></tr></table>
      <input class="filter" type="checkbox" name="clubs[0]"${opts.filtered ? '' : ' checked'}>
      <select id="date"><option value="2026-10-08" selected>8</option></select>
      <table class="table"><tr><th></th><th>Clubber</th></tr>${rows}</table></body></html>`;
    const EMPTY = '<tr><td class="empty"><span class="empty">No results found.</span></td></tr>';
    const r1 = parseCheckoutIds(pg(row('Amy A', 'Sparks', '11') + row('Ben B', 'T&T', '12') + row('Cy C', 'Sparks', '13')), '2026-10-08');
    check('the page\'s clubber ids and meeting are read', r1 && r1.ids.join() === '11,12,13' && r1.date === '2026-10-08', JSON.stringify(r1));
    check('ids only: no name rides along', !JSON.stringify(r1).includes('Amy'));
    check('a page that is not genuinely read is null (signed out, filtered, drifted)',
      parseCheckoutIds('<html><input name="LoginForm[password]"></html>', 'x') === null
      && parseCheckoutIds(pg(row('Amy A', 'Sparks', '11'), { filtered: true }), 'x') === null
      && parseCheckoutIds(pg(''), 'x') === null);
    let st = checkoutDisappearances(null, r1);
    check('the first read compares nothing', st.gone.length === 0);
    st = checkoutDisappearances(st, null);
    check('a failed read compares nothing and keeps the last good one', st.gone.length === 0 && st.last.ids.join() === '11,12,13');
    st = checkoutDisappearances(st, parseCheckoutIds(pg(row('Amy A', 'Sparks', '11') + row('Cy C', 'Sparks', '13')), 'x'));
    check('a child gone between two genuine reads is checked out', st.gone.join() === '12' && st.goneTonight.ids.join() === '12', JSON.stringify(st));
    st = checkoutDisappearances(st, parseCheckoutIds(pg(EMPTY), 'x'));
    check('the page\'s own "nobody left" is a genuine read: the rest are out too', st.gone.join() === '11,13' && st.goneTonight.ids.join() === '12,11,13');
    const other = checkoutDisappearances(st, { date: '2026-10-15', ids: [] });
    check('another meeting starts afresh', other.gone.length === 0 && other.goneTonight.ids.length === 0);
    const run = fromFeeds('runCheckout');
    check('it posts the night\'s ids to /feed/checked-out, marked as from the Checkout page, and no longer posts names',
      /postFeed\('\/feed\/checked-out', \{ date: next\.goneTonight\.date, clubberIds: next\.goneTonight\.ids, source: 'checkout-page' \}\)/.test(run)
      && !/\/feed\/checkout'/.test(run));
  }
}

async function serverSuite() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-pickup-'));
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-pickup-bin-'));
  fs.writeFileSync(path.join(binDir, 'powershell'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;
  fs.writeFileSync(path.join(dataDir, 'clubbers.csv'), 'ClubberID,FirstName,LastName,Club\n4821,Ava,Stone,Sparks\n77,Mia,Reed,T&T\n900,Tom,Trek,Trek\n');
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
    printerName: 'Fake', pusherAppId: '1', pusherKey: 'k', pusherSecret: 's', pusherCluster: 'us2',
  }, null, 2));
  const now = Date.now();
  const row = (r, minsAgo) => Object.assign({ clubName: 'Sparks', printer: 'Fake', success: true, timestamp: new Date(now - minsAgo * 60000).toISOString() }, r);
  fs.writeFileSync(path.join(dataDir, 'print-history.json'), JSON.stringify([
    row({ firstName: 'Zed', lastName: 'Walker', visitor: true }, 1),
    row({ firstName: 'Mia', lastName: 'Reed', clubberId: '77', clubName: 'T&T' }, 2),
    row({ firstName: 'Ava', lastName: 'Stone', clubberId: '4821' }, 3),
    row({ firstName: 'Tom', lastName: 'Trek', clubberId: '900', clubName: 'Trek' }, 4),
    row({ firstName: 'Lily', lastName: 'Name', clubName: 'Cubbies' }, 5),
    row({ firstName: 'Mary Kate', lastName: 'Jones', clubberId: '321' }, 6),
    row({ firstName: 'Ben', lastName: 'Gone', clubberId: '600', undone: true, undoneBy: 'phone' }, 7),
  ]));
  Object.assign(process.env, { AWANA_DATA_DIR: dataDir, AWANA_PORT: String(PORT), AWANA_BIND_HOST: '127.0.0.1', PRINTER_NAME: 'Fake' });

  const server = require(path.join(root, 'print-server', 'server.js'));
  const listener = server.startListening();
  await new Promise((r) => { if (listener.listening) return r(); listener.once('listening', r); });
  const j = async (p, opts) => { const res = await fetch(BASE + p, opts); return { status: res.status, body: await res.json().catch(() => null) }; };
  const post = (p, body) => j(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const names = () => server.stillHereEntries().map((e) => `${e.firstName}/${e.club}`).join(',');
  const frames = () => wire.filter((w) => w.event === 'checkout');
  const lastFrame = () => frames()[frames().length - 1];
  const tallies = () => wire.filter((w) => w.event === 'tally');
  const today = new Date(now);
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const pendingNow = (accept) => j('/pending-actions' + (accept ? '?accept=' + accept : ''), { signal: AbortSignal.timeout(600) })
    .then((r) => r.body.actions).catch(() => []);
  const report = (entries) => server._setLastCheckinReportForTests({ at: Date.now() - 1000, entries });
  const REPORT = [
    { clubberId: '4821', name: 'Ava Stone', club: 'Sparks' },
    { clubberId: '77', name: 'Mia Reed', club: 'T&T' },
    { clubberId: '900', name: 'Tom Trek', club: 'Trek' },
    { clubberId: '555', name: 'Lily Name', club: 'Cubbies' },
    { clubberId: '321', name: 'Mary Kate Jones', club: 'Sparks' },
    { clubberId: '600', name: 'Ben Gone', club: 'Sparks' },
  ];

  try {
    console.log('\nstill here: who is on it');
    {
      check('history-built: tonight\'s rows in the ticked clubs, visitors too (they count), undone and Trek left off',
        names() === 'Ava/Sparks,Lily/Cubbies,Mary Kate/Sparks,Mia/T&T,Zed/Sparks', names());
      report(REPORT);
      check('report-built: the report\'s children, visitors left off as the count leaves them, a Removed child still off',
        names() === 'Ava/Sparks,Lily/Cubbies,Mary Kate/Sparks,Mia/T&T', names());
      const auth = server.authoritativeTonight();
      check('one child per identity: Lily\'s name-only row and her report entry are one (the count agrees)',
        auth.checkedIn === 5 && names().split(',').filter((n) => n.startsWith('Lily')).length === 1, JSON.stringify(auth));
      check('the name this laptop printed beats the report\'s first word ("Mary Kate", not "Mary")', names().includes('Mary Kate/'));
      server._setCheckedOutForTests(date, ['4821']);
      check('a checked-out child is off it', names() === 'Lily/Cubbies,Mary Kate/Sparks,Mia/T&T', names());
      server._setCheckedOutForTests(date, []);
      server._setLastCheckinReportForTests(null);
    }

    console.log('\nstill here: published as the `checkout` event');
    {
      server._setStillHereWindowForTests(() => true);
      server.publishStillHere();
      const f = lastFrame();
      check('the existing event, its shape unchanged: entries + at + printed', f && Object.keys(f.payload).sort().join() === 'at,entries,printed' && Number.isInteger(f.payload.printed), f && JSON.stringify(f.payload));
      check('entries are first name + club only', f && f.payload.entries.every((e) => Object.keys(e).join() === 'firstName,club') && !JSON.stringify(f.payload).match(/Stone|Walker|4821/));
      const src = fs.readFileSync(path.join(root, 'print-server', 'server.js'), 'utf8');
      const events = require(path.join(root, 'print-server', 'events.js'));
      check('it is sealed like every name-bearing frame', events.ENCRYPTED_EVENTS.has('checkout'));
      check('every minute inside the tally window', /setInterval\(onTallyWindow\(publishStillHere\), 60 \* 1000\);/.test(src));

      let n = frames().length;
      let r = await post('/feed/checked-out', { date, clubberIds: ['4821'] });
      check('(Ava checked out by the youth sweep\'s feed)', r.body.applied === true);
      await tick(2600);
      check('a change is published within seconds, without her', frames().length === n + 1 && !lastFrame().payload.entries.some((e) => e.firstName === 'Ava'), JSON.stringify(lastFrame().payload.entries));
      n = frames().length;
      await post('/feed/checked-out', { date, clubberIds: ['4821'] });
      await tick(2600);
      check('no change, no frame', frames().length === n);

      r = await post('/config', { pickupClubs: ['Sparks', 'Rangers'] });
      check('the setting refuses a club it does not know', r.status === 400 && /Rangers/.test(r.body.error), JSON.stringify(r.body));
      r = await post('/config', { pickupClubs: ['trek', 'Sparks'] });
      const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'));
      check('and saves a good one canonical', r.status === 200 && JSON.stringify(saved.pickupClubs) === '["Sparks","Trek"]', JSON.stringify(saved.pickupClubs));
      await tick(2600);
      check('a change of clubs republishes the list at once', frames().length === n + 1 && lastFrame().payload.entries.map((e) => e.firstName).join() === 'Mary Kate,Tom,Zed', JSON.stringify(lastFrame().payload.entries));
      r = await post('/config', { pickupClubs: null });
      check('null goes back to the default', r.status === 200 && !('pickupClubs' in JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'))));
      await tick(2600);

      server._setStillHereWindowForTests(() => false);
      n = frames().length;
      await post('/feed/checked-out', { date, clubberIds: ['77'] });
      await tick(2600);
      check('outside the window nothing is published', frames().length === n);
      server._setStillHereWindowForTests(() => true);

      n = frames().length;
      r = await post('/feed/checkout', { entries: [] });
      check('an older extension\'s scrape is accepted, not published (an empty page must not clear the lobby)', r.status === 200 && r.body.ok === true && r.body.published === false && frames().length === n, JSON.stringify(r.body));
      r = await post('/feed/checkout', {});
      check('and still validated', r.status === 400);
    }

    console.log('\nCheckout page check-outs: an undo is not a check-out');
    {
      // Ben's newest row is undone (a phone Remove): his row leaving the page is that.
      const r = await post('/feed/checked-out', { date, clubberIds: ['600', '321'], source: 'checkout-page' });
      check('an undone child is skipped, the other taken', r.body.skipped === 1 && server.authoritativeTonight().checkedOut >= 1, JSON.stringify(r.body));
      const t = (await post('/phone/tonight', {})).body;
      check('Mary Kate is checked out', t.entries.find((e) => e.firstName === 'Mary Kate').checkedOut === true);
      check('the youth sweep\'s own post (no source) is never filtered', (await post('/feed/checked-out', { date, clubberIds: ['600'] })).body.skipped === 0);
    }

    console.log('\nphone Check out: queued, never applied on the spot');
    {
      let t = (await post('/phone/tonight', {})).body;
      check('the Tonight list says the laptop can check out', Array.isArray(t.features) && t.features.includes('checkout'));
      const before = { tally: tallies().length, here: server.authoritativeTonight().checkedIn };
      let r = await post('/phone/undo', { firstName: 'Tom', lastName: 'Trek', clubberId: '900', checkout: true });
      check('queued for the check-in page', r.status === 200 && r.body.queued === true && typeof r.body.id === 'string', JSON.stringify(r.body));
      const id = r.body.id;
      check('nothing changes yet', tallies().length === before.tally && server.authoritativeTonight().checkedIn === before.here);
      check('a double-tap is the same action', (await post('/phone/undo', { firstName: 'Tom', lastName: 'Trek', clubberId: '900', checkout: true })).body.id === id);
      check('not a Remove: Tom\'s row is untouched', !JSON.parse(fs.readFileSync(path.join(dataDir, 'print-history.json'), 'utf8')).some((h) => h.firstName === 'Tom' && h.undone));
      await post('/phone/checkin', { name: 'Mia Reed' });
      const older = await pendingNow('undo');
      check('an extension older than 7.16 is never handed it', !older.some((a) => a.id === id), JSON.stringify(older));
      const acts = await pendingNow('undo,checkout');
      const a = acts.find((x) => x.id === id);
      check('a 7.16 extension gets it, typed as a check-out with the clubber id', a && a.type === 'checkout' && a.clubberId === '900', JSON.stringify(acts));
      check('(claimed)', (await post(`/pending-actions/${id}/claim`, {})).status === 200);
      const n = frames().length;
      await post(`/pending-actions/${id}/result`, { ok: true });
      check('the phone hears done', (await j('/phone/status/' + id)).body.status === 'done');
      check('he is off the count', server.authoritativeTonight().checkedIn === before.here - 1);
      check('a tally goes out at once', tallies().length > before.tally);
      t = (await post('/phone/tonight', {})).body;
      check('his row says Checked out', t.entries.find((e) => e.firstName === 'Tom').checkedOut === true);
      check('the attendance record keeps him (nothing undone)', !JSON.parse(fs.readFileSync(path.join(dataDir, 'print-history.json'), 'utf8')).some((h) => h.firstName === 'Tom' && h.undone));
      server._setStillHereWindowForTests(() => true);
      await post('/config', { pickupClubs: ['Trek'] });
      await tick(2600);
      check('and the still-here list is republished without him', frames().length > n && !lastFrame().payload.entries.some((e) => e.firstName === 'Tom'), JSON.stringify(lastFrame().payload));
      await post('/config', { pickupClubs: null });
      r = await post(`/pending-actions/${id}/result`, { ok: false });
      check('a second result changes nothing', r.body.already === 'done');
    }

    console.log('\nphone Check out: failures change nothing');
    {
      let r = await post('/phone/undo', { firstName: 'Ava', lastName: 'Stone', clubberId: '4821', checkout: true });
      // Ava is already out (the feed above); a fresh night-state for her:
      server._setCheckedOutForTests(date, ['77']);
      const here = server.authoritativeTonight().checkedIn;
      await post(`/pending-actions/${r.body.id}/claim`, {});
      await post(`/pending-actions/${r.body.id}/result`, { ok: false, detail: 'TwoTimTwo did not answer OK to the check-out.' });
      const st = (await j('/phone/status/' + r.body.id)).body;
      check('a refusal reaches the phone word for word', st.status === 'failed' && st.detail === 'TwoTimTwo did not answer OK to the check-out.');
      check('and nothing changed', server.authoritativeTonight().checkedIn === here);
      r = await post('/phone/undo', { firstName: 'Ava', lastName: 'Stone', clubberId: '4821', checkout: true });
      await post(`/pending-actions/${r.body.id}/claim`, {});
      await post(`/pending-actions/${r.body.id}/result`, { ok: 'true' });
      check('only a literal ok:true counts', (await j('/phone/status/' + r.body.id)).body.status === 'failed' && server.authoritativeTonight().checkedIn === here);
      const cfg = (body) => fetch(BASE + '/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      await cfg({ enableDrivenCheckin: false });
      r = await post('/phone/undo', { firstName: 'Ava', lastName: 'Stone', clubberId: '4821', checkout: true });
      check('driven check-ins off: refused at once, saying why', r.status === 409 && /Allow driven check-ins/.test(r.body.error));
      await cfg({ enableDrivenCheckin: true });
      const src = fs.readFileSync(path.join(root, 'print-server', 'server.js'), 'utf8');
      check('one nobody picks up fails with the reason, like an undo', /a\.detail = co \? CHECKOUT_NOT_PICKED_UP : UNDO_NOT_PICKED_UP;/.test(src) && /older than 7\.16/.test(src));
    }

    console.log('\nphone Mark checked out: a row with no TwoTimTwo id');
    {
      const here = server.authoritativeTonight().checkedIn;
      const r = await post('/phone/undo', { firstName: 'Zed', lastName: 'Walker', checkout: true });
      check('applied at once, here only, and said so', r.status === 200 && r.body.local === true && r.body.checkedOut === true, JSON.stringify(r.body));
      check('off the count (history-built, where a visitor counts)', server.authoritativeTonight().checkedIn === here - 1);
      check('and off the list', !names().includes('Zed'));
      check('his row says Checked out', (await post('/phone/tonight', {})).body.entries.find((e) => e.firstName === 'Zed').checkedOut === true);
      check('nobody by that name: 404', (await post('/phone/undo', { firstName: 'No', lastName: 'Body', checkout: true })).status === 404);
      check('nothing was queued for TwoTimTwo', !(await pendingNow('undo,checkout')).some((a) => a.type === 'checkout' && /Zed/.test(a.name)));
    }

    console.log('\nthe phone page');
    {
      const phone = fs.readFileSync(path.join(root, 'print-server', 'public', 'phone.html'), 'utf8');
      check('Check out rides /phone/undo with checkout:true (the relay\'s allowlisted route)',
        /postJson\('\/phone\/undo', \{ pin: PIN, firstName: ident\.firstName, lastName: ident\.lastName, clubberId: entry\.visitor \? null : ident\.clubberId, checkout: true \}\)/.test(phone));
      check('and is offered only when the laptop says it can, never on a child already checked out', /if \(TONIGHT\.canCheckout && !e\.checkedOut\) \{/.test(phone));
      check('it asks first, naming the child', /function askCheckout\(entry\)/.test(phone) && /'Check out ' : 'Mark '\) \+ name/.test(phone));
      check('and follows the queued action like an undo', /pollUndo\(entry, data\.id, Date\.now\(\), 'checkout'\)/.test(phone));
      const relay = require(path.join(root, 'print-server', 'phone-relay.js'));
      check('the website\'s relay already carries it', relay.relayAllowed('POST', '/phone/undo') && relay.relayAllowed('GET', '/phone/status/0f8c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b'));
    }
  } finally {
    try { server.stopListening && server.stopListening(); } catch { /* exiting anyway */ }
  }
}

(async () => {
  settingSuite();
  await extensionSuite();
  await serverSuite();
  await tick();
  __suiteFinished = true;
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
