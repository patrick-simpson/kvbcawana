// The merged about page: /lobby/about.html and /journey/about.html redirect
// (301) to the lobby and Journey parts of the home page (#lobby, #journey).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGE_REDIRECTS, pageRedirects } from '../lib/redirects.js';

const SITE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('the two old about pages go permanently to their sections of the home page', () => {
  const rules = new Map(pageRedirects().map((l) => { const [from, to, code] = l.split(' '); return [from, { to, code }]; }));
  for (const [from, to] of [['/lobby/about.html', '/#lobby'], ['/lobby/about', '/#lobby'], ['/journey/about.html', '/#journey'], ['/journey/about', '/#journey']]) {
    assert.deepEqual(rules.get(from), { to, code: '301' }, from);
  }
  assert.equal(PAGE_REDIRECTS.length, 4);
});

test('the sections they land on exist on the home page, and the old files are gone', () => {
  const read = (rel) => readFileSync(path.join(SITE, '..', rel), 'utf8');
  // The home page's six parts are cards with ids (printer/components/home/Parts.tsx,
  // rendered as <li id={part.id}>); the lobby's and Journey's are two of them.
  const parts = read('printer/components/home/Parts.tsx');
  assert.match(parts, /<li ref=\{ref\} id=\{part\.id\}/);
  assert.match(parts, /id: 'lobby', club:/);
  assert.match(parts, /id: 'journey', club:/);
  assert.equal(existsSync(path.join(SITE, '..', 'lobby/public/about.html')), false);
  assert.equal(existsSync(path.join(SITE, '..', 'journey/public/about.html')), false);
});

test('site/build.mjs writes them into _redirects, and a built site has them', () => {
  assert.match(readFileSync(path.join(SITE, 'build.mjs'), 'utf8'), /\.\.\.pageRedirects\(\)/);
  const built = path.join(SITE, 'dist', '_redirects');
  if (!existsSync(built)) return; // the CI site job builds first; a bare checkout has no dist
  const lines = readFileSync(built, 'utf8').split('\n');
  for (const l of pageRedirects()) assert.ok(lines.includes(l), l);
  assert.equal(existsSync(path.join(SITE, 'dist', 'lobby', 'about.html')), false);
  assert.equal(existsSync(path.join(SITE, 'dist', 'journey', 'about.html')), false);
});
