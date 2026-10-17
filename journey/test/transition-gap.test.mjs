// Club transitions (src/schedule/29-transition-gap.js, owner 2026-10-17): a
// pure black layer for TRANSITION_GAP_MIN minutes either side of every
// scheduled hand-off (the shared rule, shared/transitionGap.js, handed to the
// page through its test seam: jsdom cannot import() a module), never over a
// running lesson, a preview, a reading overlay or Settings; the check-in frame
// never touched; and, on the black, a welcome card per club of the gap's two
// neighbours for the first names the embedded lobby hands up.
//
// The clock is pinned to Wednesday 2026-10-07 (a club night by the calendar
// below), local time, and moved by re-pinning it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bootKiosk, tick, pinClock } from './kiosk-dom.mjs';

const CSS = readFileSync(new URL('../public/src/style.css', import.meta.url), 'utf8');

const clubNight = await import('../../shared/clubNight.js');
const gapRule = await import('../../shared/transitionGap.js');

const at = (h, m, s = 0, day = 7) => new Date(2026, 9, day, h, m, s).getTime();
const ticks = async (n = 6) => {
  for (let i = 0; i < n; i += 1) await tick();
};

const LESSONS = {
  version: 1,
  lessons: [
    {
      week: 1,
      unit: 1,
      lesson: 1,
      title: 'Unit 1, Lesson 1: Apologetics',
      downloadUrl: 'https://clubs.awana.org/student-1.mp4',
      leaderDownloadUrl: 'https://clubs.awana.org/leader-1.mp4',
      captions: { student: true, leader: true },
    },
  ],
};
const CURRENT = {
  version: 2,
  week: 1,
  title: 'Unit 1, Lesson 1: Apologetics',
  sourceUrl: 'https://cdn.awana.example/student-1-original.mp4',
  downloadUrl: 'current-lesson-video.mp4',
  transcodedAt: '2026-09-15T04:00:00Z',
};
const SCHEDULE = { version: 1, timezone: 'America/New_York', meeting: { day: 3, start: '18:00' }, windows: [], specialDates: {} };
const feed = ({ cancelled = false } = {}) => ({
  version: 1,
  generatedAt: '2026-10-01T12:00:00Z',
  events: [
    { date: '2026-10-07', kind: 'club', title: cancelled ? 'No Awana this week' : 'Awana meeting', isCancelled: cancelled, isSpecial: false },
    { date: '2026-10-14', kind: 'club', title: 'Awana meeting', isCancelled: false, isSpecial: false },
  ],
});

function boot(nowMs, { calendar = feed(), motion = false, rule = gapRule, url } = {}) {
  const routes = {
    'current-lesson.json': { json: CURRENT },
    'lessons.json': { json: LESSONS },
    'calendar-feed.json': calendar ? { json: calendar } : { status: 404 },
    'shared/schedule.json': { json: SCHEDULE },
  };
  return bootKiosk(routes, { 'journey.captions': 'off' }, undefined, (window) => {
    pinClock(window, nowMs);
    window.journeyClubNightModule = clubNight;
    if (rule) window.journeyTransitionGapModule = rule;
    window.matchMedia = (query) => ({
      matches: !motion && /prefers-reduced-motion:\s*reduce/.test(query),
      media: query,
      addEventListener() {},
      removeEventListener() {},
    });
  }, url);
}

const shown = (k, id) => !k.document.getElementById(id).classList.contains('hidden');
const view = (k) => (shown(k, 'trek-view') ? 'trek' : shown(k, 'journey-view') ? 'journey' : 'checkin');
const black = (k) => shown(k, 'gap-view');
const move = (k, ms) => {
  pinClock(k.window, ms);
  k.window.pollSchedule();
  k.window.refreshGap();
};
const gapClubs = (k, ms) => {
  pinClock(k.window, ms);
  const g = k.window.scheduledGap(new k.window.Date());
  return g ? g.clubs : null;
};
function hand(k, data, { source, origin = 'https://example.test' } = {}) {
  const frame = k.document.getElementById('checkin-frame');
  k.window.dispatchEvent(new k.window.MessageEvent('message', {
    data: { type: 'awana-display:checkin', ...data },
    origin,
    source: source === undefined ? frame.contentWindow : source,
  }));
}
const card = (k, club) => k.document.getElementById(`gap-welcome-${club}`);
const names = (k, club) => card(k, club).querySelector('.gap-welcome-names').textContent;

