#!/usr/bin/env node
// The phone page as the touch check-in (7.7.0): the laptop hands the print
// server its families and Bible/Friend clubs (names only), the phone's roster
// carries them, a phone check-in carries Bible / Friend through to the laptop,
// and the phone's search and families are touch.js's own code, verbatim.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
const root = path.join(__dirname, '..');
const PORT = 34573;
const BASE = `http://127.0.0.1:${PORT}`;

(async () => {
  console.log('\nphone page: the touch check-in’s own code');
  {
    const { block } = require('./sync-touch-core.cjs');
    const touch = fs.readFileSync(path.join(root, 'chrome-extension', 'touch.js'), 'utf8');
    const phone = fs.readFileSync(path.join(root, 'print-server', 'public', 'phone.html'), 'utf8');
    const a = block(touch), b = block(phone);
    check('the phone carries touch.js’s search, households and tile fit verbatim (run scripts/sync-touch-core.cjs)',
      a === b && /function searchPeople/.test(b) && /function groupFamilies/.test(b) && /function fitTiles/.test(b));
    check('the phone shows families first when typing, away families last',
      (() => { const r = phone.slice(phone.indexOf('function renderSearch')); const x = r.indexOf("'Families'"), y = r.indexOf("'Children'"), z = r.indexOf("'Not here the last two club nights'"); return x > 0 && x < y && y < z; })());
    check('Bible starts ticked on the phone’s card and family page',
      /var choice = \{ bible: items\.bible, friend: false \};/.test(phone) && /openFamily\(null, f\.kids, \{ bible: true, friend: false \}, f\.name\)/.test(phone));
    check('a phone check-in sends Bible / Friend with it', /postJson\('\/phone\/checkin', \{ pin: PIN, name: k\.name, options: options \}\)/.test(phone));
    check('the card goes back at once (the check-in runs in the background)',
      /hideSheet\(\);[\s\S]{0,200}checkInMany\(\[\{ p: p, choice: choice \}\], null\);/.test(phone));
  }

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-phone-'));
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ printerName: 'Fake' }));
  fs.writeFileSync(path.join(dataDir, 'clubbers.csv'), 'First Name,Last Name,Club\nAva,Stone,Sparks\nEli,Stone,Cubbies\nMia,Reed,T&T\n');
  process.env.AWANA_DATA_DIR = dataDir;
  process.env.AWANA_PORT = String(PORT);
  process.env.AWANA_BIND_HOST = '127.0.0.1';
  process.env.PRINTER_NAME = 'Fake';
  const server = require(path.join(root, 'print-server', 'server.js'));
  const listener = server.startListening();
  await new Promise((resolve) => { if (listener.listening) return resolve(); listener.once('listening', resolve); });
  const post = async (p, body) => {
    const res = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  console.log('\nphone page: families from the laptop');
  {
    const ctx = server.sanitizeTouchContext({
      households: [['Ava Stone', 'Eli  STONE'], ['Lonely Kid'], 'nope', ['Mia Reed', 'Mia Reed Sister']],
      items: { bible: ['Sparks', 'T&T', 7], friend: 'Sparks' }, phone: '555-1234', address: '1 Main St',
    });
    check('households keep only children’s names, lowercased, two or more each',
      JSON.stringify(ctx.households) === JSON.stringify([['ava stone', 'eli stone'], ['mia reed', 'mia reed sister']]), JSON.stringify(ctx.households));
    check('items keep only club names', JSON.stringify(ctx.items) === JSON.stringify({ bible: ['Sparks', 'T&T', '7'], friend: [] }), JSON.stringify(ctx.items));
    check('nothing else survives', Object.keys(ctx).sort().join(',') === 'at,households,items');
    let r = await post('/touch/context', { households: [['Ava Stone', 'Eli Stone']], items: { bible: ['Sparks'], friend: ['Sparks'] } });
    check('the laptop’s extension can hand them over', r.status === 200 && r.body.households === 1, JSON.stringify(r.body));
    check('and they are kept on disk for a restart', fs.existsSync(path.join(dataDir, 'touch-context.json')));
    r = await post('/phone/roster', {});
    check('the phone’s roster carries the families, the Bible/Friend clubs and the last two nights',
      r.status === 200 && JSON.stringify(r.body.households) === JSON.stringify([['ava stone', 'eli stone']])
      && r.body.items.bible[0] === 'Sparks' && r.body.recent && r.body.recent.ready === false && r.body.kids.length === 3, JSON.stringify(r.body).slice(0, 300));
    const src = fs.readFileSync(path.join(root, 'print-server', 'server.js'), 'utf8');
    check('only the check-in laptop itself may set them', /app\.post\('\/touch\/context'[\s\S]{0,120}isLoopbackRequest\(req\)\) return res\.status\(403\)/.test(src));
  }

  console.log('\nphone page: Bible and Friend reach the laptop');
  {
    let r = await post('/phone/checkin', { name: 'Ava Stone', options: { Bible: true, Friend: false } });
    check('a phone check-in is queued with its choices', r.status === 200 && r.body.id, JSON.stringify(r.body));
    r = await post('/phone/checkin', { name: 'Mia Reed', options: { Bible: 'yes', Friend: 1, Extra: true } });
    const res = await fetch(BASE + '/pending-actions');
    const acts = (await res.json()).actions;
    const ava = acts.find(a => a.name === 'Ava Stone'), mia = acts.find(a => a.name === 'Mia Reed');
    check('the laptop sees Bible ticked, Friend not', ava && ava.options.Bible === true && ava.options.Friend === false, JSON.stringify(ava));
    check('anything but a true/false Bible or Friend is dropped', mia && JSON.stringify(mia.options) === '{}', JSON.stringify(mia));
    const ext = fs.readFileSync(path.join(root, 'chrome-extension', 'content.js'), 'utf8');
    check('the extension checks the child in with those choices',
      /tryDirectCheckin\(recid, action\.name, clubId, phoneOpts\)/.test(ext) && /pollForCheckinButton\(\{ name: action\.name, element: el \}, phoneOpts, 30\)/.test(ext));
    const touch = fs.readFileSync(path.join(root, 'chrome-extension', 'touch.js'), 'utf8');
    check('the laptop shares its families at load and every half hour, not only when the touch screen opens',
      /setTimeout\(loadHouseholds, 5000\);/.test(touch) && /shareContext\(\); \} \}\)/.test(touch));
  }

  console.log('\nthe youth leaders’ page and the 7:15 check-out (7.10.0)');
  {
    const res = await fetch(BASE + '/phone/ym');
    const html = await res.text();
    check('/phone/ym serves the phone page marked Trek and Journey only, check-in only',
      res.status === 200 && html.indexOf("window.AWANA_ONLY_CLUBS = ['trek', 'journey']; window.AWANA_SIMPLE = true;") !== -1
      && html.indexOf('AWANA_SIMPLE') < html.indexOf("var RELAY = window.AWANA_RELAY"));
    const phone = fs.readFileSync(path.join(root, 'print-server', 'public', 'phone.html'), 'utf8');
    check('the page keeps only those clubs’ children', /return !ONLY \|\| ONLY\.indexOf\(clubKit\(sk\.club\)\) !== -1;/.test(phone));
    check('the simple page hides Tonight and the + menu, and never asks for leaders or jams',
      /\$\('count-pill'\)\.hidden = SIMPLE;/.test(phone) && /\$\('menu-btn'\)\.hidden = SIMPLE;/.test(phone) && /if \(SIMPLE\) return;[^\n]*\n  refreshLeaders\(\);/.test(phone));
    const build = fs.readFileSync(path.join(root, '..', 'site', 'build.mjs'), 'utf8');
    check('the website builds /checkin/ym too', /path\.join\(checkinOut, 'ym', 'index\.html'\)/.test(build) && /AWANA_ONLY_CLUBS = \['trek', 'journey'\]/.test(build));

    const ext = fs.readFileSync(path.join(root, 'chrome-extension', 'content.js'), 'utf8');
    const grab = (name) => { const i = ext.indexOf('function ' + name + '('); let d = 0, j = ext.indexOf('{', i); for (; j < ext.length; j++) { if (ext[j] === '{') d++; else if (ext[j] === '}' && --d === 0) break; } return ext.slice(i, j + 1); };
    const vm = require('vm');
    const sb = { YM_CHECKOUT: { enabled: true, at: '19:15', clubs: ['trek', 'journey'] }, CHURCH_CFG: { clubNights: [{ dow: 3 }] },
      parseHM: (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s); return m ? +m[1] * 60 + +m[2] : null; } };
    vm.createContext(sb);
    vm.runInContext(grab('ymCheckoutDue') + '\n' + grab('ymClubOf'), sb);
    const wed = (h, m) => new Date(2026, 9, 7, h, m), thu = new Date(2026, 9, 8, 19, 30);
    check('the check-out starts at 7:15 on a club night, and runs on from there (late arrivals too)',
      !sb.ymCheckoutDue(wed(19, 14)) && sb.ymCheckoutDue(wed(19, 15)) && sb.ymCheckoutDue(wed(20, 45)));
    check('never on another night', !sb.ymCheckoutDue(thu));
    sb.YM_CHECKOUT.enabled = false;
    check('the church can switch it off', !sb.ymCheckoutDue(wed(19, 30)));
    check('only Trek and Journey are checked out',
      sb.ymClubOf('Trek') === 'trek' && sb.ymClubOf('Journey') === 'journey' && !sb.ymClubOf('T&T') && !sb.ymClubOf('Sparks') && !sb.ymClubOf(''));
    check('the sweep runs every 30 seconds, checks out with TwoTimTwo’s own call, and never twice',
      /setInterval\(function\(\) \{ ymSweep\(false\); \}, YM_SWEEP_MS\);/.test(ext) && /var YM_SWEEP_MS = 30 \* 1000;/.test(ext)
      && /'calendar_id=' \+ encodeURIComponent\(cal\[1\]\) \+ '&clubber_id='/.test(ext) && /done\.indexOf\(id\) === -1/.test(ext));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
