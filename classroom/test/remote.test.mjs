// The Sparks remote (public/remote/): its pure words and choices, and the page
// in real Chromium against a stand-in sync Worker served by this test (tiles,
// presses, the video and PDF controls, the editor with an upload in parts,
// a stale save, Sparky's long press, phone width).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as logic from '../public/remote/logic.js';
import * as R from '../../shared/classroomRemote.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, '..', 'public');
const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';
let chromium = null;
try { ({ chromium } = await import('playwright-core')); } catch { /* skipped below */ }
const SKIP = !chromium || !existsSync(CHROMIUM) ? 'no Chromium here (set PLAYWRIGHT_CHROMIUM)' : false;
if (SKIP) console.log(`# Sparks remote page tests skipped: ${SKIP}`);

describe('the remote\'s words', () => {
  it('says what the TV shows', () => {
    const stage = { show: { button: { id: 'bvideo01', kind: 'video', title: 'Sparky Song' }, at: 1, page: 1 }, preview: null };
    const now = { view: 'video', button: 'bvideo01', video: { t: 75, d: 200, paused: true, muted: false, volume: 80 } };
    assert.deepEqual(logic.nowWords({ now, stage, screenOnline: true }), { kicker: 'On the classroom TV · Video', main: 'Sparky Song', sub: '1:15 / 3:20 · paused · volume 80%', live: true });
    assert.equal(logic.nowWords({ now: null, stage, screenOnline: false }).sub, 'Waiting for the classroom TV to pick it up…');
    assert.equal(logic.nowWords({ now: { view: 'sparks' }, stage: { show: null, preview: null }, screenOnline: true }).main, 'Sparks Large Group Time');
    assert.equal(logic.nowWords({ now: null, stage: { show: null }, screenOnline: false }).main, 'The classroom TV is not on');
    assert.equal(logic.clock(3725), '1:02:05');
  });
  it('turns the editor rows into the shared list, and names the first problem', () => {
    const rows = {
      videos: [{ id: 'bvideo01', title: 'Song', link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m5s' }, { id: 'bvideo02', title: '', link: '' }],
      items: [{ id: 'btext001', kind: 'text', title: 'Verse', heading: '', text: 'Hi', look: 'board' }, { id: 'bfile001', kind: 'file', title: 'Map', file: 'fabcdefghijkl0001', type: 'image/png', fileKind: 'image' }],
    };
    const out = logic.buttonsFromRows(rows, R);
    assert.equal(out.ok, true);
    assert.deepEqual(out.buttons.videos, [{ id: 'bvideo01', title: 'Song', youtube: 'dQw4w9WgXcQ', start: 65 }]);
    assert.equal(out.buttons.items.length, 2);
    const bad = logic.buttonsFromRows({ videos: [{ id: 'bvideo01', title: 'x', link: 'https://vimeo.com/1' }], items: [] }, R);
    assert.deepEqual(bad, { ok: false, error: 'Video 1: paste a YouTube link (youtube.com or youtu.be).', at: 'video-0' });
    assert.equal(logic.buttonsFromRows({ videos: [], items: [{ id: 'bfile001', kind: 'file', title: 'Map' }] }, R).at, 'item-0');
    assert.deepEqual(logic.rowsFromButtons(out.buttons).videos[0], { id: 'bvideo01', title: 'Song', link: 'https://youtu.be/dQw4w9WgXcQ?t=65' });
    assert.match(logic.newButtonId(), /^b[a-z0-9]{10}$/);
  });
});

const SESSION = `v1.1.${Date.now()}.${'s'.repeat(43)}`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };
const W = {};
const reset = () => Object.assign(W, {
  rev: 1,
  buttons: { videos: [{ id: 'bvideo01', title: 'Sparky Song', youtube: 'dQw4w9WgXcQ', start: 0 }], items: [{ id: 'btext001', kind: 'text', title: 'Verse', text: 'Hi', look: 'page' }, { id: 'bpdf0001', kind: 'pdf', title: 'Handbook', file: 'fabcdefghijkl0001', type: 'application/pdf' }] },
  stage: { rev: 0, show: null, preview: null, cmds: [] },
  now: null, presses: [], puts: [], parts: [], stale: false,
});
let server; let base; let browser;

before(async () => {
  if (SKIP) return;
  server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname.startsWith('/api/')) {
      if (req.headers.authorization !== `Bearer ${SESSION}`) { send(401, {}); return; }
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks);
        const p = url.pathname.slice(4);
        const body = req.headers['content-type'] === 'application/json' && raw.length ? JSON.parse(raw) : null;
        if (p === '/v1/classroom/remote/state') { send(200, { buttons: W.buttons, rev: W.rev, stage: W.stage, now: W.now, screenOnline: true, serverNow: Date.now(), watchMs: 30000 }); return; }
        if (p === '/v1/classroom/remote') {
          W.presses.push(body);
          if (body.action === 'show') { const b = [...W.buttons.videos.map((v) => ({ ...v, kind: 'video' })), ...W.buttons.items].find((x) => x.id === body.data.button); W.stage = { ...W.stage, rev: W.stage.rev + 1, show: { button: b, at: Date.now(), page: 1 } }; }
          if (body.action === 'back') W.stage = { ...W.stage, rev: W.stage.rev + 1, show: null };
          send(200, { ok: true, screenOnline: true });
          return;
        }
        if (p === '/v1/classroom/buttons' && req.method === 'GET') { send(200, { rev: W.rev, buttons: W.buttons }); return; }
        if (p === '/v1/classroom/buttons' && req.method === 'PUT') {
          W.puts.push(body);
          if (W.stale) { W.stale = false; W.rev += 1; send(409, { reason: 'stale', rev: W.rev, buttons: W.buttons }); return; }
          W.rev += 1; W.buttons = body.buttons; send(200, { ok: true, rev: W.rev, buttons: W.buttons }); return;
        }
        if (p === '/v1/classroom/files' && req.method === 'POST') { send(200, { ok: true, id: 'fnewfile00000001', parts: Math.ceil(body.bytes / 1000), partBytes: 1000 }); return; }
        if (/^\/v1\/classroom\/files\/fnewfile00000001\/\d+$/.test(p)) { W.parts.push(raw.length); send(200, { ok: true }); return; }
        if (p === '/v1/classroom/files/fnewfile00000001/done') { send(200, { ok: true, id: 'fnewfile00000001', type: 'image/png', bytes: W.parts.reduce((a, b) => a + b, 0), kind: 'image' }); return; }
        send(404, {});
      });
      return;
    }
    const rel = url.pathname.replace(/^\/classroom\//, '');
    const file = path.join(PUBLIC, rel.endsWith('/') ? `${rel}index.html` : rel);
    if (!url.pathname.startsWith('/classroom/') || !file.startsWith(PUBLIC) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: CHROMIUM });
});
after(async () => { await browser?.close(); server?.close(); });

