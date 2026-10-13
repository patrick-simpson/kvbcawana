// The phone remote page (public/remote/) in real Chromium: signing in with the
// passphrase (v2: only the derived key leaves the phone), the layout on a
// phone (390x844, 360x740) and a tablet (1024x768), the presses it sends,
// the sample answers that stay on the phone, and its plain-words states.
// Every request is answered by test/remote-harness.mjs; skipped without Chromium.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOW, SESSION, SLIDES, answersFixture, chromiumMissing, CHROMIUM, openRemote, waitForMain } from './remote-harness.mjs';

const skip = chromiumMissing;

async function withBrowser(fn) {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  try {
    await fn(browser);
  } finally {
    await browser.close();
  }
}

const box = (page, sel) => page.locator(sel).boundingBox();

test('signed out: the passphrase card; signing in sends only the derived key, keeps only the session', { skip }, async () => {
  await withBrowser(async (browser) => {
    const { page, calls, context } = await openRemote(browser, { width: 390, height: 844 }, { signedIn: false });
    await page.waitForSelector('#signin:not([hidden])');
    assert.equal(await page.isVisible('#remote'), false);
    assert.equal(await page.textContent('#conn'), 'Signed out');
    await page.fill('#passphrase', 'Kennebec');
    await page.click('#signin-btn');
    await page.waitForSelector('#remote:not([hidden])', { timeout: 15000 });
    const login = calls.find((c) => c.path === '/v1/login');
    assert.equal(typeof login.body.authKey, 'string');
    assert.equal('passphrase' in login.body, false, 'the word never leaves the phone');
    const stored = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));
    assert.equal(stored['awanaSyncSession.v1'], SESSION);
    assert.equal(JSON.stringify(stored).toLowerCase().includes('kennebec'), false, 'the passphrase is not kept anywhere');
    assert.equal(await page.inputValue('#passphrase'), '');
    await waitForMain(page, 'Slides 3 of 7');
    await context.close();
  });
});

test('a session the service no longer takes goes back to the sign-in card, in plain words', { skip }, async () => {
  await withBrowser(async (browser) => {
    const { page, context } = await openRemote(browser, { width: 390, height: 844 });
    await waitForMain(page, 'Slides 3 of 7');
    await page.evaluate(() => localStorage.setItem('awanaSyncSession.v1', 'v1.1.1.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'));
    await page.waitForSelector('#signin:not([hidden])', { timeout: 5000 });
    assert.match(await page.textContent('#signin-note'), /signed out|passphrase/i);
    await context.close();
  });
});

for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 740 }, { width: 1024, height: 768 }]) {
  test(`layout at ${viewport.width}x${viewport.height}: no sideways scroll, Back and Next thumb-sized, every control reachable`, { skip }, async () => {
    await withBrowser(async (browser) => {
      const { page, context } = await openRemote(browser, viewport, {
        kiosks: [
          { id: 'jk_aaaaaaaaaaaaaaaaaaaa', name: 'Journey kiosk', online: true, now: NOW.questions() },
          { id: 'jk_bbbbbbbbbbbbbbbbbbbb', name: 'Gym TV', online: false, now: null },
        ],
        answers: answersFixture(),
      });
      await waitForMain(page, 'Slides 5 of 7');
      await page.click('#picker summary');
      await page.click('#screens summary');
      await page.waitForSelector('#answers:not([hidden])');
      const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      assert.ok(m.sw <= m.iw, `no horizontal scroll (${m.sw} > ${m.iw})`);
      const next = await box(page, '#btn-next');
      const back = await box(page, '#btn-prev');
      assert.ok(next.height >= 72 && back.height >= 72, `Back ${back.height}px, Next ${next.height}px tall`);
      assert.ok(next.width > back.width, 'Next is the bigger one');
      assert.ok(next.width >= 160, `Next is ${next.width}px wide`);
      // Next is on the first screenful of a phone, under the readout.
      if (viewport.width < 600) assert.ok(next.y + next.height <= viewport.height, `Next ends at ${next.y + next.height}px`);
      // Every button and field: on the page's width, at least 44px to tap, and not covered.
      const controls = await page.$$eval('button, select, summary, input', (els) => els
        .filter((el) => el.offsetParent !== null)
        .map((el) => { const r = el.getBoundingClientRect(); return { id: el.id || el.textContent.trim().slice(0, 24), x: r.x, w: r.width, h: r.height }; }));
      for (const c of controls) {
        assert.ok(c.x >= 0 && c.x + c.w <= viewport.width + 0.5, `${c.id} fits across (${c.x}+${c.w})`);
        assert.ok(c.h >= 44, `${c.id} is ${c.h}px tall`);
      }
      const big = await page.$$eval('.video [data-action]', (els) => els.map((el) => el.getBoundingClientRect().height));
      for (const h of big) assert.ok(h >= 72, `video buttons ${h}px tall`);
      // The reach line names the online count from the service.
      assert.match(await page.textContent('#reach'), /every Journey screen \(1 online\)/);
      assert.match(await page.textContent('#screens-list'), /Gym TV\s*Offline/);
      await context.close();
    });
  });
}

