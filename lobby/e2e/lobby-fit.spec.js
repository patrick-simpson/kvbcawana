import { expect, test } from './pastFlagship.js';

// The lobby's copy frame on a real screen (rebrand stage 4b): whatever the
// operator types, the words stay inside the safe box, clear of the house
// waves, the corner tab and the top-right stack, and read in their own order.
// src/lib/lobbyFrame.test.js pins the fit's model; this pins what Chromium
// actually lays out from it, in the real faces, frozen under ?lowPower=1.

const URL130 = 'https://kvbc.example.org/awana/registration/2026-27/fall-family-sign-up-form?ref=lobby-tv&utm_source=signage&utm_campaign=fall-welcome-26';
const NAMES = 'Ava Ben Cal Dee Eli Fay Gus Hal Ivy Jo Kit Lu Max Ned Oli Pia Quin Rose Sam Tess Uma Vic Wes Xan Yui Zane'.split(' ');
// A URL with a hyphen every few letters: Chromium, left to wrap it itself,
// breaks after each hyphen and needs more rows than the fit counted.
const HYPHENS = `https://kvbc.example.org/${Array.from({ length: 14 }, (_, i) => `section-${i}-a-b`).join('/')}`;
// Whole on one line only at about 1.5u.
const URL90 = 'https://kvbc.example.org/awana/fall-2026/registration-form-for-families?ref=lobby-signage';

