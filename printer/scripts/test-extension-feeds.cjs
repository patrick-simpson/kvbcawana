#!/usr/bin/env node
// The extension's feeds (award slips, handbook worksheets) mark their work
// done only once the print server has accepted it — plain Node, zero deps.
//
// Both used to mark first and post after, so a print server that was down or
// refused the post left the award marked "slipped" and the night marked
// "worksheets printed" with nothing printed. Lifted out of feeds.js by brace
// matching, as the other extension tests do.
//
// Run: node scripts/test-extension-feeds.cjs

'use strict';
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'chrome-extension', 'feeds.js'), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
function extractFunction(name) {
  const start = SRC.indexOf('function ' + name + '(');
  if (start < 0) throw new Error(`feeds.js no longer defines function ${name}()`);
  let depth = 0, opened = false;
  for (let i = start; i < SRC.length; i++) {
    const ch = SRC[i];
    if (ch === '{') { depth++; opened = true; }
    else if (ch === '}') { depth--; if (opened && depth === 0) return SRC.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces in ${name}()`);
}
const tick = () => new Promise((r) => setTimeout(r, 10));

function slipsPage(env) {
  const build = new Function('env', `
    const AWARD_SLIP_CAP = 10;
    const slipsInFlight = new Set();
    const loadSlipped = () => new Set(env.slipped);
    const saveSlipped = (set) => { env.slipped = Array.from(set); };
    const postFeed = (p, body) => { env.posts.push(body); return Promise.resolve(env.answer()); };
    ${extractFunction('processAwardSlips')}
    return processAwardSlips;
  `);
  return build(env);
}

(async () => {
  console.log('\naward slips: marked only once the print server accepted them');
  {
    const env = { slipped: [], posts: [], answer: () => ({ ok: true }) };
    const run = slipsPage(env);
    run([{ name: 'Ava Stone', clubName: 'Sparks', award: 'Hang Glider' }]);
    await tick();
    check('an accepted slip is posted once and marked', env.posts.length === 1 && env.slipped.join() === 'ava stone|hang glider', JSON.stringify(env));
    run([{ name: 'Ava Stone', clubName: 'Sparks', award: 'Hang Glider' }]);
    await tick();
    check('the next tick does not post it again', env.posts.length === 1);
    const down = { slipped: [], posts: [], answer: () => undefined };   // postFeed's "server offline" resolution
    const run2 = slipsPage(down);
    run2([{ name: 'Eli Stone', clubName: 'Sparks', award: 'Wing Runner' }]);
    await tick();
    check('with the print server down the slip is posted but NOT marked, so the next tick tries again', down.posts.length === 1 && down.slipped.length === 0, JSON.stringify(down));
    run2([{ name: 'Eli Stone', clubName: 'Sparks', award: 'Wing Runner' }]);
    await tick();
    check('and it does try again', down.posts.length === 2);
    const refused = { slipped: [], posts: [], answer: () => ({ ok: false, status: 500 }) };
    slipsPage(refused)([{ name: 'Mia Stone', clubName: 'Cubbies', award: 'Apple Acres' }]);
    await tick();
    check('a refused slip is not marked either', refused.slipped.length === 0);
    let release;
    const slow = { slipped: [], posts: [], answer: () => new Promise((r) => { release = r; }) };
    const run3 = slipsPage(slow);
    run3([{ name: 'Kai Stone', clubName: 'T&T', award: 'Start Zone' }]);
    run3([{ name: 'Kai Stone', clubName: 'T&T', award: 'Start Zone' }]);
    await tick();
    check('an overlapping tick does not post a slip still in flight', slow.posts.length === 1);
    release({ ok: true });
    await tick();
    check('once accepted it is marked', slow.slipped.length === 1);
  }

  console.log('\nworksheets: the night is marked printed only once an agenda was accepted');
  {
    const page = (env) => new Function('env', `
      const WORKSHEETS_WINDOW_GRACE_MIN = 10;
      const CHURCH_CFG = { sharesClubIds: [2, 3] };
      const CLUB_ID_NAMES = { '2': 'Sparks', '3': 'T&T' };
      let worksheetsRunning = false;
      const worksheetsEnabled = () => true, isInClubWindow = () => true, isNearClubWindowStart = () => true;
      const formatDateYMD = () => '2026-10-07';
      const alreadyPrintedWorksheetsToday = (d) => env.marked.includes(d);
      const markWorksheetsPrinted = (d) => env.marked.push(d);
      const getCalendarIdFromPage = () => '77';
      const fetchPdfBase64 = (url) => Promise.resolve(env.pdf);
      const postFeed = (p, body) => { env.posts.push(p); return Promise.resolve(env.answer()); };
      ${extractFunction('runWorksheets')}
      return runWorksheets;
    `)(env);
    let env = { marked: [], posts: [], pdf: 'AAAA', answer: () => ({ ok: true }) };
    await page(env)();
    check('two clubs, two agendas posted, the night marked', env.posts.length === 2 && env.marked.join() === '2026-10-07', JSON.stringify(env));
    env = { marked: [], posts: [], pdf: 'AAAA', answer: () => undefined };
    const run = page(env);
    await run();
    check('with the print server down nothing is marked, so the next tick tries again', env.posts.length === 2 && env.marked.length === 0, JSON.stringify(env));
    await run();
    check('and it does try again', env.posts.length === 4);
    env = { marked: [], posts: [], pdf: null, answer: () => ({ ok: true }) };
    await page(env)();
    check('no PDF to print: nothing posted, nothing marked', env.posts.length === 0 && env.marked.length === 0);
  }

  console.log('\nannouncement scrape: an empty table is not an announcement');
  {
    const isEmpty = new Function(`${extractFunction('isEmptyTableText')} return isEmptyTableText;`)();
    for (const t of ['No results found.', 'No results found', 'No data available in table', 'No records found', 'No messages.', 'Nothing found']) {
      check(`"${t}" is the empty placeholder`, isEmpty(t) === true);
    }
    for (const t of ['No Awana tonight, weather', 'No club this week. Enjoy the break!', 'Bring a friend night is next week']) {
      check(`"${t}" is a real announcement`, isEmpty(t) === false);
    }
    check('the scrape checks it before posting', /isEmptyTableText\(text\)\) return null/.test(SRC));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
