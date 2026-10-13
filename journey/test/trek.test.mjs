// Trek's small group card (src/schedule/25-trek.js, owner 2026-10-12): club
// nights only, 7:00-7:30 PM, by the lobby's own club-night rule; never over a
// lesson that is still running; the Trek count from the lobby's stored tally;
// tonight's Trek lesson title only when the calendar names one.
//
// The rule is lobby/shared/clubNight.js itself, handed to the page through
// its test seam (jsdom cannot import() a module). The clock is pinned to
// Wednesday 2026-10-07, local time, and moved by re-pinning it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootKiosk, tick, pinClock } from './kiosk-dom.mjs';

const clubNight = await import('../../lobby/shared/clubNight.js');

const PUBLIC = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'public');
const json = (rel) => JSON.parse(readFileSync(path.join(PUBLIC, rel), 'utf8'));
const at = (h, m, day = 7) => new Date(2026, 9, day, h, m, 0).getTime();
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

function feed(extra = [], { cancelled = false } = {}) {
  return {
    version: 1,
    generatedAt: '2026-10-01T12:00:00Z',
    events: [
      { date: '2026-10-07', kind: 'club', title: cancelled ? 'No Awana this week' : 'Awana meeting', isCancelled: cancelled, isSpecial: false },
      { date: '2026-10-14', kind: 'club', title: 'Awana meeting', isCancelled: false, isSpecial: false },
      ...extra,
    ],
  };
}

const ANSWERED = { 'journey.captions': 'off' };

// The OS asks for reduced motion unless `motion` is set (the card is then
// still, and no view-flip carry runs under the assertions).
function boot(nowMs, { calendar = feed(), schedule = SCHEDULE, prefs = {}, motion = false, rule = clubNight, extraRoutes = {} } = {}) {
  const routes = {
    ...extraRoutes,
    'current-lesson.json': { json: CURRENT },
    'lessons.json': { json: LESSONS },
    'calendar-feed.json': calendar ? { json: calendar } : { status: 404 },
    'shared/schedule.json': schedule ? { json: schedule } : { status: 404 },
  };
  return bootKiosk(routes, { ...ANSWERED, ...prefs }, undefined, (window) => {
    pinClock(window, nowMs);
    if (rule) window.journeyClubNightModule = rule;
    window.matchMedia = (query) => ({
      matches: !motion && /prefers-reduced-motion:\s*reduce/.test(query),
      media: query,
      addEventListener() {},
      removeEventListener() {},
    });
  });
}

const shown = (k, id) => !k.document.getElementById(id).classList.contains('hidden');
const view = (k) => (shown(k, 'trek-view') ? 'trek' : shown(k, 'journey-view') ? 'journey' : 'checkin');
const counts = (byClub, atMs) => JSON.stringify({ v: 1, at: atMs, byClub });

test('club night: Journey until 7:00, Trek from 7:00 to 7:30, then the Check-in Display', async () => {
  const k = boot(at(18, 59));
  try {
    await ticks();
    assert.equal(k.window.scheduledPhase(), 'journey', '18:59');
    pinClock(k.window, at(19, 0));
    assert.equal(k.window.scheduledPhase(), 'trek', '19:00');
    pinClock(k.window, at(19, 29));
    assert.equal(k.window.scheduledPhase(), 'trek', '19:29');
    pinClock(k.window, at(19, 30));
    assert.equal(k.window.scheduledPhase(), 'checkin', '19:30');
  } finally {
    k.close();
  }
});

test('the poll flips 18:59 -> 19:00 -> 19:30: splash, then the card, then the Check-in Display', async () => {
  const k = boot(at(18, 59));
  try {
    await ticks();
    assert.equal(view(k), 'journey');
    assert.equal(shown(k, 'journey-splash'), true, 'nothing running: the splash is up');
    pinClock(k.window, at(19, 0));
    k.window.pollSchedule();
    assert.equal(view(k), 'trek', 'a splash nobody started is not a running lesson');
    assert.equal(shown(k, 'checkin-view'), false);
    pinClock(k.window, at(19, 30));
    k.window.pollSchedule();
    assert.equal(view(k), 'checkin');
  } finally {
    k.close();
  }
});

test('a kiosk switched on mid-window shows the card as soon as it knows the night', async () => {
  const k = boot(at(19, 10));
  try {
    await ticks();
    assert.equal(view(k), 'trek');
  } finally {
    k.close();
  }
});

