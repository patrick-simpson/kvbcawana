#!/usr/bin/env node
// Tests for the encrypted realtime pipe, against a REALLY running print server.
//
// WHAT THIS GUARDS THAT test-envelope.cjs CANNOT
//
// test-envelope.cjs proves the crypto is correct. This proves the SERVER is
// wired to it: that a name actually leaves this process as ciphertext, that the
// key can be generated and saved and takes effect without a restart, that
// /health tells the operator which mode they are in, and — the one that bit me
// while building this — that CLEARING the key actually clears it.
//
// That last one was a genuine bug in two places. Both POST /config paths can
// `delete next.<key>`, and the live-config sync was `Object.assign(config,
// next)`, which copies properties but never removes them. So clearing the phone
// PIN wrote the file correctly while the live auth gate — which reads
// config.phonePin per request — kept accepting the OLD PIN until someone
// restarted the server. An operator revoking a leaked PIN had every reason to
// believe it was gone. The display key had the same hole. `applySavedConfig()`
// fixes both, and the assertions at the bottom of this file are what keep it
// fixed.
//
// Run: npm run test:realtime

'use strict';

// A crashed suite must FAIL, not pass: server.js's uncaughtException handler
// (a production never-crash feature) can swallow a test-time crash, letting
// the event loop drain and the process exit 0 without a summary ever printing.
// If we reach 'exit' with code 0 and the suite never declared itself finished,
// force red. (Found the hard way: a ReferenceError mid-suite passed CI.)
let __suiteFinished = false;
process.on('exit', (code) => {
  if (code === 0 && !__suiteFinished) {
    console.error('\u2717 Test suite terminated before completing (crash swallowed?) \u2014 failing.');
    process.exitCode = 1;
  }
});


const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');

// ── Pin the wall clock ────────────────────────────────────────────────────────
// The server keys "today" and "tonight" on the LOCAL date (localDayISO, read
// from the global Date when called), and so does this file's own checks. A run
// that crosses midnight therefore splits one night's rows across two days: a
// row written at 23:59:59 reads back as yesterday's at 00:00:01, and about
// twenty "tonight" checks fail. So the clock starts at a Wednesday, 7 pm local,
// and runs on from there: timers and elapsed-time checks still advance, and no
// run gets near midnight. Installed before the server loads, so every `new Date()`
// the server makes after that point reads the pinned clock.
const RealDate = Date;
const PINNED_AT = new RealDate(2026, 9, 7, 19, 0, 0).getTime();
const clockShift = PINNED_AT - RealDate.now();
class PinnedDate extends RealDate {
  constructor(...args) { if (args.length === 0) super(PinnedDate.now()); else super(...args); }
  static now() { return RealDate.now() + clockShift; }
}
global.Date = PinnedDate;

const PORT = Number(process.env.AWANA_TEST_PORT || require('./free-port.cjs')());
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

// ── Record the wire ───────────────────────────────────────────────────────────
// The server hands every frame, after sealing, to the relay it installs at
// load. Replacing that relay (below, once the server is required) records each
// frame instead of sending it, which is the only way to assert what actually
// went ON THE WIRE.
const wire = [];

const events = require(path.join(__dirname, '..', 'print-server', 'events.js'));

