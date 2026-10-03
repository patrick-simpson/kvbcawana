#!/usr/bin/env node
// Tests for the touch check-in's search and household parsing
// (chrome-extension/touch.js, whose pure half loads in Node).
//
// WHAT THIS GUARDS
// * First name, last name, both, either order, as typed: every typed word
//   must START a word of the name to count as a match.
// * Misspellings are offered, never matched: "Jaxon" lists Jackson under
//   "Did you mean", and one or two letters are only ever a prefix.
// * Children already checked in sort after those still to check in.
// * The household export keeps the household id and children's names, and
//   nothing else from a row (addresses and phones never leave the parse).
'use strict';
const fs = require('fs');
const path = require('path');
// A content script, not a module: run it with a `module` to fill, the way it
// detects Node (the printer's package.json makes a bare require load it as ESM).
const mod = { exports: {} };
new Function('module', fs.readFileSync(path.join(__dirname, '..', 'chrome-extension', 'touch.js'), 'utf8'))(mod);
const t = mod.exports;

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

const kids = [
  'Micah Johnson', 'Jackson Smith', 'Jaxson Lee', 'Caitlin Brooks', 'Kaitlyn Ross', 'Ava Smith',
  'Avery Stone', 'Émile Dubois', 'Noah O\'Brien', 'Sophia Martinez', 'Smith Carter',
].map((name) => ({ name }));
const names = (r) => r.map((p) => p.name);

console.log('touch check-in: search');
{
  let r = t.searchPeople(kids, 'smi');
  check('last name prefix', names(r.matches).includes('Jackson Smith') && names(r.matches).includes('Ava Smith'));
  check('a first name that starts the same word comes first', r.matches[0].name === 'Smith Carter', names(r.matches).join(', '));
  r = t.searchPeople(kids, 'smith ava');
  check('both words, either order', names(r.matches).join() === 'Ava Smith', names(r.matches).join());
  r = t.searchPeople(kids, 'Jaxon');
  check('Jaxon: nobody matches as typed', !r.matches.length, names(r.matches).join());
  check('Jaxon: Jaxson and Jackson are offered', names(r.close).includes('Jaxson Lee') && names(r.close).includes('Jackson Smith'), names(r.close).join());
  r = t.searchPeople(kids, 'caitlyn');
  check('Caitlyn offers Caitlin and Kaitlyn', names(r.close).includes('Caitlin Brooks') && names(r.close).includes('Kaitlyn Ross'), names(r.close).join());
  r = t.searchPeople(kids, 'Mciah');
  check('swapped letters still find Micah', names(r.close).includes('Micah Johnson'), names(r.close).join());
  r = t.searchPeople(kids, 'emile');
  check('accents do not matter', names(r.matches).includes('Émile Dubois'));
  r = t.searchPeople(kids, 'obrien');
  check('apostrophes do not matter', names(r.matches).includes('Noah O\'Brien'));
  r = t.searchPeople(kids, 'zx');
  check('two letters are only ever a prefix (no guesses)', !r.matches.length && !r.close.length);
  r = t.searchPeople(kids, 'av');
  check('a short prefix matches as typed', names(r.matches).includes('Ava Smith') && names(r.matches).includes('Avery Stone'));
  check('an empty query lists no one', !t.searchPeople(kids, '   ').matches.length);
  const withIn = [{ name: 'Ava Smith', checkedIn: true }, { name: 'Avery Stone' }];
  r = t.searchPeople(withIn, 'av');
  check('children already in sort after the rest', r.matches[0].name === 'Avery Stone');
  check('edit distance counts a swap as one', t.editDistance('micah', 'mciah') === 1);
}

console.log('touch check-in: households');
{
  const csv = 'Household ID,Parent/Guardian#1,Address1,Primary Phone,Active Clubbers\n'
    + '101,"Doe, Jane",1 Main St,555-0100,"Micah Johnson, Ava Smith"\n'
    + '102,Pat Roe,2 Oak Ave,555-0101,Avery Stone\n'
    + '103,"Kim ""K"" Lee",3 Elm,555-0102,"Jaxson Lee,Émile Dubois,Noah O\'Brien"\n';
  const h = t.householdIndex(csv);
  check('children map to their household', h.byName['micah johnson'] === '101' && h.byName['ava smith'] === '101');
  check('a one-child household is not a sibling group', !('avery stone' in h.byName));
  check('three in a household, accents normalized', h.members['103'] && h.members['103'].length === 3 && h.byName['emile dubois'] === '103');
  check('nothing but ids and names is kept', !JSON.stringify(h).match(/555|Main St|Oak|Elm|Doe|Roe/));
  check('an export without the columns yields nothing', !Object.keys(t.householdIndex('a,b\n1,2\n').byName).length);
}

