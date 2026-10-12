// The one check-in page (/checkin, /checkin/ym): built from the print app's phone
// page by site/checkin/checkin-page.mjs, on the desk's online path. Pinned from the
// source: the touch core is the laptop touch screen's own, every module it imports
// is one the build serves, nothing leaves the site, nothing relays to the laptop,
// and no passphrase or medical field is ever kept.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildCheckinPages, CHECKIN_MODULES, PHONE_PAGE } from '../checkin/checkin-page.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
const block = (src) => src.slice(src.indexOf('  // touch-core:begin'), src.indexOf('  // touch-core:end'));

describe('the check-in page', () => {
  const { index, ym } = buildCheckinPages();
  const src = readFileSync(PHONE_PAGE, 'utf8');

  it('carries the touch check-in\'s own touch-core block (the laptop\'s touch.js is the source)', () => {
    const touch = block(read('printer', 'chrome-extension', 'touch.js'));
    assert.ok(touch.length > 1000 && index.includes(touch), 'the page\'s search, households and grouping differ from touch.js');
    for (const fn of ['function norm(', 'function searchPeople(', 'function groupFamilies(']) assert.ok(index.includes(fn), fn);
  });

  it('imports exactly the modules the build serves beside it, and the transport takes the crypto from its caller', () => {
    const imports = [...index.matchAll(/import\('\/checkin\/([^']+)'\)/g)].map((m) => m[1]).sort();
    assert.deepEqual(imports, Object.keys(CHECKIN_MODULES).sort());
    for (const from of Object.values(CHECKIN_MODULES)) assert.ok(existsSync(from), from);
    assert.match(read('site', 'build.mjs'), /for \(const \[name, from\] of Object\.entries\(CHECKIN_MODULES\)\) cpSync\(from, path\.join\(checkinOut, name\)\)/);
    assert.match(read('site', 'checkin', 'desk-transport.js'), /^(?![\s\S]*\bimport\b[^\n]*from)/);
  });

  it('is on the desk\'s path: the transport for every call, no relay, no laptop PIN', () => {
    assert.ok(!/AWANA_RELAY|\/v1\/relay|\/phone\/|X-Awana-Pin|postJson\(/.test(src), 'nothing of the relayed page is left');
    for (const call of ['desk.signIn(', 'desk.restore()', 'desk.roster()', 'desk.families()', 'desk.tonight()', 'desk.printStatus()',
      'desk.checkIn(', 'desk.undo(', 'desk.checkout(', 'desk.oneOffTag(', 'desk.leaderTag(', 'desk.customLabel(',
      'desk.barfInfo()', 'desk.barfLate(', 'desk.barfRecheck(']) {
      assert.ok(src.includes(call), call);
    }
  });

  it('asks TwoTimTwo-backed routes no faster than the old phone page did (every 12 s), and waits out a busy answer', () => {
    const base = Number((src.match(/var ROSTER_POLL_BASE_MS = (\d+);/) || [])[1]);
    assert.ok(base >= 12000, `the roster is asked every ${base} ms`);
    assert.match(src, /if \(e && e\.code === 'busy'\) \{ setBusy\(e\.retryAfterMs\); scheduleRosterPoll\(\(e\.retryAfterMs \|\| 5000\) \+ 250\); return; \}/);
    assert.match(src, /var FAMILIES_EVERY_MS = 30 \* 60 \* 1000;/);
    // the roster is the one tick's only TwoTimTwo-backed call; nothing else polls on a timer
    assert.equal((src.match(/setInterval\(/g) || []).length, 3, 'only the three countdowns tick (the passphrase lockout, the roster\'s busy note, a queued job\'s automatic retry)');
    // A busy Worker is a countdown and an automatic retry of that one job (owner 2026-10-12), never a hammer.
    assert.match(src, /if \(e && e\.code === 'busy' && !job\.cancelled\) \{ waitJob\(job, e\.retryAfterMs\); return; \}/);
    assert.match(src, /var until = Date\.now\(\) \+ Math\.max\(1000, ms \|\| 5000\);/);
  });

  it('draws with the brand kit under /checkin/brand/ and nothing from another host', () => {
    assert.match(index, /href="\/checkin\/brand\/fonts\.css"/);
    assert.match(index, /src="\/checkin\/brand\/logos\/awana-clubs-white\.svg"/);
    assert.deepEqual([...index.matchAll(/(?:href|src)="(https?:)?\/\/[^"]+"/g)], []);
    assert.ok(!/fonts\.googleapis|@import|@font-face/.test(index));
  });

  it('never stores the passphrase and names no medical field', () => {
    const js = src + read('site', 'checkin', 'desk-transport.js');
    assert.ok(!/localStorage\.setItem\([^)]*pass/i.test(js));
    assert.ok(!/sessionStorage\.setItem\([^)]*pass/i.test(js));
    assert.ok(!/allerg|medical/i.test(js));
  });

  it('/checkin/ym is the same page for Trek and Journey, check-in only', () => {
    assert.match(ym, /<script>window\.AWANA_ONLY_CLUBS = \['trek', 'journey'\]; window\.AWANA_SIMPLE = true;<\/script>\n<script>\n\/\/ ── The touch check-in/);
    assert.equal(ym.replace("<script>window.AWANA_ONLY_CLUBS = ['trek', 'journey']; window.AWANA_SIMPLE = true;</script>\n", ''), index);
  });

  it('a built site has the page, its modules and its kit', () => {
    const dist = path.join(ROOT, 'site', 'dist', 'checkin');
    if (!existsSync(dist)) return; // the CI site job builds first; a bare checkout has no dist
    assert.equal(readFileSync(path.join(dist, 'index.html'), 'utf8'), index);
    assert.equal(readFileSync(path.join(dist, 'ym', 'index.html'), 'utf8'), ym);
    for (const [name, from] of Object.entries(CHECKIN_MODULES)) assert.equal(readFileSync(path.join(dist, name), 'utf8'), readFileSync(from, 'utf8'), name);
    assert.ok(existsSync(path.join(dist, 'brand', 'tokens.css')));
  });
});