async function showSlide(page, { eyebrow = '', text, textSize = 'auto', config = {}, weather = null }) {
  await page.route(/pusher|twotimtwo|sockjs/, (route) => route.abort());
  if (weather) {
    await page.route(/open-meteo/, (route) => route.fulfill({
      body: JSON.stringify({ current: { temperature_2m: 72, apparent_temperature: 70, weather_code: weather, is_day: 1 } }),
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
    }));
  } else {
    await page.route(/open-meteo/, (route) => route.abort());
  }
  await page.addInitScript((cfg) => {
    localStorage.setItem('awanaSetupCardDismissed.v1', '1');
    localStorage.setItem('awanaConfig.v1', JSON.stringify(cfg));
  }, {
    pusherAppKey: '',
    backgroundSource: 'manual',
    calendarEnabled: false,
    seasonPromos: false,
    slideshowDelaySec: 3,
    manualSlides: [{ id: 's_fit', eyebrow, text, theme: 'sky', textSize, durationSec: 0 }],
    ...config,
  });
  await page.goto('/index.html?lowPower=1');
  await expect(page.locator('.lobby-headline')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  // A face that lands after the first fit refits; let that settle.
  await page.waitForTimeout(300);
}

/** Boxes in px: the stage (the 16:9 box, u = its width / 100), the headline's and kicker's text, the waves. */
const measure = (page) => page.evaluate(() => {
  const rect = (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  const textBox = (el) => {
    if (!el) return null;
    const range = document.createRange();
    range.selectNodeContents(el);
    const rs = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    return {
      left: Math.min(...rs.map((r) => r.left)),
      top: Math.min(...rs.map((r) => r.top)),
      right: Math.max(...rs.map((r) => r.right)),
      bottom: Math.max(...rs.map((r) => r.bottom)),
      rects: rs.map(rect),
    };
  };
  const stage = document.querySelector('.lobby-stage').getBoundingClientRect();
  return {
    screen: { width: innerWidth, height: innerHeight },
    stage: rect(stage),
    u: stage.width / 100,
    headline: textBox(document.querySelector('.lobby-headline')),
    kicker: textBox(document.querySelector('.lobby-kicker')),
    waves: rect(document.querySelector('.lobby-waves').getBoundingClientRect()),
    fontSize: parseFloat(getComputedStyle(document.querySelector('.lobby-headline')).fontSize),
    words: [...document.querySelectorAll('.lobby-headline .lobby-word')].map((w) => ({ text: w.textContent, ...rect(w.getBoundingClientRect()) })),
    text: document.querySelector('.lobby-headline').textContent,
  };
});

/**
 * The headline's rows as Chromium drew them (one per distinct line of text),
 * the rows the fit counted (data-rows), and where the block ends, in u of the
 * stage.
 */
const rowsOf = (page) => page.evaluate(() => {
  const stage = document.querySelector('.lobby-stage').getBoundingClientRect();
  const u = stage.width / 100;
  const headline = document.querySelector('.lobby-headline');
  const rects = [];
  const walker = document.createTreeWalker(headline, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.data.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    rects.push(...[...range.getClientRects()].filter((r) => r.width > 0.5));
  }
  // One row per band of text, by centre: a row whose Hebrew falls back to
  // another face than its Latin still counts once.
  const lh = parseFloat(getComputedStyle(headline).fontSize) * parseFloat(headline.style.lineHeight);
  const rows = [];
  for (const r of rects) {
    const y = (r.top + r.bottom) / 2;
    if (!rows.some((c) => Math.abs(c - y) < lh * 0.45)) rows.push(y);
  }
  const mid = (stage.left + stage.right) / 2;
  return {
    mode: headline.classList.contains('lobby-headline--shout') ? 'shout' : 'read',
    counted: Number(headline.dataset.rows),
    drawn: rows.length,
    breaksInRuns: headline.querySelectorAll('bdi br').length,
    size: parseFloat(getComputedStyle(headline).fontSize) / u,
    bottom: (headline.closest('.lobby-copy').getBoundingClientRect().bottom - stage.top) / u,
    left: (Math.min(...rects.map((r) => r.left)) - mid) / u,
    right: (Math.max(...rects.map((r) => r.right)) - mid) / u,
  };
});

/**
 * Each drawn row's characters in the order they sit on screen, left to right,
 * beside the same row's text set as plain text in a dir="auto" paragraph of
 * the same face: what the bidi algorithm itself makes of the row.
 */
const bidiRows = (page) => page.evaluate(() => {
  const headline = document.querySelector('.lobby-headline');
  const cs = getComputedStyle(headline);
  const lh = parseFloat(cs.fontSize) * parseFloat(headline.style.lineHeight);
  const rowsIn = (root) => {
    const rows = [];
    let last = null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      let off = 0;
      for (const ch of n.data) {
        const range = document.createRange();
        range.setStart(n, off);
        off += ch.length;
        range.setEnd(n, off);
        const r = [...range.getClientRects()].find((b) => b.width > 0.3);
        if (!r || /\s/.test(ch)) {
          if (last) last.text += ch;
          continue;
        }
        const y = (r.top + r.bottom) / 2;
        let row = rows.find((w) => Math.abs(w.y - y) < lh * 0.45);
        if (!row) rows.push(row = { y, text: '', chars: [] });
        row.text += ch;
        row.chars.push({ ch, x: (r.left + r.right) / 2 });
        last = row;
      }
    }
    return rows.sort((a, b) => a.y - b.y).map((row) => ({ text: row.text.trim(), seen: row.chars.sort((a, b) => a.x - b.x).map((c) => c.ch).join('') }));
  };
  const drawn = rowsIn(headline);
  const plain = document.createElement('p');
  plain.dir = 'auto';
  plain.style.cssText = `position:fixed;left:0;top:0;margin:0;white-space:nowrap;visibility:hidden;font-size:${cs.fontSize};font-family:${cs.fontFamily};font-weight:${cs.fontWeight};text-transform:${cs.textTransform};line-height:${headline.style.lineHeight}`;
  drawn.forEach((row, i) => {
    if (i) plain.append(document.createElement('br'));
    plain.append(row.text);
  });
  document.body.append(plain);
  const want = rowsIn(plain);
  plain.remove();
  return drawn.map((row, i) => ({ text: row.text, seen: row.seen, want: want[i]?.seen }));
});

/** The left edge of each headline word, by its text. */
const wordLefts = (page) => page.evaluate(() => Object.fromEntries(
  [...document.querySelectorAll('.lobby-headline .lobby-word')].map((w) => {
    const r = w.getBoundingClientRect();
    return [w.textContent, { left: r.left, top: Math.round(r.top) }];
  }),
));

/**
 * Each headline row's ink as Chromium draws it, and the kicker's, in px: the
 * row's baseline from a zero-height probe set on it, and the letters' reach
 * from the canvas's own bounding box in the face and size the page drew
 * them in, so an accent or a comma is measured from the real outlines.
 */
const inkOf = (page) => page.evaluate(() => {
  const ctx = new OffscreenCanvas(1, 1).getContext('2d');
  /** One element's ink: its baseline, and how far its letters reach above and below it. */
  const ink = (el, text) => {
    const cs = getComputedStyle(el);
    const probe = document.createElement('span');
    probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
    el.appendChild(probe);
    const baseline = probe.getBoundingClientRect().top;
    probe.remove();
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const m = ctx.measureText(cs.textTransform === 'uppercase' ? text.toUpperCase() : text);
    return { baseline, top: baseline - m.actualBoundingBoxAscent, bottom: baseline + m.actualBoundingBoxDescent };
  };
  const headline = document.querySelector('.lobby-headline');
  const rows = [];
  for (const w of headline.querySelectorAll('.lobby-word')) {
    const i = ink(w, w.textContent);
    const row = rows.find((r) => Math.abs(r.baseline - i.baseline) < 2);
    if (row) Object.assign(row, { top: Math.min(row.top, i.top), bottom: Math.max(row.bottom, i.bottom) });
    else rows.push(i);
  }
  rows.sort((a, b) => a.baseline - b.baseline);
  const kicker = document.querySelector('.lobby-kicker');
  const hs = getComputedStyle(headline);
  return {
    rows,
    kicker: kicker ? ink(kicker, kicker.textContent) : null,
    // The hard offset shadow hangs below each row's ink, marks and all.
    shadow: parseFloat(hs.textShadow.match(/(-?[\d.]+)px\s+(-?[\d.]+)px/)?.[2] ?? '0'),
    fontSize: parseFloat(hs.fontSize),
    bottom: headline.getBoundingClientRect().bottom,
  };
});

for (const [width, height] of [[1920, 1080], [1280, 720]]) {
  test.describe(`marks at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    // Paytone One's marks reach far past its caps (É to 1.045em, Ễ to 1.161em,
    // Ș's comma to -0.351em, on rows 0.93em apart): the fit gives the row a
    // mark would crowd exactly the room it needs, measured in the real face.
    for (const [name, text] of [
      ['a lower row\'s accents clear the comma above them', 'Ștefan\nÉmile Nguyễn'],
      ['a first row\'s accent clears the kicker, and a hanging comma stays inside the headline', 'Émile\nȘtefan'],
    ]) {
      test(name, async ({ page }) => {
        await showSlide(page, { eyebrow: 'Welcome', text });
        await expect(page.locator('.lobby-headline--shout')).toBeVisible();
        const m = await inkOf(page);
        expect(m.rows).toHaveLength(2);
        // Nothing may touch: the rows' ink (and the upper row's shadow)
        // keeps a visible gap, and the first row keeps off the kicker's.
        const gap = 0.03 * m.fontSize;
        expect(m.rows[1].top - (m.rows[0].bottom + m.shadow)).toBeGreaterThanOrEqual(gap);
        expect(m.rows[0].top - m.kicker.bottom).toBeGreaterThanOrEqual(gap);
        // The comma and its shadow hang inside the headline's own box, which
        // is what the fit keeps clear of the waves.
        expect(m.rows[1].bottom + m.shadow).toBeLessThanOrEqual(m.bottom + 1);
      });
    }
  });
}

for (const [width, height] of [[1920, 1080], [1280, 720], [1024, 768]]) {
  test.describe(`a pasted URL at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    for (const [name, eyebrow, text] of [
      ['full of hyphens', 'Sign up', HYPHENS],
      ['inside a sentence', 'Register online', `Please register every child for the new club year before next Wednesday at ${HYPHENS.slice(0, 190)} and bring your forms`],
    ]) {
      test(`${name}: draws only the rows the fit counted, and nothing passes 45u`, async ({ page }) => {
        await showSlide(page, { eyebrow, text });
        const rows = await rowsOf(page);
        expect(rows.counted).toBeGreaterThan(3);
        expect(rows.drawn).toBe(rows.counted);
        expect(rows.bottom).toBeLessThanOrEqual(45.05);
        expect(rows.left).toBeGreaterThanOrEqual(-38.05);
        expect(rows.right).toBeLessThanOrEqual(38.05);
      });
    }
  });
}

