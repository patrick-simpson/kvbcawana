// ─────────────────────────────────────────────────────────────
// Calendar → slides. Pure date math and copywriting, no React,
// no fetching — the fully-testable core between the scraped
// calendar events (calendarParse.js) and the slideshow deck.
//
// House rules encoded here:
//   • "Tonight" is a LOCAL calendar-date match. Never toISOString()
//     — in US-Eastern evenings UTC has already rolled to tomorrow,
//     which is exactly club hours.
//   • Awana Store nights are a surprise: /store/i titles are never
//     announced ahead of time.
//   • Saturday day-notes (Build Day, Grand Prix) are not weekly
//     club nights: they never count toward "nights remaining" and
//     never appear as "tonight"/"next week".
// ─────────────────────────────────────────────────────────────

import { SLIDE_THEMES, TEXT_SIZES } from './slides.js';

// Local-time YYYY-MM-DD key (same recipe as useTally's todayKey).
export function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 'Water Night - Poster Contest kicks off' → headline + sub-note.
// Split on the FIRST spaced hyphen only, so hyphenated names survive.
export function splitTitle(rawTitle) {
  const raw = String(rawTitle ?? '').trim();
  const at = raw.indexOf(' - ');
  if (at === -1) return { title: raw, note: '' };
  return { title: raw.slice(0, at).trim(), note: raw.slice(at + 3).trim() };
}

export function isStoreNight(title) {
  return /store/i.test(String(title ?? ''));
}

