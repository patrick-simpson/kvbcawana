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
  joinWords, linkToCopy, placeholderId, shareWords, size, textPress, titleFromName, tvWords, videoPress, volumeWords,
  SLIDES_ACCEPT, convertWords, isPresentation, slideView, slidesChoice,
  codeFromHash, facebookPress, resultPress, CAST_HOME, presenterUrl, addressWords,
} from '../cast/logic.js';

const SITE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (...p) => readFileSync(path.join(SITE, ...p), 'utf8');
const page = read('cast', 'index.html');
// The presenter's page is app.js (its way in) + controls.js (what it can put up; shared
// with the lobby computer's desk since 2026-11-09): pinned together as one.
const app = `${read('cast', 'app.js')}\n${read('cast', 'controls.js')}`;
const appOwn = read('cast', 'app.js');
const controls = read('cast', 'controls.js');
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

test('the volume between the − and + buttons', () => {
  assert.equal(volumeWords({ muted: false, volume: 60 }), 'Volume 60%');
  assert.equal(volumeWords({ muted: true, volume: 60 }), 'Volume 60% · muted');
  assert.equal(volumeWords(null), 'Volume');
  // Both pages carry the level between the two buttons, and write it only when it changes.
  for (const page of [read('cast', 'index.html'), read('cast', 'desk', 'index.html')]) {
    assert.match(page, /data-step="-1"[^>]*>−<\/button>\s*<span class="vol-level" id="vol-level">Volume<\/span>\s*<button[^>]*data-step="1"[^>]*>\+<\/button>/);
  }
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
  // The desk heads the panel "On the TV now" itself: just what is up.
  assert.equal(tvWords({ stage: share, now: null, screenOnline: true }, { short: true }).main, 'A shared screen');
  assert.equal(tvWords({ stage, now, screenOnline: true }, { short: true }).main, 'A YouTube video: Welcome');
});

