// The real screens, driven the way their own test suites drive them, and
// recorded frame by frame (lib/vclock.mjs). Every name is made up; every frame
// on the wire passes the screens' own sanitizers, exactly like a club night.
//
// Each shot: where the page is, when (America/New_York), how big, what it is
// told before it loads, and what happens while it is filmed.
import { liveChannel } from './lib/live.mjs';
import { phoneApi } from './lib/phone.mjs';

const WED = '2026-10-14'; // a club night
const at = (hhmmss) => `${WED}T${hhmmss}-04:00`;

const TYPED_DECK = [
  { id: 's_1', type: 'text', eyebrow: 'This week', text: 'Bring your handbook and a friend', theme: 'sky' },
  { id: 's_2', type: 'text', eyebrow: 'Game time', text: 'Every club plays in the gym tonight', theme: 'sun' },
];

/** The lobby, set up and signed in to the stand-in live channel. */
function lobby(config) {
  return async (page, ctx) => {
    await page.route(/open-meteo|twotimtwo/, (r) => r.abort());
    ctx.send = await liveChannel(page);
    await page.addInitScript((c) => {
      localStorage.setItem('awanaSetupCardDismissed.v1', '1');
      localStorage.setItem('awanaConfig.v1', JSON.stringify(c));
    }, { calendarEnabled: false, seasonPromos: false, particleEffect: 'off', ...config });
  };
}

/** The projector, its first-run note put away as a set-up projector has it. */
async function projector(page) {
  await page.route(/open-meteo/, (r) => r.abort());
  await page.addInitScript(() => {
    try { localStorage.setItem('awanaSetupChecklistDismissed.v1', '1'); } catch { /* */ }
  });
}

let n = 0;
const checkin = (ctx, firstName, club, flags = {}) => () => ctx.send('checkin', {
  id: `reel-${++n}-${firstName}`, firstName, club, at: new Date(ctx.now()).toISOString(), ...flags,
});