// 'YYYY-MM-DD' → 'Wed, Sep 9'. Components go through the LOCAL Date
// constructor — new Date('YYYY-MM-DD') would parse as UTC midnight
// and render the previous day in the Americas.
export function formatShortDate(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

// 'YYYY-MM-DD' → 'Wednesday, October 14'. Same local-Date recipe as
// formatShortDate above, spelled out: a promo naming the night it is
// counting down to has the room's full attention and can afford the words.
export function formatLongDate(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

/**
 * A date as the lobby's stepped chip carries it: the weekday on the label
 * tier and the month and day on the value block, 'YYYY-MM-DD' → WED / SEP 30.
 * `lead` rides in front of the weekday ('Back' → BACK WED / DEC 2). Same
 * local-Date recipe as formatShortDate, so the chip and the sentence it
 * replaces always name the same day. Null for anything that is not a date.
 */
export function dateChip(dateStr, lead = '') {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  const weekday = date.toLocaleDateString('en-US', { weekday: 'short' });
  const day = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return {
    label: `${lead ? `${lead} ` : ''}${weekday}`.toUpperCase(),
    value: day.toUpperCase(),
  };
}

// Whole days between two date keys, DST-proof (UTC component math).
export function daysBetween(fromStr, toStr) {
  const [fy, fm, fd] = String(fromStr).split('-').map(Number);
  const [ty, tm, td] = String(toStr).split('-').map(Number);
  if (!fy || !ty) return NaN;
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

// Sunday-based day of week for a local date key (0 = Sunday).
function dayOfWeek(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  if (!y || !m || !d) return 0;
  return new Date(y, m - 1, d).getDay();
}

/**
 * The club nights on the calendar, with the shared schedule's break weeks
 * already applied. Split out of deriveClubInfo() so anything else that has to
 * count real club nights (see src/lib/promos.js) asks the SAME question about
 * cancellations instead of growing a second, slightly different copy of the
 * rules.
 *
 * @param {Array<any>|null|undefined} events
 * @param {Record<string, { noClub?: boolean, label?: string }>|null} [specialDates]
 */
export function clubNights(events, specialDates = null) {
  const special = (specialDates && typeof specialDates === 'object') ? specialDates : {};
  return (Array.isArray(events) ? events : []).filter((e) => e?.kind === 'club').map((e) => {
    const entry = special[e.date];
    if (!entry || entry.noClub !== true) return e;
    // The calendar's own title still stands as the title (it may be a real
    // event name); the shared file's label is carried separately, because it is
    // the church's words for WHY there is no club, which is what the heads-up
    // slide should say.
    return { ...e, isCancelled: true, noClubLabel: entry.label || '' };
  });
}

/**
 * Everything the slides need to know about where we are in the club
 * year, derived from the sanitized event list and a local date key.
 *
 * `specialDates` (#342) is the shared schedule's break-week table — the same
 * one the projector reads (see src/lib/schedule.js for the signage-side
 * parser). A date it marks `noClub` cancels that night here too, so one shared
 * file means one answer on both screens: the lobby TV stops counting a break
 * week toward "nights remaining" and can name the reason on its heads-up
 * slide. Nothing else about the entry is used.
 *
 * Note the limit, deliberately: this can only cancel a night the CHURCH
 * CALENDAR also lists. A break week that the calendar feed never mentioned was
 * never counted in the first place, so there is nothing to subtract.
 *
 * @param {Array<any>|null|undefined} events
 * @param {string} todayStr
 * @param {Record<string, { noClub?: boolean, label?: string }>|null} [specialDates]
 */
export function deriveClubInfo(events, todayStr, specialDates = null) {
  const clubs = clubNights(events, specialDates);

  const tonight = clubs.find((e) => e.date === todayStr && !e.isCancelled) || null;
  const after = clubs.filter((e) => e.date > todayStr);

  return {
    todayStr,
    tonight,
    // Next row on the calendar after today, cancelled or not — this is
    // what "next week" means on a weekly calendar with explicit breaks.
    nextEntry: after[0] || null,
    // Next ACTUAL club night, skipping cancelled weeks.
    nextNight: after.find((e) => !e.isCancelled) || null,
    nightsRemaining: after.filter((e) => !e.isCancelled).length,
    seasonOver: after.length === 0,
  };
}

// ── Slide construction ───────────────────────────────────────

const check = (theme, textSize) => ({
  theme: SLIDE_THEMES.includes(theme) ? theme : 'sky',
  textSize: TEXT_SIZES.includes(textSize) ? textSize : 'auto',
});

// `frame` is how the lobby lays the slide out (src/lib/lobbyFrame.js): the
// same words, with the date moved out of the sentence and onto the stepped
// chip under the headline (NEXT CLUB NIGHT / MAKING BOOKMARKS / WED SEP 30).
// `text` and `subtext` stay the whole sentence, so nothing that reads them
// changes; only the lobby's frame reads `frame`.
function slide(id, { eyebrow = '', text, subtext = '', theme = 'sky', textSize = 'auto', frame }) {
  const out = { id, eyebrow, text, subtext, durationSec: 0, ...check(theme, textSize) };
  if (frame) out.frame = frame;
  return out;
}

/**
 * The auto-generated deck, in show order. Derived fresh every render
 * from (events, today, config) — these slides are NEVER persisted, so
 * they can't go stale in localStorage or leak into the user's deck.
 */
export function buildCalendarSlides(info, cfg = {}) {
  if (!info) return [];
  const slides = [];
  const showWelcome = cfg.calendarShowWelcome !== false;
  const showNextWeek = cfg.calendarShowNextWeek !== false;
  const showRemaining = cfg.calendarShowRemaining !== false;

  // 1 — Welcome / next-night pointer
  if (showWelcome) {
    if (info.tonight) {
      if (info.tonight.isSpecial) {
        const { title, note } = splitTitle(info.tonight.title);
        slides.push(slide('cal_welcome', {
          eyebrow: 'Tonight', text: `Welcome to ${title}!`, subtext: note, theme: 'sky', textSize: 'xl',
        }));
      } else {
        slides.push(slide('cal_welcome', {
          eyebrow: 'Awana Clubs',
          text: String(cfg.calendarWelcomeText || 'Welcome to Awana!'),
          theme: 'sky',
          textSize: 'xl',
        }));
      }
    } else if (info.nextNight) {
      // Off-day: point at the next night. Store/regular titles are not
      // announced — the date alone is the message.
      const { title } = splitTitle(info.nextNight.title);
      const announce = info.nextNight.isSpecial && !isStoreNight(info.nextNight.title);
      slides.push(slide('cal_welcome', {
        eyebrow: 'Next club night',
        text: announce
          ? `${title} — ${formatShortDate(info.nextNight.date)}`
          : `See you ${formatShortDate(info.nextNight.date)}!`,
        theme: 'sky',
        textSize: 'lg',
        frame: { headline: announce ? title : 'See you!', chip: dateChip(info.nextNight.date) },
      }));
    }
  }

  // 2 — Next week / weather
  if (showNextWeek && info.nextEntry) {
    const entry = info.nextEntry;
    const gap = daysBetween(info.todayStr || localDateStr(), entry.date);
    if (entry.isCancelled) {
      // Phrase the cancellation by where the break actually falls.
      // "No club next week" while the cancelled night is tomorrow (or
      // months of summer break remain) reads as nonsense — and echoing
      // the calendar's boilerplate title ("No Awana this week") under a
      // "next week" headline contradicts it. Point at the comeback date
      // instead; only a non-boilerplate reason (e.g. "Christmas Break")
      // is worth repeating.
      const todayKey = info.todayStr || localDateStr();
      const resumeGap = info.nextNight ? daysBetween(todayKey, info.nextNight.date) : null;
      const weeksAway = Math.floor((gap + dayOfWeek(todayKey)) / 7);
      const longBreak = (resumeGap != null && resumeGap > 14) || weeksAway > 1;
      // When it is the SHARED SCHEDULE that cancelled the night (#342), its
      // label is the only honest reason — the calendar's own title describes a
      // night that is now not happening, so "Awana meeting — Back Wed, Dec 2"
      // would be worse than saying nothing. A shared break week with no label
      // therefore falls through to just the comeback date.
      const reason = entry.noClubLabel !== undefined
        ? entry.noClubLabel
        : splitTitle(entry.title).title;
      const back = info.nextNight ? `Back ${formatShortDate(info.nextNight.date)}` : '';
      const why = /^no\s+(awana|club)\b/i.test(reason) ? '' : reason;
      const headline = longBreak
        ? 'Club is on a break'
        : weeksAway === 0 ? 'No club this week' : 'No club next week';
      slides.push(slide('cal_next', {
        eyebrow: 'Heads up',
        text: headline,
        subtext: [why, back].filter(Boolean).join(' — '),
        theme: 'sunset',
        textSize: 'lg',
        frame: { headline, sub: why, chip: info.nextNight ? dateChip(info.nextNight.date, 'Back') : null },
      }));
    } else if (entry.isSpecial && !isStoreNight(entry.title)) {
      const { title, note } = splitTitle(entry.title);
      slides.push(slide('cal_next', {
        eyebrow: 'Mark your calendar',
        // A colon, not "is": titles are often whole sentences ("Poster
        // contest kicks off"), and "Next week is Poster contest kicks off"
        // reads as broken grammar on a wall.
        text: gap <= 8 ? `Next week: ${title}` : `Coming up: ${title} — ${formatShortDate(entry.date)}`,
        subtext: note,
        theme: 'sunset',
        textSize: 'lg',
        frame: { headline: gap <= 8 ? `Next week: ${title}` : `Coming up: ${title}`, sub: note, chip: dateChip(entry.date) },
      }));
    }
    // Regular (or hush-hush store) week ahead → nothing to tease, no
    // slide. Weather lives in the corner chip now, not the rotation.
  }

  // 3 — Nights remaining (the countdown-to-finish nudge)
  if (showRemaining && info.nightsRemaining >= 1 && info.nightsRemaining <= 9) {
    const n = info.nightsRemaining;
    slides.push(slide('cal_remaining', {
      eyebrow: 'The clock is ticking',
      text: `${n} night${n === 1 ? '' : 's'} remaining`,
      subtext: 'Is your child on track to finish their book?',
      theme: 'night',
      textSize: 'xl',
    }));
  }

  return slides;
}