test('presses: one request each, the right action; the readout follows the screen', { skip }, async () => {
  await withBrowser(async (browser) => {
    const { page, calls, ctl, context } = await openRemote(browser, { width: 390, height: 844 });
    await waitForMain(page, 'Slides 3 of 7');
    assert.match(await page.textContent('#now-sub'), /^Week 5 · /);
    assert.match(await page.textContent('#now-last'), /Next: done/);
    const presses = () => calls.filter((c) => c.path === '/v1/journey/remote').map((c) => c.body);
    await page.click('#btn-next');
    await page.click('#btn-next');
    await page.click('#btn-prev');
    await page.click('#btn-slides');
    await page.waitForFunction(() => true);
    for (let i = 0; i < 50 && presses().length < 4; i += 1) await page.waitForTimeout(20);
    assert.deepEqual(presses(), [{ action: 'slide-next' }, { action: 'slide-next' }, { action: 'slide-prev' }, { action: 'slides-start' }]);

    ctl.kiosks = [{ id: 'jk_aaaaaaaaaaaaaaaaaaaa', name: 'Journey kiosk', online: true, now: NOW.video(5, 765, 902, false) }];
    await waitForMain(page, 'Video 12:4');
    assert.match(await page.textContent('#now-main'), /^Video 12:4\d \/ 15:02$/);
    assert.equal(await page.textContent('#now-detail'), 'Playing');
    assert.equal(await page.textContent('#btn-play'), 'Pause');
    await page.click('#btn-play');
    await page.click('.video [data-by="-15"]');
    await page.click('.video [data-by="15"]');
    await page.click('#btn-mute');
    for (let i = 0; i < 50 && presses().length < 8; i += 1) await page.waitForTimeout(20);
    assert.deepEqual(presses().slice(4), [{ action: 'pause' }, { action: 'seek', data: { by: -15 } }, { action: 'seek', data: { by: 15 } }, { action: 'mute' }]);

    ctl.kiosks = [{ id: 'jk_aaaaaaaaaaaaaaaaaaaa', name: 'Journey kiosk', online: true, now: { ...NOW.checkin(), last: { id: 'x', action: 'slide-next', ok: false, reason: 'no-slides' } } }];
    await waitForMain(page, 'Check-in display');
    assert.equal(await page.textContent('#now-last'), 'Next skipped: No teaching slides are showing.');
    await context.close();
  });
});

test('picking a lesson over a running one asks first, then sends force; over nothing it just goes', { skip }, async () => {
  await withBrowser(async (browser) => {
    const { page, calls, ctl, context } = await openRemote(browser, { width: 390, height: 844 }, {
      kiosks: [{ id: 'jk_aaaaaaaaaaaaaaaaaaaa', name: 'Journey kiosk', online: true, now: NOW.video() }],
    });
    await waitForMain(page, 'Video');
    await page.click('#picker summary');
    await page.waitForFunction(() => document.querySelectorAll('#week option').length >= 30);
    assert.equal(await page.inputValue('#week'), '5', 'opens on the lesson on the screen');
    // Week 27 has no Leader Video: its Leader buttons are off.
    await page.selectOption('#week', '27');
    assert.equal(await page.isDisabled('[data-choice="leader"]'), true);
    assert.equal(await page.isDisabled('[data-choice="slides"]'), false);
    await page.selectOption('#week', '6');
    const picks = () => calls.filter((c) => c.path === '/v1/journey/remote' && c.body.action === 'pick').map((c) => c.body.data);
    await page.click('[data-choice="slides"]');
    await page.waitForSelector('#confirm:not([hidden])');
    assert.match(await page.textContent('#confirm-text'), /Replace it with Week 6, Teaching slides/);
    await page.waitForTimeout(150);
    assert.deepEqual(picks(), [], 'nothing sent before the confirm tap');
    await page.click('#confirm-no');
    assert.deepEqual(picks(), []);
    await page.click('[data-choice="slides"]');
    await page.click('#confirm-yes');
    for (let i = 0; i < 50 && !picks().length; i += 1) await page.waitForTimeout(20);
    assert.deepEqual(picks(), [{ week: 6, choice: 'slides', force: true }]);
    ctl.kiosks = [{ id: 'jk_aaaaaaaaaaaaaaaaaaaa', name: 'Journey kiosk', online: true, now: NOW.checkin() }];
    await waitForMain(page, 'Check-in display');
    await page.click('[data-choice="student"]');
    for (let i = 0; i < 50 && picks().length < 2; i += 1) await page.waitForTimeout(20);
    assert.deepEqual(picks()[1], { week: 6, choice: 'student' });
    // The page never names or links a video file.
    const html = await page.content();
    assert.equal(/\.mp4|cdn|clubs\.awana\.org|downloadUrl/i.test(html), false);
    await context.close();
  });
});

