// The Sparks remote's half of the classroom screen (public/src/stage.js) in
// real Chromium, against a stand-in sync Worker served by this test: the
// stage it follows, the swoop, each kind of button, video commands run once,
// no welcome over a video, the TV's report, a /settings preview, the
// doorbell from its own lobby frame, and Sparky. YouTube and pdf.js are
// stand-ins (window.classroomYouTube, window.classroomPdfLib): no network.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, '..', 'public');
const SCHEDULE = path.join(HERE, '..', '..', 'shared', 'schedule.json');
const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';
let chromium = null;
try { ({ chromium } = await import('playwright-core')); } catch { /* skipped below */ }
const SKIP = !chromium || !existsSync(CHROMIUM) ? 'no Chromium here (set PLAYWRIGHT_CHROMIUM)' : false;
if (SKIP) console.log(`# classroom stage tests skipped: ${SKIP}`);

const SESSION = `v1.1.${Date.now()}.${'s'.repeat(43)}`;
const PNG = readFileSync(path.join(PUBLIC, 'art', 'sparky-flying.png'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };
const LOBBY_STAND_IN = `<!doctype html><script>
  addEventListener('message', (e) => { if (e.data && e.data.post) parent.postMessage(e.data.post, location.origin); });
</script>`;

const worker = { stage: { rev: 0, show: null, preview: null, cmds: [] }, watch: true, reads: 0, now: [], remote: [] };
const resetWorker = () => Object.assign(worker, { stage: { rev: 0, show: null, preview: null, cmds: [] }, watch: true, reads: 0, now: [], remote: [] });
let server;
let base;
let browser;

before(async () => {
  if (SKIP) return;
  server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type }); res.end(type === 'application/json' ? JSON.stringify(body) : body); };
    if (url.pathname.startsWith('/api/')) {
      if (req.headers.authorization !== `Bearer ${SESSION}`) { send(401, { error: 'signed out' }); return; }
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        const body = raw ? JSON.parse(raw) : null;
        const p = url.pathname.slice(4);
        if (p === '/v1/classroom/stage') { worker.reads += 1; send(200, { stage: worker.stage, watch: worker.watch, serverNow: Date.now() }); return; }
        if (p === '/v1/classroom/now') { worker.now.push(body.now); send(200, { ok: true, watch: worker.watch }); return; }
        if (p === '/v1/classroom/remote') { worker.remote.push(body); worker.stage = { ...worker.stage, rev: worker.stage.rev + 1, show: body.action === 'back' ? null : worker.stage.show }; send(200, { ok: true }); return; }
        if (p.startsWith('/v1/classroom/files/')) { send(200, PNG, 'image/png'); return; }
        send(404, { error: 'no' });
      });
      return;
    }
    if (url.pathname === '/lobby/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(LOBBY_STAND_IN); return; }
    if (url.pathname === '/lobby/shared/schedule.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(readFileSync(SCHEDULE)); return; }
    const rel = url.pathname.replace(/^\/classroom\//, '');
    const file = path.join(PUBLIC, rel === '' ? 'index.html' : rel);
    if (!url.pathname.startsWith('/classroom/') || !file.startsWith(PUBLIC) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: CHROMIUM });
});
after(async () => { await browser?.close(); server?.close(); });

async function open(query, { pollMs = 150 } = {}) {
  resetWorker();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.addInitScript(({ api, session, pollMs: poll }) => {
    localStorage.setItem('awanaSyncSession.v1', session);
    window.classroomSyncBase = api;
    window.classroomStageTuning = { pollMs: poll, swoopMs: 300, swapAtMs: 120, reportVideoMs: 400 };
    window.__yt = { made: [], calls: [] };
    class Player {
      constructor(host, opts) {
        this.opts = opts; this.state = -1; this.volume = 100; this.muted = false; this.t = 0;
        window.__yt.made.push({ videoId: opts.videoId, host: opts.host, playerVars: opts.playerVars });
        window.__yt.player = this;
        setTimeout(() => { opts.events.onReady({ target: this }); }, 20);
      }
      playVideo() { window.__yt.calls.push('play'); this.state = 1; this.opts.events.onStateChange({ data: 1 }); }
      pauseVideo() { window.__yt.calls.push('pause'); this.state = 2; this.opts.events.onStateChange({ data: 2 }); }
      getPlayerState() { return this.state; }
      seekTo(s) { window.__yt.calls.push(`seek:${Math.round(s)}`); this.t = s; }
      getCurrentTime() { return this.t; }
      getDuration() { return 200; }
      getVolume() { return this.volume; }
      setVolume(v) { window.__yt.calls.push(`volume:${v}`); this.volume = v; }
      isMuted() { return this.muted; }
      mute() { this.muted = true; }
      unMute() { this.muted = false; }
      destroy() { window.__yt.calls.push('destroy'); }
      end() { this.state = 0; this.opts.events.onStateChange({ data: 0 }); }
    }
    window.classroomYouTube = { Player };
    window.__pdf = { rendered: [] };
    window.classroomPdfLib = {
      getDocument: () => ({ promise: Promise.resolve({ numPages: 3, getPage: async (n) => ({ getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }), render: () => { window.__pdf.rendered.push(n); return { promise: Promise.resolve() }; } }) }) }),
    };
  }, { api: `${base}/api`, session: SESSION, pollMs });
  await page.goto(`${base}/classroom/${query}`);
  return page;
}

