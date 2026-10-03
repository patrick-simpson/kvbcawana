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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