test('not on a non-club night: a cancelled night, a noClub date, another weekday', async () => {
  const cancelled = boot(at(19, 0), { calendar: feed([], { cancelled: true }) });
  try {
    await ticks();
    assert.equal(cancelled.window.scheduledPhase(), 'journey', 'the Journey window as always');
    pinClock(cancelled.window, at(19, 20));
    assert.equal(cancelled.window.scheduledPhase(), 'checkin');
    assert.equal(view(cancelled), 'journey');
  } finally {
    cancelled.close();
  }
  const noClub = boot(at(19, 5), { schedule: { ...SCHEDULE, specialDates: { '2026-10-07': { noClub: true } } } });
  try {
    await ticks();
    assert.equal(noClub.window.scheduledPhase(), 'journey');
  } finally {
    noClub.close();
  }
  const thursday = boot(at(19, 20, 8), { calendar: null });
  try {
    await ticks();
    assert.equal(thursday.window.scheduledPhase(), 'checkin', 'no feed: the meeting day only');
  } finally {
    thursday.close();
  }
});

test('until the club-night rule has loaded, no night is a club night', async () => {
  const k = boot(at(19, 5), { rule: null });
  try {
    await ticks();
    assert.equal(k.window.scheduledPhase(), 'journey');
    assert.equal(view(k), 'journey');
  } finally {
    k.close();
  }
});

test('a lesson still running at 7:00 is waited for; its end brings the card; 7:30 ends it', async () => {
  const k = boot(at(18, 50));
  try {
    await ticks();
    k.document.getElementById('journey-splash-play-btn').click();
    await ticks();
    assert.ok(k.video.hasAttribute('src'), 'the lesson is playing');
    pinClock(k.window, at(19, 0));
    k.window.pollSchedule();
    assert.equal(view(k), 'journey', 'never cut at 7:00');
    assert.ok(k.video.hasAttribute('src'));
    pinClock(k.window, at(19, 16));
    k.window.pollSchedule();
    assert.equal(view(k), 'journey', 'nor at 7:15 on a club night: the card is waiting for it');
    // The video ends: its slides come next, as always, and are not cut either.
    k.video.dispatchEvent(new k.window.Event('ended'));
    assert.equal(view(k), 'journey');
    assert.equal(shown(k, 'slides-view'), true);
    k.window.pollSchedule();
    assert.equal(view(k), 'journey');
    // Finish: straight to the card.
    k.window.finishTeachingSlides();
    assert.equal(view(k), 'trek');
    k.window.pollSchedule();
    assert.equal(view(k), 'trek', 'the next poll agrees');
    pinClock(k.window, at(19, 30));
    k.window.pollSchedule();
    assert.equal(view(k), 'checkin');
  } finally {
    k.close();
  }
});

test('teaching slides still up at 7:00 are waited for too; Finish brings the card', async () => {
  const k = boot(at(18, 55), { extraRoutes: { 'teaching-slides.json': { json: json('teaching-slides.json') } } });
  try {
    await ticks();
    assert.equal(view(k), 'journey');
    assert.equal(k.window.skipToTeachingSlides(), true, 'the splash went straight to the slides');
    pinClock(k.window, at(19, 1));
    k.window.pollSchedule();
    assert.equal(view(k), 'journey', 'the slides are not cut');
    assert.equal(shown(k, 'slides-view'), true);
    k.window.finishTeachingSlides();
    assert.equal(view(k), 'trek');
  } finally {
    k.close();
  }
});

test('the chip shows tonight’s Trek count, follows the lobby’s writes, and hides with none', async () => {
  const k = boot(at(19, 5), { prefs: { 'awanaClubCounts.v1': counts({ trek: 14, sparks: 30 }, at(19, 4)) } });
  try {
    await ticks();
    assert.equal(view(k), 'trek');
    assert.equal(shown(k, 'trek-chip'), true);
    assert.equal(k.document.getElementById('trek-chip-count').textContent, '14');
    assert.match(k.document.getElementById('trek-chip-label').textContent, /checked in/i);
    // The lobby frame writes a new tally (another document: a storage event).
    k.window.localStorage.setItem('awanaClubCounts.v1', counts({ trek: 15 }, at(19, 5)));
    k.window.dispatchEvent(new k.window.StorageEvent('storage', { key: 'awanaClubCounts.v1' }));
    assert.equal(k.document.getElementById('trek-chip-count').textContent, '15');
    // A tally with no Trek entry: no count is known.
    k.window.localStorage.setItem('awanaClubCounts.v1', counts({ sparks: 2 }, at(19, 5)));
    k.window.dispatchEvent(new k.window.StorageEvent('storage', { key: 'awanaClubCounts.v1' }));
    assert.equal(shown(k, 'trek-chip'), false);
  } finally {
    k.close();
  }

  const none = boot(at(19, 5));
  try {
    await ticks();
    assert.equal(view(none), 'trek');
    assert.equal(shown(none, 'trek-chip'), false, 'no tally: no chip');
  } finally {
    none.close();
  }

  const lastWeek = boot(at(19, 5), { prefs: { 'awanaClubCounts.v1': counts({ trek: 9 }, at(19, 20, 1)) } });
  try {
    await ticks();
    assert.equal(shown(lastWeek, 'trek-chip'), false, 'last week’s count is not tonight’s');
  } finally {
    lastWeek.close();
  }
});