export const SHOTS = {
  // 5:44 pm, doors open: the flagship title plays, the first child of the
  // night arrives and the lobby crowns her.
  'lobby-open': {
    url: '/lobby/', time: at('17:44:00'), seconds: 10,
    setup: lobby({ standardDisplayMs: 4600 }),
    ready: '.stage',
    cues: (ctx) => ({ 4.0: checkin(ctx, 'Maya', 'Sparks') }),
  },
  // A run: a birthday, a first-timer, a returning kid. Each holds for their
  // full time and the next one flips in, in their own club's colours.
  'lobby-run': {
    url: '/lobby/', time: at('18:12:00'), seconds: 13.5,
    setup: lobby({ manualSlides: TYPED_DECK, standardDisplayMs: 3200, specialDisplayMs: 3800, firstArrivalMoment: false }),
    ready: '.stage',
    cues: (ctx) => ({
      0.5: checkin(ctx, 'Noah', 'T&T', { isBirthday: true }),
      0.9: checkin(ctx, 'Ella', 'Puggles', { isFirstTimer: true }),
      1.2: checkin(ctx, 'Leo', 'Cubbies'),
      1.5: checkin(ctx, 'Sophia', 'Trek', { welcomeBack: true }),
    }),
  },
  // The room's numbers: a club crosses 20, the night crosses 100.
  'lobby-milestone': {
    url: '/lobby/', time: at('18:24:00'), seconds: 7,
    setup: lobby({ manualSlides: TYPED_DECK, firstArrivalMoment: false, showTonightTicker: true }),
    ready: '.stage',
    cues: (ctx) => {
      const tally = (counts) => () => ctx.send('tally', { counts, at: new Date(ctx.now()).toISOString() });
      const tonight = (checkedIn, booksCompleted) => () => ctx.send('tonight', { checkedIn, booksCompleted, awardsEarned: 3, friendsBrought: 4, at: new Date(ctx.now()).toISOString() });
      return {
        0.0: tally({ Puggles: 14, Cubbies: 21, Sparks: 19, 'T&T': 32, Trek: 9, Journey: 3 }),
        0.1: tonight(96, 4),
        0.3: tally({ Puggles: 14, Cubbies: 21, Sparks: 20, 'T&T': 32, Trek: 9, Journey: 3 }),
        2.6: tonight(100, 6),
      };
    },
  },
  // 7:45 pm, pickup: who is not checked out yet, by club, in the foot.
  'lobby-pickup': {
    url: '/lobby/', time: at('19:45:00'), seconds: 8,
    setup: lobby({ manualSlides: TYPED_DECK, firstArrivalMoment: false, checkoutBoardNamesAbove: 0 }),
    ready: '.stage',
    cues: (ctx) => {
      const list = [
        ['Ava', 'Puggles'], ['Mia', 'Puggles'], ['Leo', 'Cubbies'], ['Ezra', 'Cubbies'], ['Ruby', 'Cubbies'],
        ['Maya', 'Sparks'], ['Owen', 'Sparks'], ['Ivy', 'Sparks'], ['Jude', 'Sparks'], ['Noah', 'T&T'],
        ['Lucy', 'T&T'], ['Eli', 'T&T'], ['Nora', 'T&T'], ['Finn', 'T&T'],
      ];
      const board = (entries) => () => ctx.send('checkout', { entries: entries.map(([firstName, club]) => ({ firstName, club })), printed: 112, at: new Date(ctx.now()).toISOString() });
      return {
        0.3: board(list),
        4.0: board(list.filter(([f]) => f !== 'Owen')),
      };
    },
  },
  // The projector: the countdown runs out at 6:00 and the opening begins.
  'projector-countdown': {
    url: '/lobby/countdown', time: at('17:59:49'), seconds: 15,
    setup: projector,
    ready: 'body',
    warmup: async (shot) => { await shot.run(1.5); },
  },
  // Game time, T&T's turn: two minutes left.
  'projector-game': {
    url: '/lobby/countdown', time: at('18:27:53'), seconds: 9,
    setup: projector,
    ready: 'body',
    warmup: async (shot) => { await shot.run(1.5); },
  },
  // Journey at 6:30: the kiosk turns from the lobby feed to the lesson's start
  // screen and waits for a leader. The lesson title is a placeholder.
  'journey': {
    url: '/journey/', time: at('18:29:58'), seconds: 6,
    setup: async (page) => {
      await page.route(/open-meteo|twotimtwo/, (r) => r.abort());
      await page.route(/\.mp4(\?|$)/, (r) => r.abort());
      // The lobby feed it shows until 6:30 is a set-up, signed-in screen.
      await liveChannel(page);
      await page.addInitScript(() => {
        try {
          localStorage.setItem('awanaSetupCardDismissed.v1', '1');
          localStorage.setItem('awanaConfig.v1', JSON.stringify({ calendarEnabled: false, seasonPromos: false }));
        } catch { /* */ }
      });
      await page.route(/current-lesson\.json/, (r) => r.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ version: 2, week: 7, title: 'Lesson', downloadUrl: 'current-lesson-video.mp4', transcodedAt: '2026-10-13T15:44:31.611Z', resolvedAt: '2026-10-13T15:43:56.061Z' }),
      }));
    },
    ready: '#journey-splash',
    // The kiosk looks at the clock every 15 s: run up to just before it turns.
    warmup: async (shot) => { await shot.run(13.4, 100); },
  },
  // The phone page, awana.kvbchurch.org/checkin, on a phone: tap a child, keep
  // Bible ticked, check in. The check-in service behind it is a stand-in (lib/phone.mjs).
  'phone': {
    url: '/checkin/', time: at('18:02:00'), seconds: 7,
    viewport: { width: 390, height: 844 }, dpr: 2, mobile: true,
    setup: async (page) => { await phoneApi(page); },
    ready: '.fam',
    cues: (ctx) => ({
      1.4: (page) => ctx.tap(page, '.fam[aria-label="Owen Pemberly"]'),
      3.3: (page) => ctx.tap(page, '#kid-sheet .btn.go'),
    }),
  },
  // One settings page for every screen (awana.kvbchurch.org/settings): the
  // screens that are on, then a section of shared settings.
  'settings': {
    url: '/lobby/settings', time: at('16:30:00'), seconds: 6.5,
    viewport: { width: 1600, height: 1000 },
    setup: async (page) => {
      await page.route(/open-meteo|twotimtwo|localhost:3456/, (r) => r.abort());
      await liveChannel(page, {
        answer: (url) => {
          if (url.pathname.endsWith('/v1/screens')) {
            const seen = new Date(Date.parse(at('16:29:40'))).toISOString();
            return { body: { max: 40, screens: [
              { id: 'scr-lobby-1', kind: 'lobby', name: 'Lobby TV', online: true, lastSeen: seen },
              { id: 'scr-lobby-2', kind: 'lobby', name: 'Gym door TV', online: true, lastSeen: seen },
              { id: 'scr-proj-1', kind: 'projector', name: 'Projector', online: true, lastSeen: seen },
              { id: 'scr-jr-1', kind: 'journey', name: 'Journey kiosk', online: true, lastSeen: seen },
              { id: 'scr-pc-1', kind: 'computer', name: 'Check-in laptop', online: true, lastSeen: seen },
            ] } };
          }
          if (url.pathname.endsWith('/v1/state')) return { body: {} };
          return undefined;
        },
      });
    },
    ready: '[role=tab]',
    warmup: async (shot) => {
      await shot.page.locator('[role=tab]', { hasText: 'Screens' }).first().click();
      await shot.run(1.2);
    },
    cues: (ctx) => ({
      2.0: (page) => ctx.tap(page, '[role=tab]:has-text("Check-ins")'),
      4.2: (page) => ctx.tap(page, '[role=tab]:has-text("Celebrations")'),
    }),
  },
};

