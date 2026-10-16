#!/usr/bin/env node
// The lobby's still-here list (7.16.0), against a REALLY running print server.
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
// * /feed/checked-out: a check-out takes the child off the count and the
//   list; one from the Checkout page skips a child whose row is undone.
// (The Chrome extension's check-out and the phone's Check out through this
// laptop went with the extension in 10.0.0; the Worker does both.)
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
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const PORT = Number(process.env.AWANA_TEST_PORT || require('./free-port.cjs')());
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

const wire = [];

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
  // The settings page (lobby/src/lib/printServer.js, laptop.jsx) is where the clubs are ticked now.
  const page = fs.readFileSync(path.join(root, '..', 'lobby', 'src', 'lib', 'printServer.js'), 'utf8');
  const laptop = fs.readFileSync(path.join(root, '..', 'lobby', 'src', 'components', 'settings', 'laptop.jsx'), 'utf8');
  const asJs = (list) => JSON.stringify(list).replace(/"/g, "'").replace(/,/g, ', ');
  check('the settings page offers the same clubs and the same default',
    page.includes(`export const PICKUP_CLUBS = ${asJs(pickup.PICKUP_CLUBS)};`)
    && page.includes(`export const PICKUP_DEFAULT = ${asJs(pickup.PICKUP_DEFAULT)};`));
  check('and saves it as a pickupClubs list through POST /config', /save\(\{ pickupClubs: next \}\)/.test(laptop));

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

async function serverSuite() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-pickup-'));
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-pickup-bin-'));
  fs.writeFileSync(path.join(binDir, 'powershell'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;
  fs.writeFileSync(path.join(dataDir, 'clubbers.csv'), 'ClubberID,FirstName,LastName,Club\n4821,Ava,Stone,Sparks\n77,Mia,Reed,T&T\n900,Tom,Trek,Trek\n');
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
    printerName: 'Fake',  }, null, 2));
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

  // The relay is the only pipe: record what the server hands it, as the wire.
  require(path.join(root, 'print-server', 'events.js')).setRelay((channel, event, body) => { wire.push({ channel, event, payload: body }); return Promise.resolve(true); });
  const listener = server.startListening();
  await new Promise((r) => { if (listener.listening) return r(); listener.once('listening', r); });
  const j = async (p, opts) => { const res = await fetch(BASE + p, opts); return { status: res.status, body: await res.json().catch(() => null) }; };
  const post = (p, body) => j(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const names = () => server.stillHereEntries().map((e) => `${e.firstName}/${e.club}`).join(',');
  const frames = () => wire.filter((w) => w.event === 'checkout');
  const lastFrame = () => frames()[frames().length - 1];
  const today = new Date(now);
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
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
      const src = require('./server-source.cjs')();
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
    }

    console.log('\nCheckout page check-outs: an undo is not a check-out');
    {
      // Ben's newest row is undone (a phone Remove): his row leaving the page is that.
      const r = await post('/feed/checked-out', { date, clubberIds: ['600', '321'], source: 'checkout-page' });
      check('an undone child is skipped, the other taken', r.body.skipped === 1 && server.authoritativeTonight().checkedOut >= 1, JSON.stringify(r.body));
      check('Mary Kate is checked out', !names().includes('Mary Kate'), names());
      check('the youth sweep\'s own post (no source) is never filtered', (await post('/feed/checked-out', { date, clubberIds: ['600'] })).body.skipped === 0);
    }
  } finally {
    try { server.stopListening && server.stopListening(); } catch { /* exiting anyway */ }
  }
}

(async () => {
  settingSuite();
  await serverSuite();
  await tick();
  __suiteFinished = true;
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