test('trekCountFrom: only a well-formed entry from today', async () => {
  const k = boot(at(12, 0));
  try {
    const now = at(19, 0);
    const f = (raw) => k.window.trekCountFrom(raw, now);
    assert.equal(f(counts({ trek: 0 }, at(18, 0))), 0, 'zero is a count');
    assert.equal(f(counts({ trek: 3 }, at(23, 59, 6))), null, 'yesterday');
    assert.equal(f(counts({ trek: 3 }, now + 2 * 60 * 60 * 1000)), null, 'far in the future');
    assert.equal(f(counts({ trek: -1 }, now)), null);
    assert.equal(f(counts({ trek: 1.5 }, now)), null);
    assert.equal(f('not json'), null);
    assert.equal(f(null), null);
    assert.equal(f(JSON.stringify({ at: now, byClub: { trek: 3 } })), null, 'no version');
  } finally {
    k.close();
  }
});

test('the calendar names tonight’s Trek lesson: shown; anything less: no title', async () => {
  const k = boot(at(19, 5), {
    calendar: feed([{ date: '2026-10-07', kind: 'note', title: 'Trek: Mapping the Way', isCancelled: false, isSpecial: false }]),
  });
  try {
    await ticks();
    assert.equal(view(k), 'trek');
    assert.equal(shown(k, 'trek-lesson'), true);
    assert.equal(k.document.getElementById('trek-lesson-title').textContent, 'Mapping the Way');
  } finally {
    k.close();
  }

  const plain = boot(at(19, 5));
  try {
    await ticks();
    assert.equal(view(plain), 'trek');
    assert.equal(shown(plain, 'trek-lesson'), false, 'no Trek entry tonight: no title');
    assert.equal(plain.document.getElementById('trek-lesson-title').textContent, '');
  } finally {
    plain.close();
  }

  const k2 = boot(at(12, 0));
  try {
    const title = (titles, extra = {}) =>
      k2.window.trekLessonTitleFor(
        titles.map((t) => ({ date: '2026-10-07', kind: 'note', title: t, isCancelled: false, ...extra })),
        '2026-10-07'
      );
    assert.equal(title(['Trek - Into the Wild']), 'Into the Wild');
    assert.equal(title(['TREK – Into the Wild']), 'Into the Wild');
    assert.equal(title(['Trek Lesson 4: Into the Wild']), 'Lesson 4: Into the Wild');
    assert.equal(title(['Trek: Into the Wild', 'Trek: Into the Wild']), 'Into the Wild', 'the same title twice is one');
    assert.equal(title(['Trek: One', 'Trek: Two']), null, 'two different titles: never pick one');
    assert.equal(title(['Trek night']), null, 'no separator: not a title');
    assert.equal(title(['Trekking club: Hike']), null, 'not the word Trek');
    assert.equal(title(['Awana meeting']), null);
    assert.equal(title(['Trek:']), null, 'nothing after the name');
    assert.equal(title(['Trek: Into the Wild'], { isCancelled: true }), null, 'cancelled');
    assert.equal(
      k2.window.trekLessonTitleFor([{ date: '2026-10-14', title: 'Trek: Next Week' }], '2026-10-07'),
      null,
      'another night'
    );
    assert.equal(title([`Trek: ${'x'.repeat(81)}`]), null, 'too long to be a title');
  } finally {
    k2.close();
  }
});

test('the toggle and Settings still work over the card', async () => {
  const k = boot(at(19, 10));
  try {
    await ticks();
    assert.equal(view(k), 'trek');
    k.document.getElementById('toggle-btn').click();
    assert.equal(view(k), 'checkin');
    k.window.pollSchedule();
    assert.equal(view(k), 'checkin', 'the poll does not fight a manual choice');
    k.document.getElementById('toggle-btn').click();
    assert.equal(view(k), 'trek', 'back to the card in Trek’s time');
    k.document.getElementById('settings-btn').click();
    assert.equal(shown(k, 'settings-panel'), true);
    // A pick from Settings plays over the card and hands back to it.
    assert.equal(k.window.startSlidesPreview(1), true);
    assert.equal(view(k), 'journey', 'the preview takes the screen, the card under it hidden');
    k.window.finishTeachingSlides();
    assert.equal(view(k), 'trek');
  } finally {
    k.close();
  }
});

