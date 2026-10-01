// ─────────────────────────────────────────────────────────────
// Church-calendar scraper — turns the twotimtwo calendar page's
// HTML into a small list of club-night events. Pure data helpers,
// no React, and no direct DOM globals: everything works off a
// Document you hand in, so the SAME code runs in three places:
//
//   • the browser (DOMParser) — runtime CORS-proxy fallback
//   • Vitest (jsdom environment) — tests against the real HTML
//   • scripts/fetch-calendar.mjs (jsdom) — the nightly feed build
//
// An event is:
//   { date: 'YYYY-MM-DD', kind: 'club'|'note', title, isCancelled, isSpecial }
//
// kind 'note' marks all-day side events (Build Day, Grand Prix —
// Saturdays on the source calendar) that are NOT weekly club
// nights and never count toward "nights remaining".
//
// Source-page shapes this understands (one <div class="dayline">
// per calendar day; see __fixtures__/calendar-2026.html):
//   club night   .mtg-container with a visible  <span class="desc">TITLE</span>
//                plus a hidden .fields span with calendar_date="YYYY-MM-DD"
//   cancelled    .msg.skipped containing "No Awana this week"
//   day note     .day-note text, no .msg at all
//
// Trap: the day-number cell (`.cal_daynbr`) carries the class
// `skipped` for BOTH cancelled weeks and Saturday day-notes, so
// cancellation is detected via .msg.skipped only.
// ─────────────────────────────────────────────────────────────

export const FEED_VERSION = 1;
export const MAX_EVENTS = 120;
export const MAX_TITLE = 120;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Format AND a real calendar day — '2026-13-99' must not survive.
function isValidDateStr(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  return utc.getUTCFullYear() === y && utc.getUTCMonth() === m - 1 && utc.getUTCDate() === d;
}

// The source calendar titles ordinary weeks exactly "Awana meeting";
// anything else on a live club night is a special night.
export function isRegularTitle(title) {
  return /^awana meeting$/i.test(String(title ?? '').trim());
}

function cleanTitle(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
}

// A .desc span is only the display title when it's actually visible —
// every dayline also carries a hidden machine copy that always reads
// "Awana meeting", even on special nights.
function visibleDesc(dayline) {
  for (const span of dayline.querySelectorAll('.msg .desc')) {
    if ((span.style?.display || '') !== 'none') return span;
  }
  return null;
}

function parseDayline(dayline) {
  // Prefer the machine-readable attribute the page ships alongside
  // each meeting; fall back to the dayline's own id ("D2026-09-16").
  const fields = dayline.querySelector('.fields');
  let date = fields?.getAttribute('calendar_date') || '';
  if (!isValidDateStr(date)) date = (dayline.id || '').replace(/^D/, '');
  if (!isValidDateStr(date)) return null;

  const skippedMsg = dayline.querySelector('.msg.skipped');
  if (skippedMsg) {
    const note = cleanTitle(skippedMsg.querySelector('div')?.textContent) || 'No club';
    return { date, kind: 'club', title: note, isCancelled: true, isSpecial: false };
  }

  const desc = visibleDesc(dayline);
  if (desc) {
    const title = cleanTitle(desc.textContent);
    if (!title) return null;
    return { date, kind: 'club', title, isCancelled: false, isSpecial: !isRegularTitle(title) };
  }

  const note = dayline.querySelector('.day-note');
  if (note) {
    const title = cleanTitle(note.textContent);
    if (!title) return null;
    return { date, kind: 'note', title, isCancelled: false, isSpecial: false };
  }

  return null;
}

/**
 * Document → sorted event list. Never throws: a malformed dayline
 * drops that day, not the whole calendar — same salvage philosophy
 * as sanitizeSlides, because this feeds an unattended signage screen.
 */
export function parseCalendarDocument(doc) {
  if (!doc || typeof doc.querySelectorAll !== 'function') return [];
  const byDate = new Map();
  for (const dayline of doc.querySelectorAll('div.dayline')) {
    if (byDate.size >= MAX_EVENTS) break;
    try {
      const event = parseDayline(dayline);
      if (event && !byDate.has(event.date)) byDate.set(event.date, event);
    } catch {
      /* skip this day, keep the rest */
    }
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** HTML string → events, for the browser/tests (needs DOMParser). */
export function parseCalendarHtml(html) {
  if (typeof html !== 'string' || !html || typeof DOMParser === 'undefined') return [];
  try {
    return parseCalendarDocument(new DOMParser().parseFromString(html, 'text/html'));
  } catch {
    return [];
  }
}

// Salvages a feed that came out of fetch/localStorage — entry by
// entry, so one corrupt row can't blank the screen on club night.
export function sanitizeEvents(raw) {
  if (!Array.isArray(raw)) return [];
  const clean = [];
  const seen = new Set();
  for (const entry of raw) {
    if (clean.length >= MAX_EVENTS) break;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const date = typeof entry.date === 'string' ? entry.date : '';
    if (!isValidDateStr(date) || seen.has(date)) continue;
    const kind = entry.kind === 'note' ? 'note' : entry.kind === 'club' ? 'club' : null;
    if (!kind) continue;
    const title = cleanTitle(entry.title);
    if (!title) continue;
    seen.add(date);
    const isCancelled = kind === 'club' && entry.isCancelled === true;
    clean.push({
      date,
      kind,
      title,
      isCancelled,
      isSpecial: kind === 'club' && !isCancelled && !isRegularTitle(title),
    });
  }
  return clean.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Whole-feed version: also validates/normalizes the envelope. */
export function sanitizeFeed(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { generatedAt: null, events: [] };
  }
  const generatedAt =
    typeof raw.generatedAt === 'string' && !Number.isNaN(Date.parse(raw.generatedAt))
      ? raw.generatedAt
      : null;
  return { generatedAt, events: sanitizeEvents(raw.events) };
}
