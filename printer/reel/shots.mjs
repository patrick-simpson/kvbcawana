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

/** One season poster on the lobby, asked for at 0.2 s and played to its end card. */
function promoShot(key, seconds) {
  return {
    url: '/lobby/', time: at('18:15:00'), seconds,
    setup: lobby({ manualSlides: TYPED_DECK, firstArrivalMoment: false }),
    ready: '.stage',
    // The room sees the poster, not the preview's "click or press Esc to stop" pill.
    warmup: (shot) => shot.page.addStyleTag({ content: '.lobby-preview__stop{display:none!important}' }),
    cues: () => ({
      0.2: (page) => page.evaluate((k) => {
        new BroadcastChannel('awana-configure').postMessage({ screen: 'lobby', action: 'preview-promo', data: { key: k } });
      }, key),
    }),
  };
}

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
    // One bar of the song (1.92 s) per name, so each flips on the bar (owner 2026-10-16: "in time with the music").
    setup: lobby({ manualSlides: TYPED_DECK, standardDisplayMs: 1920, specialDisplayMs: 1920, firstArrivalMoment: false }),
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
        0.7: tally({ Puggles: 14, Cubbies: 21, Sparks: 20, 'T&T': 32, Trek: 9, Journey: 3 }),
        2.62: tonight(100, 6),
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
  // The season's posters (owner, 2026-10-16: "the promos like barf, snow day and
  // poster contest and parents night"), played the way the Settings window's
  // Preview the promos plays them on a TV: a relay on the lobby's own channel.
  'promo-barf': promoShot('friend', 15.5),
  'promo-snow': promoShot('snowAlertsStorm', 20.5),
  'promo-contest': promoShot('contest', 15.5),
  'promo-parents': promoShot('parents', 15.5),
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
  // Journey's teaching slides, stepped by the leader's phone remote (owner,
  // 2026-10-16: the remote beside the screen). The room's PC and the phone are
  // filmed apart, pressed at the same clip times (one bar apart): the PC takes
  // the kiosk's own remote command, the phone taps its real Next button.
  'journey-slides': {
    url: '/journey/', time: at('18:30:05'), seconds: 6,
    setup: async (page) => {
      await page.route(/open-meteo|twotimtwo/, (r) => r.abort());
      await page.route(/\.mp4(\?|$)/, (r) => r.abort());
      await liveChannel(page);
      await page.addInitScript(() => {
        try {
          localStorage.setItem('awanaSetupCardDismissed.v1', '1');
          localStorage.setItem('awanaConfig.v1', JSON.stringify({ calendarEnabled: false, seasonPromos: false }));
        } catch { /* */ }
      });
    },
    ready: '#journey-splash',
    warmup: async (shot) => {
      await shot.run(3, 100);
      await shot.page.evaluate(() => window.journeyRemote.command({ action: 'slides-start' }));
      await shot.run(2.5, 100);
    },
    cues: () => {
      const next = (page) => page.evaluate(() => window.journeyRemote.command({ action: 'slide-next' }));
      return { 1.0: next, 2.92: next };
    },
  },
  'remote': {
    url: '/journey/remote/', time: at('18:30:05'), seconds: 6,
    viewport: { width: 390, height: 844 }, dpr: 2, mobile: true,
    setup: async (page, ctx) => {
      // The Talk About It sample answers stay on a leader's own phone (licensing):
      // never in the film, which plays on the public home page.
      await page.route(/slide-answers\.json/, (r) => r.fulfill({ status: 404, body: '' }));
      const kinds = ['title', 'verse', 'misconception', 'illumination'];
      ctx.slide = 1;
      ctx.last = null;
      let presses = 0;
      await liveChannel(page, {
        answer: (url, method, body) => {
          const now = new Date(ctx.now ? ctx.now() : Date.now()).toISOString();
          if (url.pathname.endsWith('/v1/journey/remote/state')) {
            return { body: { serverNow: now, online: 1, kiosks: [{ id: 'jr-1', name: 'Journey room', online: true, now: {
              view: 'slides', week: 8, title: 'Unit 2, Lesson 4: Naturalism', preview: false, wait: null, last: ctx.last, at: now,
              slide: { n: ctx.slide, of: 7, kind: kinds[ctx.slide - 1] || 'template', heading: null, lines: [] },
            } }] } };
          }
          if (url.pathname.endsWith('/v1/journey/remote') && method === 'POST') {
            presses += 1;
            const id = `reel-press-${presses}`;
            if (body && body.action === 'slide-next') ctx.slide = Math.min(4, ctx.slide + 1);
            ctx.last = { id, action: body && body.action, ok: true, reason: null };
            return { body: { ok: true, id, kiosks: 1 } };
          }
          return undefined;
        },
      });
    },
    ready: '#btn-next',
    warmup: async (shot) => { await shot.run(2, 100); },
    cues: (ctx) => ({
      1.0: (page) => ctx.tap(page, '#btn-next'),
      2.92: (page) => ctx.tap(page, '#btn-next'),
    }),
  },
  // The phone page, awana.kvbchurch.org/checkin, on a phone: one tap checks a
  // child in (simple check-in, on by default since 2026-10-15), then another. The check-in service behind it is a stand-in (lib/phone.mjs).
  'phone': {
    url: '/checkin/', time: at('18:02:00'), seconds: 7,
    viewport: { width: 390, height: 844 }, dpr: 2, mobile: true,
    setup: async (page) => { await phoneApi(page); },
    ready: '.fam',
    cues: (ctx) => ({
      1.4: (page) => ctx.tap(page, '.fam[aria-label="Owen Pemberly"]'),
      3.32: (page) => ctx.tap(page, '.fam[aria-label="Ivy Calloway"]'),
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
      // The rail since 2026-10-13: Tonight, Printing, Screens, What screens show, Slides & look...
      2.0: (page) => ctx.tap(page, '[role=tab]:has-text("What screens show")'),
      3.92: (page) => ctx.tap(page, '[role=tab]:has-text("Slides & look")'),
    }),
  },
};

