// Club email (owner 2026-11-13; site/tools/email/, worker/src/routes.md 10.19): the
// page's pure rules, and what the page must never do.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hasWords, parseMessage, pictureLine, previewHtml, problemWords, recipientWords, sizeWords, stepRetryable, totalWords,
} from '../tools/email/logic.js';
import { cleanBlocks } from '../../worker/src/clubmail.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'email');
const html = readFileSync(path.join(DIR, 'index.html'), 'utf8');
const app = readFileSync(path.join(DIR, 'app.js'), 'utf8');

test('the typed message becomes paragraphs, a heading, a list and placed pictures', () => {
  const files = [{ name: 'flyer.pdf', inline: false }, { name: 'Boxes.jpg', inline: true }, { name: 'late.png', inline: true }];
  const blocks = parseMessage('# Shoeboxes\n\nBring one Wednesday.\nThanks!\n\n- cars\n- crayons\n\n[picture: boxes.jpg]\nSee you there.\n\n[picture: missing.jpg]', files);
  assert.deepEqual(blocks, [
    { t: 'h', text: 'Shoeboxes' },
    { t: 'p', text: 'Bring one Wednesday.\nThanks!' },
    { t: 'ul', items: ['cars', 'crayons'] },
    { t: 'img', file: 1 },
    { t: 'p', text: 'See you there.' },
    { t: 'p', text: '[picture: missing.jpg]' },
    { t: 'img', file: 2 },   // a picture nobody placed goes at the end
  ]);
  // The Worker keeps every block the page makes (its own cleaning agrees).
  assert.deepEqual(cleanBlocks(blocks, files.length), blocks);
  assert.equal(pictureLine('a.jpg'), '[picture: a.jpg]');
  assert.equal(hasWords(parseMessage('[picture: late.png]', files)), false);
  assert.equal(hasWords(parseMessage('', [])), false);
});

test('the preview never runs a director\'s markup', () => {
  const out = previewHtml(parseMessage('<img src=x onerror=alert(1)> https://example.org/a.', []), [], { sender: 'Dana <b>', club: 'Sparks' });
  assert.ok(!out.includes('<img'));
  assert.ok(out.includes('&lt;img src=x'));
  assert.ok(out.includes('<a href="https://example.org/a">https://example.org/a</a>.'));
  assert.ok(out.includes('Sent by Dana &lt;b&gt; for Sparks'));
});

test('the words for who it goes to, sizes and problems', () => {
  assert.equal(recipientWords({ name: 'Sparks', addresses: 41, kids: 46, kidsWithoutEmail: 3 }), 'Goes to 41 parent addresses for 46 Sparks children. 3 children have no email on file, so their family will not get it.');
  assert.equal(recipientWords({ name: 'Trek', addresses: 1, kids: 1, kidsWithoutEmail: 0 }), 'Goes to 1 parent address for 1 Trek child.');
  assert.equal(recipientWords({ name: 'Puggles', addresses: 0, kids: 2, kidsWithoutEmail: 2 }), 'TwoTimTwo has no parent email address for Puggles.');
  assert.equal(sizeWords(300 * 1024), '300 KB');
  assert.equal(sizeWords(1.5 * 1048576), '1.5 MB');
  assert.deepEqual(totalWords([{ size: 1048576 }, { size: 1048576 }], 18 * 1048576), { total: 2097152, over: false, words: '2.0 MB of 18 MB' });
  assert.equal(totalWords([{ size: 19 * 1048576 }], 18 * 1048576).over, true);
  assert.match(problemWords({ status: 503, body: { reason: 'not-configured' } }), /not set up yet/);
  assert.equal(problemWords({ status: 409, body: { error: 'That email was already sent.' } }), 'That email was already sent.');
  assert.equal(stepRetryable({ status: 0, body: null }), true);
  assert.equal(stepRetryable({ status: 503, body: { reason: 'read-busy' } }), true);
  assert.equal(stepRetryable({ status: 502, body: { reason: 'graph-auth' } }), false);
  assert.equal(stepRetryable({ status: 409, body: { reason: 'sent' } }), false);
});

test('the page is unlisted and loads nothing from another host', () => {
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(urls.length > 3);
  for (const u of urls) assert.ok(u.startsWith('/') || u.startsWith('./'), u);
});

test('the page keeps no code, passphrase or address where it should not', () => {
  // The owner's code and the passphrase live in memory only.
  assert.ok(!/store\.set\([^)]*(?:ownerCode|passphrase|typed)/.test(app));
  assert.ok(!/(?:local|session)Storage\.setItem\([^)]*owner/i.test(app));
  // The only things saved: the director's token and the unsent draft's words.
  const saved = [...app.matchAll(/store\.set\((\w+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(saved)].sort(), ['DRAFT_KEY', 'TOKEN_KEY']);
  // The message is built by the Worker from blocks: the page sends no HTML.
  assert.ok(!/body:\s*\{[^}]*html/.test(app));
  // A send with no answer is never asked for again by the page.
  assert.match(app, /stage === 'unknown'[\s\S]{0,200}running = null/);
});
