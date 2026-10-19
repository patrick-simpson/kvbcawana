// The downstairs classroom page in real Chromium: the clock picks the right
// view, the cards fit at 720p, 1080p and 4K, and a welcome comes only from
// the page's own lobby frame. Uses the Chromium the cloud sessions have
// (PLAYWRIGHT_CHROMIUM, else /opt/pw-browsers/chromium); skipped, and says so,
// without it. The page's own lobby frame is a stand-in (served at /lobby/)
// that posts whatever the test hands it up to the page.
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
if (SKIP) console.log(`# classroom page tests skipped: ${SKIP}`);

const LOBBY_STAND_IN = `<!doctype html><script>
  addEventListener('message', (e) => { if (e.data && e.data.post) parent.postMessage(e.data.post, location.origin); });
</script>`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };

let server;
let base;
let browser;

before(async () => {
  if (SKIP) return;
  server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/lobby/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(LOBBY_STAND_IN); return; }
    if (url.pathname === '/lobby/shared/schedule.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(readFileSync(SCHEDULE)); return; }
    const rel = url.pathname.replace(/^\/classroom\//, '');
    const file = path.join(PUBLIC, rel === '' ? 'index.html' : rel);
    if (!url.pathname.startsWith('/classroom/') || !file.startsWith(PUBLIC) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/classroom/`;
  browser = await chromium.launch({ executablePath: CHROMIUM });
});
after(async () => { await browser?.close(); server?.close(); });

async function open(query, size = { width: 1920, height: 1080 }) {
  const page = await browser.newPage({ viewport: size });
  await page.goto(`${base}${query}`);
  await page.evaluate(() => document.fonts.ready);
  return page;
}

describe('the clock', { skip: SKIP }, () => {
  // Wednesday 2026-10-14 (a club night by the default rule; no calendar feed served), Eastern daylight time.
  const cases = [
    ['2026-10-14T22:29:00Z', 'off'], ['2026-10-14T22:31:00Z', 'cubbies'], ['2026-10-14T22:59:00Z', 'black'],
    ['2026-10-14T23:04:00Z', 'sparks'], ['2026-10-14T23:29:00Z', 'black'], ['2026-10-14T23:33:00Z', 'lobby'], ['2026-10-15T00:01:00Z', 'off'],
    ['2026-10-13T22:40:00Z', 'off'], // a Tuesday
  ];
  for (const [now, want] of cases) {
    it(`${now} shows ${want}`, async () => {
      const page = await open(`?now=${now}`);
      await page.waitForFunction((w) => document.documentElement.dataset.phase === w, want, { timeout: 5000 });
      if (want === 'lobby') assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('lobby')).visibility), 'visible');
      else assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('lobby')).visibility), 'hidden');
      await page.close();
    });
  }
});

describe('the cards fit', { skip: SKIP }, () => {
  for (const size of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 3840, height: 2160 }, { width: 1024, height: 768 }]) {
    for (const card of ['cubbies', 'sparks']) {
      it(`${card} at ${size.width}x${size.height}: mark, title and chip on screen and apart`, async () => {
        const page = await open(`?preview=${card}`, size);
        const boxes = await page.evaluate((c) => {
          const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
          const root = document.getElementById(c);
          return {
            mark: box(root.querySelector('.cr-mark')),
            title: c === 'sparks' ? box(root.querySelector('.cr-headline span')) : null,
            chip: box(root.querySelector('.cr-chip')),
          };
        }, card);
        const inside = (b) => b.l >= 0 && b.t >= 0 && b.r <= size.width + 0.5 && b.b <= size.height + 0.5;
        const apart = (a, b) => a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t;
        for (const [name, b] of Object.entries(boxes)) if (b) assert.ok(inside(b), `${name} on screen: ${JSON.stringify(b)}`);
        assert.ok(apart(boxes.mark, boxes.chip), 'the mark clears the chip');
        if (boxes.title) assert.ok(apart(boxes.title, boxes.chip), 'the title clears the chip');
        await page.close();
      });
    }
  }
});

describe('welcomes', { skip: SKIP }, () => {
  const checkin = (id, firstName, club) => ({ type: 'awana-display:checkin', id, firstName, club });
  it('come from the lobby frame only, for the card\'s club only', async () => {
    const page = await open('?now=2026-10-14T22:40:00Z');
    await page.waitForFunction(() => document.documentElement.dataset.phase === 'cubbies');
    // A message the page posts to itself (not from its frame) is ignored.
    await page.evaluate((m) => window.postMessage(m, location.origin), checkin('x', 'Mallory', 'Cubbies'));
    await page.waitForTimeout(150);
    assert.equal(await page.isHidden('#welcome-cubbies'), true);
    assert.equal(await page.isHidden('#welcome-sparks'), true);
    // Another club's child: nothing.
    const frame = page.frame({ url: /\/lobby\/\?club=sparks/ });
    await frame.evaluate((m) => window.postMessage({ post: m }, location.origin), checkin('s', 'Sam', 'Sparks'));
    await page.waitForTimeout(150);
    assert.equal(await page.isHidden('#welcome-cubbies'), true);
    assert.equal(await page.isHidden('#welcome-sparks'), true);
    // The card's club: a welcome, and arrivals share it.
    await frame.evaluate((m) => window.postMessage({ post: m }, location.origin), checkin('a', 'Ava', 'Cubbies'));
    await page.waitForSelector('#welcome-cubbies:not([hidden])');
    await frame.evaluate((m) => window.postMessage({ post: m }, location.origin), checkin('b', 'Ben', 'Cubbies'));
    await page.waitForFunction(() => document.querySelector('#welcome-cubbies .cr-welcome-names').textContent === 'Ava & Ben!');
    // Names never reach storage.
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    assert.doesNotMatch(stored, /Ava|Ben/);
    await page.close();
  });

  it('in the black gap both neighbours are welcomed on the black, one card each', async () => {
    const page = await open('?now=2026-10-14T22:59:00Z');
    await page.waitForFunction(() => document.documentElement.dataset.phase === 'black');
    const frame = page.frame({ url: /\/lobby\/\?club=sparks/ });
    for (const m of [checkin('a', 'Ava', 'Cubbies'), checkin('m', 'Micah', 'Sparks'), checkin('t', 'Tom', 'T&T')]) {
      await frame.evaluate((x) => window.postMessage({ post: x }, location.origin), m);
    }
    await page.waitForSelector('#welcome-cubbies:not([hidden])');
    await page.waitForSelector('#welcome-sparks:not([hidden])');
    assert.equal(await page.textContent('#welcome-cubbies .cr-welcome-names'), 'Ava!');
    assert.equal(await page.textContent('#welcome-sparks .cr-welcome-names'), 'Micah!');
    // Nothing of the cards shows: the black is up, the chips hidden.
    assert.equal(await page.isHidden('#cubbies'), true);
    assert.equal(await page.isHidden('#sparks'), true);
    const slots = await page.evaluate(() => [...document.querySelectorAll('.cr-welcome')].map((el) => el.dataset.slot));
    assert.deepEqual(slots, ['left', 'right']);
    await page.close();
  });
});

describe('the black board (owner 2026-10-18)', { skip: SKIP }, () => {
  const lifted = (page) => page.evaluate(() => window.dispatchEvent(new Event('awana:pen-lifted')));
  const visible = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); return Boolean(el) && !el.closest('[hidden]') && getComputedStyle(el).display !== 'none'; }, sel);

  it('a lifted pen blacks the card out, keeping the club\'s chip; the undo button brings the card back', async () => {
    const page = await open('?now=2026-10-14T22:40:00Z');
    await page.waitForFunction(() => document.documentElement.dataset.phase === 'cubbies');
    await page.evaluate(() => localStorage.setItem('awanaClubCounts.v1', JSON.stringify({ v: 1, at: Date.now(), byClub: { cubbies: 7 } })));
    assert.equal(await visible(page, '#pen-btn'), true);
    await lifted(page);
    await page.waitForSelector('#board:not([hidden])');
    assert.equal(await page.getAttribute('#board .cr-chip', 'data-club'), 'cubbies');
    assert.equal(await visible(page, '#board .cr-board-undo'), true);
    assert.equal(await visible(page, '#pen-btn'), false);
    // The board is on top of the card (the spill's blob covers the middle as it grows).
    const top = await page.evaluate(() => document.elementFromPoint(innerWidth / 2, innerHeight / 2).closest('#board') !== null);
    assert.equal(top, true);
    // The ink spills, then the board rests plain black; the button is still up (a minute).
    assert.equal(await page.evaluate(() => document.getElementById('board').classList.contains('is-spilling')), true);
    await page.waitForFunction(() => document.getElementById('board').classList.contains('is-spilled'), null, { timeout: 3000 });
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('board')).backgroundColor), 'rgb(0, 0, 0)');
    assert.equal(await visible(page, '#board .cr-board-undo'), true);
    await page.click('#board .cr-board-undo');
    await page.waitForSelector('#board', { state: 'hidden' });
    assert.equal(await visible(page, '#cubbies'), true);
    await page.close();
  });

  it('welcomes the club on the board, centred', async () => {
    const page = await open('?now=2026-10-14T23:40:00Z');
    await page.waitForFunction(() => document.documentElement.dataset.phase === 'lobby');
    await lifted(page);
    await page.waitForSelector('#board:not([hidden])');
    assert.equal(await page.getAttribute('#board .cr-chip', 'data-club'), 'sparks');
    const frame = page.frame({ url: /\/lobby\/\?club=sparks/ });
    await frame.evaluate((m) => window.postMessage({ post: m }, location.origin), { type: 'awana-display:checkin', id: 'm', firstName: 'Micah', club: 'Sparks' });
    await page.waitForSelector('#welcome-sparks:not([hidden])');
    assert.equal(await page.getAttribute('#welcome-sparks', 'data-slot'), 'center');
    await page.close();
  });

  it('the pen button does it too, and the board goes when its period does', async () => {
    const page = await open('?now=2026-10-14T22:57:57Z');
    await page.waitForFunction(() => document.documentElement.dataset.phase === 'cubbies');
    await page.click('#pen-btn');
    await page.waitForSelector('#board:not([hidden])');
    await page.waitForFunction(() => document.documentElement.dataset.phase === 'black', null, { timeout: 8000 });
    assert.equal(await page.isHidden('#board'), true);
    assert.equal(await page.isHidden('#pen-btn'), true);
    // No board in a gap.
    await lifted(page);
    await page.waitForTimeout(400);
    assert.equal(await page.isHidden('#board'), true);
    await page.close();
  });

  it('a pen touching the card starts it; a finger does not', async () => {
    const page = await open('?now=2026-10-14T23:10:00Z');
    await page.waitForFunction(() => document.documentElement.dataset.phase === 'sparks');
    const down = (type) => page.evaluate((t) => document.getElementById('sparks').dispatchEvent(new PointerEvent('pointerdown', { pointerType: t, bubbles: true, clientX: 300, clientY: 300 })), type);
    await down('touch');
    await page.waitForTimeout(300);
    assert.equal(await page.isHidden('#board'), true);
    await down('pen');
    await page.waitForSelector('#board:not([hidden])');
    assert.equal(await page.getAttribute('#board .cr-chip', 'data-club'), 'sparks');
    await page.close();
  });

  for (const size of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 1024, height: 768 }]) {
    it(`fits at ${size.width}x${size.height}: chip top right, undo bottom left, apart`, async () => {
      const page = await open('?preview=board-cubbies', size);
      await page.waitForSelector('#board .cr-chip:not([hidden]) svg');
      const b = await page.evaluate(() => {
        const box = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
        return { chip: box('#board .cr-chip'), undo: box('#board .cr-board-undo') };
      });
      for (const x of Object.values(b)) assert.ok(x.l >= 0 && x.t >= 0 && x.r <= size.width + 0.5 && x.b <= size.height + 0.5, JSON.stringify(x));
      assert.ok(b.chip.r > size.width * 0.8 && b.chip.t < size.height * 0.2);
      assert.ok(b.undo.l < size.width * 0.2 && b.undo.b > size.height * 0.8);
      // The chalk Cubbie rests below the frame (he only peeks once a night).
      assert.ok(await page.evaluate(() => document.querySelector('.cr-chalk-cubbie').getBoundingClientRect().top >= innerHeight - 0.5));
      await page.close();
    });
  }
});
