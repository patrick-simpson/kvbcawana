// Hand out shares (site/tools/shares/, owner 2026-11-23): the page's pure parts and its fences.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { byClub, confirmWords, defaultWhy, resultWords, batchKey } from '../tools/shares/logic.js';

test('children by club, youngest club first, by name', () => {
  const g = byClub([
    { id: '3', first: 'Zed', last: 'A', club: 'T&T' },
    { id: '1', first: 'Ava', last: 'B', club: 'Sparks' },
    { id: '2', first: 'Ben', last: 'C', club: 'Cubbies' },
    { id: '4', first: 'Amy', last: 'D', club: 'Sparks' },
  ]);
  assert.deepEqual(g.map((x) => x.club), ['Cubbies', 'Sparks', 'T&T']);
  assert.deepEqual(g[1].kids.map((k) => k.first), ['Amy', 'Ava']);
  assert.equal(g[2].key, 'tnt');
});

test('the words: tonight\'s theme as the reason, a plain confirm, each result', () => {
  assert.equal(defaultWhy({ backwards: true }), 'Backwards Night');
  assert.equal(defaultWhy({}), 'Awana club night');
  assert.equal(confirmWords(1, 1), 'Give 1 share to 1 child? TwoTimTwo has no undo.');
  assert.equal(confirmWords(5, 3), 'Give 3 shares to 5 children? TwoTimTwo has no undo.');
  assert.equal(resultWords({ outcome: 'given', shares: 3, balance: 12 }), '+3 given · now 12');
  assert.match(resultWords({ outcome: 'unknown' }), /never tried twice/);
  assert.match(batchKey(), /^[0-9a-f]{24}$/);
});

test('owner only, unlisted, nothing stored: the page keeps the owner\'s code in memory', () => {
  const html = readFileSync(new URL('../tools/shares/index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../tools/shares/app.js', import.meta.url), 'utf8');
  assert.match(html, /noindex/);
  assert.doesNotMatch(app, /localStorage\.setItem|sessionStorage/);
  assert.match(app, /X-Mail-Owner/);
  const links = readFileSync(new URL('../links/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(links, /tools\/shares/);
});