test('a 90-character URL is cut at a readable size, never shrunk whole to a hairline', async ({ page }) => {
  await showSlide(page, { text: URL90 });
  const rows = await rowsOf(page);
  expect(rows.size).toBeGreaterThanOrEqual(2.4);
  expect(rows.drawn).toBe(rows.counted);
  expect(rows.drawn).toBeGreaterThan(1);
});

test('a Hebrew phrase in an English sentence keeps its own order in the read layout', async ({ page }) => {
  await showSlide(page, { text: 'We say שבת שלום טוב to all of you and your whole family this week, see you all at club again next Wednesday night' });
  await expect(page.locator('.lobby-headline--read')).toBeVisible();
  const w = await wordLefts(page);
  expect(new Set([w.say.top, w['שבת'].top, w['טוב'].top, w.to.top]).size).toBe(1);
  // Left to right on screen: say, then the phrase right to left, then to.
  expect(w.say.left).toBeLessThan(w['טוב'].left);
  expect(w['טוב'].left).toBeLessThan(w['שלום'].left);
  expect(w['שלום'].left).toBeLessThan(w['שבת'].left);
  expect(w['שבת'].left).toBeLessThan(w.to.left);
});

test('a Hebrew phrase in an English sentence keeps its own order when shouted', async ({ page }) => {
  await showSlide(page, { text: 'Say שבת שלום טוב tonight' });
  await expect(page.locator('.lobby-headline--shout')).toBeVisible();
  const w = await wordLefts(page);
  // However the rows fall, a phrase word sits left of the one before it on its row.
  const pairs = [['שבת', 'שלום'], ['שלום', 'טוב']].filter(([a, b]) => w[a].top === w[b].top);
  expect(pairs.length).toBeGreaterThan(0);
  for (const [a, b] of pairs) expect(w[b].left).toBeLessThan(w[a].left);
});

