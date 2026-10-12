#!/usr/bin/env node
// BARF Night (8.1.0, owner 2026-10-11): a child checked in with Brought a
// friend gets a second tag, BARFED, on BARF Night only, and the print server
// tells the sync service who brought whom for the night's email. A stub
// printer counts the tags; a stand-in sync service catches the reports.
'use strict';

// ── Pin the wall clock ────────────────────────────────────────────────────────
// `today` below is computed up front and handed to the server as tonight's
// BARF Night, while the server asks the global Date for the local day on every
// print. A run that crosses midnight (8 pm Eastern on a UTC runner) would lose
// its BARF Night mid-test. So the clock starts at a Wednesday, 7 pm local, and
// runs on from there (timers still advance). Installed before the server loads.
const RealDate = Date;
const PINNED_AT = new RealDate(2026, 9, 7, 19, 0, 0).getTime();
const clockShift = PINNED_AT - RealDate.now();
class PinnedDate extends RealDate {
  constructor(...args) { if (args.length === 0) super(PinnedDate.now()); else super(...args); }
  static now() { return RealDate.now() + clockShift; }
}
global.Date = PinnedDate;
const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
const root = path.join(__dirname, '..');
const PORT = Number(process.env.AWANA_TEST_PORT || require('./free-port.cjs')());
const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

