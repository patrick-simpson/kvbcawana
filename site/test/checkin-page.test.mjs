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
    assert.equal((src.match(/setInterval\(/g) || []).length, 4, 'only the three countdowns and the waiting Cubbies\' sign tick (the passphrase lockout, the roster\'s busy note, a queued job\'s automatic retry, the sign\'s line)');
    // the sign's tick changes words only: it calls nothing
    assert.match(src, /if \(!waitTimer\) waitTimer = setInterval\(function\(\) \{\n\s+var now = document\.querySelector\('#list \.wait-line'\);/);
    // A busy Worker is a countdown and an automatic retry of that one job (owner 2026-10-12), never a hammer.
    assert.match(src, /if \(e && e\.code === 'busy' && !job\.cancelled\) \{ waitJob\(job, e\.retryAfterMs\); return; \}/);
    assert.match(src, /var until = Date\.now\(\) \+ Math\.max\(1000, ms \|\| 5000\);/);
  });

  it('on a day with no club (the roster\'s noClub answer, owner 2026-10-13): the note in the list\'s place, asked again once a minute', () => {
    assert.match(src, /var NO_CLUB_POLL_MS = 60 \* 1000;/);
    // a restored or stale list is never read as "no club"
    assert.match(src, /if \(data && data\.noClub === true && !data\.stale && !data\.restored\) \{[\s\S]{0,200}setNoClub\(data\);[\s\S]{0,120}rosterPollMs = NO_CLUB_POLL_MS;[\s\S]{0,60}scheduleRosterPoll\(\);/);
    // the note replaces "Reading the roster…" and the list; its words are the transport's (site/test/desk-transport.test.mjs)
    assert.match(src, /if \(NO_CLUB\) list\.appendChild\(noClubNote\(\)\);\n\s+else if \(!rosterLoaded\)/);
    assert.match(src, /noClubWords = m\[0\]\.noClubWords;/);
    // no search box, no printer line, no busy or stale note while it shows
    assert.match(src, /#main-screen\.no-club \.search \.box,[^{]*#main-screen\.no-club \.statusline \{ display: none !important; \}/);
    // a write the Worker refuses no-club asks the roster again at once, so the note replaces the list
    assert.match(src, /job\.onFail\(e\);\n\s+if \(e && e\.code === 'no-club'\) scheduleRosterPoll\(0\);/);
  });

  it('Check out (owner 2026-10-15): a mode, Puggles to T&T, one tap per household held for Undo before anything is sent', () => {
    assert.match(src, /var PICKUP_KITS = \['puggles', 'cubbies', 'sparks', 'tnt'\];/);
    assert.match(src, /var CHECKOUT_UNDO_MS = 10000;/);
    // TwoTimTwo's check-out cannot be taken back: nothing is sent until the Undo time is over
    assert.match(src, /batch\.timer = setTimeout\(function\(\) \{ sendHeld\(batch\); \}, CHECKOUT_UNDO_MS\);/);
    assert.match(src, /go: function\(\) \{ return desk\.checkout\(\{ clubberId: k\.clubberId, name: k\.name, club: k\.club \}\); \}/);
    // never on the youth page (the Worker checks Trek and Journey out) or a day with no club
    assert.match(src, /\$\('mode-btn'\)\.hidden = SIMPLE;/);
    assert.match(src, /MODE = m === 'out' && !SIMPLE && !NO_CLUB && !TEST_DAY \? 'out' : 'in';/);
    // ...or a test day (owner 2026-10-15): TwoTimTwo's check-out cannot be undone overnight
    assert.match(src, /#main-screen\.test-day \.mode-btn \{ display: none !important; \}/);
    assert.match(src, /if \(!data\.stale && !data\.restored\) setTestDay\(data\.testDay \|\| null\);/);
    // leaving the page while a household is held asks first
    assert.match(src, /Object\.keys\(WAITING\)\.length \+ HELD\.length > 0;/);
  });

  it('draws with the brand kit under /checkin/brand/ and nothing from another host', () => {
    assert.match(index, /href="\/checkin\/brand\/fonts\.css"/);
    assert.match(index, /src="\/checkin\/brand\/logos\/kvbc-awana-two-line-white\.svg"/);
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