test('a Trek night: black 6:28-6:32 (Journey), 6:58-7:02 (Journey and Trek), 7:28-7:32 (Trek)', async () => {
  const k = boot(at(12, 0));
  try {
    await ticks();
    const table = [
      [at(18, 27), null], [at(18, 28), ['journey']], [at(18, 31, 59), ['journey']], [at(18, 32), null],
      [at(18, 57), null], [at(18, 58), ['journey', 'trek']], [at(19, 1, 59), ['journey', 'trek']], [at(19, 2), null],
      [at(19, 13), null], [at(19, 15), null],
      [at(19, 27), null], [at(19, 28), ['trek']], [at(19, 31, 59), ['trek']], [at(19, 32), null],
    ];
    for (const [ms, clubs] of table) assert.deepEqual(gapClubs(k, ms), clubs, new Date(ms).toTimeString());
    // The views themselves still change at the hand-off itself.
    pinClock(k.window, at(18, 59));
    assert.equal(k.window.scheduledPhase(), 'journey');
    pinClock(k.window, at(19, 0));
    assert.equal(k.window.scheduledPhase(), 'trek');
    pinClock(k.window, at(19, 30));
    assert.equal(k.window.scheduledPhase(), 'checkin');
  } finally {
    k.close();
  }
});

test('a night without Trek: 6:28-6:32 and, at the Journey window\'s end, 7:28-7:32 (Journey)', async () => {
  for (const [label, k] of [
    ['a cancelled club night', boot(at(12, 0), { calendar: feed({ cancelled: true }) })],
    ['a Thursday', boot(at(12, 0, 0, 8), { calendar: null })],
  ]) {
    try {
      await ticks();
      const day = label === 'a Thursday' ? 8 : 7;
      const table = [
        [at(18, 27, 0, day), null], [at(18, 28, 0, day), ['journey']], [at(18, 31, 0, day), ['journey']], [at(18, 32, 0, day), null],
        [at(18, 58, 0, day), null], [at(19, 1, 0, day), null],
        [at(19, 13, 0, day), null], [at(19, 16, 59, day), null],
        [at(19, 27, 0, day), null], [at(19, 28, 0, day), ['journey']], [at(19, 31, 59, day), ['journey']], [at(19, 32, 0, day), null],
      ];
      for (const [ms, clubs] of table) assert.deepEqual(gapClubs(k, ms), clubs, `${label} ${new Date(ms).toTimeString()}`);
    } finally {
      k.close();
    }
  }
});

test('the black covers the views through the gap; the check-in frame is never removed or reloaded', async () => {
  const k = boot(at(18, 27));
  try {
    await ticks();
    const frame = k.document.getElementById('checkin-frame');
    const src = frame.getAttribute('src');
    assert.equal(view(k), 'checkin');
    assert.equal(black(k), false, '6:27');
    move(k, at(18, 28));
    assert.equal(black(k), true, '6:28: black over the Check-in Display');
    assert.equal(view(k), 'checkin', 'the display is still there under it');
    move(k, at(18, 30));
    assert.equal(view(k), 'journey', '6:30: the view changes under the black');
    assert.equal(black(k), true);
    move(k, at(18, 31, 59));
    assert.equal(black(k), true);
    move(k, at(18, 32));
    assert.equal(black(k), false, '6:32: the splash appears');
    assert.equal(shown(k, 'journey-splash'), true);
    move(k, at(18, 58));
    assert.equal(black(k), true, '6:58');
    move(k, at(19, 0));
    assert.equal(view(k), 'trek');
    move(k, at(19, 2));
    assert.equal(black(k), false, '7:02: the Trek card');
    assert.equal(view(k), 'trek');
    move(k, at(19, 28));
    assert.equal(black(k), true, '7:28');
    move(k, at(19, 30));
    assert.equal(view(k), 'checkin');
    move(k, at(19, 32));
    assert.equal(black(k), false, '7:32: the Check-in Display');
    assert.equal(k.document.getElementById('checkin-frame'), frame, 'the same frame element throughout');
    assert.equal(frame.isConnected, true);
    assert.equal(frame.getAttribute('src'), src, 'never re-pointed (that would reload it)');
  } finally {
    k.close();
  }
});

test('the corner buttons stay above the black, and ⇄ puts this gap\'s black away', async () => {
  const k = boot(at(18, 29));
  try {
    await ticks();
    k.window.refreshGap();
    assert.equal(black(k), true);
    const z = (head) => Number(CSS.slice(CSS.indexOf(`\n${head} {`)).match(/z-index:\s*(\d+)/)[1]);
    assert.ok(z('#gap-view') < z('#toggle-btn,\n#settings-btn'), 'the black sits under both buttons (style.css)');
    assert.ok(k.document.getElementById('toggle-btn').compareDocumentPosition(k.document.getElementById('gap-view')) & k.window.Node.DOCUMENT_POSITION_PRECEDING, 'and the buttons come after it in the page');
    k.document.getElementById('toggle-btn').click();
    assert.equal(black(k), false, 'the operator asked for a view');
    assert.equal(view(k), 'journey');
    k.window.refreshGap();
    assert.equal(black(k), false, 'not back for the rest of this gap');
    move(k, at(18, 58));
    assert.equal(black(k), true, 'the next gap comes as usual');
  } finally {
    k.close();
  }
});