async function j(pathname, opts) {
  const res = await fetch(BASE + pathname, opts);
  return { status: res.status, body: await res.json().catch(() => null) };
}
const post = (pathname, body) => j(pathname, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body || {}),
});
const sealedFrames = (event) => wire.filter((w) => w.event === event);
const isSealed = (b) => Boolean(b && b.v === events.ENVELOPE_VERSION && typeof b.ct === 'string');

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-realtime-'));
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-realtime-bin-'));

  // printImage() shells out to `powershell`, absent on a Linux runner. Without
  // this stub every /print throws at the print step, the checkin publish never
  // runs, and this whole file would pass while testing nothing.
  fs.writeFileSync(path.join(binDir, 'powershell'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;

  // Distinct children per phase: the server suppresses a repeat print of the
  // same child inside DUPLICATE_WINDOW_MS, so reusing one name makes later
  // phases test nothing.
  fs.writeFileSync(path.join(dataDir, 'clubbers.csv'),
    // The Inactive column and Erin exist for the phone's Not-here-yet tab:
    // loadClubbers() keeps every row the CSV ever had, so a former clubber
    // would otherwise be listed as missing forever.
    'FirstName,LastName,Birthdate,Allergies,HandbookGroup,MedRelease,Inactive\n'
    + 'Amy,Tester,,peanut allergy,Sparks A,y,\n'
    + 'Bella,Tester,,,Sparks A,y,\n'
    + 'Cody,Tester,,,Sparks A,y,\n'
    + 'Dana,Tester,,,Sparks A,y,\n'
    + 'Erin,Former,,,Sparks A,y,y\n');

  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
    printerName: 'Fake',
    checkinUrl: 'https://example.com/checkin',
    phonePin: '4821',
  }, null, 2));

  process.env.AWANA_DATA_DIR = dataDir;
  process.env.AWANA_PORT = String(PORT);
  process.env.AWANA_BIND_HOST = '127.0.0.1';

  const server = require(path.join(__dirname, '..', 'print-server', 'server.js'));

  // The relay is the only pipe: record what the server hands it, as the wire.
  require(path.join(__dirname, '..', 'print-server', 'events.js')).setRelay((channel, event, body) => { wire.push({ channel, event, payload: body }); return Promise.resolve(true); });
  const listener = server.startListening();
  await new Promise((resolve) => {
    if (listener.listening) return resolve();
    listener.once('listening', resolve);
  });

  const configFile = path.join(dataDir, 'config.json');
  const onDisk = () => JSON.parse(fs.readFileSync(configFile, 'utf8'));

  // Every /health warning must be a {type, message} OBJECT. The dashboard
  // renders `w.message`, so a bare string arrived as undefined and painted an
  // EMPTY yellow box — the loudest warnings in the codebase were the invisible
  // ones. Read warnings through here so a slip back to strings shows up as a
  // named failure rather than a silently-never-matching regex.
  const warningTexts = (warnings) => (warnings || []).map((w) => {
    check('every /health warning is a {type, message} object',
      w && typeof w === 'object' && typeof w.type === 'string' && typeof w.message === 'string',
      JSON.stringify(w));
    return (w && w.message) || '';
  });

  // ── 1. Unkeyed: plaintext, and loudly said so ──────────────────────────────
  console.log('\nrealtime: with no display key');
  {
    let h = await j('/health');
    check('/health reports no display key', h.body.displayKeyConfigured === false);
    check('/health reports it is not encrypting', h.body.encryptingNames === false);
    check('not signed in to the sync service, nothing is published, so there is no unencrypted-names warning',
      !warningTexts(h.body.warnings).some((w) => /unencrypted/i.test(w)),
      JSON.stringify(h.body.warnings));
    // Signed in (a session on disk, applied by a config save), the live channel
    // is open, so a missing key is a warning. Signed out again right after.
    const cfgFile = path.join(dataDir, 'config.json');
    const unsigned = fs.readFileSync(cfgFile, 'utf8');
    fs.writeFileSync(cfgFile, JSON.stringify({ ...JSON.parse(unsigned), syncUrl: 'https://awana-sync.test.workers.dev', syncSession: 'v1.1.1790839331729.oWr6n92IJW5ldPGmtiyjPHAZpca-QGToNlKGXlKI6vc' }));
    await post('/config', {});
    h = await j('/health');
    check('signed in with no display key, /health warns that names are unencrypted',
      warningTexts(h.body.warnings).some((w) => /unencrypted/i.test(w)),
      JSON.stringify(h.body.warnings));
    check('and the warning names the exact place to fix it',
      warningTexts(h.body.warnings).some((w) => /settings . Printing . At the laptop . This laptop.s sign-in/i.test(w)),
      JSON.stringify(h.body.warnings));
    fs.writeFileSync(cfgFile, unsigned);
    await post('/config', {});

    await post('/print', { firstName: 'Amy', lastName: 'Tester', clubName: 'Sparks' });
    const ck = sealedFrames('checkin');
    check('a checkin was published', ck.length === 1, `saw ${ck.length}`);
    // Plaintext while unkeyed is DELIBERATE: an operator who has not opted in
    // must not have banners break under them on an auto-update. The consumer's
    // anti-downgrade rule is what makes it safe once a screen IS keyed.
    check('and it is plaintext (rollout mode)',
      ck.length === 1 && ck[0].payload.firstName === 'Amy' && !isSealed(ck[0].payload));
  }

  // ── 2. Generating and saving a key ─────────────────────────────────────────
  console.log('realtime: generating and saving a key');
  let KEY;
  {
    const gen = await post('/config/display-key/generate');
    KEY = gen.body && gen.body.key;
    check('generate returns a valid 32-byte key',
      gen.status === 200 && events.isValidDisplayKey(KEY), JSON.stringify(gen.body));
    // Generate deliberately does not persist: the operator copies it into the
    // screens FIRST, so a mistyped paste cannot leave every screen locked out of
    // a key the server has already committed to.
    check('generate does not save it yet', !onDisk().displayKey);
    check('and the server is still unencrypted until it is saved',
      events.getDisplayKeyState().configured === false);

    check('an invalid key is refused with 400',
      (await post('/config', { displayKey: 'not-a-key' })).status === 400);
    check('an over-long key is refused',
      (await post('/config', { displayKey: Buffer.alloc(64).toString('base64') })).status === 400);
    check('a refused key leaves the server unencrypted rather than half-keyed',
      events.getDisplayKeyState().configured === false);

    check('a valid key is accepted', (await post('/config', { displayKey: KEY })).status === 200);
    check('it is persisted', onDisk().displayKey === KEY);
    check('and it takes effect immediately, with no restart',
      events.getDisplayKeyState().configured === true);
  }

  // ── 2b. The display login is retired ──────────────────────────────────────
  console.log('realtime: the retired display login');
  {
    check('nothing was provisioned: no provision frame is ever published', wire.filter((w) => w.event === 'provision').length === 0);
    check('the generate route is gone', (await post('/config/display-login/generate')).status === 404);
    // An old config.json may still hold a passphrase and salt: any save scrubs them.
    const cfg = onDisk();
    cfg.displayLoginPassphrase = 'a-legacy-passphrase-left-on-disk';
    cfg.displayLoginSalt = Buffer.alloc(16, 7).toString('base64');
    fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2));
    check('saving a (ignored) passphrase is still accepted', (await post('/config', { displayLoginPassphrase: 'ignored passphrase here' })).status === 200);
    const d = onDisk();
    check('the legacy passphrase and its salt are gone from disk', !d.displayLoginPassphrase && !d.displayLoginSalt, JSON.stringify(d));
    await new Promise((r) => setTimeout(r, 50));
    check('and no provision frame was published', wire.filter((w) => w.event === 'provision').length === 0);
    await post('/config', { slidesPublishToken: '' });

    // ── The fleet-config URL (#394) ────────────────────────────────────────
    // Non-secret, but it is persisted, so it is validated where it is STORED.
    check('a non-https settings URL is refused with 400 and NOT persisted',
      (await post('/config', { fleetConfigUrl: 'http://example.org/a.json' })).status === 400
      && !onDisk().fleetConfigUrl);
    check('a credentials-in-URL settings URL is refused too',
      (await post('/config', { fleetConfigUrl: 'https://u:p@example.org/a.json' })).status === 400);
    check('an over-long settings URL is refused',
      (await post('/config', { fleetConfigUrl: `https://example.org/${'a'.repeat(200)}` })).status === 400);
    check('a valid https settings URL is accepted',
      (await post('/config', { fleetConfigUrl: 'https://example.org/awana-display.json' })).status === 200);
    check('and persisted', onDisk().fleetConfigUrl === 'https://example.org/awana-display.json');
    await post('/config', { fleetConfigUrl: '' });
    check('clearing it deletes the key', !onDisk().fleetConfigUrl);
    check('/health never carries the settings URL to a CORS-readable caller',
      !JSON.stringify((await j('/health')).body).includes('awana-display.json'));
  }

  // ── 3. Names leave this process as ciphertext ──────────────────────────────
  console.log('realtime: names are sealed on the wire');
  {
    const before = wire.length;
    await post('/print', { firstName: 'Bella', lastName: 'Tester', clubName: 'Sparks' });
    const fresh = wire.slice(before);
    const ck = fresh.filter((w) => w.event === 'checkin');
    check('a checkin was published', ck.length === 1, `saw ${ck.length}`);
    const env = ck[0] && ck[0].payload;
    check('the checkin on the wire is an envelope', isSealed(env),
      JSON.stringify(env || null).slice(0, 120));
    // Structural rather than a substring search over base64: a short name can
    // collide with random ciphertext by chance (a 3-letter one did, in the
    // checkout suite). Key-set equality tests the same property — that no
    // plaintext payload field rode along beside the envelope — and cannot flake.
    check('the frame carries only envelope fields — no plaintext rode along',
      JSON.stringify(Object.keys(env || {}).sort()) === JSON.stringify(['ct', 'iv', 'kid', 'v']),
      JSON.stringify(Object.keys(env || {})));
    let opened = null;
    try { opened = events.openForTest(KEY, 'checkin', env); } catch { /* reported */ }
    check('the church key opens it back to the real payload',
      Boolean(opened && opened.firstName === 'Bella'), JSON.stringify(opened));
    check('and the payload still carries no last name or allergy',
      Boolean(opened) && !('lastName' in opened) && !('allergies' in opened));

    // The non-PII events must stay readable — that readability is what lets a
    // screen tell "pipe down" from "cannot read names" from "quiet night".
    const tally = fresh.filter((w) => w.event === 'tally');
    check('tally stays plaintext and readable (deliberate)',
      tally.length === 0 || (!isSealed(tally[0].payload) && tally[0].payload.counts !== undefined),
      JSON.stringify((tally[0] && tally[0].payload) || null).slice(0, 120));
  }

  // ── 4. /health and Night Test report the truth ──────────────────────────────
  console.log('realtime: the operator can see which mode they are in');
  {
    const h = await j('/health');
    check('/health reports the key is configured', h.body.displayKeyConfigured === true);
    check('/health exposes the kid fingerprint',
      typeof h.body.displayKeyId === 'string' && h.body.displayKeyId.length === 8);
    check('/health NEVER exposes the key itself',
      !JSON.stringify(h.body).includes(KEY));
    check('/health stops warning once encrypted',
      !warningTexts(h.body.warnings).some((w) => /unencrypted/i.test(w)),
      JSON.stringify(h.body.warnings));

    const canary = await post('/canary', { printerName: 'Fake' });
    const stage = (canary.body.stages || []).find((s) => s.stage === 'display key');
    check('Night Test has a display-key stage', Boolean(stage),
      JSON.stringify(canary.body.stages));
    check('and it passes with a key set', Boolean(stage && stage.passed),
      JSON.stringify(stage));
    // The stage publishes a sealed recap, which doubles as the heartbeat a screen
    // uses to notice a wrong key BEFORE the first child arrives.
    const recaps = sealedFrames('recap');
    check('the stage publishes a sealed recap',
      recaps.length > 0 && isSealed(recaps[recaps.length - 1].payload));
  }

  // ── 5. Clearing a secret actually clears it ────────────────────────────────
  // The regression this file exists for. Object.assign cannot delete, so both of
  // these used to write the file and keep the old value live until a restart.
  console.log('realtime: clearing a secret takes effect immediately');
  {
    await post('/config', { displayKey: '' });
    check('the key is gone from disk', !onDisk().displayKey);
    check('AND gone from the live publisher, not just the file',
      events.getDisplayKeyState().configured === false,
      'this is the Object.assign-cannot-delete bug');
    const before = wire.length;
    await post('/print', { firstName: 'Cody', lastName: 'Tester', clubName: 'Sparks' });
    const ck = wire.slice(before).filter((w) => w.event === 'checkin');
    check('and it really is publishing unsealed frames again',
      ck.length === 1 && !isSealed(ck[0].payload),
      JSON.stringify((ck[0] && ck[0].payload) || null).slice(0, 120));

    // The phone PIN and LAN access are retired (Online only, 2026-10-12): the
    // server listens on loopback only, so there is no PIN to clear and no
    // "set a PIN" warning to show. A page that still sends them changes nothing.
    const pinWarning = async () => warningTexts((await j('/health')).body.warnings)
      .some((w) => /\bPIN\b/i.test(w));
    const pinBefore = onDisk().phonePin;
    await post('/config', { lanAccess: true, phonePin: '9999-new' });
    check('POST /config no longer saves a PIN or LAN access', onDisk().phonePin === pinBefore && !onDisk().lanAccess, JSON.stringify(onDisk()));
    check('and /health never warns about a PIN, with LAN access asked for or not', (await pinWarning()) === false);
  }

  // ── 6. Encryption never blocks a label ─────────────────────────────────────
  console.log('realtime: printing is never gated on the realtime pipe');
  {
    // The printing guarantee outranks everything else here: a child at the door
    // must get a label even if the pipe or the key is broken.
    events.setDisplayKey(KEY);
    const res = await post('/print', { firstName: 'Dana', lastName: 'Tester', clubName: 'Sparks' });
    check('a print succeeds with encryption on', res.body && res.body.success === true,
      JSON.stringify(res.body));
    const hist = await j('/history');
    const rows = Array.isArray(hist.body) ? hist.body : (hist.body && hist.body.history) || [];
    check('every print was recorded', rows.length >= 4, `history has ${rows.length} rows`);
  }

  // ── 6b. Leader name tags: a print that is never a check-in ────────────────
  console.log('realtime: leader tag prints without counting');
  {
    const statsBefore = (await j('/stats/tonight')).body;
    const wireBefore = wire.length;
    const bufferBefore = JSON.parse(fs.readFileSync(path.join(dataDir, 'events-buffer.json'), 'utf8') || '[]').length;
    const ledgerBefore = fs.existsSync(path.join(dataDir, 'attendance.json'))
      ? fs.readFileSync(path.join(dataDir, 'attendance.json'), 'utf8') : '';

    const res = await post('/print-leader', { name: 'Pat Leader', clubName: 'Sparks' });
    check('a leader tag prints', res.status === 200 && res.body && res.body.success === true && !res.body.duplicate, JSON.stringify(res.body));

    const rows = (await j('/history')).body || [];
    const leaderRows = rows.filter((r) => r.isLeader === true);
    check('exactly one isLeader history row, with the name and club',
      leaderRows.length === 1 && leaderRows[0].firstName === 'Pat' && leaderRows[0].lastName === 'Leader' && leaderRows[0].clubName === 'Sparks',
      JSON.stringify(leaderRows));

    const statsAfter = (await j('/stats/tonight')).body;
    check('checkedIn is unchanged', statsAfter.checkedIn === statsBefore.checkedIn, `${statsBefore.checkedIn} → ${statsAfter.checkedIn}`);
    check('byClub.Sparks is unchanged', (statsAfter.byClub || {}).Sparks === (statsBefore.byClub || {}).Sparks, JSON.stringify(statsAfter.byClub));
    const fresh = wire.slice(wireBefore);
    check('NO checkin frame went on the wire', fresh.filter((w) => w.event === 'checkin').length === 0, JSON.stringify(fresh.map((w) => w.event)));
    check('NO tally went on the wire', fresh.filter((w) => w.event === 'tally').length === 0, JSON.stringify(fresh.map((w) => w.event)));
    check('the recap buffer is untouched',
      JSON.parse(fs.readFileSync(path.join(dataDir, 'events-buffer.json'), 'utf8') || '[]').length === bufferBefore);
    const ledgerAfter = fs.existsSync(path.join(dataDir, 'attendance.json'))
      ? fs.readFileSync(path.join(dataDir, 'attendance.json'), 'utf8') : '';
    check('the season ledger is untouched (no "pat" key)', ledgerAfter === ledgerBefore && !/pat leader/i.test(ledgerAfter));

    const dup = await post('/print-leader', { name: 'Pat Leader', clubName: 'Sparks' });
    check('an immediate second tap is a duplicate, not a second row',
      dup.body && dup.body.duplicate === true && ((await j('/history')).body || []).filter((r) => r.isLeader).length === 1,
      JSON.stringify(dup.body));
    check('a leader tag without a name is a 400', (await post('/print-leader', {})).status === 400);
    const badPrinter = await post('/print-leader', { name: 'Q Leader', printerName: 'x"; rm -rf /' });
    check('an unsafe printer name is refused', badPrinter.status === 400, JSON.stringify(badPrinter.body));

    // Reprint by index keeps a leader a leader (the kid path would record an
    // unflagged, counted row for the same name).
    const today = (await j('/history/today')).body || [];
    const idx = today.findIndex((r) => r.isLeader);
    const rp = await post('/reprint', { index: idx });
    check('reprinting a leader row by index re-prints a leader tag', rp.status === 200 && rp.body && rp.body.leader === true, JSON.stringify(rp.body));
    check('and records another isLeader row, still counting nobody',
      ((await j('/history')).body || []).filter((r) => r.isLeader).length === 2
        && (await j('/stats/tonight')).body.checkedIn === statsBefore.checkedIn);
  }

  // ── 10. What's new (#6): the route serves the real top changes.md entry ──
  console.log('\nrealtime: /whats-new serves the shipped release notes');
  {
    const res = await j('/whats-new');
    check('/whats-new returns the top entry', res.status === 200 && res.body && /^\d+\.\d+\.\d+$/.test(res.body.version), JSON.stringify(res.body && res.body.version));
    check('the entry has a body', typeof res.body.body === 'string' && res.body.body.length > 10);
  }

  // ── Screen season rides the tally (#16/#18) ──────────────────────────────
  // The labels stopped wearing the season in the 2026-27 rebrand; the setting
  // stayed, renamed "Screen season" on the dashboard, because it is what tells
  // the lobby screens which skin to wear. Its config key (seasonTheme) and its
  // payload field (tally.season) are the signage app's contract, so neither
  // may move. The retired collectible-of-the-week toggle must save harmlessly.
  console.log('\nrealtime: the Screen season broadcast');
  {
    const lastTallySeason = async () => {
      const before = wire.filter((w) => w.event === 'tally').length;
      server.publishTally();   // publishes a tally at once
      await new Promise((r) => setTimeout(r, 100));
      const tallies = wire.filter((w) => w.event === 'tally');
      return tallies.length > before ? { season: tallies[tallies.length - 1].payload.season } : null;
    };

    const saved = await post('/config', { seasonTheme: 'winter', collectibleIcons: false });
    check('a pinned Screen season saves (and a stale collectibleIcons field does not break the save)',
      saved.status === 200, JSON.stringify(saved.body));
    check('it is stored under the old key, seasonTheme', onDisk().seasonTheme === 'winter', JSON.stringify(onDisk()));
    check('the retired collectibleIcons toggle is not written', !('collectibleIcons' in onDisk()), JSON.stringify(onDisk()));
    const pinned = await lastTallySeason();
    check('the tally carries the pinned season', pinned && pinned.season === 'winter', JSON.stringify(pinned));

    await post('/config', { seasonTheme: 'off' });
    const off = await lastTallySeason();
    check('Off: the tally carries no season (each screen follows its own skin)',
      off && off.season === undefined, JSON.stringify(off));

    check('an unknown season is still refused', (await post('/config', { seasonTheme: 'halloween' })).status === 400);

    await post('/config', { seasonTheme: 'auto' });
    check('Auto deletes the key', !('seasonTheme' in onDisk()), JSON.stringify(onDisk()));
    const auto = await lastTallySeason();
    check('Auto: the tally carries the calendar season',
      auto && auto.season === server.seasonForDate(new Date()), JSON.stringify(auto));
  }

  listener.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(binDir, { recursive: true, force: true });
}

main().then(() => {
  console.log('');
  console.log(`${passed} passed, ${failed} failed`);
  __suiteFinished = true;
  process.exit(failed > 0 ? 1 : 0);
}).catch((err) => {
  console.error('\nharness error:', err);
  process.exit(1);
});
