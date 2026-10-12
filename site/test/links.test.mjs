// /links: the unlisted volunteer page (site/links/index.html). It links to every page
// the volunteers need and nothing else, carries no script, and asks search engines to skip it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const page = readFileSync(path.join(SITE, 'links', 'index.html'), 'utf8');

const ALLOWED = [
  '/checkin', '/checkin/ym',
  '/lobby/', '/lobby/countdown', '/journey/',
  '/settings',
  '/download/kvbc-awana', '/chrome-extension.zip', '/help', '/capabilities.html', '/release-notes/printer.md',
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

test('each of the 12 listed pages is linked exactly once', () => {
  assert.equal(hrefs.length, ALLOWED.length);
  assert.deepEqual([...hrefs].sort(), [...ALLOWED].sort());
});

test('no external hosts and no script', () => {
  assert.ok(!page.includes('https://'), 'no https:// URL');
  assert.ok(!page.includes('googleapis'), 'no Google Fonts');
  assert.ok(!/<script/i.test(page), 'no <script');
});