test('reduced motion gets a still card; with motion, no Check-in stinger over it', async () => {
  const still = boot(at(19, 5));
  try {
    await ticks();
    assert.equal(view(still), 'trek');
    assert.equal(still.document.documentElement.classList.contains('motion-full'), false);
    assert.equal(still.document.querySelector('.jm-stinger'), null);
  } finally {
    still.close();
  }
  const mac = boot(at(18, 59), { motion: true });
  try {
    await ticks();
    assert.equal(mac.document.documentElement.classList.contains('motion-full'), true);
    assert.equal(view(mac), 'journey');
    pinClock(mac.window, at(19, 0));
    mac.window.pollSchedule();
    await ticks(1);
    assert.equal(view(mac), 'trek');
    assert.equal(mac.document.querySelector('.jm-stinger'), null, 'the card has its own entrance');
  } finally {
    mac.close();
  }
});

/* Journey's own count chip (owner 2026-10-12): same entry, byClub.journey. */
const chipUp = (k) => shown(k, 'journey-chip');
const chipText = (k) => k.document.getElementById('journey-chip-count').textContent;

test('the Journey chip: on the splash, gone while the video plays, back on the slides', async () => {
  const k = boot(at(18, 40), { prefs: { 'awanaClubCounts.v1': counts({ journey: 11, trek: 4 }, at(18, 39)) } });
  try {
    await ticks();
    assert.equal(view(k), 'journey');
    assert.equal(shown(k, 'journey-splash'), true);
    assert.equal(chipUp(k), true, 'on the splash');
    assert.equal(chipText(k), '11');
    const beside = () => k.document.getElementById('journey-chip').classList.contains('beside-slides');
    assert.equal(beside(), false, 'beside the gear on the splash');
    k.document.getElementById('journey-splash-play-btn').click();
    await ticks();
    assert.ok(k.video.hasAttribute('src'));
    assert.equal(chipUp(k), false, 'never over the lesson video');
    k.video.dispatchEvent(new k.window.Event('ended'));
    await ticks(1);
    assert.equal(shown(k, 'slides-view'), true);
    assert.equal(chipUp(k), true, 'back with the teaching slides');
    // In the pillarbox, off Awana's slide (design review 2026-10-13; where
    // it lands is test/big-screen-layout.test.mjs).
    assert.equal(beside(), true, 'moved beside the slide');
    // The lobby writes a new tally.
    k.window.localStorage.setItem('awanaClubCounts.v1', counts({ journey: 12 }, at(18, 41)));
    k.window.dispatchEvent(new k.window.StorageEvent('storage', { key: 'awanaClubCounts.v1' }));
    assert.equal(chipText(k), '12');
    // The menus: Settings opens over it and the chip stays.
    k.document.getElementById('settings-btn').click();
    await ticks(1);
    assert.equal(chipUp(k), true, 'with the lesson picker open');
  } finally {
    k.close();
  }
});

test('the Journey chip stays away from reading overlays, the Trek card, the Check-in Display, and with no count', async () => {
  const k = boot(at(18, 40), { prefs: { 'awanaClubCounts.v1': counts({ journey: 11, trek: 4 }, at(18, 39)) } });
  try {
    await ticks();
    assert.equal(chipUp(k), true);
    k.document.getElementById('prep-view').classList.remove('hidden');
    await ticks(1);
    assert.equal(chipUp(k), false, 'Read Prep');
    k.document.getElementById('prep-view').classList.add('hidden');
    k.document.getElementById('handout-view').classList.remove('hidden');
    await ticks(1);
    assert.equal(chipUp(k), false, 'the handout');
    k.document.getElementById('handout-view').classList.add('hidden');
    await ticks(1);
    assert.equal(chipUp(k), true);
    k.document.getElementById('toggle-btn').click();
    await ticks(1);
    assert.equal(view(k), 'checkin');
    assert.equal(chipUp(k), false, 'not over the Check-in Display');
    pinClock(k.window, at(19, 5));
    k.window.pollSchedule();
    await ticks(1);
    assert.equal(view(k), 'trek');
    assert.equal(chipUp(k), false, 'the Trek card shows Trek’s count instead');
    assert.equal(k.document.getElementById('trek-chip-count').textContent, '4');
  } finally {
    k.close();
  }
  const none = boot(at(18, 40), { prefs: { 'awanaClubCounts.v1': counts({ trek: 4 }, at(18, 39)) } });
  try {
    await ticks();
    assert.equal(view(none), 'journey');
    assert.equal(chipUp(none), false, 'no Journey entry: no chip');
  } finally {
    none.close();
  }
});