async function open(size = { width: 390, height: 844 }) {
  reset();
  const page = await browser.newPage({ viewport: size, hasTouch: true });
  await page.addInitScript(({ api, session }) => {
    localStorage.setItem('awanaSyncSession.v1', session);
    window.sparksRemoteBase = api;
    window.sparksRemoteTuning = { pollMs: 200, holdMs: 300 };
  }, { api: `${base}/api`, session: SESSION });
  await page.goto(`${base}/classroom/remote/`);
  await page.waitForSelector('#remote:not([hidden]) .tile');
  return page;
}

describe('the Sparks remote page', { skip: SKIP }, () => {
  it('shows the shared buttons; a tap puts one up; the right controls appear; Back takes it down', async () => {
    const page = await open();
    assert.deepEqual(await page.$$eval('.tile', (ts) => ts.map((t) => [t.dataset.kind, t.firstChild.textContent])), [['video', 'Sparky Song'], ['text', 'Verse'], ['pdf', 'Handbook']]);
    assert.equal(await page.isHidden('#btn-back'), true);
    await page.click('.tile[data-button="bvideo01"]');
    await page.waitForSelector('#video:not([hidden])');
    assert.deepEqual(W.presses[0], { action: 'show', data: { button: 'bvideo01' } });
    await page.waitForFunction(() => document.querySelector('.tile[data-button="bvideo01"]').getAttribute('aria-pressed') === 'true');
    W.now = { view: 'video', button: 'bvideo01', video: { t: 30, d: 200, paused: false, muted: false, volume: 100 } };
    await page.waitForFunction(() => document.getElementById('now-sub').textContent.startsWith('0:30 / 3:20'));
    await page.click('#video [data-op="seek"][data-by="10"]');
    await page.click('#video [data-op="volume"][data-step="-1"]');
    assert.deepEqual(W.presses.slice(1), [{ action: 'video', data: { op: 'seek', by: 10 } }, { action: 'video', data: { op: 'volume', step: -1 } }]);
    await page.click('.tile[data-button="bpdf0001"]');
    await page.waitForSelector('#pdf:not([hidden])');
    assert.equal(await page.isHidden('#video'), true);
    await page.click('#pdf [data-step="1"]');
    assert.deepEqual(W.presses.at(-1), { action: 'page', data: { step: 1 } });
    await page.click('#btn-back');
    await page.waitForSelector('#btn-back', { state: 'hidden' });
    assert.deepEqual(W.presses.at(-1), { action: 'back' });
    // Nothing on a phone runs off its right edge.
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.close();
  });

  it('edits the shared list: a video, a text button, a picture uploaded in parts; a stale save reloads', async () => {
    const page = await open();
    await page.click('#btn-edit');
    await page.waitForSelector('#editor:not([hidden]) .edit-row');
    await page.click('#add-video');
    const vrows = await page.$$('#edit-videos .edit-row');
    await vrows[1].$eval('.f-title', (el) => { el.value = 'Bible Song'; el.dispatchEvent(new Event('input')); });
    await vrows[1].$eval('.f-link', (el) => { el.value = 'not a link'; el.dispatchEvent(new Event('input')); });
    await page.click('#edit-save');
    await page.waitForFunction(() => document.getElementById('edit-note').textContent.startsWith('Video 2:'));
    assert.equal(W.puts.length, 0);
    await vrows[1].$eval('.f-link', (el) => { el.value = 'https://youtu.be/aaaaaaaaaaa'; el.dispatchEvent(new Event('input')); });
    await page.click('#add-file');
    const fileRow = (await page.$$('#edit-items .edit-row')).at(-1);
    const png = readFileSync(path.join(PUBLIC, 'art', 'sparky-flying.png')).subarray(0, 2500);
    await (await fileRow.$('.f-input')).setInputFiles({ name: 'Map.png', mimeType: 'image/png', buffer: png });
    await page.waitForFunction(() => [...document.querySelectorAll('.f-file')].some((p) => p.textContent.startsWith('Picture ready')));
    assert.deepEqual(W.parts, [1000, 1000, 500]);
    W.stale = true;
    await page.click('#edit-save');
    await page.waitForFunction(() => document.getElementById('edit-note').textContent.startsWith('Someone else changed'));
    // Their list is back in the editor; make the change again and save.
    await page.click('#add-text');
    const textRow = (await page.$$('#edit-items .edit-row')).at(-1);
    await textRow.$eval('.f-text', (el) => { el.value = 'Line up!'; el.dispatchEvent(new Event('input')); });
    await textRow.$eval('.f-look input[value="board"]', (el) => { el.checked = true; el.dispatchEvent(new Event('change')); });
    await page.click('#edit-save');
    await page.waitForSelector('#editor', { state: 'hidden' });
    const saved = W.puts.at(-1);
    assert.equal(saved.buttons.items.at(-1).text, 'Line up!');
    assert.equal(saved.buttons.items.at(-1).look, 'board');
    await page.close();
  });

  it('a long press on the Sparks mark sends Sparky; a tap does not', async () => {
    const page = await open();
    const box = await page.locator('#mark').boundingBox();
    await page.mouse.move(box.x + 10, box.y + 10);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(450);
    assert.equal(W.presses.length, 0);
    await page.mouse.down();
    await page.waitForTimeout(450);
    await page.mouse.up();
    await page.waitForFunction(() => document.getElementById('press-note').textContent.startsWith('Whoosh'));
    assert.deepEqual(W.presses, [{ action: 'sparky' }]);
    await page.close();
  });
});