// Punctuation at the edge of a phrase in the other direction: plain text
// gives it the headline's direction, so "Say שלום, friends!" keeps its comma
// after the Hebrew, and an Arabic sentence ending "Awana!" its "!" at the end.
for (const [name, textSize, texts] of [
  ['a lone word, shouted', 'auto', ['Say שלום, friends!', 'مرحبا بكم في Awana!', 'We always say שלום.', 'Can you say مرحبا? Try it tonight']],
  ['a phrase, shouted', 'auto', ['We say "שבת שלום" to all', 'ברוכים הבאים, Awana Clubs.', 'Welcome ל-Awana tonight', 'Say שבת שלום!']],
  ['read', 'md', ['We say שבת שלום, and see you next week', 'Say שלום, friends!', 'مرحبا بكم في Awana!', 'אנחנו אומרים Hello World, לכולם']],
]) {
  test(`punctuation at the edge of a phrase in the other direction sits where plain text puts it: ${name}`, async ({ context }) => {
    for (const text of texts) {
      const page = await context.newPage();
      await showSlide(page, { text, textSize });
      for (const row of await bidiRows(page)) expect(row.seen, `${text}: "${row.text}"`).toBe(row.want);
      await page.close();
    }
  });
}

test('a quoted phrase split across two shouted rows keeps its quotes where plain text puts them', async ({ page }) => {
  await showSlide(page, { text: 'We say "שבת שלום" to all' });
  const rows = await rowsOf(page);
  expect(rows.mode).toBe('shout');
  expect(rows.drawn).toBe(rows.counted);
  for (const row of await bidiRows(page)) expect(row.seen, row.text).toBe(row.want);
  // The row break falls inside the phrase, so this is the case it covers.
  expect(rows.breaksInRuns).toBeGreaterThan(0);
});

