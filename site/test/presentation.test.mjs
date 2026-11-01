// /presentation (site/presentation/, owner 2026-11-01; CLAUDE.md "Presentation",
// worker/src/routes.md 10.14): the sealed congregation deck on the lobby TV, slide
// controls everywhere else. The rules are pure (logic.js); the page signs in with
// passphrase v2 only, keeps the history key in memory, and opens the deck itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FRAME_HELPER, builtWords, clampSlide, deckOutline, elapsed, frameHtml, keyStep, modeOf, tapStep } from '../presentation/logic.js';

const SITE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const page = readFileSync(path.join(SITE, 'presentation', 'index.html'), 'utf8');
const app = readFileSync(path.join(SITE, 'presentation', 'app.js'), 'utf8');
const build = readFileSync(path.join(SITE, 'build.mjs'), 'utf8');

const DECK = `<!doctype html><html><head><title>Eleven Seasons of Awana</title></head><body>
<script id="payload" type="application/json">{"meta":{},"slides":[{"title":"Eleven seasons","kicker":"Welcome","notes":"Thank the leaders."},{"title":"How the club grew","kicker":"Growth"},{"title":"Room to grow","notes":"Ask for helpers."}]}</script>
<script>(function(){})();</script>
</body></html>`;

test('the outline comes from the deck\'s own payload: titles, kickers, notes', () => {
  const o = deckOutline(DECK);
  assert.equal(o.title, 'Eleven Seasons of Awana');
  assert.deepEqual(o.slides.map((s) => s.title), ['Eleven seasons', 'How the club grew', 'Room to grow']);
  assert.equal(o.slides[0].notes, 'Thank the leaders.');
  assert.equal(o.slides[1].notes, '');
  assert.deepEqual(deckOutline('<html>no payload</html>').slides, []);
  assert.deepEqual(deckOutline('<script id="payload">{broken</script>').slides, []);
});

test('a framed deck hides its own chrome, gets the helper once, and a preview is still', () => {
  const live = frameHtml(DECK);
  assert.ok(live.includes('#help,#theme,#notes,#overview'));
  assert.ok(live.indexOf(FRAME_HELPER) > live.lastIndexOf('<script>(function(){})();</script>'), 'the helper runs after the deck');
  assert.equal(live.split(FRAME_HELPER).length, 2);
  assert.ok(!live.includes('animation:none'));
  assert.ok(frameHtml(DECK, { still: true }).includes('animation:none!important'));
  // the helper only talks to its own page
  assert.match(FRAME_HELPER, /e\.source !== P/);
  assert.match(FRAME_HELPER, /location\.origin/);
});

test('keys, taps and the slide range', () => {
  assert.equal(keyStep('ArrowRight'), 1);
  assert.equal(keyStep('PageDown'), 1);
  assert.equal(keyStep(' '), 1);
  assert.equal(keyStep('PageUp'), -1);
  assert.equal(keyStep('ArrowLeft'), -1);
  assert.equal(keyStep('Home'), 'first');
  assert.equal(keyStep('End'), 'last');
  assert.equal(keyStep('x'), null);
  assert.equal(tapStep(10, 1000), -1);
  assert.equal(tapStep(500, 1000), 0);
  assert.equal(tapStep(990, 1000), 1);
  assert.equal(clampSlide(5, 3), 2);
  assert.equal(clampSlide(-1, 3), 0);
  assert.equal(clampSlide(7, 0), 7);
  assert.equal(elapsed(65_000), '1:05');
  assert.equal(elapsed(3_725_000), '1:02:05');
  assert.equal(builtWords('2026-11-05T08:30:00Z'), 'Numbers from Thursday, Nov 5');
  assert.equal(builtWords(null), '');
});

test('the TV is ?screen=tv; everything else is the presenter view', () => {
  assert.equal(modeOf('?screen=tv'), 'tv');
  assert.equal(modeOf('?configure=1'), 'presenter');
  assert.equal(modeOf(''), 'presenter');
});

test('the page skips search engines and loads nothing from another host', () => {
  assert.match(page, /<meta name="robots" content="noindex, nofollow">/);
  assert.ok(!/(src|href)="https?:\/\//i.test(page), 'no absolute asset URL');
  assert.match(page, /<script type="module" src="\.\/app\.js"><\/script>/);
});

test('passphrase v2 only; the key stays in memory; the deck is opened here', () => {
  assert.match(app, /signInWithPassphrase/);
  assert.match(app, /unwrapPrivateKey\(key\.wrapped, typed, key\.pub\)/);
  assert.match(app, /openDocument\(ring, wire\)/);
  assert.match(app, /'awanaSyncSession\.v1'/);
  // nothing but the session goes to storage: never the passphrase, the key or the deck
  for (const m of app.matchAll(/store\.set\(([^,]+),/g)) assert.equal(m[1], 'SESSION_KEY');
  assert.ok(!/sessionStorage|indexedDB/.test(app));
  assert.ok(!/console\.(log|info)/.test(app), 'logs nothing');
});

test('the build ships the page with its two sign-in modules', () => {
  assert.match(build, /for \(const f of \['index\.html', 'app\.js', 'logic\.js'\]\) cpSync\(path\.join\(ROOT, 'site', 'presentation', f\)/);
  assert.match(build, /for \(const f of \['sync-protocol\.js', 'cloud-crypto\.js'\]\) cpSync\(path\.join\(ROOT, 'shared', f\), path\.join\(out, 'shared', f\)\)/);
});
