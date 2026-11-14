// Club email (owner 2026-11-13; site/tools/email/, worker/src/routes.md 10.19): the
// page's pure rules, and what the page must never do.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  blocksToText, boldEdit, bounceWords, cleanLink, hasWords, laterTime, secretWords, inlineHtml, linesEdit, linkEdit, parseMessage, pictureLine, previewHtml, problemWords, recipientWords, sizeWords, stepRetryable, totalWords,
} from '../tools/email/logic.js';
import { cleanBlocks, linked } from '../../worker/src/clubmail.js';

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

test('bold and links: the preview and the real email follow one rule', () => {
  const samples = [
    'Bring **one shoebox** on Wednesday.',
    'Sign up at [the church site](https://example.org/sign-up?a=1&b=2), please.',
    'See https://example.org/list. Or **https://example.org/b**',
    'A [**bold** link](https://example.org/x) and 2 * 3 ** 4 stars',
    '<b>not markup</b> [x](javascript:alert(1)) **<i>**',
    'line one\n**line two**',
  ];
  // The Worker's copy only adds the link colour.
  for (const s of samples) assert.equal(linked(s).replaceAll(' style="color:#0B5CAD"', ''), inlineHtml(s), s);
  assert.equal(inlineHtml(samples[0]), 'Bring <b>one shoebox</b> on Wednesday.');
  assert.equal(inlineHtml(samples[1]), 'Sign up at <a href="https://example.org/sign-up?a=1&amp;b=2">the church site</a>, please.');
  assert.equal(inlineHtml(samples[2]), 'See <a href="https://example.org/list">https://example.org/list</a>. Or <b><a href="https://example.org/b">https://example.org/b</a></b>');
  assert.equal(inlineHtml(samples[3]), 'A <a href="https://example.org/x"><b>bold</b> link</a> and 2 * 3 ** 4 stars');
  const unsafe = inlineHtml(samples[4]);
  assert.ok(!unsafe.includes('<a') && !unsafe.includes('<i>') && unsafe.includes('&lt;b&gt;not markup'));
  assert.equal(inlineHtml(samples[5]), 'line one<br><b>line two</b>');
});

test('a sent message comes back as the text that makes it', () => {
  const blocks = [{ t: 'h', text: 'Shoeboxes' }, { t: 'p', text: 'Bring **one**.\nThanks!' }, { t: 'ul', items: ['cars', 'crayons'] }, { t: 'p', text: 'See you there.' }];
  const text = blocksToText([...blocks, { t: 'img', file: 0 }]);
  assert.equal(text, '# Shoeboxes\n\nBring **one**.\nThanks!\n\n- cars\n- crayons\n\nSee you there.');
  assert.deepEqual(parseMessage(text, []), blocks);
  assert.equal(blocksToText(null), '');
  assert.equal(bounceWords(2, 'awana@kvbchurch.org'), '2 came back undelivered (see the awana@kvbchurch.org inbox)');
  assert.equal(bounceWords(0, 'x'), '');
  assert.equal(bounceWords(null, 'x'), '');
});

test('send later takes a time from five minutes to four weeks off', () => {
  const now = new Date(2026, 10, 14, 12, 0).getTime();
  assert.deepEqual(laterTime('2026-11-18T09:00', now), { at: new Date(2026, 10, 18, 9, 0).getTime(), problem: '' });
  assert.match(laterTime('', now).problem, /Pick a day and time/);
  assert.match(laterTime('2026-11-14T12:03', now).problem, /five minutes/);
  assert.match(laterTime('2026-11-13T09:00', now).problem, /five minutes/);
  assert.match(laterTime('2027-02-01T09:00', now).problem, /four weeks/);
});

test('the owner is told when the Microsoft secret is about to end', () => {
  assert.equal(secretWords(null), '');
  assert.equal(secretWords(undefined), '');
  assert.match(secretWords(18), /ends in 18 days\. After that nobody can send\./);
  assert.match(secretWords(1), /ends in 1 day\./);
  assert.match(secretWords(0), /ends today\./);
  assert.match(secretWords(-3), /^Sending has stopped/);
});

test('the formatting buttons edit the typed text', () => {
  assert.deepEqual(boldEdit('Bring a box today', 8, 11), { value: 'Bring a **box** today', start: 10, end: 13 });
  assert.deepEqual(boldEdit('Hi ', 3, 3), { value: 'Hi **bold words**', start: 5, end: 15 });
  assert.deepEqual(boldEdit('a word here', 1, 7), { value: 'a **word** here', start: 4, end: 8 });   // spaces stay outside
  const h = linesEdit('Hello there\nShoeboxes\nBring one.', 14, 14, 'heading');
  assert.equal(h.value, 'Hello there\n\n# Shoeboxes\n\nBring one.');
  assert.equal(h.value.slice(h.start, h.end), 'Shoeboxes');
  assert.deepEqual(parseMessage(h.value, []), [{ t: 'p', text: 'Hello there' }, { t: 'h', text: 'Shoeboxes' }, { t: 'p', text: 'Bring one.' }]);
  const l = linesEdit('Bring:\ncars\n- crayons\nThanks', 7, 20, 'list');
  assert.equal(l.value, 'Bring:\n\n- cars\n- crayons\n\nThanks');
  assert.deepEqual(parseMessage(l.value, [])[1], { t: 'ul', items: ['cars', 'crayons'] });
  assert.equal(linesEdit('', 0, 0, 'list').value, '- First thing');
  assert.equal(linesEdit('', 0, 0, 'heading').value, '# Heading');
  assert.equal(cleanLink(' kvbchurch.org/alerts '), 'https://kvbchurch.org/alerts');
  assert.equal(cleanLink('http://example.org'), 'http://example.org');
  for (const bad of ['', 'https://', 'not a link', 'javascript:alert(1)', 'x"y.com', null]) assert.equal(cleanLink(bad), '', String(bad));
  assert.deepEqual(linkEdit('See the list now', 8, 12, 'https://example.org'), { value: 'See the [list](https://example.org) now', start: 9, end: 13 });
  assert.equal(linkEdit('Go ', 3, 3, 'https://example.org').value, 'Go [link words](https://example.org)');
});

test('the words for who it goes to, sizes and problems', () => {
  assert.equal(recipientWords({ name: 'Sparks', addresses: 41, kids: 46, kidsWithoutEmail: 3 }), 'Goes to 41 parent addresses for 46 Sparks children. 3 children have no email on file, so their family will not get it.');
  assert.equal(recipientWords({ name: 'Trek', addresses: 1, kids: 1, kidsWithoutEmail: 0 }), 'Goes to 1 parent address for 1 Trek child.');
  assert.equal(recipientWords({ name: 'Puggles', addresses: 0, kids: 2, kidsWithoutEmail: 2 }), 'TwoTimTwo has no parent email address for Puggles.');
  assert.equal(recipientWords({ club: 'all', name: 'all clubs', addresses: 120, kids: 140, kidsWithoutEmail: 0 }), 'Goes to 120 parent addresses for 140 children in all clubs.');
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