test('sample answers: shown for the questions on the wall, on this phone only', { skip }, async () => {
  await withBrowser(async (browser) => {
    const fixture = answersFixture();
    const { page, calls, ctl, context } = await openRemote(browser, { width: 390, height: 844 }, {
      kiosks: [{ id: 'jk_aaaaaaaaaaaaaaaaaaaa', name: 'Journey kiosk', online: true, now: NOW.questions() }],
      answers: fixture,
    });
    await waitForMain(page, 'Slides 5 of 7');
    await page.waitForSelector('#answers:not([hidden])');
    const qs = SLIDES.weeks['5'].notes.questions;
    assert.deepEqual(await page.$$eval('#answers-list summary', (els) => els.map((e) => e.textContent)), qs);
    assert.equal(await page.isVisible('#answers-list .answer'), false, 'collapsed until tapped');
    await page.click('#answers-list summary >> nth=0');
    assert.equal(await page.isVisible('#answers-list .answer >> nth=0'), true);
    assert.match(await page.textContent('#answers-list li:nth-child(1)'), /Look at: Romans 12:2/);
    assert.match(await page.textContent('#answers-list li:nth-child(1)'), /Video says this at 6:20/);
    assert.equal(await page.isVisible('#now-lines'), false, 'the questions are in the answers list already');
    // The open one stays open across polls.
    await page.waitForTimeout(700);
    assert.equal(await page.isVisible('#answers-list .answer >> nth=0'), true);
    // Tapping the time hint does nothing: no request at all.
    const before = calls.length;
    const pressesBefore = calls.filter((c) => c.path === '/v1/journey/remote').length;
    await page.click('#answers-list .when >> nth=0');
    await page.waitForTimeout(100);
    assert.equal(calls.filter((c) => c.path === '/v1/journey/remote').length, pressesBefore);
    assert.ok(calls.length >= before);
    // Nothing of an answer ever leaves the phone.
    const sent = JSON.stringify(calls.map((c) => c.body));
    for (const a of fixture.weeks[5]) assert.equal(sent.includes(a.answer.slice(0, 30)), false);

    // Questions edited on the screen: the answers are hidden, and it says why.
    ctl.kiosks = [{ id: 'jk_aaaaaaaaaaaaaaaaaaaa', name: 'Journey kiosk', online: true, now: NOW.questions(5, [qs[0], 'Our own question?', qs[2]]) }];
    await page.waitForSelector('#answers-edited:not([hidden])', { timeout: 5000 });
    assert.equal(await page.$$eval('#answers-list li', (els) => els.length), 0);
    assert.equal(await page.isVisible('#now-lines'), true, 'the edited lines themselves are shown');
    // Another slide: no answers section.
    ctl.kiosks = [{ id: 'jk_aaaaaaaaaaaaaaaaaaaa', name: 'Journey kiosk', online: true, now: NOW.slides(5, 2) }];
    await page.waitForSelector('#answers[hidden]', { state: 'attached', timeout: 5000 });
    await context.close();
  });
});

test('no answers file yet: the answers section is simply absent', { skip }, async () => {
  await withBrowser(async (browser) => {
    const { page, context } = await openRemote(browser, { width: 390, height: 844 }, {
      kiosks: [{ id: 'jk_aaaaaaaaaaaaaaaaaaaa', name: 'Journey kiosk', online: true, now: NOW.questions() }],
      answers: null,
    });
    await waitForMain(page, 'Slides 5 of 7');
    await page.waitForTimeout(400);
    assert.equal(await page.isVisible('#answers'), false);
    assert.equal(await page.isVisible('#now-lines'), true, 'the questions on the wall still show');
    await context.close();
  });
});

test('the service unreachable: "Reconnecting…" in plain words, and it recovers by itself', { skip }, async () => {
  await withBrowser(async (browser) => {
    const { page, ctl, context } = await openRemote(browser, { width: 390, height: 844 });
    await waitForMain(page, 'Slides 3 of 7');
    ctl.stateStatus = 503;
    await page.waitForSelector('#problem:not([hidden])', { timeout: 5000 });
    assert.match(await page.textContent('#problem'), /Reconnecting…/);
    assert.equal(await page.textContent('#conn'), 'Reconnecting…');
    ctl.stateStatus = 200;
    await page.waitForSelector('#problem[hidden]', { state: 'attached', timeout: 5000 });
    assert.equal(await page.textContent('#conn'), 'Connected');
    // No screen signed in at all.
    ctl.kiosks = [];
    await page.waitForSelector('#problem:not([hidden])', { timeout: 5000 });
    assert.match(await page.textContent('#problem'), /No Journey screen has signed in yet/);
    await context.close();
  });
});

test('stops asking while the page is hidden', { skip }, async () => {
  await withBrowser(async (browser) => {
    const { page, calls, context } = await openRemote(browser, { width: 390, height: 844 });
    await waitForMain(page, 'Slides 3 of 7');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const n = calls.length;
    await page.waitForTimeout(900);
    assert.equal(calls.length, n, 'no polls while hidden');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(400);
    assert.ok(calls.length > n, 'back to polling when shown');
    await context.close();
  });
});