(async () => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-barfbin-'));
  const jobLog = path.join(binDir, 'jobs.log');
  fs.writeFileSync(path.join(binDir, 'powershell'), `#!/bin/sh\necho job >> ${jobLog}\nexit 0\n`, { mode: 0o755 });
  process.env.PATH = `${binDir}:${process.env.PATH}`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-barf-'));
  // Tonight is a BARF Night here (config.json's own barfNights wins), and no
  // drop-off tags (lateGraceMin a whole day). Signed in to a stand-in service.
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
    printerName: 'Fake', lateGraceMin: 24 * 60, barfNights: [today],
    syncUrl: 'https://sync.example.org', syncSession: 'v1.1.1700000000000.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
  }));
  fs.writeFileSync(path.join(dataDir, 'clubbers.csv'), 'Clubber ID,First Name,Last Name,Club\n1,Ava,Stone,Sparks\n2,Eli,Stone,Cubbies\n3,Mia,Lee,T&T\n4,Ben,Ray,Trek\n');
  Object.assign(process.env, { AWANA_DATA_DIR: dataDir, AWANA_PORT: String(PORT), AWANA_BIND_HOST: '127.0.0.1', PRINTER_NAME: 'Fake' });
  // The stand-in sync service: only its own address is caught.
  const reports = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://sync.example.org/')) {
      if (String(url).endsWith('/v1/cloud/friend')) reports.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(url, init);
  };
  const server = require(path.join(root, 'print-server', 'server.js'));
  const listener = server.startListening();
  await listener.ready;
  const base = `http://127.0.0.1:${PORT}`;
  const post = (p, body) => realFetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  const jobs = () => (fs.existsSync(jobLog) ? fs.readFileSync(jobLog, 'utf8').trim().split('\n').filter(Boolean).length : 0);
  const settle = () => new Promise((r) => setTimeout(r, 300));

  console.log('\nBARF Night: the BARFED tag');
  {
    check('tonight is a BARF Night here', server.isBarfNight() === true);
    check('another night is not', server.isBarfNight(new Date('2000-01-05T12:00:00')) === false);
    check('a BARF Bag is the first name in capitals, made possessive',
      server.barfBagOwner('Sophia Simpson') === 'SOPHIA\u2019S' && server.barfBagOwner('james') === 'JAMES\u2019' && server.barfBagOwner('  ') === '');
    check('a typed name is one clean line of at most 24',
      server.cleanFriendName('  <Ma\nya>  ') === 'Maya' && server.cleanFriendName('x'.repeat(40)).length === 24 && server.cleanFriendName(7) === '');
    const tag = await server.generateBarfTag({ firstName: 'Ava', friendName: 'Maya' });
    const png = fs.readFileSync(tag.pngPath);
    check('it is a 4x2 label at 300 dpi', png.readUInt32BE(16) === 1200 && png.readUInt32BE(20) === 600, `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`);
    fs.unlinkSync(tag.pngPath);

    let r = await post('/print', { name: 'Ava Stone', clubName: 'Sparks', clubberId: '1', friend: true, friendName: 'Maya' });
    await settle();
    check('a child who brought a friend gets two tags tonight', r.body.success === true && jobs() === 2, `${jobs()} ${JSON.stringify(r)}`);
    check('and the sync service hears who brought whom', reports.length === 1
      && reports[0].name === 'Ava Stone' && reports[0].club === 'Sparks' && reports[0].clubberId === '1' && reports[0].friendName === 'Maya', JSON.stringify(reports));
    r = await post('/print', { name: 'Eli Stone', clubName: 'Cubbies', clubberId: '2' });
    await settle();
    check('a child without one gets their one tag, and nothing is reported', jobs() === 3 && reports.length === 1, `${jobs()} ${reports.length}`);
    r = await post('/print', { name: 'Ben Ray', clubName: 'Trek', clubberId: '4', friend: true });
    await settle();
    check('a friend ticked at the desk box (no name) still gets the BARFED tag', jobs() === 5 && reports.length === 2 && reports[1].friendName === '', `${jobs()} ${JSON.stringify(reports[1])}`);
    r = await post('/print', { name: 'Mia Lee', clubName: 'T&T', clubberId: '3', cloud: true, friend: true, friendName: 'Jo' });
    await settle();
    check('a cloud check-in prints both, and is not reported again (the service recorded it)', jobs() === 7 && reports.length === 2, `${jobs()} ${reports.length}`);
    // P5: a check-in made on TwoTimTwo's own page. The Worker's watcher reads Brought a friend off the
    // report and its job carries friend: true and NO friend's name (TwoTimTwo's box has no name field).
    r = await post('/print', { name: 'Kai Ford', clubName: 'Sparks', clubberId: '9', cloud: true, friend: true, cloudJob: 'K'.repeat(22) });
    await settle();
    check('a TwoTimTwo-page child the report marks Brought a friend gets the BARFED tag too, with no friend\'s name, and is not reported again',
      r.body.success === true && jobs() === 9 && reports.length === 2, `${jobs()} ${reports.length}`);
  }

  console.log('\nBARF Night: the BARF Bag labels, one job');
  {
    const bag = await server.generateBarfBag('Maya');
    const png = fs.readFileSync(bag.pngPath);
    check('a BARF Bag label is a 4x2 label too', png.readUInt32BE(16) === 1200 && png.readUInt32BE(20) === 600);
    fs.unlinkSync(bag.pngPath);
    const before = jobs();
    let r = await post('/print-barf-bags', { names: ['Sophia Simpson', 'Maya', 'James'] });
    check('three labels go to the printer as ONE job', r.status === 200 && r.body.printed === 3 && jobs() === before + 1, `${JSON.stringify(r)} ${jobs() - before}`);
    r = await post('/print-barf-bags', { names: [' ', 7] });
    check('nothing to print is a clear refusal', r.status === 400 && jobs() === before + 1, JSON.stringify(r));
    r = await post('/print-barf-bags', {});
    check('and so is no list', r.status === 400);
    const relay = require(path.join(root, 'print-server', 'phone-relay.js'));
    check('the sync service may send it as a job; a phone page may not', relay.jobAllowed('POST', '/print-barf-bags') && !relay.relayAllowed('POST', '/print-barf-bags'));
  }

  console.log('\nBARF Night: the phone\'s card');
  {
    const q = await post('/phone/checkin', { name: 'Ava Stone', options: { Bible: true, Friend: true, FriendName: ' Maya<b> ' } });
    const pending = await (await realFetch(`${base}/pending-actions`)).json();
    const a = (pending.actions || []).find((x) => x.id === q.body.id);
    check('the friend\'s name rides the check-in to the laptop, cleaned', a && a.options.Friend === true && a.options.FriendName === 'Mayab', JSON.stringify(a && a.options));
    const q2 = await post('/phone/checkin', { name: 'Eli Stone', options: { Friend: false, FriendName: 'Jo' } });
    const p2 = await (await realFetch(`${base}/pending-actions`)).json();
    const a2 = (p2.actions || []).find((x) => x.id === q2.body.id);
    check('no name without Brought a friend', a2 && !('FriendName' in a2.options), JSON.stringify(a2 && a2.options));
  }

  console.log('\nBARF Night: the extension and the pages carry it');
  {
    const content = fs.readFileSync(path.join(root, 'chrome-extension', 'content.js'), 'utf8');
    const touch = fs.readFileSync(path.join(root, 'chrome-extension', 'touch.js'), 'utf8');
    const phone = fs.readFileSync(path.join(root, 'print-server', 'public', 'phone.html'), 'utf8');
    check('every tag the extension prints takes the friend note', /var friendNote = takeFriendNote\(resolvedClubberId, fullName\);[\s\S]{0,200}payload\.friend = true;/.test(content));
    check('the touch screen, phone actions and the desk box all leave one',
      /if \(opts\.Friend === true\) noteFriend\(recid, name, opts\.FriendName/.test(content)
      && /if \(phoneOpts\.Friend === true\) noteFriend\(recid, action\.name, action\.options\.FriendName/.test(content)
      && /closest\('#checkin'\)[\s\S]{0,120}friendBoxTicked\(\)/.test(content));
    check('the touch screen and the phone page ask for the friend\'s first name',
      /friendInput\(/.test(touch) && /options\.FriendName = friendName/.test(touch)
      && /friendInput\(/.test(phone) && /options\.FriendName = friendName/.test(phone));
    check('a brother or sister never gets the first child\'s friend name',
      /openFamily\(p, sibs, \{ bible: choice\.bible, friend: choice\.friend \}\)/.test(phone)
      && /var choice = \{ bible: state\.choice\.bible, friend: state\.choice\.friend, friendName: state\.choice\.friendName \|\| '' \};/.test(touch)
      && !/friendName: choice\.friendName/.test(touch.slice(touch.indexOf('function openSiblings'))));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  listener.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
