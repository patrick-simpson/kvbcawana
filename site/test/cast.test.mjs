// /cast (site/cast/, owner 2026-11-08; worker/src/routes.md 10.18): the lobby computer's
// AirServer-like screen. A presenter types the TV's code (no passphrase) and puts things
// up; the TV page opens the room and shows them. The words and choices are pure
// (logic.js); the rest is pinned by source: the token stays in this tab, every presenter
// call carries it, the TV closes its room on pagehide (never in configure mode), and the
// pages wear the CHURCH's look, never Awana's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../../shared/classroomRemote.js';
import {
  TOKEN_KEY, captureWords, cleanCode, clock, codeReady, errorWords, filePress, fileProblem, formatCode,
  joinWords, linkToCopy, placeholderId, shareWords, size, textPress, titleFromName, tvWords, videoPress,
  SLIDES_ACCEPT, convertWords, isPresentation, slideView, slidesChoice,
  codeFromHash, facebookPress, resultPress,
} from '../cast/logic.js';

const SITE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (...p) => readFileSync(path.join(SITE, ...p), 'utf8');
const page = read('cast', 'index.html');
const app = read('cast', 'app.js');
const screenPage = read('cast', 'screen', 'index.html');
const screen = read('cast', 'screen', 'screen.js');
const css = read('cast', 'church', 'church.css');
const build = read('build.mjs');
const previewJs = read('cast', 'preview.js');

test('the code: digits only, six of them, shown as two groups of three', () => {
  assert.equal(cleanCode('482 913'), '482913');
  assert.equal(cleanCode(' 482-913 extra 7'), '482913');
  assert.equal(cleanCode(42), '');
  assert.ok(codeReady('482913'));
  assert.ok(!codeReady('48291'));
  assert.ok(!codeReady('082913'), 'the Worker never makes a code starting with 0');
  assert.equal(formatCode('482913'), '482 913');
  assert.equal(formatCode('48'), '48');
  assert.equal(formatCode('4829'), '482 9');
});

test('a placeholder id matches the shared rules (the Worker gives the real one)', () => {
  for (let i = 0; i < 20; i += 1) assert.ok(R.isButtonId(placeholderId()));
});

test('a YouTube link becomes an item press the shared rules accept', () => {
  const out = videoPress({ link: 'https://youtu.be/dQw4w9WgXcQ?t=1m30s', title: '  Welcome   video ' }, R);
  assert.ok(out.ok);
  assert.equal(out.press.action, 'item');
  assert.deepEqual({ ...out.press.data.item, id: 'x' }, { id: 'x', kind: 'video', youtube: 'dQw4w9WgXcQ', start: 90, title: 'Welcome video' });
  assert.equal(videoPress({ link: 'https://youtu.be/dQw4w9WgXcQ' }, R).press.data.item.title, 'YouTube video');
  const bad = videoPress({ link: 'https://vimeo.com/123' }, R);
  assert.ok(!bad.ok);
  assert.match(bad.error, /YouTube link/);
});

test('text: heading, up to eight lines, a look; empty or too long says why', () => {
  const out = textPress({ heading: 'Welcome', text: 'Line one\nLine two', look: 'board' }, R);
  assert.ok(out.ok);
  assert.deepEqual({ ...out.press.data.item, id: 'x' }, { id: 'x', kind: 'text', title: 'Welcome', text: 'Line one\nLine two', heading: 'Welcome', look: 'board' });
  assert.equal(textPress({ text: 'Hello' }, R).press.data.item.look, 'page');
  assert.equal(textPress({ text: 'Hello', look: 'neon' }, R).press.data.item.look, 'page');
  assert.match(textPress({ text: '   ' }, R).error, /Type something/);
  assert.match(textPress({ text: '1\n2\n3\n4\n5\n6\n7\n8\n9' }, R).error, /Eight lines/);
  assert.match(textPress({ text: 'x'.repeat(401) }, R).error, /too long/);
});

