// Opens the phone remote (public/remote/) in real Chromium with every request
// answered here: the page and the brand kit from public/, the site's
// shared/sync.json naming a stand-in sync Worker on the same origin
// (/api, as the real site serves it), and that Worker's sign-in, state and
// press routes. Used by test/remote-page.test.mjs (and for screenshots).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PUBLIC = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'public');
export const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';
export const chromiumMissing = existsSync(CHROMIUM) ? false : `no Chromium at ${CHROMIUM}`;
export const ORIGIN = 'https://journey.test';
export const SESSION = 'v1.1.1790839331729.oWr6n92IJW5ldPGmtiyjPHAZpca-QGToNlKGXlKI6vc';
export const V2_PARAMS = { v: 2, salt: 'AAECAwQFBgcICQoLDA0ODw==', iter: 600000, legacy: true, upgrade: false };
export const SLIDES = JSON.parse(readFileSync(path.join(PUBLIC, 'teaching-slides.json'), 'utf8'));
export const LESSONS = JSON.parse(readFileSync(path.join(PUBLIC, 'lessons.json'), 'utf8'));

const TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

const titleOf = (week) => LESSONS.lessons.find((l) => l.week === week).title;

/* Reports a kiosk would send (shared/journeyRemote.js shape). */
export const NOW = {
  slides: (week = 5, n = 3, of = 7) => ({
    view: 'slides', week, title: titleOf(week), preview: false, wait: null,
    slide: { n, of, kind: n <= 4 ? ['title', 'verse', 'misconception', 'illumination'][n - 1] : 'template', heading: null, lines: [] },
    last: { id: 'r1', action: 'slide-next', ok: true, reason: null }, at: null,
  }),
  questions: (week = 5, lines = SLIDES.weeks[String(week)].notes.questions) => ({
    view: 'slides', week, title: titleOf(week), preview: false, wait: null,
    slide: { n: 5, of: 7, kind: 'questions', heading: 'Talk About It', lines },
    last: null, at: null,
  }),
  video: (week = 5, t = 765, d = 902, paused = false, volume = 60, muted = false) => ({
    view: 'video', week, title: titleOf(week), preview: false, wait: null,
    video: { t, d, paused, muted, volume }, last: null, at: null,
  }),
  checkin: (week = 5) => ({ view: 'checkin', week, title: titleOf(week), preview: false, wait: null, last: null, at: null }),
};

/* Sample answers for a week, written against its real questions. */
export function answersFixture(week = 5) {
  const qs = SLIDES.weeks[String(week)].notes.questions;
  return {
    version: 1,
    weeks: {
      [week]: [
        { q: qs[0], answer: 'Family, friends, school and what we watch all shape how we see things, often before we notice.', scripture: 'Romans 12:2', at: 380 },
        { q: qs[1], answer: 'Where two beliefs we hold cannot both be true, and we pick whichever suits the moment.', scripture: null, at: null },
        { q: qs[2], answer: 'A story shows what it thinks matters most: who the hero is and what counts as winning.', scripture: null, at: 512 },
      ],
    },
  };
}

/**
 * @param browser  a playwright-core Chromium
 * @param viewport {width, height}
 * @param opts { signedIn, kiosks (array or function), answers (object | null = 404), echo (false: no report names a press) }
 */
export async function openRemote(browser, viewport, opts = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: viewport.width < 600, hasTouch: true, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const calls = [];
  const ctl = {
    kiosks: opts.kiosks || [{ id: 'jk_aaaaaaaaaaaaaaaaaaaa', name: 'Journey kiosk', online: true, now: NOW.slides() }],
    stateStatus: 200,
    answers: opts.answers === undefined ? null : opts.answers,
    // As a kiosk does: its report names the latest press it ran (false: no kiosk answers).
    echo: opts.echo !== false,
    lastPress: null,
  };
  if (opts.signedIn !== false) {
    await page.addInitScript((s) => { localStorage.setItem('awanaSyncSession.v1', s); }, SESSION);
  }
  await page.addInitScript(() => { window.journeyRemoteTuning = { pollMs: 300, afterPressMs: 100 }; });
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== ORIGIN) return route.fulfill({ status: 404, body: '' });
    const p = url.pathname;
    const send = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (p === '/lobby/shared/sync.json') return send(200, { url: `${ORIGIN}/api` });
    if (p.startsWith('/api/')) {
      const body = req.postData() ? JSON.parse(req.postData()) : null;
      const call = { method: req.method(), path: p.slice(4), body, auth: req.headers().authorization || null };
      calls.push(call);
      if (call.path === '/v1/auth/params') return send(200, V2_PARAMS);
      if (call.path === '/v1/login') {
        if (!body.authKey || body.passphrase) return send(401, { reason: 'wrong', triesLeft: 4 });
        return send(200, { session: SESSION, displayKey: 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=', state: {} });
      }
      if (call.auth !== `Bearer ${SESSION}`) return send(401, { reason: 'signed-out' });
      // The fixture's `last` says how the latest press went; its id becomes that press's.
      const echoed = (k) => {
        const p = ctl.lastPress;
        if (!ctl.echo || !p || !k.online) return {};
        return { last: k.now.last ? { ...k.now.last, id: p.id } : { id: p.id, action: p.action, ok: true, reason: null } };
      };
      if (call.path === '/v1/journey/remote/state') {
        const status = typeof ctl.stateStatus === 'function' ? ctl.stateStatus() : ctl.stateStatus;
        if (status !== 200) return route.fulfill({ status, body: 'down' });
        const kiosks = typeof ctl.kiosks === 'function' ? ctl.kiosks() : ctl.kiosks;
        const at = new Date().toISOString();
        return send(200, {
          kiosks: kiosks.map((k) => ({ ...k, now: k.now ? { ...k.now, ...echoed(k), at } : null })),
          online: kiosks.filter((k) => k.online).length,
          serverNow: at,
          watchMs: 30000,
        });
      }
      if (call.path === '/v1/journey/remote' && req.method() === 'POST') {
        const id = `r${calls.length}`;
        ctl.lastPress = { id, action: body.action };
        return send(200, { ok: true, id, kiosks: 1, online: 1 });
      }
      return send(404, { error: 'Not found.' });
    }
    if (p === '/journey/slide-answers.json') {
      return ctl.answers ? send(200, ctl.answers) : route.fulfill({ status: 404, body: 'Not found' });
    }
    if (!p.startsWith('/journey/')) return route.fulfill({ status: 404, body: '' });
    let rel = p.slice('/journey/'.length);
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const file = path.join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC) || !existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream', body: readFileSync(file) });
  });
  await page.goto(`${ORIGIN}/journey/remote/`);
  return { context, page, calls, ctl };
}

/* Wait for the readout to say `text` (the first poll lands within a moment). */
export async function waitForMain(page, text) {
  await page.waitForFunction((t) => (document.getElementById('now-main')?.textContent || '').includes(t), text, { timeout: 5000 });
}