console.log('touch check-in: families still to come');
{
  const csv = 'Household ID,Active Clubbers\n1,"Micah Johnson, Ava Johnson, Eli Ross"\n2,"Jackson Smith, Lily Smith"\n';
  const h = t.householdIndex(csv);
  const left = [
    { name: 'Micah Johnson', recid: '1' }, { name: 'Ava Johnson', recid: '2' }, { name: 'Eli Ross', recid: '3' },
    { name: 'Jackson Smith', recid: '4' }, { name: 'Nora Bennett', recid: '5' },
  ];
  const f = t.groupFamilies(left, h);
  check('children group by household; a child it doesn\'t place stands alone', f.length === 3, JSON.stringify(f.map((x) => x.name)));
  const j = f.find((x) => x.kids.length === 3);
  check('a blended family is named by its most common last name', j && j.name === 'Johnson & Ross', j && j.name);
  check('families sort by name', f.map((x) => x.name).join() === 'Bennett,Johnson & Ross,Smith', f.map((x) => x.name).join());
  check('only the children still to come are in a family (Lily is in already)', f.find((x) => x.name === 'Smith').kids.length === 1);
  check('before the household list loads, everyone stands alone', t.groupFamilies(left, null).length === 5);

  const W = 1232, H = 600;
  const few = t.fitTiles(3, W, H, 12, 1.6, 92);
  const many = t.fitTiles(30, W, H, 12, 1.6, 92);
  check('few families: big tiles, no scrolling', !few.scroll && few.h > 180, JSON.stringify(few));
  check('more families: smaller tiles, still no scrolling', !many.scroll && many.h < few.h && many.h >= 92, JSON.stringify(many));
  const lots = t.fitTiles(200, W, H, 12, 1.6, 92);
  check('too many to fit: the minimum size, scrolling', lots.scroll && lots.h === 92 && lots.cols >= 4, JSON.stringify(lots));
  const rowsNeeded = (r) => Math.ceil(30 / r.cols) * r.h + (Math.ceil(30 / r.cols) - 1) * 12;
  check('the tiles that fit do fit the height', rowsNeeded(many) <= H + 0.5, String(rowsNeeded(many)));
  let prev = Infinity, shrinking = true;
  for (let n = 1; n <= 60; n++) { const r = t.fitTiles(n, W, H, 12, 1.6, 92); if (r.h > prev + 0.5) shrinking = false; prev = r.h; }
  check('a tile never gets smaller as families leave (one fewer is never smaller)', shrinking);
}

// The touch path never opens TwoTimTwo's modal (7.4.1): behind the full-screen
// overlay it stacked up and left its grey backdrop over the page after Close.
{
  const c = fs.readFileSync(path.join(__dirname, '..', 'chrome-extension', 'content.js'), 'utf8');
  const api = c.slice(c.indexOf('window.__awanaTouchApi = {'), c.indexOf('injectWidget();', c.indexOf('window.__awanaTouchApi = {')));
  check('the touch API never clicks a TwoTimTwo row or polls for its modal', api.length > 200 && !/\.click\(\)|pollForCheckinButton|tryDirectCheckin/.test(api));
  check('no CSRF token needed: TwoTimTwo\'s check-in page has none (live, 7.4.2)',
    /if \(!calendarId\) return Promise\.resolve\('no-form'\);/.test(c) && /if \(csrfToken\) body \+= '&YII_CSRF_TOKEN=/.test(c));
  check('rows TwoTimTwo already checked in (.checked-in, hidden) are not offered or posted',
    /:not\(\.checked-in\)'\) : null;/.test(c) && /querySelectorAll\('\.clubber:not\(\.checked-in\)'\)/.test(fs.readFileSync(path.join(__dirname, '..', 'chrome-extension', 'touch.js'), 'utf8')));
  const tj = fs.readFileSync(path.join(__dirname, '..', 'chrome-extension', 'touch.js'), 'utf8');
  check('Bible starts ticked wherever the club has it (7.6.0)', /state\.choice = \{ bible: !!state\.items\.bible, friend: false \};/.test(tj)
    && /openSiblings\(null, f\.kids, \{ bible: true, friend: false \}, f\.name\)/.test(tj));
  check('a typed search shows households first, then the children, away families last', (function () {
    const r = tj.slice(tj.indexOf('function renderSearch'), tj.indexOf('// ── Families still to come'));
    const a = r.indexOf("'Families'"), b = r.indexOf("'Children'"), c = r.indexOf("'Not here the last two club nights'");
    return a > 0 && a < b && b < c;
  })());
  check('redraws are keyed (no tile replays its landing) and survivors glide', /function keyed\(tag, cls, k\)/.test(tj) && /beginKeyed\(list\);[\s\S]{0,400}endKeyed\(\);/.test(tj));
  check('rows TwoTimTwo has checked in never count as "still there" for the panel and phone paths',
    /function findClubberElByName\(name\) \{[\s\S]{0,120}querySelectorAll\('\.clubber:not\(\.checked-in\)'\)/.test(c));
  check('the panel and phone direct path needs no CSRF token either', /var csrfToken = findCsrfToken\(\);\s*if \(!calendarId\) return Promise\.resolve\(false\);/.test(c));
  check('a phone check-in never opens the modal under the touch screen', /if \(window\.__awanaTouchOpen\) \{[\s\S]{0,300}reportPhoneAction\(action\.id, false/.test(c));
  check('touch check-ins run one at a time', /touchQueue = run\.catch/.test(api));
  check('the row is dropped by its recid, not its name text', /var row = rowByRecid\(recid\);/.test(c));
  check('a failed post refreshes the token in the background and retries once', /return refreshCheckinTokens\(\)\.then\(function\(\) \{ return postTouchCheckin\(/.test(c));
  check('Close clears a stuck modal and reloads only after check-ins', /closed: function\(checkedIn\) \{\s*clearStuckModal\(\);\s*if \(!checkedIn\) return;/.test(api));
  check('a new version on disk loads itself: the extension re-reads its folder, then the tab reloads',
    /if \(managed\) selfUpdateTo\(data\.version\);/.test(c) && /type: 'AWANA_RELOAD_SELF'/.test(c)
    && /AWANA_RELOAD_SELF[\s\S]{0,120}chrome\.runtime\.reload\(\)/.test(fs.readFileSync(path.join(__dirname, '..', 'chrome-extension', 'background.js'), 'utf8')));
  check('once per version per tab, so a copy that cannot reload never loops', /sessionStorage\.getItem\(key\)\) return;/.test(c));
  check('the peak-window auto-reload waits while the touch screen is up', /if \(window\.__awanaTouchOpen\) return;\s*if \(document\.getElementById\('checkin-modal'\)\) return;/.test(c));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
