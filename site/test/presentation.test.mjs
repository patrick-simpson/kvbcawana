// /presentation (site/presentation/, owner 2026-11-01; ARCHIVED 2026-11-09: index.html is a
// static note, app.js and logic.js kept unloaded and still checked here; CLAUDE.md "Presentation",
// worker/src/routes.md 10.14): the sealed congregation deck on the lobby TV, slide
// controls everywhere else. The rules are pure (logic.js); the page signs in with
// passphrase v2 only, keeps the history key in memory, and opens the deck itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FRAME_HELPER, builtWords, clampSlide, deckOutline, followingNow, frameHtml, keyStep, lobbyTargets, modeOf, msToNextEdge, notesHere, pushWords, tapStep } from '../presentation/logic.js';

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
  assert.equal(builtWords('2026-11-05T08:30:00Z'), 'Numbers from Thursday, Nov 5');
  assert.equal(builtWords(null), '');
});

test('speaker notes on a phone only: never the lobby computer\'s Settings window, a laptop or a tablet', () => {
  assert.equal(notesHere({ configure: false, coarse: true, screenW: 390, screenH: 844 }), true);
  assert.equal(notesHere({ configure: false, coarse: true, screenW: 844, screenH: 390 }), true, 'a phone turned sideways');
  assert.equal(notesHere({ configure: true, coarse: true, screenW: 390, screenH: 844 }), false, 'the app\'s Settings window');
  assert.equal(notesHere({ configure: false, coarse: false, screenW: 1920, screenH: 1080 }), false, 'a laptop or the lobby PC');
  assert.equal(notesHere({ configure: false, coarse: true, screenW: 1920, screenH: 1080 }), false, 'a touch-screen PC');
  assert.equal(notesHere({ configure: false, coarse: true, screenW: 820, screenH: 1180 }), false, 'a tablet');
  assert.equal(notesHere({ configure: false, coarse: false, screenW: 390, screenH: 844 }), false);
});

test('the TV is ?screen=tv; everything else is the presenter view', () => {
  assert.equal(modeOf('?screen=tv'), 'tv');
  assert.equal(modeOf('?configure=1'), 'presenter');
  assert.equal(modeOf(''), 'presenter');
});