test('a finished upload becomes a picture or slides press', () => {
  const pic = filePress({ id: 'fabcdefghijkl', type: 'image/png' }, 'Sunrise', R);
  assert.equal(pic.press.data.item.kind, 'image');
  assert.equal(pic.press.data.item.file, 'fabcdefghijkl');
  const doc = filePress({ id: 'fabcdefghijkl', type: 'application/pdf' }, '', R);
  assert.equal(doc.press.data.item.kind, 'pdf');
  assert.equal(doc.press.data.item.title, 'Slides');
  assert.ok(!filePress({ id: 'fabcdefghijkl', type: 'text/html' }, '', R).ok);
  assert.ok(!filePress({ id: 'not-a-file', type: 'image/png' }, '', R).ok);
});

test('which files may be sent, and links to copy', () => {
  assert.equal(fileProblem({ type: 'image/jpeg', size: 1000 }, 'image', R), '');
  assert.match(fileProblem({ type: 'application/pdf', size: 1000 }, 'image', R), /picture/);
  assert.match(fileProblem({ type: 'application/vnd.ms-powerpoint', size: 1000 }, 'pdf', R), /Save As, PDF/);
  assert.match(fileProblem({ type: 'application/pdf', size: 21 * 1024 * 1024 }, 'pdf', R), /20 MB/);
  const g = linkToCopy('https://docs.google.com/presentation/d/1AbCdEfGhIjKlMn/edit?usp=sharing', R);
  assert.deepEqual(g, { ok: true, url: 'https://docs.google.com/presentation/d/1AbCdEfGhIjKlMn/export/pdf', google: true });
  assert.ok(!linkToCopy('http://example.org/a.pdf', R).ok);
  assert.equal(titleFromName('Easter_service.slides.pdf'), 'Easter service.slides');
  assert.equal(size(2048), '2 KB');
  assert.equal(size(3 * 1024 * 1024), '3.0 MB');
  assert.equal(clock(95), '1:35');
});

test('refusals are one plain sentence, the Worker\'s own when it sent one', () => {
  assert.equal(joinWords(403, { error: 'That code is not the one on the TV. Check it and try again.' }), 'That code is not the one on the TV. Check it and try again.');
  assert.equal(joinWords(429, { error: 'Too many wrong codes. Wait a few minutes, then try again.' }), 'Too many wrong codes. Wait a few minutes, then try again.');
  assert.match(joinWords(429, null), /Too many/);
  assert.match(joinWords(0, null), /internet/);
  assert.match(errorWords(500, null), /did not work/);
  assert.match(captureWords({ name: 'NotAllowedError' }), /cancelled/);
  assert.equal(shareWords('connected'), 'Sharing. The TV shows what you see.');
  assert.equal(shareWords('failed', 'The TV did not answer.'), 'The TV did not answer.');
});

test('the "On the TV now" line', () => {
  assert.deepEqual(tvWords({ stage: R.sanitizeStage(null), now: null, screenOnline: true }), { main: 'Nothing yet. The TV is showing its code.', sub: '', online: true });
  assert.match(tvWords({ stage: R.sanitizeStage(null), now: null, screenOnline: false }).main, /not answering/);
  const stage = R.sanitizeStage({ rev: 3, show: { button: { id: 'babcdefgh', kind: 'video', youtube: 'dQw4w9WgXcQ', title: 'Welcome' }, at: 1, page: 1 } });
  const now = R.sanitizeClassroomNow({ view: 'video', button: 'babcdefgh', video: { t: 65, d: 200, paused: true, muted: false, volume: 70 } });
  assert.deepEqual(tvWords({ stage, now, screenOnline: true }), { main: 'On the TV now: a YouTube video: Welcome', sub: '1:05 of 3:20, paused, volume 70%', online: true });
  const pdf = R.sanitizeStage({ show: { button: { id: 'babcdefgh', kind: 'pdf', file: 'fabcdefghijkl', type: 'application/pdf', title: 'Sermon' }, at: 1, page: 2 } });
  assert.equal(tvWords({ stage: pdf, now: R.sanitizeClassroomNow({ view: 'pdf', button: 'babcdefgh', page: 2, pages: 9 }), screenOnline: true }).sub, 'Page 2 of 9');
  const share = R.sanitizeStage({ show: { button: { id: 'babcdefgh', kind: 'screen', title: 'Dan' }, at: 1 } });
  assert.equal(tvWords({ stage: share, now: null, screenOnline: true }).main, 'On the TV now: a shared screen');
});