test('a run-on list keeps one separator on each side of a name in the other direction', async ({ context }) => {
  for (const name of ['שרה כהן', 'محمد']) {
    const page = await context.newPage();
    await showSlide(page, { eyebrow: 'Thank you', text: ['Book finishers!', ...NAMES.slice(0, 12), name, ...NAMES.slice(12)].join('\n') });
    const rows = await bidiRows(page);
    expect(rows.some((row) => row.text.includes(name)), name).toBe(true);
    for (const row of rows) expect(row.seen, `${name}: "${row.text}"`).toBe(row.want);
    await page.close();
  }
});

// A row break inside a phrase in the other direction: the <br> sits inside
// its <bdi>, and without it the rows the fit counted run together off the
// stage.
for (const text of ['Say שבת שלום טוב tonight', 'Say שבת שלום לכל החברים tonight at club']) {
  test(`a row break inside a phrase in the other direction is drawn: ${text}`, async ({ page }) => {
    await showSlide(page, { text });
    const rows = await rowsOf(page);
    expect(rows.drawn).toBe(rows.counted);
    const half = rows.mode === 'shout' ? 42.05 : 38.05;
    expect(rows.left).toBeGreaterThanOrEqual(-half);
    expect(rows.right).toBeLessThanOrEqual(half);
    expect(rows.bottom).toBeLessThanOrEqual(45.05);
    // The fit put a row break inside the phrase, so this is the case it covers.
    expect(rows.breaksInRuns).toBeGreaterThan(0);
  });
}

test('Devanagari reads rather than shouts, so its marks clear the next row', async ({ page }) => {
  await showSlide(page, { text: 'प्रभु की\nस्तुति करो' });
  await expect(page.locator('.lobby-headline--read')).toBeVisible();
  const rows = await rowsOf(page);
  expect(rows.drawn).toBe(rows.counted);
  expect(rows.counted).toBe(2);
});

test('English inside a Hebrew headline keeps its own order', async ({ page }) => {
  await showSlide(page, { text: 'ברוכים הבאים ל Awana Clubs Tonight' });
  const w = await wordLefts(page);
  // The headline runs right to left, the English left to right within it.
  expect(w['ברוכים'].left).toBeGreaterThan(w['הבאים'].left);
  if (w.Awana.top === w.Clubs.top) expect(w.Awana.left).toBeLessThan(w.Clubs.left);
  if (w.Clubs.top === w.Tonight.top) expect(w.Clubs.left).toBeLessThan(w.Tonight.left);
  expect(w.Awana.top === w.Clubs.top || w.Clubs.top === w.Tonight.top).toBe(true);
});

test('Thai reads rather than shouts, so its marks clear the next row', async ({ page }) => {
  await showSlide(page, { eyebrow: 'Tonight', text: 'ยินดีต้อนรับสู่ชมรมคืนนี้ กรุณานำหนังสือคู่มือ และพระคัมภีร์มาด้วย' });
  await expect(page.locator('.lobby-headline--read')).toBeVisible();
  const rows = await rowsOf(page);
  expect(rows.drawn).toBe(rows.counted);
  expect(rows.bottom).toBeLessThanOrEqual(45.05);
});