test('ARCHIVED 2026-11-09: the page is a static note: no script, no call, nothing from another host', () => {
  assert.match(page, /<meta name="robots" content="noindex, nofollow">/);
  assert.ok(!/(src|href)="https?:\/\//i.test(page), 'no absolute asset URL');
  assert.ok(!/<script/i.test(page), 'no script at all');
  assert.ok(!/\/v1\/|\/api\/|app\.js/.test(page), 'no call to the sync service, app.js never loaded');
  assert.match(page, /The presentation is over/);
});

test('passphrase v2 only; the key stays in memory; the deck is opened here', () => {
  assert.match(app, /signInWithPassphrase/);
  assert.match(app, /unwrapPrivateKey\(key\.wrapped, typed, key\.pub\)/);
  assert.match(app, /openDocument\(ring, wire\)/);
  assert.match(app, /'awanaSyncSession\.v1'/);
  // notes are written only where notesHere says so
  assert.match(app, /\$\('notes-wrap'\)\.hidden = !notesOn;\n  if \(notesOn\) \{/);
  // nothing but the session and the slide number goes to localStorage: never the passphrase, the key or the deck
  for (const m of app.matchAll(/store\.set\(([^,]+),/g)) assert.ok(['SESSION_KEY', 'SLIDE_KEY'].includes(m[1]), m[1]);
  assert.ok(!/sessionStorage/.test(app));
  // The lobby computer only (owner 2026-11-08: "stop asking for the passcode after you've already asked"):
  // the non-extractable key kept in the KVBC Awana app's own IndexedDB; Lock and a passphrase change forget it.
  assert.match(app, /const IN_APP = \/\\bElectron\\\/\/\.test\(navigator\.userAgent\);/);
  assert.match(app, /async run\(fn\) \{\n    if \(!IN_APP\) return null;/);
  assert.equal((app.match(/indexedDB\./g) || []).length, 1, 'IndexedDB is opened in one place, behind IN_APP');
  assert.match(app, /await savedKey\.put\(priv, key\.pub\);/);
  assert.match(app, /function lock\(\) \{\n  ring = null;\n  savedKey\.forget\(\);/);
  assert.match(app, /function signedOut\(words\) \{\n  closeLive\(\);\n  savedKey\.forget\(\);/);
  assert.ok(!/console\.(log|info)/.test(app), 'logs nothing');
});

test('the build ships the page with its two sign-in modules', () => {
  assert.match(build, /for \(const f of \['index\.html', 'app\.js', 'logic\.js'\]\) cpSync\(path\.join\(ROOT, 'site', 'presentation', f\)/);
  assert.match(build, /for \(const f of \['sync-protocol\.js', 'cloud-crypto\.js'\]\) cpSync\(path\.join\(ROOT, 'shared', f\), path\.join\(out, 'shared', f\)\)/);
});

test('the slide is pushed: the page listens for the doorbell and only polls slowly while it can hear it (2026-11-03)', () => {
  // Polling every 0.8 s around the clock used up the account's free daily requests.
  assert.match(app, /\/v1\/live\?session=/);
  assert.match(app, /f\?\.d\?\.what === 'presentation'/);
  const t = /livePollMs: (\d[\d *]*)/.exec(app);
  assert.ok(t && eval(t[1]) >= 60 * 1000, 'the safety-net poll is a minute or more');
  assert.match(app, /liveOpen \? tuning\.livePollMs : document\.hidden \? tuning\.hiddenPollMs/, 'a hidden TV slows down too');
});

test('it follows other devices Sunday 5-9 PM Eastern only, and makes no calls outside it (owner 2026-11-03)', () => {
  const et = (iso) => new Date(iso);   // UTC instants; EST is UTC-5 in November, EDT UTC-4 in October
  assert.equal(followingNow(et('2026-11-15T22:00:00Z')), true, 'Sunday 5:00 PM EST');
  assert.equal(followingNow(et('2026-11-16T01:59:00Z')), true, 'Sunday 8:59 PM EST');
  assert.equal(followingNow(et('2026-11-16T02:00:00Z')), false, 'Sunday 9:00 PM EST');
  assert.equal(followingNow(et('2026-11-15T21:59:00Z')), false, 'Sunday 4:59 PM EST');
  assert.equal(followingNow(et('2026-11-04T23:00:00Z')), false, 'Wednesday 6 PM');
  assert.equal(followingNow(et('2026-10-25T21:30:00Z')), true, 'Sunday 5:30 PM EDT');
  assert.equal(msToNextEdge(et('2026-11-15T21:30:00Z')), 30 * 60 * 1000, 'opens in half an hour');
  assert.equal(msToNextEdge(et('2026-11-15T23:00:00Z')), 60 * 60 * 1000, 'never sleeps more than an hour');
  assert.match(app, /if \(!followingNow\(\)\) \{ closeLive\(\);/, 'the poll stops and the socket closes outside it');
  assert.match(app, /!session\(\) \|\| !followingNow\(\)\) return;/, 'a press outside it is not sent');
  assert.match(app, /liveSock \|\| !session\(\) \|\| !followingNow\(\)/, 'no socket outside it');
});

test('today only (owner 2026-11-08): it also follows 4-7 PM Eastern on 2026-11-08', () => {
  const et = (iso) => new Date(iso);
  assert.equal(followingNow(et('2026-11-08T20:59:00Z')), false, '3:59 PM');
  assert.equal(followingNow(et('2026-11-08T21:00:00Z')), true, '4:00 PM');
  assert.equal(followingNow(et('2026-11-08T21:59:00Z')), true, '4:59 PM (the extra window)');
  assert.equal(followingNow(et('2026-11-09T01:59:00Z')), true, '8:59 PM (the Sunday window still)');
  assert.equal(followingNow(et('2026-11-15T21:30:00Z')), false, 'next Sunday 4:30 PM: not again');
  assert.equal(msToNextEdge(et('2026-11-08T20:30:00Z')), 30 * 60 * 1000, 'opens at 4');
});


test('"Show on lobby computer" (owner 2026-11-08): the lobby-named computer, else a pick; one action, at any time', () => {
  const list = [
    { id: 'tv1', kind: 'lobby', name: 'Lobby TV', online: true },
    { id: 'pc1', kind: 'computer', name: 'Check-in laptop', online: true },
    { id: 'pc2', kind: 'computer', name: 'Lobby computer', online: false },
  ];
  const t = lobbyTargets(list);
  assert.deepEqual(t.pick, { id: 'pc2', name: 'Lobby computer', online: false });
  assert.deepEqual(t.choices.map((c) => c.id), ['pc2', 'pc1'], 'computers only, the lobby one first');
  assert.equal(lobbyTargets([...list, { id: 'pc3', kind: 'computer', name: 'lobby 2' }]).pick, null, 'two lobby computers: the presenter picks');
  assert.deepEqual(lobbyTargets(null), { pick: null, choices: [] });
  assert.match(pushWords({ ok: true, status: 200 }, 'Lobby computer'), /^Sent: Lobby computer switches to the slideshow/);
  assert.match(pushWords({ ok: false, status: 401 }, 'x'), /Signed out/);
  assert.match(pushWords({ ok: false, status: 0 }, 'x'), /Could not reach/);
  assert.match(app, /\/v1\/screens\/\$\{encodeURIComponent\(t\.id\)\}\/action`, \{ method: 'POST', body: \{ action: 'show-presentation' \} \}/);
  assert.doesNotMatch(app.slice(app.indexOf('async function pushLobby'), app.indexOf('// ── start')), /followingNow|store\.set/,
    'a press at any time, and nothing of it goes to storage');
});