test('the presenter\'s token lives in sessionStorage only, and every call carries it', () => {
  assert.equal(TOKEN_KEY, 'awanaCastToken.v1');
  assert.match(app, /sessionStorage\.getItem\(TOKEN_KEY\)/);
  assert.match(app, /sessionStorage\.setItem\(TOKEN_KEY/);
  assert.ok(!/localStorage\./.test(app), 'the presenter page never uses localStorage');
  assert.match(app, /headers\['X-Cast-Token'\] = token/);
  // One request function for every call, and a 401 drops the token.
  assert.equal((app.match(/fetch\(base \+/g) || []).length, 1);
  assert.match(app, /r\.status === 401 && path !== '\/v1\/cast\/join'\) disconnected/);
  assert.ok(!/Authorization/.test(app), 'a presenter never sends the church sign-in');
});

test('the presenter page polls only while visible, and stops after 30 minutes untouched', () => {
  assert.match(app, /pollMs: 2000/);
  assert.match(app, /idleMs: 30 \* 60 \* 1000/);
  assert.match(app, /if \(!tokenStore\.get\(\) \|\| document\.hidden\) return;/);
  assert.match(app, /getDisplayMedia\(\{ video: \{ frameRate: 30 \}, audio: true \}\)/);
  assert.match(app, /canShareScreen\(\)/);
});

test('the TV opens its room, closes it on pagehide, and does neither in configure mode', () => {
  assert.match(screen, /'\/v1\/cast\/open', \{ method: 'POST'/);
  assert.match(screen, /addEventListener\('pagehide'/);
  assert.match(screen, /\/v1\/cast\/close`, \{ method: 'POST', keepalive: true/);
  assert.match(screen, /localStorage\.getItem\(SESSION_KEY\)/);
  assert.match(screen, /Authorization: `Bearer \$\{s\}`/);
  assert.match(screen, /what === 'cast'/);
  assert.match(screen, /youtube-nocookie\.com/);
  assert.match(screen, /pdf\.js\/3\.11\.174\//);
  assert.match(screen, /'\/v1\/cast\/screen\/now'/);
  // Configure mode (KVBC Awana's Settings window): a note, then return before anything opens.
  const start = screen.slice(screen.indexOf('async function start()'));
  const cfg = start.slice(0, start.indexOf('drawCode();'));
  assert.match(cfg, /if \(CONFIGURE\) \{[\s\S]*Cast is on\.[\s\S]*return;\s*\}/);
  assert.ok(!/openRoom|openLive|pagehide/.test(cfg));
  assert.ok(start.indexOf('if (CONFIGURE)') < start.indexOf('openRoom()'));
  assert.ok(start.indexOf('if (CONFIGURE)') < start.indexOf("addEventListener('pagehide'"));
  // No ICE servers anywhere (the TV answers with its real local address).
  assert.ok(!/iceServers|stun:|turn:/.test(screen + app));
});

test('the church\'s look, never Awana\'s', () => {
  for (const f of ['kvbc-logo.png', 'kvbc-logo-white.png', 'fonts/Jost-Variable.ttf', 'fonts/Almarai-Regular.ttf', 'fonts/Almarai-Bold.ttf', 'fonts/OFL-Jost.txt', 'fonts/OFL-Almarai.txt']) {
    assert.ok(existsSync(path.join(SITE, 'cast', 'church', f)), f);
  }
  assert.match(css, /--green: #344F3D/);
  assert.match(css, /font-family: 'Jost'/);
  for (const src of [page, screenPage, app, screen, css]) {
    assert.ok(!/shared\/brand|brand\/tokens|Paytone|Londrina|fonts\.googleapis|fonts\.gstatic/.test(src));
    assert.ok(!/-gradient\(|blur\(|box-shadow/.test(src), 'flat: no gradients or blur');
  }
  // "Awana" may appear only inside the address awana.kvbchurch.org and internal names.
  const visible = (html) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/awana\.kvbchurch\.org/gi, '');
  assert.ok(!/awana/i.test(visible(page)));
  assert.ok(!/awana/i.test(visible(screenPage)));
  const quoted = (js) => (js.match(/'[^'\n]*'|`[^`\n]*`/g) || []).filter((s) => /\s/.test(s)).join('\n').replace(/awana\.kvbchurch\.org/gi, '').replace(/KVBC Awana/g, '');
  assert.ok(!/awana/i.test(quoted(app)), 'no "Awana" in the presenter page\'s words');
  assert.ok(!/awana/i.test(quoted(screen)), 'no "Awana" on the TV but the app\'s own name');
});

test('the build copies both pages, the church kit and the shared modules', () => {
  assert.match(build, /path\.join\(OUT, 'cast'\)/);
  assert.match(build, /\['classroomRemote\.js', 'screenShare\.js'\]/);
  for (const f of ['cast/index.html', 'cast/screen/index.html', 'cast/screen/screen.js', 'cast/shared/screenShare.js', 'cast/church/church.css']) assert.ok(build.includes(`'${f}'`), f);
});

// PowerPoint (owner 2026-11-08: "Support pptx upload and show a preview on the phone
// screen", the exact copy; current + next on the phone).
test('a PowerPoint is turned into slides; a PDF goes as it is; anything else says why', () => {
  assert.equal(isPresentation({ name: 'Easter.PPTX', type: '' }), true);
  assert.equal(isPresentation({ name: 'x', type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }), true);
  assert.equal(isPresentation({ name: 'old.ppt', type: '' }), true);
  assert.equal(isPresentation({ name: 'a.pdf', type: 'application/pdf' }), false);
  assert.deepEqual(slidesChoice({ name: 'a.pptx', type: '', size: 1000 }, R), { ok: true, kind: 'pptx' });
  assert.deepEqual(slidesChoice({ name: 'a.pdf', type: 'application/pdf', size: 1000 }, R), { ok: true, kind: 'pdf' });
  assert.match(slidesChoice({ name: 'a.pptx', type: '', size: 41 * 1024 * 1024 }, R).error, /40 MB at most/);
  assert.match(slidesChoice({ name: 'a.docx', type: 'application/msword', size: 10 }, R).error, /PDF or a PowerPoint/);
  assert.match(SLIDES_ACCEPT, /\.pptx/);
  assert.match(SLIDES_ACCEPT, /application\/pdf/);
});

test('the PowerPoint\'s progress and failures in plain words', () => {
  assert.match(convertWords('converting', '', 0), /about a minute\.$/);
  assert.match(convertWords('converting', '', 70), /\(1:10\)/);
  assert.match(convertWords('converting', '', 200), /GitHub may be busy/);
  assert.match(convertWords('failed', 'type'), /not a PowerPoint/);
  assert.match(convertWords('failed', 'too-big'), /20 MB/);
  assert.match(convertWords('failed', 'whatever'), /Save it as a PDF/);
  assert.equal(convertWords('done'), '');
});

test('the preview: this slide, the next, none past the last', () => {
  assert.deepEqual(slideView(3, 12), { now: 3, next: 4, label: 'Slide 3 of 12', first: false, last: false });
  assert.deepEqual(slideView(12, 12), { now: 12, next: 0, label: 'Slide 12 of 12', first: false, last: true });
  assert.deepEqual(slideView(40, 12).now, 12);
  assert.deepEqual(slideView(0, 0), { now: 1, next: 2, label: 'Slide 1', first: true, last: false });
});

test('a PowerPoint is scrambled in the browser before it leaves; the preview reads the room\'s file with the token', () => {
  assert.match(app, /crypto\.subtle\.encrypt\(\{ name: 'AES-GCM', iv \}/);
  assert.match(app, /'\/v1\/cast\/convert', \{ method: 'POST', body: \{ bytes: bytes\.length/);
  assert.match(app, /\/v1\/cast\/convert\/\$\{id\}\/start`, \{ method: 'POST', body: \{ key \}/);
  assert.match(app, /\/v1\/cast\/files\/\$\{encodeURIComponent\(id\)\}`, \{ headers: \{ 'X-Cast-Token': tokenStore\.get\(\) \}/);
  // A slide in the strip is a press straight to it; Back/Next step.
  assert.match(app, /press\('page', \{ to \}/);
  assert.match(app, /press\('page', \{ step \}/);
  assert.equal(R.sanitizeClassroomPress('page', { to: 5 }).data.to, 5);
  // pdf.js from cdnjs, the TV's version; strip thumbnails drawn only when seen.
  assert.match(previewJs, /cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js\/3\.11\.174\//);
  assert.match(screen, /pdf\.js\/3\.11\.174/);
  assert.match(previewJs, /new IntersectionObserver/);
  assert.match(page, /data-slide="now"/);
  assert.match(page, /data-slide="next"/);
  assert.match(page, /data-slide-strip/);
  assert.match(build, /'preview\.js'/);
});

// Owner 2026-11-08, later: one phone at a time, Display code, the TV's QR (and the
// KVBC_Guest note), YouTube search, Facebook videos, video files.
test('the QR link carries the code in the fragment; the page connects with it and cleans the address', () => {
  assert.equal(codeFromHash('#code=123456'), '123456');
  assert.equal(codeFromHash('#x=1&code=654321'), '654321');
  assert.equal(codeFromHash('#code=012345'), '');
  assert.equal(codeFromHash(''), '');
  assert.match(screen, /\/cast\/#code=\$\{d\}/);
  assert.match(app, /codeFromHash\(location\.hash\)/);
  assert.match(app, /history\.replaceState\(null, '', location\.pathname \+ location\.search\)/);
  assert.match(screen, /cdnjs\.cloudflare\.com\/ajax\/libs\/qrcode-generator\/1\.4\.4\//);
  assert.match(screenPage, /id="qr"/);
});

test('the TV and the share step say a laptop joins KVBC_Guest first', () => {
  assert.match(screenPage, /Join the <b>KVBC_Guest<\/b> Wi-Fi first/);
  assert.match(page, /Join the KVBC_Guest Wi-Fi first/);
});

test('Disconnect frees the room; Display code also puts the TV back to its code', () => {
  assert.match(app, /'\/v1\/cast\/leave', \{ method: 'POST', body: takeDown \? \{ takeDown: true \} : \{\} \}/);
  assert.match(page, /id="btn-code">Display code</);
  assert.match(app, /\$\('btn-code'\)\.addEventListener\('click', \(\) => leave\(true\)\)/);
});

test('YouTube search results, Facebook links and video files become presses the shared rules accept', () => {
  assert.equal(resultPress({ youtube: 'dQw4w9WgXcQ', title: 'Song' }, R).press.data.item.youtube, 'dQw4w9WgXcQ');
  assert.equal(facebookPress({ link: 'https://www.facebook.com/kvbchurch/videos/1234567890/' }, R).press.data.item.kind, 'facebook');
  assert.match(facebookPress({ link: 'https://example.org/v' }, R).error, /Copy link/);
  assert.equal(fileProblem({ type: 'video/mp4', size: 5 }, 'clip', R), '');
  assert.match(fileProblem({ type: 'video/mp4', size: 201 * 1024 * 1024 }, 'clip', R), /200 MB/);
  assert.match(fileProblem({ type: 'image/png', size: 5 }, 'clip', R), /Choose a video/);
  assert.equal(filePress({ id: 'fabcdefghijkl', type: 'video/mp4' }, 'Skit', R).press.data.item.kind, 'clip');
  assert.match(app, /\/v1\/cast\/youtube\?q=\$\{encodeURIComponent\(q\)\}/);
  // The TV: one set of controls for YouTube, clips and Facebook; each takes itself down at its end.
  assert.match(screen, /connect\.facebook\.net\/en_US\/sdk\.js/);
  assert.match(screen, /subscribe\('finishedPlaying', \(\) => \{ playing = false; ended\(\); \}\)/);
  assert.match(screen, /v\.addEventListener\('ended', ended\)/);
  assert.match(screen, /R\.CLASSROOM_PLAYABLE_KINDS\.includes\(b\.kind\) && media/);
});