test('the presenter\'s token lives in sessionStorage only, and every call carries it', () => {
  assert.equal(TOKEN_KEY, 'awanaCastToken.v1');
  assert.match(app, /sessionStorage\.getItem\(TOKEN_KEY\)/);
  assert.match(app, /sessionStorage\.setItem\(TOKEN_KEY/);
  assert.ok(!/localStorage\./.test(app), 'the presenter page never uses localStorage');
  assert.match(app, /headers\['X-Cast-Token'\] = token/);
  // One request function for every call, and a 401 drops the token.
  assert.equal((app.match(/fetch\(base \+/g) || []).length, 1);
  assert.match(controls, /r\.status === 401 && path !== '\/v1\/cast\/join'\) conn\.refused\(/);
  assert.match(appOwn, /refused: \(words\) => disconnected\(words\),/);
  assert.match(appOwn, /path: \(p\) => p,/);
  assert.ok(!/Authorization/.test(app), 'a presenter never sends the church sign-in');
});

test('the presenter page polls only while visible, and stops after 30 minutes untouched', () => {
  assert.match(app, /pollMs: 2000/);
  assert.match(app, /idleMs: 30 \* 60 \* 1000/);
  assert.match(controls, /if \(!conn\.live\(\) \|\| document\.hidden\) return;/);
  assert.match(appOwn, /live: \(\) => Boolean\(tokenStore\.get\(\)\),/);
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
  // ICE servers come ONLY from the Worker (owner 2026-11-08 picked the Cloudflare relay;
  // worker/src/turn.js): no page names a STUN/TURN address or holds a credential itself.
  assert.ok(!/stun:|turns?:/.test(screen + app));
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

test('the build copies both pages, the church kit and the shared modules (into Cast\'s own site)', () => {
  assert.match(build, /const out = CAST_OUT;/);
  assert.match(build, /\['classroomRemote\.js', 'screenShare\.js'\]/);
  for (const f of ['index.html', 'screen/index.html', 'screen/screen.js', 'shared/screenShare.js', 'church/church.css']) assert.ok(build.includes(`'${f}'`), f);
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
  assert.match(controls, /conn\.path\(`\/v1\/cast\/files\/\$\{encodeURIComponent\(id\)\}`\)\}`, \{ headers: conn\.headers\(\)/);
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
  assert.match(build, /'controls\.js'/);
});

// Owner 2026-11-08, later: one phone at a time, Display code, the TV's QR (and the
// KVBC_Guest note), YouTube search, Facebook videos, video files.
test('the QR link carries the code in the fragment; the page connects with it and cleans the address', () => {
  assert.equal(codeFromHash('#code=123456'), '123456');
  assert.equal(codeFromHash('#x=1&code=654321'), '654321');
  assert.equal(codeFromHash('#code=012345'), '');
  assert.equal(codeFromHash(''), '');
  assert.match(screen, /`\$\{presenterUrl\(location\.href\)\}#code=\$\{d\}`/);
  assert.match(app, /codeFromHash\(location\.hash\)/);
  assert.match(app, /history\.replaceState\(null, '', location\.pathname \+ location\.search\)/);
  // The QR library is one module, qr.js, shared with the lobby computer's desk.
  assert.match(read('cast', 'qr.js'), /cdnjs\.cloudflare\.com\/ajax\/libs\/qrcode-generator\/1\.4\.4\//);
  assert.match(read('cast', 'qr.js'), /sc\.integrity = QR_LIB_SRI;/);
  assert.match(screen, /import \{ drawQrCode \} from '\.\.\/qr\.js';/);
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
  // The TV: one set of controls for YouTube and clips; each takes itself down at its end.
  // Facebook (security, 2026-11-09): never its SDK on the session-holding TV page, only
  // its plain cross-origin iframe player, sandboxed, from the validated link; it cannot
  // report its end, so it stays up until Back.
  assert.doesNotMatch(screen, /connect\.facebook\.net/);
  assert.doesNotMatch(screen, /\bFB\.|fbAsyncInit/);
  assert.match(screen, /https:\/\/www\.facebook\.com\/plugins\/video\.php\?\$\{q\}/);
  assert.match(screen, /const clean = R\.facebookVideoFrom\(href\);\n  if \(!clean\) return '';/);
  assert.match(screen, /frame\.setAttribute\('sandbox', 'allow-scripts allow-same-origin allow-presentation'\)/);
  assert.match(screen, /v\.addEventListener\('ended', ended\)/);
  assert.match(screen, /R\.CLASSROOM_PLAYABLE_KINDS\.includes\(b\.kind\) && media/);
});

// Owner 2026-11-08, after a real try: "a laptop that was on the network didn't connect.
// We got a black screen. That can't happen. Any way to make this work over the Web?"
// (the Cloudflare relay); "the pin should not show up by default until it's clicked on,
// same with the QR code".
test('both ends ask the Worker for the relay before the offer and the answer', () => {
  assert.match(app, /\/v1\/cast\/ice\?id=\$\{encodeURIComponent\(id\)\}/);
  assert.match(app, /startSharing\(\{\n\s+stream,\n\s+iceServers,/);
  assert.match(screen, /\/v1\/cast\/screen\/ice\?id=\$\{encodeURIComponent\(id\)\}/);
  assert.match(screen, /answerShare\(\{\n      iceServers,/);
});

test('never a black screen: the picture shows only once it arrives, and a share that does not arrive says so and goes back', () => {
  assert.match(screen, /v\.style\.visibility = 'hidden';/);
  assert.match(screen, /if \(!v\.videoWidth\) return;/);
  assert.match(screen, /shareFailed\(entry, 'The presenter\\u2019s screen did not arrive\.'\)/);
  assert.match(screen, /request\('\/v1\/cast\/screen\/back'/);
  assert.match(app, /giveUp\(id, 'Your screen did not reach the TV\./);
  assert.match(app, /CONNECT_WAIT_MS\);/);
});

test('the code and QR stay hidden until a click, the tray or Display code asks', () => {
  assert.match(screenPage, /<section class="layer card code-hidden" id="card">/);
  assert.match(screenPage, /\.card\.code-hidden \.code, \.card\.code-hidden \.qr \{ display: none !important; \}/);
  assert.match(screenPage, /Click this screen to show the code/);
  assert.match(screen, /document\.addEventListener\('pointerdown', \(\) => \{ if \(layer\.hidden\) reveal\(\); \}\);/);
  assert.match(screen, /const asked = Number\(r\.body\.revealAt\) \|\| 0;/);
  assert.match(screen, /REVEAL_MS = 5 \* 60 \* 1000/);
});

// Owner 2026-11-08: "Everything this does should have professional animations and
// transitions" (the TV and the presenter page). Motion lives ONLY inside the
// prefers-reduced-motion: no-preference blocks, so "reduce motion" sees the finished page.
test('every animation is inside the motion-allowed block; one shared motion language', () => {
  const outside = (src) => src.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n {0,2}\}\n/g, '');
  for (const [name, src] of [['presenter', page], ['tv', screenPage], ['church.css', css]]) {
    const style = name === 'church.css' ? src : (src.match(/<style>([\s\S]*?)<\/style>/) || ['', ''])[1];
    assert.ok(!/animation:/.test(outside(style)), `${name}: an animation outside the motion block`);
    assert.ok(!/@keyframes/.test(outside(style)), `${name}: keyframes outside the motion block`);
  }
  assert.match(css, /--ease-out: cubic-bezier\(\.22, 1, \.36, 1\);/);
  assert.match(screenPage, /\.card:not\(\.code-hidden\) \.code > span \{ animation: cast-rise/);
  assert.match(screen, /canvas\.classList\.add\('is-next'\);/);
  assert.match(app, /function closePanel\(panel\)/);
});

// The pages work wherever they are served (owner 2026-11-09: Cast moves to its own
// address, cast.kvbchurch.org, presenter at / and the TV at /screen/; the old
// awana.kvbchurch.org/cast/ copy keeps working meanwhile): every path of their own is
// relative, and the Worker is the page's own origin's /api.
test('the pages name their own files relatively and call their own origin\'s /api', () => {
  for (const [name, src] of [['index.html', page], ['screen/index.html', screenPage], ['app.js', app], ['screen.js', screen], ['preview.js', previewJs], ['church.css', css]]) {
    const own = src.replace(/\/v1\/cast\//g, '');
    assert.ok(!/["'(]\/cast\//.test(own), `${name} names an absolute /cast/ path`);
    assert.ok(!/\/lobby\/shared\/sync\.json/.test(src), `${name} reads the lobby's sync.json`);
  }
  assert.match(app, /from '\.\/shared\/classroomRemote\.js'/);
  assert.match(app, /from '\.\/logic\.js'/);
  assert.match(screen, /from '\.\.\/shared\/screenShare\.js'/);
  assert.match(page, /src="app\.js"/);
  assert.match(screenPage, /src="screen\.js"/);
  assert.match(screenPage, /href="\.\.\/church\/church\.css"/);
  assert.match(css, /url\('fonts\/Jost-Variable\.ttf'\)/);
  for (const src of [app, screen]) assert.match(src, /if \(!base && location\.protocol === 'https:'\) base = `\$\{location\.origin\}\/api`;/);
});

test('the TV sends people to the presenter page beside it: cast.kvbchurch.org once moved', () => {
  assert.equal(CAST_HOME, 'https://cast.kvbchurch.org/');
  assert.equal(presenterUrl('https://cast.kvbchurch.org/screen/'), 'https://cast.kvbchurch.org/');
  assert.equal(presenterUrl('https://cast.kvbchurch.org/screen/?configure=1#x'), 'https://cast.kvbchurch.org/');
  assert.equal(presenterUrl('https://awana.kvbchurch.org/cast/screen/'), 'https://awana.kvbchurch.org/cast/');
  assert.equal(presenterUrl('http://localhost:5173/screen/'), CAST_HOME);
  assert.equal(presenterUrl('file:///x/screen/index.html'), CAST_HOME);
  assert.equal(presenterUrl(undefined), CAST_HOME);
  assert.equal(addressWords('https://cast.kvbchurch.org/'), 'cast.kvbchurch.org');
  assert.equal(addressWords('https://awana.kvbchurch.org/cast/'), 'awana.kvbchurch.org/cast');
  assert.match(screen, /import \{ addressWords, presenterUrl \} from '\.\.\/logic\.js';/);
  assert.match(screenPage, /Go to <b id="card-addr">cast\.kvbchurch\.org<\/b> and enter/);
  assert.match(screen, /addr\.textContent = addressWords\(presenterUrl\(location\.href\)\)/);
  assert.match(screen, /presenters go to \$\{addressWords\(presenterUrl\(location\.href\)\)\} and type it/);
  assert.ok(!/awana\.kvbchurch\.org\/cast/.test(screen + screenPage), 'the TV never names the old address');
});

// Owner 2026-11-09: "The lobby computer's KVBC Awana app must sign the new TV page in BY
// ITSELF" (localStorage does not cross origins). The app's bridge is
// printer/electron-app/static/display/cast-preload.cjs; a plain browser has none.
test('the TV page asks KVBC Awana for its sign-in when its slot is empty, and once more after a 401', () => {
  assert.match(screen, /const host = window\.awanaCastHost;\n  if \(!host \|\| typeof host\.session !== 'function'\) return false;/);
  assert.match(screen, /if \(!SESSION_RE\.test\(s\)\) return false;\n  try \{ localStorage\.setItem\(SESSION_KEY, s\); \}/);
  assert.match(screen, /if \(!session\(\)\) await sessionFromHost\(\);\n  if \(!session\(\)\) \{ signedOut\(\); \}/);
  // A 401 asks once; only a DIFFERENT sign-in starts the page again (never a loop).
  assert.match(screen, /if \(!hostAskedAfter401\) \{\n    hostAskedAfter401 = true;\n    const before = session\(\);\n    if \(await sessionFromHost\(\) && session\(\) !== before\) \{ location\.reload\(\); return; \}\n  \}\n  signedOut\(\);/);
  assert.equal((screen.match(/r\.status === 401\) \{ refused\(\); return; \}/g) || []).length, 2);
  assert.ok(!/r\.status === 401\) \{ signedOut\(\)/.test(screen));
  // Configure mode (the app's Settings window) returns before any of it.
  const start = screen.slice(screen.indexOf('async function start()'));
  assert.ok(start.indexOf('if (CONFIGURE)') < start.indexOf('sessionFromHost()'));
});

// The desk (owner 2026-11-09): KVBC Awana's back-of-house "Cast control" window on the
// lobby computer, cast.kvbchurch.org/desk/. The presenter page's own code (controls.js),
// signed in only through the app's bridge, in the Windows 11 look.
test('the desk reuses the presenter page\'s controls through the desk routes and the computer\'s sign-in', () => {
  const desk = read('cast', 'desk', 'desk.js');
  assert.match(desk, /import \{ \$, createControls, setText \} from '\.\.\/controls\.js';/);
  assert.match(desk, /path: \(p\) => p\.replace\(\/\^\\\/v1\\\/cast\\\/\/, '\/v1\/cast\/desk\/'\),/);
  assert.match(desk, /headers: \(\) => \(session \? \{ Authorization: `Bearer \$\{session\}` \} : \{\}\),/);
  assert.match(desk, /nav: true,/);
  // A mouse clicks: the shared words take their verb from the page.
  assert.match(desk, /verb: 'Click',/);
  const controls = read('cast', 'controls.js');
  assert.match(controls, /const VERB = conn\.verb \|\| 'Tap';/);
  assert.ok(!/\bTap (one|it|anywhere)/.test(controls), 'no hard-coded Tap in the shared controls');
  // Never a presenter token, never storage: the sign-in is the app's, in memory.
  assert.ok(!/X-Cast-Token|sessionStorage|localStorage/.test(desk));
  assert.ok(!/\/v1\/cast\/join|\/v1\/cast\/leave/.test(desk));
  // "Disconnect the presenter" is the tray's own route; a 401 asks the app once more.
  assert.match(desk, /fetch\(`\$\{base\}\/v1\/cast\/kick`, \{ method: 'POST', headers: \{ Authorization: `Bearer \$\{session\}`/);
  assert.match(desk, /if \(!askedAfter401\) \{\n    askedAfter401 = true;/);
  // The code and its QR always (the TV's reveal rule does not apply here).
  assert.ok(!/revealAt|code-hidden|REVEAL/.test(desk));
  assert.match(desk, /drawQrCode\(\$\('desk-qr'\), `\$\{presenterUrl\(location\.href\)\}#code=\$\{code\}`/);
  // No bridge (a plain browser): the calm note, nothing else runs.
  const start = desk.slice(desk.indexOf('async function start()'));
  assert.match(start, /if \(!session\) \{\n    off\('Open this on the lobby computer'/);
  assert.ok(start.indexOf('return;') < start.indexOf('ui.wire()'));
});

test('the desk page: every control the presenter has but the screen share, in the Windows 11 look', () => {
  const deskPage = read('cast', 'desk', 'index.html');
  for (const id of ['yt-search-form', 'yt-q', 'yt-results', 'video-form', 'video-link', 'fb-form', 'fb-link', 'text-form', 'text-body', 'pic-input', 'thumbs', 'clip-input', 'clip-show', 'pdf-input', 'pdf-link', 'pdf-copy', 'pdf-show', 'tv', 'tv-main', 'ctl-video', 'ctl-pdf', 'btn-down', 'press-note', 'desk-code', 'desk-qr', 'desk-addr', 'btn-reveal', 'btn-kick', 'desk-off']) {
    assert.match(deskPage, new RegExp(`id="${id}"`), id);
  }
  assert.ok(!/id="btn-share"|getDisplayMedia/.test(deskPage), 'no screen share: it is the TV\'s own computer');
  assert.match(deskPage, /data-slide="now"/);
  assert.match(deskPage, /data-slide-strip/);
  assert.match(deskPage, /<nav aria-label="What to show">/);
  // Fluent 2 / Windows 11: the system font, the neutral page, the accent, 32 px controls,
  // 14 px text, focus rings, high contrast, dark mode. Not the church's kit, not Awana's.
  assert.match(deskPage, /"Segoe UI Variable Text", "Segoe UI Variable", "Segoe UI", system-ui/);
  // The Mica-like base, the Fluent layer and card fills (were --page/--card/--stroke flat tokens until 2026-11-10),
  // and the Windows accent with its fallbacks (light #005FB8; dark #60CDFF with black text).
  assert.match(deskPage, /--base: #F3F3F3;/);
  assert.match(deskPage, /--base: #202020;/);
  assert.match(deskPage, /--layer: rgba\(255, 255, 255, \.5\); --layer-stroke: rgba\(0, 0, 0, \.058\);/);
  assert.match(deskPage, /--card: rgba\(255, 255, 255, \.7\); --stroke: rgba\(0, 0, 0, \.058\);/);
  assert.match(deskPage, /--card: rgba\(255, 255, 255, \.051\);/);
  assert.match(deskPage, /--accent: #005FB8;/);
  assert.match(deskPage, /--accent: #60CDFF; --on-accent: #000000;/);
  assert.match(deskPage, /@supports \(color: AccentColor\) \{ :root \{ --accent: AccentColor; --on-accent: AccentColorText; \} \}/);
  assert.match(deskPage, /html\.mica, html\.mica body \{ background: transparent; \}/);
  assert.ok(!/box-shadow: 0 [1-9]/.test(deskPage.replace(/--flyout-shadow[^;]*;/g, '')), 'cards are stroke-defined: no drop shadows');
  assert.match(deskPage, /min-height: 32px;/);
  assert.match(deskPage, /font: 400 14px\/20px var\(--font\);/);
  assert.match(deskPage, /:focus-visible \{ outline: 2px solid/);
  assert.match(deskPage, /@media \(forced-colors: active\)/);
  assert.match(deskPage, /@media \(prefers-color-scheme: dark\)/);
  assert.ok(!/church\.css|Jost|Almarai|kvbc-logo|shared\/brand|Paytone|Londrina|fonts\.googleapis|@font-face/.test(deskPage));
  assert.match(deskPage, /<meta name="robots" content="noindex, nofollow">/);
  // Windows 11 pieces: the nav pane with its gliding accent pill, InfoBars, the miniature's placeholder.
  for (const id of ['nav-pill', 'tv-mini', 'tv-shot', 'tv-ph', 'tv-live', 'tv-progress', 'btn-copy', 'presence']) assert.match(deskPage, new RegExp(`id="${id}"`), id);
  assert.match(deskPage, /\.pill \{ transition: transform 167ms cubic-bezier\(0, 0, 0, 1\); \}/);
  assert.match(deskPage, /@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*@keyframes ring/);
  assert.match(deskPage, /#tv-mini\[data-kind="code"\] \.g-code/, 'a placeholder glyph per kind of thing on the TV');
  assert.match(deskPage, /@media \(max-width: 1100px\)/);
  assert.match(deskPage, /<script type="module" src="desk\.js"><\/script>/);
  assert.ok(!/<script>/.test(deskPage), 'no inline script (the policy allows none it does not fingerprint)');
});

test('the desk: Mica when the app says so, and a live miniature of the TV that never breaks', () => {
  const desk = read('cast', 'desk', 'desk.js');
  // Mica only on the app's word.
  assert.match(desk, /window\.awanaCastHost\.material === 'mica'\) document\.documentElement\.classList\.add\('mica'\)/);
  // The miniature: the bridge's preview() only when it is a function, only while visible, one at a time,
  // a JPEG/PNG data URL only, decoded before the swap; without it the placeholder shows.
  assert.match(desk, /typeof host\.preview !== 'function'\) \{ showShot\(null\); return; \}/);
  assert.match(desk, /if \(document\.hidden \|\| shotBusy\) return;/);
  assert.match(desk, /SHOT_RE = \/\^data:image\\\/\(jpeg\|png\);base64,/);
  assert.match(desk, /await probe\.decode\(\)/);
  assert.match(desk, /function drawRoom\(body\) \{\n  drawTv\(body\);\n  void refreshShot\(\);/, 'asked with each good state answer: visible and not idle-paused, like the state poll');
  assert.ok(!/setInterval|setTimeout\([^)]*refreshShot/.test(desk), 'no timer of its own for the miniature');
  assert.ok(!/preview\(\)[^;]*fetch|fetch[^;]*preview\(\)/.test(desk), 'the miniature is local: no Worker call');
  const deskPage = read('cast', 'desk', 'index.html');
  assert.match(deskPage, /<img id="tv-shot"[^>]*hidden>/);
  assert.match(deskPage, /\.screen\[data-shot="true"\] \.ph \{ display: none; \}/);
  // The desk's CSP lets the data: picture in (img-src has data: already; nothing else was added for it).
  const build = read('build.mjs');
  assert.match(build, /const CAST_DESK_CSP = tvPagePolicy\(\{\n  origin: CAST_ORIGIN,\n  images: \['https:\/\/i\.ytimg\.com'\],/);
});
