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
      // The video card's buttons on screen (End video is hidden with no video up).
      const big = await page.$$eval('.video [data-action]', (els) => els.filter((el) => el.offsetParent !== null).map((el) => el.getBoundingClientRect().height));
      assert.ok(big.length >= 6, `${big.length} video buttons on screen`);
      for (const h of big) assert.ok(h >= 72, `video buttons ${h}px tall`);
      // The header stays on one line, its status pill inside the right gutter.
      const conn = await box(page, '#conn');
      const top = await box(page, '.top');
      assert.ok(conn.x + conn.width <= viewport.width - 15.5, `the status pill ends at ${conn.x + conn.width}px`);
      assert.ok(top.height <= 60, `the header is ${top.height}px tall`);
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
    // On the slides "Start teaching slides" is not there (the screen would only say it already is).
    assert.equal(await page.isVisible('#btn-slides'), false);
    await page.click('#btn-next');
    await page.click('#btn-next');
    await page.click('#btn-prev');
    ctl.kiosks = [{ id: 'jk_aaaaaaaaaaaaaaaaaaaa', name: 'Journey kiosk', online: true, now: NOW.checkin() }];
    await waitForMain(page, 'Check-in display');
    assert.equal(await page.textContent('#btn-slides'), 'Start teaching slides');
    await page.click('#btn-slides');
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
    // Muted: Unmute is the hot button.
    ctl.kiosks = [{ id: 'jk_aaaaaaaaaaaaaaaaaaaa', name: 'Journey kiosk', online: true, now: NOW.video(5, 765, 902, false, 60, true) }];
    await page.waitForFunction(() => document.getElementById('btn-mute').textContent === 'Unmute');
    assert.equal(await page.getAttribute('#btn-mute', 'data-action'), 'unmute');
    assert.match(await page.getAttribute('#btn-mute', 'class'), /\bbtn-hot\b/);

    ctl.kiosks = [{ id: 'jk_aaaaaaaaaaaaaaaaaaaa', name: 'Journey kiosk', online: true, now: { ...NOW.checkin(), last: { id: 'x', action: 'slide-next', ok: false, reason: 'no-slides' } } }];
    await waitForMain(page, 'Check-in display');
    assert.equal(await page.textContent('#now-last'), 'Next skipped: No teaching slides are showing.');
    await context.close();
  });
});