test('a long list, one name per line, stays above the house waves', async ({ page }) => {
  await showSlide(page, { eyebrow: 'Thank you', text: ['Book finishers!', ...NAMES].join('\n') });
  const m = await measure(page);
  expect(m.headline.bottom).toBeLessThanOrEqual(m.waves.top);
  for (const name of NAMES) expect(m.text).toContain(name);
  // Still a size a room can read.
  expect(m.fontSize / m.u).toBeGreaterThanOrEqual(1.5);
});

test('a pasted URL wraps inside the read layout\'s width, at a readable size', async ({ page }) => {
  await showSlide(page, { text: URL130 });
  const m = await measure(page);
  const mid = (m.stage.left + m.stage.right) / 2;
  expect(m.headline.left).toBeGreaterThanOrEqual(mid - 38.5 * m.u);
  expect(m.headline.right).toBeLessThanOrEqual(mid + 38.5 * m.u);
  expect(m.headline.bottom).toBeLessThanOrEqual(m.waves.top);
  expect(m.fontSize / m.u).toBeGreaterThanOrEqual(2.4);
});

test('a Chinese sentence wraps between its words instead of shrinking to one line', async ({ page }) => {
  await showSlide(page, { eyebrow: '本周', text: '欢迎来到今晚的俱乐部活动请带上你的手册和圣经我们一起学习一起玩游戏欢迎你们大家' });
  const m = await measure(page);
  expect(new Set(m.words.map((w) => Math.round(w.top))).size).toBeGreaterThan(1);
  expect(m.fontSize / m.u).toBeGreaterThanOrEqual(4);
  expect(m.headline.right - m.headline.left).toBeLessThanOrEqual(77 * m.u);
});

test('a Hebrew headline reads right to left, word by word', async ({ page }) => {
  await showSlide(page, { text: 'ברוכים הבאים לאוואנה הערב' });
  const m = await measure(page);
  const [first, second] = m.words;
  expect(first.text).toBe('ברוכים');
  expect(Math.round(first.top)).toBe(Math.round(second.top));
  expect(first.left).toBeGreaterThan(second.left);
});

test('a kicker at the editor\'s full length stays on the screen', async ({ page }) => {
  await showSlide(page, { eyebrow: '通'.repeat(60), text: 'Hi there' });
  const m = await measure(page);
  expect(m.kicker.left).toBeGreaterThanOrEqual(0);
  expect(m.kicker.right).toBeLessThanOrEqual(m.screen.width);
  expect(m.kicker.right - m.kicker.left).toBeLessThanOrEqual(84.5 * m.u);
});

test.describe('at 1280x720', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('a long kicker on a full slide stays clear of the top-right stack', async ({ page }) => {
    // Real-clock independent: the lobby changes during Wednesday club hours.
    await page.clock.install({ time: new Date('2026-09-23T10:00:00-04:00') });
    await showSlide(page, {
      eyebrow: 'IMPORTANT ANNOUNCEMENT FOR ALL PARENTS AND GUARDIANS TONIGHT',
      text: 'Parents, please remember that pick-up is at the gym doors this week while the lobby floor is refinished. '.repeat(6).slice(0, 500),
      config: { showConnectionStatus: true, slideshowDelaySec: 600 },
      weather: 96, // "Thunderstorm with hail": the widest weather chip there is
    });
    // The corner shows one item at a time; wait for the weather's turn.
    await expect(page.locator('.corner-top .corner-chip')).toBeVisible({ timeout: 12_000 });
    await page.waitForTimeout(400);
    const stack = await page.locator('.corner-stack .sticker-chip, .corner-top .corner-chip').evaluateAll((els) => els.map((e) => {
      const r = e.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }));
    const m = await measure(page);
    const hits = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    for (const box of stack) {
      for (const r of [...m.kicker.rects, ...m.headline.rects]) expect(hits(box, r)).toBe(false);
    }
    expect(m.headline.bottom).toBeLessThanOrEqual(m.waves.top);
  });
});