test('a lesson running through a gap gets no black; one that ends inside a gap goes to black until the gap ends', async () => {
  const k = boot(at(18, 50));
  try {
    await ticks();
    k.window.refreshGap();
    k.document.getElementById('journey-splash-play-btn').click();
    await ticks();
    assert.ok(k.video.hasAttribute('src'), 'the lesson is playing');
    move(k, at(18, 58));
    assert.equal(black(k), false, 'never over a playing lesson');
    move(k, at(19, 0));
    assert.equal(view(k), 'journey', 'and never cut at 7:00 (unchanged)');
    assert.equal(black(k), false);
    // Its slides come next, still no black.
    k.video.dispatchEvent(new k.window.Event('ended'));
    k.window.refreshGap();
    assert.equal(shown(k, 'slides-view'), true);
    assert.equal(black(k), false, 'the slides are a running lesson too');
    // It finishes at 7:01: the card's turn, under the black until 7:02.
    pinClock(k.window, at(19, 1));
    k.window.finishTeachingSlides();
    assert.equal(view(k), 'trek');
    assert.equal(black(k), true, 'black until the gap ends');
    move(k, at(19, 1, 59));
    assert.equal(black(k), true);
    move(k, at(19, 2));
    assert.equal(black(k), false, 'then the Trek card');
    assert.equal(view(k), 'trek');
  } finally {
    k.close();
  }
});

test('Settings, a reading overlay or a preview hold the black off', async () => {
  const k = boot(at(18, 28, 30));
  try {
    await ticks();
    k.window.refreshGap();
    assert.equal(black(k), true);
    k.document.getElementById('settings-btn').click();
    await ticks();
    k.window.refreshGap();
    assert.equal(black(k), false, 'Settings open: no black');
    k.window.closeSettingsPanel();
    k.window.refreshGap();
    assert.equal(black(k), true, 'closed again: black for the rest of the gap');
    k.window.openHandout(LESSONS.lessons[0]);
    k.window.refreshGap();
    assert.equal(black(k), false, 'a handout open: no black');
    k.window.closeHandout();
    k.window.refreshGap();
    assert.equal(black(k), true);
    k.window.startSlidesPreview(1);
    await ticks();
    k.window.refreshGap();
    assert.equal(black(k), false, 'a preview: no black');
  } finally {
    k.close();
  }
});

test('welcomes on the black: the gap\'s clubs only, one card each, 20 s after the latest, deduped, first names only', async () => {
  const k = boot(at(18, 58, 10));
  try {
    await ticks();
    k.window.refreshGap();
    assert.equal(black(k), true);
    hand(k, { id: 'a', firstName: 'Ava', club: 'Journey' });
    assert.equal(card(k, 'journey').classList.contains('hidden'), false, 'a Journey welcome');
    assert.equal(card(k, 'trek').classList.contains('hidden'), true);
    assert.equal(card(k, 'journey').dataset.slot, 'center');
    assert.equal(names(k, 'journey'), 'Ava!');
    hand(k, { id: 'b', firstName: 'Ben', club: 'Trek' });
    assert.equal(card(k, 'trek').classList.contains('hidden'), false, 'and a Trek one beside it');
    assert.equal(card(k, 'journey').dataset.slot, 'left');
    assert.equal(card(k, 'trek').dataset.slot, 'right');
    assert.equal(names(k, 'journey'), 'Ava!', 'never mixed');
    assert.equal(names(k, 'trek'), 'Ben!');
    hand(k, { id: 'c', firstName: 'Cara', club: 'T&T' });
    hand(k, { id: 'd', firstName: 'Dan', club: 'Cubbies' });
    assert.equal(names(k, 'journey'), 'Ava!', 'an unrelated club: nothing');
    assert.equal(names(k, 'trek'), 'Ben!');
    hand(k, { id: 'a', firstName: 'Ava', club: 'Journey' });
    assert.equal(names(k, 'journey'), 'Ava!', 'the same check-in twice: once');
    hand(k, { id: 'e', firstName: 'Eli', club: 'Journey', oneOff: true });
    assert.equal(names(k, 'journey'), 'Ava & Eli!', 'a one-off name tag is welcomed, as the lobby welcomes it');
    hand(k, { id: 'f', firstName: 'Fay', club: 'Journey' }, { source: null });
    hand(k, { id: 'g', firstName: 'Gus', club: 'Journey' }, { origin: 'https://elsewhere.test' });
    assert.equal(names(k, 'journey'), 'Ava & Eli!', 'only the page\'s own frame, at its own origin');
    // 20 s after the latest Journey arrival (Eli), and Ben's own 20 s.
    pinClock(k.window, at(18, 58, 29));
    k.window.refreshGap();
    assert.equal(card(k, 'journey').classList.contains('hidden'), false);
    assert.equal(card(k, 'trek').classList.contains('hidden'), false);
    pinClock(k.window, at(18, 58, 31));
    k.window.refreshGap();
    assert.equal(card(k, 'journey').classList.contains('hidden'), true, 'then back to black');
    assert.equal(card(k, 'trek').classList.contains('hidden'), true);
    assert.equal(black(k), true);
    for (const club of ['journey', 'trek']) assert.equal(names(k, club), '', 'the names leave the page with their card');
  } finally {
    k.close();
  }
});

