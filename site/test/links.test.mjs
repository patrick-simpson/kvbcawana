// /links: the unlisted volunteer page (site/links/index.html). It links to every page
// the volunteers need and nothing else, carries no script, and asks search engines to skip it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const page = readFileSync(path.join(SITE, 'links', 'index.html'), 'utf8');

const ALLOWED = [
  '/checkin', '/checkin/ym',
  '/lobby/', '/lobby/countdown', '/journey/', '/journey/remote/',
  '/classroom/', '/classroom/remote/', // owner 2026-10-18: the Sparks remote is on the links page
  '/lobby/projector-remote.html', // the opening ceremony remote (phone: Next and Back for the projector's slides)
  '/lobby/scoreboard.html', // the game time scoreboard (phone: four teams' scores and the stopwatch on the projector)
  '/cast/', // owner 2026-11-08: Cast, present on the lobby TV with the code it shows
  '/settings', '/logo/',
  '/tools/print/', // owner 2026-10-28: the letterhead maker; renamed the Print tool 2026-11-05
  '/download/kvbc-awana', '/help', '/capabilities.html', '/release-notes/printer.md',
  '/',
];

const hrefs = [...page.matchAll(/<a\b[^>]*\bhref="([^"]*)"/gi)].map((m) => m[1]);

test('the page asks search engines to skip it', () => {
  assert.match(page, /<meta name="robots" content="noindex,nofollow">/);
});

test('every link is one of the listed pages: no extra links, no passphrase, query string or http', () => {
  assert.ok(hrefs.length > 0, 'the page has links');
  for (const href of hrefs) {
    assert.ok(href.startsWith('/'), `${href} is not a site-relative link`);
    assert.ok(ALLOWED.includes(href), `${href} is not in the allowed list`);
    assert.ok(!href.includes('passphrase'), `${href} names a passphrase`);
    assert.ok(!href.includes('?'), `${href} has a query string`);
    assert.ok(!href.includes('http'), `${href} is absolute`);
  }
});

test('each of the 18 listed pages is linked exactly once', () => {
  assert.equal(hrefs.length, ALLOWED.length);
  assert.deepEqual([...hrefs].sort(), [...ALLOWED].sort());
});

test('no external hosts and no script', () => {
  assert.ok(!page.includes('https://'), 'no https:// URL');
  assert.ok(!page.includes('googleapis'), 'no Google Fonts');
  assert.ok(!/<script/i.test(page), 'no <script');
});

test('the archived poster tally (owner 2026-11-05) is off the list and its page runs nothing', () => {
  assert.ok(!hrefs.includes('/tools/tally/'));
  const tally = readFileSync(path.join(SITE, 'tools', 'tally', 'index.html'), 'utf8');
  assert.doesNotMatch(tally, /<script|fetch\(|WebSocket|\/v1\//);
});

test('the page has its own icon (owner 2026-11-09: the chain link), and the build ships every file of it', () => {
  assert.match(page, /<link rel="icon" type="image\/svg\+xml" href="\/links\/icon\.svg">/);
  assert.match(page, /<link rel="apple-touch-icon" href="\/links\/icon-180\.png">/);
  const build = readFileSync(path.join(SITE, 'build.mjs'), 'utf8');
  for (const f of ['icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png']) {
    assert.ok(existsSync(path.join(SITE, 'links', f)), f);
    assert.ok(build.includes(`'${f}'`), `site/build.mjs copies ${f}`);
  }
});