test('volume: big - and + with the level between, each tap one step press, off with no video', { skip }, async () => {
  for (const viewport of [{ width: 360, height: 740 }, { width: 430, height: 900 }]) {
    await withBrowser(async (browser) => {
      const { page, calls, ctl, context } = await openRemote(browser, viewport);
      await waitForMain(page, 'Slides 3 of 7');
      // No video showing: the control is there but off.
      assert.equal(await page.isDisabled('#btn-vol-down'), true);
      assert.equal(await page.isDisabled('#btn-vol-up'), true);
      assert.equal(await page.textContent('#vol-level'), 'Volume: no video');

      ctl.kiosks = [{ id: 'jk_aaaaaaaaaaaaaaaaaaaa', name: 'Journey kiosk', online: true, now: NOW.video(5, 765, 902, false, 60) }];
      await waitForMain(page, 'Video 12:4');
      assert.equal(await page.textContent('#vol-level'), 'Volume 60%');
      assert.equal(await page.isDisabled('#btn-vol-down'), false);
      const down = await box(page, '#btn-vol-down');
      const up = await box(page, '#btn-vol-up');
      const level = await box(page, '#vol-level');
      const next = await box(page, '#btn-next');
      assert.ok(down.height >= 112 && up.height >= 112, `buttons ${down.height}/${up.height}px tall`);
      assert.ok(down.width >= 72 && up.width >= 72, `buttons ${down.width}/${up.width}px wide`);
      assert.ok(down.x + down.width <= level.x && level.x + level.width <= up.x, 'the level sits between - and +');
      assert.ok(down.x >= 0 && up.x + up.width <= viewport.width, 'both fit across the phone');
      assert.ok(next.height >= 112 && down.height >= next.height - 1, 'as big as Back / Next');
      const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      assert.ok(m.sw <= m.iw, 'no sideways scroll');

      const presses = () => calls.filter((c) => c.path === '/v1/journey/remote').map((c) => c.body);
      await page.click('#btn-vol-up');
      await page.click('#btn-vol-down');
      await page.click('#btn-vol-down');
      for (let i = 0; i < 50 && presses().length < 3; i += 1) await page.waitForTimeout(20);
      assert.deepEqual(presses(), [{ action: 'volume', data: { step: 1 } }, { action: 'volume', data: { step: -1 } }, { action: 'volume', data: { step: -1 } }]);

      // The ends: - is off at 0, + is off at 100 unless muted; muted shows in the words.
      ctl.kiosks = [{ id: 'jk_aaaaaaaaaaaaaaaaaaaa', name: 'Journey kiosk', online: true, now: NOW.video(5, 765, 902, false, 0) }];
      await page.waitForFunction(() => document.getElementById('vol-level').textContent === 'Volume 0%');
      assert.equal(await page.isDisabled('#btn-vol-down'), true);
      assert.equal(await page.isDisabled('#btn-vol-up'), false);
      ctl.kiosks = [{ id: 'jk_aaaaaaaaaaaaaaaaaaaa', name: 'Journey kiosk', online: true, now: NOW.video(5, 765, 902, false, 100) }];
      await page.waitForFunction(() => document.getElementById('vol-level').textContent === 'Volume 100%');
      assert.equal(await page.isDisabled('#btn-vol-up'), true);
      ctl.kiosks = [{ id: 'jk_aaaaaaaaaaaaaaaaaaaa', name: 'Journey kiosk', online: true, now: NOW.video(5, 765, 902, false, 100, true) }];
      await page.waitForFunction(() => document.getElementById('vol-level').textContent === 'Volume 100% · muted');
      assert.equal(await page.isDisabled('#btn-vol-up'), false);
      await context.close();
    });
  }
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
    // What is shown is the last thing heard, and it says so.
    await page.waitForFunction(() => /not live/.test(document.getElementById('now-kicker').textContent));
    assert.match(await page.getAttribute('#now', 'class'), /\bis-stale\b/);
    const conn = await box(page, '#conn');
    assert.ok(conn.x + conn.width <= 390 - 15.5, 'Reconnecting… fits inside the gutter');
    ctl.stateStatus = 200;
    await page.waitForSelector('#problem[hidden]', { state: 'attached', timeout: 5000 });
    assert.equal(await page.textContent('#conn'), 'Connected');
    assert.equal(await page.textContent('#now-kicker'), 'On the screen now');
    assert.doesNotMatch(await page.getAttribute('#now', 'class'), /is-stale/);
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

test('Back and Next stay put from slide to slide: the bullets, the answers and the press line go below them', { skip }, async () => {
  await withBrowser(async (browser) => {
    for (const viewport of [{ width: 360, height: 740 }, { width: 390, height: 844 }]) {
      const { page, ctl, context } = await openRemote(browser, viewport, {
        kiosks: [{ id: 'jk_aaaaaaaaaaaaaaaaaaaa', name: 'Journey kiosk', online: true, now: { ...NOW.slides(5, 3, 7), last: null } }],
        answers: answersFixture(),
      });
      await waitForMain(page, 'Slides 3 of 7');
      const at = async () => Math.round((await box(page, '#btn-next')).y);
      const first = await at();
      const slide = (now) => { ctl.kiosks = [{ id: 'jk_aaaaaaaaaaaaaaaaaaaa', name: 'Journey kiosk', online: true, now }]; };
      // Three bullets on the wall, a long template heading, and how the last press went.
      slide({
        ...NOW.slides(5, 6, 7),
        slide: {
          n: 6, of: 7, kind: 'template', heading: 'A heading long enough that it would wrap onto a second line on any phone',
          lines: ['Everyone has a worldview, whether they know it or not.', 'A worldview answers the big questions of life.', 'Scripture is the lens that brings it into focus.'],
        },
        last: { id: 'x', action: 'slide-next', ok: true, reason: null },
      });
      await waitForMain(page, 'Slides 6 of 7');
      await page.waitForSelector('#lines:not([hidden])');
      assert.equal(await at(), first, 'bullets and the press line do not move Next');
      const next = await box(page, '#btn-next');
      assert.ok((await box(page, '#lines')).y > next.y + next.height, 'the wall\'s bullets sit below the buttons');
      assert.ok((await box(page, '#now-last')).y > next.y + next.height, 'so does the press line');
      // The questions slide with its sample answers.
      slide(NOW.questions());
      await waitForMain(page, 'Slides 5 of 7');
      await page.waitForSelector('#answers:not([hidden])');
      assert.equal(await at(), first, 'the answers do not move Next');
      // The screen waiting for a person: that line goes below too, and the skip does not repeat it.
      slide({ ...NOW.slides(5, 3, 7), wait: 'settings', last: { id: 'x', action: 'slide-next', ok: false, reason: 'settings-open' } });
      await page.waitForSelector('#now-wait:not([hidden])');
      await page.waitForFunction(() => document.getElementById('now-last').textContent === 'Next skipped.');
      assert.equal(await at(), first, 'nor does a waiting line');
      assert.ok(first + next.height <= viewport.height, 'Next is on the first screenful');
      await context.close();
    }
  });
});

test('a press says at once that it is on its way, then how the screen took it, or that no screen answered', { skip }, async () => {
  await withBrowser(async (browser) => {
    const { page, ctl, context } = await openRemote(browser, { width: 390, height: 844 }, {
      echo: false,
      kiosks: [{ id: 'jk_aaaaaaaaaaaaaaaaaaaa', name: 'Journey kiosk', online: true, now: { ...NOW.slides(), last: null } }],
    });
    await waitForMain(page, 'Slides 3 of 7');
    await page.evaluate(() => { window.journeyRemoteTuning.pressAnswerMs = 800; });
    assert.equal(await page.isVisible('#now-last'), false, 'nothing pressed yet');
    await page.click('#btn-next');
    await page.waitForFunction(() => /^Next: (sending|sent, waiting)/.test(document.getElementById('now-last').textContent));
    assert.equal(await page.getAttribute('#now-last', 'data-ok'), 'wait');
    // No report names the press: after a while the phone says so.
    await page.waitForFunction(() => /no screen has answered/.test(document.getElementById('now-last').textContent), null, { timeout: 5000 });
    assert.equal(await page.getAttribute('#now-last', 'data-ok'), 'false');
    // The screen names it: its own words replace the waiting.
    ctl.echo = true;
    await page.waitForFunction(() => document.getElementById('now-last').textContent === 'Next: done ✓', null, { timeout: 5000 });
    assert.equal(await page.getAttribute('#now-last', 'data-ok'), 'true');
    ctl.kiosks = [{ id: 'jk_aaaaaaaaaaaaaaaaaaaa', name: 'Journey kiosk', online: true, now: { ...NOW.slides(5, 1, 7), last: { id: 'x', action: 'slide-prev', ok: false, reason: 'first-slide' } } }];
    await page.click('#btn-prev');
    await page.waitForFunction(() => document.getElementById('now-last').textContent === 'Back skipped: Already on the first slide.', null, { timeout: 5000 });
    await context.close();
  });
});

test('the controls follow the screen: Begin on the start screen, the video\'s buttons first during a video, Skip to slides takes two taps', { skip }, async () => {
  await withBrowser(async (browser) => {
    const splash = { view: 'splash', week: 5, title: 'Unit 2, Lesson 1: Worldview', preview: false, wait: null, last: null, at: null };
    const { page, calls, ctl, context } = await openRemote(browser, { width: 360, height: 740 }, {
      kiosks: [{ id: 'jk_aaaaaaaaaaaaaaaaaaaa', name: 'Journey kiosk', online: true, now: { ...splash, resume: 252 } }],
    });
    const presses = () => calls.filter((c) => c.path === '/v1/journey/remote').map((c) => c.body);
    await waitForMain(page, 'Ready to begin');
    // The start screen: a big hot Begin (Resume when offered) on the first screenful.
    await page.waitForSelector('#btn-begin:not([hidden])');
    assert.equal(await page.textContent('#btn-begin'), 'Resume at 4:12');
    const begin = await box(page, '#btn-begin');
    assert.ok(begin.height >= 112 && begin.y + begin.height <= 740, `Begin ${begin.height}px tall, ends at ${begin.y + begin.height}px`);
    assert.equal(await page.textContent('#btn-slides'), 'Skip to teaching slides');
    await page.click('#btn-begin');
    for (let i = 0; i < 50 && presses().length < 1; i += 1) await page.waitForTimeout(20);
    assert.deepEqual(presses(), [{ action: 'begin' }]);

    // A video: no Begin; the video's buttons straight under the readout, Back / Next below them.
    ctl.kiosks = [{ id: 'jk_aaaaaaaaaaaaaaaaaaaa', name: 'Journey kiosk', online: true, now: NOW.video(5, 765, 902, false, 60) }];
    await waitForMain(page, 'Video 12:4');
    assert.equal(await page.isVisible('#btn-begin'), false);
    const now = await box(page, '#now');
    const video = await box(page, '#video');
    const pad = await box(page, '#slide-pad');
    assert.ok(video.y > now.y && video.y < pad.y, 'the video card leads');
    const mute = await box(page, '#btn-mute');
    assert.ok(mute.y + mute.height <= 740, `Mute is on the first screenful (ends at ${mute.y + mute.height}px)`);
    // Skip to teaching slides ends the video: the first tap only asks.
    assert.equal(await page.textContent('#btn-slides'), 'Skip to teaching slides');
    await page.click('#btn-slides');
    await page.waitForFunction(() => document.getElementById('btn-slides').textContent === 'Tap again to end the video');
    await page.waitForTimeout(250);
    assert.deepEqual(presses().slice(1), [], 'nothing sent on the first tap');
    await page.click('#btn-slides');
    for (let i = 0; i < 50 && presses().length < 2; i += 1) await page.waitForTimeout(20);
    assert.deepEqual(presses().slice(1), [{ action: 'slides-start' }]);
    await page.waitForFunction(() => document.getElementById('btn-slides').textContent === 'Skip to teaching slides');
    await context.close();
  });
});

test('End video takes two taps and sends video-end; Go to the Journey screen shows over the Check-in Display (owner 2026-10-28)', { skip }, async () => {
  await withBrowser(async (browser) => {
    const id = 'jk_aaaaaaaaaaaaaaaaaaaa';
    const { page, calls, ctl, context } = await openRemote(browser, { width: 360, height: 740 }, {
      kiosks: [{ id, name: 'Journey kiosk', online: true, now: { view: 'checkin', week: 5, title: 'Unit 2, Lesson 1: Worldview', preview: false, wait: null, last: null, at: null } }],
    });
    const presses = () => calls.filter((c) => c.path === '/v1/journey/remote').map((c) => c.body);
    await waitForMain(page, 'Check-in display');
    // Over the Check-in Display: a big hot button to the Journey screen, on the first screenful; no End video.
    await page.waitForSelector('#btn-journey:not([hidden])');
    assert.equal(await page.textContent('#btn-journey'), 'Go to the Journey screen');
    const go = await box(page, '#btn-journey');
    assert.ok(go.height >= 112 && go.y + go.height <= 740, `Go ${go.height}px tall, ends at ${go.y + go.height}px`);
    assert.equal(await page.isVisible('#btn-end'), false);
    await page.click('#btn-journey');
    for (let i = 0; i < 50 && presses().length < 1; i += 1) await page.waitForTimeout(20);
    assert.deepEqual(presses(), [{ action: 'show-journey' }]);

    // A video: End video in the video card, thumb-sized; the Journey button gone.
    ctl.kiosks = [{ id, name: 'Journey kiosk', online: true, now: NOW.video(5, 765, 902, false, 60) }];
    await waitForMain(page, 'Video 12:4');
    assert.equal(await page.isVisible('#btn-journey'), false);
    await page.waitForSelector('#btn-end:not([hidden])');
    const end = await box(page, '#btn-end');
    assert.ok(end.height >= 72, `End video ${end.height}px tall`);
    // It stops the video for the room: the first tap only asks.
    await page.click('#btn-end');
    await page.waitForFunction(() => document.getElementById('btn-end').textContent === 'Tap again to stop it');
    await page.waitForTimeout(250);
    assert.deepEqual(presses().slice(1), [], 'nothing sent on the first tap');
    await page.click('#btn-end');
    for (let i = 0; i < 50 && presses().length < 2; i += 1) await page.waitForTimeout(20);
    assert.deepEqual(presses().slice(1), [{ action: 'video-end' }]);
    await page.waitForFunction(() => document.getElementById('btn-end').textContent === 'End video');

    // The start screen: neither.
    ctl.kiosks = [{ id, name: 'Journey kiosk', online: true, now: { view: 'splash', week: 5, title: 'Unit 2, Lesson 1: Worldview', preview: false, wait: null, last: null, at: null } }];
    await waitForMain(page, 'Ready to begin');
    assert.equal(await page.isVisible('#btn-end'), false);
    assert.equal(await page.isVisible('#btn-journey'), false);
    await context.close();
  });
});