test('each gap welcomes its own neighbours: 6:28 Journey only, 7:28 Trek only; nothing outside a gap', async () => {
  const k = boot(at(18, 29));
  try {
    await ticks();
    k.window.refreshGap();
    hand(k, { id: 't1', firstName: 'Tess', club: 'Trek' });
    assert.equal(card(k, 'trek').classList.contains('hidden'), true, '6:29: not Trek');
    hand(k, { id: 'j1', firstName: 'Jo', club: 'Journey' });
    assert.equal(card(k, 'journey').classList.contains('hidden'), false, '6:29: Journey');
    move(k, at(18, 40));
    assert.equal(black(k), false);
    assert.equal(card(k, 'journey').classList.contains('hidden'), true, 'the black and its names go together');
    hand(k, { id: 'j2', firstName: 'Jay', club: 'Journey' });
    assert.equal(card(k, 'journey').classList.contains('hidden'), true, 'no welcome outside a gap');
    move(k, at(19, 0));
    move(k, at(19, 29));
    assert.equal(black(k), true);
    hand(k, { id: 'j3', firstName: 'Jill', club: 'Journey' });
    assert.equal(card(k, 'journey').classList.contains('hidden'), true, '7:29: not Journey');
    hand(k, { id: 't2', firstName: 'Tom', club: 'Trek' });
    assert.equal(names(k, 'trek'), 'Tom!', '7:29: Trek');
  } finally {
    k.close();
  }
});

test('the self-update may reload over the black, never over a welcome on it', async () => {
  const k = boot(at(18, 30, 30));
  try {
    await ticks();
    k.window.refreshGap();
    assert.equal(black(k), true);
    assert.equal(view(k), 'journey', 'the splash is waiting under the black');
    assert.equal(k.window.safeToReload(), true, 'black is safe');
    hand(k, { id: 'a', firstName: 'Ava', club: 'Journey' });
    assert.equal(k.window.safeToReload(), false, 'a welcome is being read');
  } finally {
    k.close();
  }
});

test('with motion the black fades in and out; reduced motion is instant', async () => {
  const k = boot(at(18, 27, 50), { motion: true });
  try {
    await ticks();
    assert.equal(k.document.documentElement.classList.contains('motion-full'), true);
    move(k, at(18, 28));
    assert.equal(black(k), true);
    move(k, at(18, 32));
    const gap = k.document.getElementById('gap-view');
    assert.equal(gap.classList.contains('jm-gap-out'), true, 'fading out, still shown');
    assert.equal(k.window.gapBlackUp(), false, 'but already down for the code');
    await new Promise((r) => setTimeout(r, 1000));
    assert.equal(gap.classList.contains('hidden'), true);
    assert.equal(gap.classList.contains('jm-gap-out'), false);
  } finally {
    k.close();
  }
  const still = boot(at(18, 28));
  try {
    await ticks();
    still.window.refreshGap();
    move(still, at(18, 32));
    assert.equal(still.document.getElementById('gap-view').classList.contains('hidden'), true, 'at once');
    assert.equal(still.document.getElementById('gap-view').classList.contains('jm-gap-out'), false);
  } finally {
    still.close();
  }
});

test('until the shared rule has loaded there is no gap; configure mode never has one', async () => {
  const k = boot(at(18, 29), { rule: null });
  try {
    await ticks();
    k.window.refreshGap();
    assert.equal(black(k), false);
    assert.equal(k.window.scheduledGap(new k.window.Date()), null);
  } finally {
    k.close();
  }
  const c = boot(at(18, 29), { url: 'https://example.test/?configure=1' });
  try {
    await ticks();
    c.window.refreshGap();
    assert.equal(black(c), false, 'nothing of the kiosk runs there');
    hand(c, { id: 'a', firstName: 'Ava', club: 'Journey' }, { source: null });
    assert.equal(card(c, 'journey').classList.contains('hidden'), true);
  } finally {
    c.close();
  }
});