const show = (button, at = Date.now(), page = 1) => { worker.stage = { ...worker.stage, rev: worker.stage.rev + 1, show: { button, at, page } }; };
const TEXT = { id: 'btext001', kind: 'text', title: 'Verse', heading: 'Memory verse', text: 'Love one another.\nJohn 13:34', look: 'page' };
const VIDEO = { id: 'bvideo01', kind: 'video', title: 'Sparky Song', youtube: 'dQw4w9WgXcQ', start: 5 };
const CLUB_NIGHT = '?now=2026-10-14T23:10:00Z'; // Sparks Large Group Time

describe('the Sparks remote on the classroom screen', { skip: SKIP }, () => {
  it('text goes up under the swoop, on the handbook page, and Back takes it down', async () => {
    const page = await open(CLUB_NIGHT);
    await page.waitForFunction(() => document.documentElement.dataset.phase === 'sparks');
    show(TEXT);
    await page.waitForSelector('.cr-swoop.is-sweeping', { state: 'attached', timeout: 3000 });
    await page.waitForSelector('#show:not([hidden]) .cr-show-words');
    assert.equal(await page.textContent('.cr-show-words'), 'Love one another.\nJohn 13:34');
    assert.equal(await page.textContent('.cr-show-heading'), 'Memory verse');
    assert.equal(await page.evaluate(() => document.getElementById('show').classList.contains('cr-show--page')), true);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.show), 'text');
    // The words fill their page but stay on it.
    const fit = await page.evaluate(() => { const w = document.querySelector('.cr-show-words').getBoundingClientRect(); const p = document.querySelector('.cr-show-page').getBoundingClientRect(); return { inside: w.bottom <= p.bottom + 1 && w.right <= p.right + 1, size: parseFloat(getComputedStyle(document.querySelector('.cr-show-words')).fontSize) }; });
    assert.ok(fit.inside, 'the words stay on the page');
    assert.ok(fit.size > 40, `the words are big (${fit.size}px)`);
    worker.stage = { ...worker.stage, rev: worker.stage.rev + 1, show: null };
    await page.waitForSelector('#show', { state: 'hidden' });
    assert.equal(await page.evaluate(() => document.documentElement.dataset.show), undefined);
    await page.close();
  });

  it('a video plays in the privacy-enhanced player; commands run once; no welcome over it; it ends back to the schedule', async () => {
    const page = await open(CLUB_NIGHT);
    await page.waitForFunction(() => document.documentElement.dataset.phase === 'sparks');
    // A command from before the page loaded is never run.
    worker.stage = { ...worker.stage, cmds: [{ id: 'old1', action: 'video', data: { op: 'pause' }, at: Date.now() - 60000 }] };
    show(VIDEO);
    await page.waitForFunction(() => window.__yt.made.length === 1 && window.__yt.calls.includes('play'));
    const made = await page.evaluate(() => window.__yt.made[0]);
    assert.equal(made.videoId, 'dQw4w9WgXcQ');
    assert.equal(made.host, 'https://www.youtube-nocookie.com');
    assert.equal(made.playerVars.rel, 0);
    assert.equal(made.playerVars.controls, 0);
    assert.equal(made.playerVars.start, 5);
    worker.stage = { ...worker.stage, rev: worker.stage.rev + 1, cmds: [...worker.stage.cmds, { id: 'c1', action: 'video', data: { op: 'toggle' }, at: Date.now() }, { id: 'c2', action: 'video', data: { op: 'volume', step: -1 }, at: Date.now() }] };
    await page.waitForFunction(() => window.__yt.calls.includes('pause') && window.__yt.calls.includes('volume:90'));
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => window.__yt.calls.filter((c) => c === 'pause').length), 1, 'each command once');
    // A Sparks child checks in during the video: no ding, no card.
    const frame = page.frame({ url: /\/lobby\/\?club=sparks/ });
    await frame.evaluate((m) => window.postMessage({ post: m }, location.origin), { type: 'awana-display:checkin', id: 'm1', firstName: 'Micah', club: 'Sparks' });
    await page.waitForTimeout(300);
    assert.equal(await page.isHidden('#welcome-sparks'), true);
    // The report says what is playing.
    await page.waitForFunction(() => true);
    assert.ok(worker.now.some((n) => n.view === 'video' && n.button === 'bvideo01' && n.video && n.video.d === 200));
    // It ends: the TV tells the service, and the schedule comes back.
    await page.evaluate(() => window.__yt.player.end());
    await page.waitForSelector('#show', { state: 'hidden' });
    assert.deepEqual(worker.remote.at(-1), { action: 'back' });
    await page.close();
  });

  it('a picture is read from the service with the sign-in; a PDF turns its pages', async () => {
    const page = await open(CLUB_NIGHT);
    show({ id: 'bimg0001', kind: 'image', title: 'Map', file: 'fabcdefghijkl0001', type: 'image/png' });
    await page.waitForSelector('#show:not([hidden]) img.cr-show-img');
    assert.match(await page.getAttribute('img.cr-show-img', 'src'), /^blob:/);
    await page.waitForFunction(() => document.querySelector('img.cr-show-img').naturalWidth > 0);
    show({ id: 'bpdf0001', kind: 'pdf', title: 'Handbook', file: 'fabcdefghijkl0002', type: 'application/pdf' });
    await page.waitForSelector('#show:not([hidden]) canvas.cr-show-pdf');
    await page.waitForFunction(() => window.__pdf.rendered.includes(1));
    worker.stage = { ...worker.stage, rev: worker.stage.rev + 1, show: { ...worker.stage.show, page: 3 } };
    await page.waitForFunction(() => window.__pdf.rendered.includes(3));
    await page.waitForFunction(() => true);
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(worker.now.some((n) => n.view === 'pdf' && n.page === 3 && n.pages === 3), JSON.stringify(worker.now.slice(-3)));
    await page.close();
  });

  it('a /settings preview shows its look for its minute on a night with no club', async () => {
    const page = await open('?now=2026-10-13T16:00:00Z'); // a Tuesday noon
    await page.waitForFunction(() => document.documentElement.dataset.phase === 'off');
    worker.stage = { ...worker.stage, rev: 1, preview: { look: 'cubbies', until: Date.now() + 1500 } };
    await page.waitForFunction(() => document.documentElement.dataset.phase === 'cubbies');
    assert.equal(await page.isVisible('#cubbies'), true);
    await page.waitForFunction(() => document.documentElement.dataset.phase === 'off', null, { timeout: 4000 });
    await page.close();
  });

  it('the lobby frame\'s doorbell makes it read at once; a stranger\'s message does nothing; Sparky flies', async () => {
    const page = await open(CLUB_NIGHT, { pollMs: 60000 });
    await page.waitForFunction(() => document.documentElement.dataset.phase === 'sparks');
    await page.waitForTimeout(200);
    const reads = worker.reads;
    await page.evaluate(() => window.postMessage({ type: 'awana-display:sync-doorbell', what: 'classroom', rev: 1 }, location.origin));
    await page.waitForTimeout(300);
    assert.equal(worker.reads, reads, 'not from the page itself');
    worker.stage = { ...worker.stage, rev: 2, cmds: [{ id: 's1', action: 'sparky', at: Date.now() }] };
    const frame = page.frame({ url: /\/lobby\/\?club=sparks/ });
    await frame.evaluate(() => window.postMessage({ post: { type: 'awana-display:sync-doorbell', what: 'classroom', rev: 2 } }, location.origin));
    await page.waitForFunction(() => document.getElementById('sparky-fly').classList.contains('is-flying'), null, { timeout: 2000 });
    assert.ok(worker.reads > reads);
    await page.close();
  });

  it('a lifted pen over a video pauses it and the board goes on top; a new button takes the board down', async () => {
    const page = await open(CLUB_NIGHT);
    await page.waitForFunction(() => document.documentElement.dataset.phase === 'sparks');
    show(VIDEO);
    await page.waitForFunction(() => window.__yt.calls.includes('play'));
    await page.evaluate(() => window.dispatchEvent(new Event('awana:pen-lifted')));
    await page.waitForSelector('#board:not([hidden])');
    assert.ok(await page.evaluate(() => window.__yt.calls.includes('pause')));
    const top = await page.evaluate(() => document.elementFromPoint(640, 360).closest('#board') !== null);
    assert.equal(top, true);
    show(TEXT);
    await page.waitForSelector('#board', { state: 'hidden', timeout: 3000 });
    await page.waitForSelector('#show:not([hidden]) .cr-show-words');
    await page.close();
  });
});
