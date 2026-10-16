// /logo: the unlisted logo sheet (site/logo/index.html). It asks search engines to skip it,
// fetches nothing from another host, takes its fonts from the brand kit, and its download and
// copy links point at real kit files (the currentColor file for Copy, ink and white for downloads).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.dirname(SITE);
const LOGOS = path.join(ROOT, 'shared', 'brand', 'logos');
const page = readFileSync(path.join(SITE, 'logo', 'index.html'), 'utf8');
const links = readFileSync(path.join(SITE, 'links', 'index.html'), 'utf8');

const hrefs = [...page.matchAll(/<a\b[^>]*\bhref="([^"]*)"/gi)].map((m) => m[1]);
const copies = [...page.matchAll(/data-copy="([^"]*)"/g)].map((m) => m[1]);

test('the page asks search engines to skip it and has a title', () => {
  assert.match(page, /<meta name="robots" content="noindex,nofollow">/);
  assert.match(page, /<title>KVBC Awana Logo<\/title>/);
  assert.match(page, /<html lang="en">/);
  assert.match(page, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
});

test('no external hosts, no Google fonts, no remote script', () => {
  assert.ok(!/https?:\/\//i.test(page), 'no absolute URL');
  assert.ok(!/\/\/[a-z0-9-]+\.[a-z]{2,}/i.test(page), 'no protocol-relative URL');
  assert.ok(!page.includes('googleapis'), 'no Google Fonts');
  assert.ok(!/<script[^>]*\bsrc=/i.test(page), 'no external script');
  assert.equal([...page.matchAll(/<script\b/gi)].length, 1, 'one inline script');
});

test('the fonts come from the brand kit', () => {
  assert.match(page, /<link rel="stylesheet" href="\/lobby\/shared\/brand\/fonts\.css">/);
  assert.ok(existsSync(path.join(ROOT, 'shared', 'brand', 'fonts.css')));
});

test('every download link is a kit file that exists, and the sheet has ink and white for each version', () => {
  const downloads = hrefs.filter((h) => h.endsWith('.svg'));
  assert.equal(downloads.length, 6, 'ink and white for three versions');
  for (const href of downloads) {
    assert.ok(href.startsWith('/lobby/shared/brand/logos/'), `${href} is outside the kit`);
    assert.ok(existsSync(path.join(LOGOS, path.basename(href))), `${href} is not a kit file`);
    assert.match(href, /-(ink|white)\.svg$/, `${href} is not an ink or white file`);
  }
  assert.equal(new Set(downloads).size, 6, 'no duplicate links');
  for (const href of hrefs.filter((h) => !h.endsWith('.svg'))) {
    assert.fail(`${href} is not a download link`);
  }
});

test('each Copy button names a currentColor kit file', () => {
  assert.equal(copies.length, 3, 'one Copy button per version');
  for (const file of copies) {
    assert.ok(file.startsWith('/lobby/shared/brand/logos/'), `${file} is outside the kit`);
    const local = path.join(LOGOS, path.basename(file));
    assert.ok(existsSync(local), `${file} is not a kit file`);
    assert.match(path.basename(file), /^kvbc-awana-(full|two-line|stacked)\.svg$/, `${file} is not a currentColor file`);
    assert.match(readFileSync(local, 'utf8'), /currentColor/, `${file} does not paint in currentColor`);
  }
});

test('every logo on the sheet carries the church name', () => {
  // The "Don't" examples are aria-hidden on purpose: their caption says what is wrong.
  const logos = [...page.matchAll(/<svg class="logo"[^>]*>/g)].map((m) => m[0]).filter((t) => !t.includes('aria-hidden'));
  assert.ok(logos.length >= 10, 'the sheet shows the logo many times');
  for (const tag of logos) {
    assert.match(tag, /role="img" aria-label="Kennebec Valley Baptist Church Awana Clubs"/, tag.slice(0, 120));
  }
});

test('the motion demo keeps its three groups and respects reduced motion', () => {
  for (const cls of ['kvbc-church', 'kvbc-awana', 'kvbc-tagline']) {
    assert.ok(page.includes(`class="${cls}"`), `${cls} group`);
  }
  assert.match(page, /@media \(prefers-reduced-motion: reduce\)/);
  assert.ok(page.includes('id="replay"'), 'replay button');
});

test('the page has no em dashes', () => {
  assert.ok(!page.includes('—'), 'no em dash');
});

test('the links page links to the logo page, once', () => {
  const count = links.split('href="/logo/"').length - 1;
  assert.equal(count, 1);
});

test('the kit folder exists for the logo files the sheet uses', () => {
  assert.ok(readdirSync(LOGOS).some((f) => f === 'kvbc-awana-full.svg'));
});
