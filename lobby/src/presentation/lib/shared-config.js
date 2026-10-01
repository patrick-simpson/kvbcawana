/**
 * Loads and validates the shared data files (`shared/schedule.json`,
 * `shared/theme.json`) hosted at this repo's root for the whole Awana
 * app family. Validation is strict and throws at module init: a
 * malformed file fails `npm run lint` / `npm test` / `npm run build`
 * long before it can reach the live display. Everything exported here
 * is plain data — the schedule engine stays pure.
 */
import rawSchedule from '../../../shared/schedule.json';
import rawTheme from '../../../shared/theme.json';
import rawSlides from '../../../shared/slides.json';

/* ── Validation helpers (hand-rolled; no runtime deps) ────────────── */

const CLUB_IDS = ['puggles', 'cubbies', 'sparks', 'tnt', 'trek', 'journey'];
const DECK_IDS = ['opening', 'closing'];
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function fail(msg) {
  throw new Error(`shared config invalid: ${msg}`);
}

function isRecord(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** "HH:MM" → minutes from midnight (24:00 allowed as an exclusive end). */
export function parseHHMM(raw, ctx) {
  if (typeof raw !== 'string') fail(`${ctx}: time must be an "HH:MM" string`);
  const m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) fail(`${ctx}: bad time "${raw}"`);
  const mins = Number(m[1]) * 60 + Number(m[2]);
  if (mins < 0 || mins > 24 * 60) fail(`${ctx}: time "${raw}" out of range`);
  return mins;
}

function parseWindow(v, ctx) {
  if (!isRecord(v)) fail(`${ctx}: window must be an object`);
  if (typeof v.title !== 'string' || v.title.length === 0) fail(`${ctx}: missing title`);
  const startMin = parseHHMM(v.start, `${ctx} "${v.title}" start`);
  const endMin = parseHHMM(v.end, `${ctx} "${v.title}" end`);
  if (endMin <= startMin) fail(`${ctx} "${v.title}": end must be after start`);
  const base = { title: v.title, startMin, endMin };

  switch (v.kind) {
    case 'slideshow': {
      const deck = v.deck;
      if (typeof deck !== 'string' || !DECK_IDS.includes(deck)) {
        fail(`${ctx} "${v.title}": deck must be one of ${DECK_IDS.join('/')}`);
      }
      return { ...base, kind: 'slideshow', deck };
    }
    case 'game': {
      if (!Array.isArray(v.clubs) || v.clubs.length === 0) {
        fail(`${ctx} "${v.title}": game window needs a clubs array`);
      }
      const clubs = v.clubs.map((c) => {
        if (typeof c !== 'string' || !CLUB_IDS.includes(c)) {
          fail(`${ctx} "${v.title}": unknown club "${String(c)}"`);
        }
        return c;
      });
      return { ...base, kind: 'game', clubs };
    }
    case 'shutdown':
      return { ...base, kind: 'shutdown' };
    default:
      fail(`${ctx} "${v.title}": unknown kind "${String(v.kind)}"`);
  }
}

function parseWindows(v, ctx) {
  if (!Array.isArray(v) || v.length === 0) fail(`${ctx}: windows must be a non-empty array`);
  const windows = v.map((w, i) => parseWindow(w, `${ctx} windows[${i}]`));
  for (let i = 1; i < windows.length; i++) {
    if (windows[i].startMin < windows[i - 1].endMin) {
      fail(`${ctx}: "${windows[i].title}" overlaps "${windows[i - 1].title}"`);
    }
  }
  return windows;
}

/** Validate an arbitrary JSON value into a ScheduleConfig (exported for tests). */
export function parseScheduleConfig(raw) {
  if (!isRecord(raw)) fail('schedule.json must be an object');
  if (raw.version !== 1) fail(`schedule.json: unsupported version ${String(raw.version)}`);
  if (!isRecord(raw.meeting)) fail('schedule.json: missing meeting');
  const day = raw.meeting.day;
  if (typeof day !== 'number' || !Number.isInteger(day) || day < 0 || day > 6) {
    fail('schedule.json: meeting.day must be 0–6');
  }
  const startMin = parseHHMM(raw.meeting.start, 'meeting.start');
  const windows = parseWindows(raw.windows, 'schedule.json');

  const specialDates = {};
  if (raw.specialDates !== undefined) {
    if (!isRecord(raw.specialDates)) fail('schedule.json: specialDates must be an object');
    for (const [key, val] of Object.entries(raw.specialDates)) {
      if (!DATE_KEY_RE.test(key)) fail(`specialDates: bad date key "${key}" (want YYYY-MM-DD)`);
      if (!isRecord(val)) fail(`specialDates ${key}: must be an object`);
      const label = typeof val.label === 'string' ? val.label : undefined;
      if (val.noClub === true) {
        specialDates[key] = { noClub: true, label };
      } else {
        specialDates[key] = { label, windows: parseWindows(val.windows, `specialDates ${key}`) };
      }
    }
  }

  return {
    meetingDay: day,
    meetingStart: { hour: Math.floor(startMin / 60), minute: startMin % 60 },
    windows,
    specialDates,
  };
}

/** Validate an arbitrary JSON value into a ThemeConfig (exported for tests). */
export function parseThemeConfig(raw) {
  if (!isRecord(raw)) fail('theme.json must be an object');
  if (raw.version !== 1) fail(`theme.json: unsupported version ${String(raw.version)}`);
  if (!isRecord(raw.church) || typeof raw.church.name !== 'string' || typeof raw.church.displayName !== 'string') {
    fail('theme.json: church needs name + displayName');
  }
  const brand = {};
  if (isRecord(raw.brand)) {
    for (const [k, v] of Object.entries(raw.brand)) {
      if (typeof v !== 'string' || !HEX_RE.test(v)) fail(`theme.json brand.${k}: bad hex color`);
      brand[k] = v;
    }
  }
  if (!isRecord(raw.clubs)) fail('theme.json: missing clubs');
  const clubs = {};
  for (const [id, v] of Object.entries(raw.clubs)) {
    if (!isRecord(v)) fail(`theme.json clubs.${id}: must be an object`);
    if (typeof v.name !== 'string' || v.name.length === 0) fail(`theme.json clubs.${id}: missing name`);
    if (typeof v.color !== 'string' || !HEX_RE.test(v.color)) fail(`theme.json clubs.${id}: bad hex color`);
    const aliases = Array.isArray(v.aliases)
      ? v.aliases.filter((a) => typeof a === 'string')
      : [];
    // Optional catalog shades (2026-27 brand kit). Present means valid:
    // a typo'd hex fails the build like a bad `color` does.
    const shades = {};
    for (const k of ['deep', 'tint']) {
      if (v[k] === undefined) continue;
      if (typeof v[k] !== 'string' || !HEX_RE.test(v[k])) fail(`theme.json clubs.${id}.${k}: bad hex color`);
      shades[k] = v[k];
    }
    const art = {};
    if (isRecord(v.art)) {
      if (typeof v.art.logo === 'string') art.logo = v.art.logo;
      if (typeof v.art.logoWhite === 'string') art.logoWhite = v.art.logoWhite;
      if (typeof v.art.title === 'string') art.title = v.art.title;
      if (typeof v.art.group === 'string') art.group = v.art.group;
      if (v.art.monochrome === true) art.monochrome = true;
      if (Array.isArray(v.art.characters)) {
        art.characters = v.art.characters.filter((c) => typeof c === 'string');
      }
    }
    clubs[id] = { name: v.name, color: v.color, ...shades, aliases, art };
  }
  // Every club the schedule can reference must be themed.
  for (const id of CLUB_IDS) {
    if (!clubs[id]) fail(`theme.json: missing scheduled club "${id}"`);
  }
  return { church: { name: raw.church.name, displayName: raw.church.displayName }, brand, clubs };
}

/**
 * Validate an arbitrary JSON value into a SlidesConfig (exported for
 * tests). Everything is optional — decks fall back to their baked text —
 * but anything present must be well-formed so a typo'd slides.json
 * fails the build, never the projector.
 */
export function parseSlidesConfig(raw) {
  if (!isRecord(raw)) fail('slides.json must be an object');
  if (raw.version !== 1) fail(`slides.json: unsupported version ${String(raw.version)}`);
  const out = {};
  // (verseOfTheMonth was retired with the verse slide: the opening
  // ceremony now ends welcome → pledges → blackout, by operator request.)
  if (raw.closing !== undefined) {
    const c = raw.closing;
    if (!isRecord(c)) fail('slides.json: closing must be an object');
    const closing = {};
    if (c.title !== undefined) {
      if (typeof c.title !== 'string' || !c.title.trim() || c.title.length > 120) {
        fail('slides.json: closing.title must be a string (≤120 chars)');
      }
      closing.title = c.title.trim();
    }
    if (c.body !== undefined) {
      if (typeof c.body !== 'string' || !c.body.trim() || c.body.length > 300) {
        fail('slides.json: closing.body must be a string (≤300 chars)');
      }
      closing.body = c.body.trim();
    }
    out.closing = closing;
  }
  return out;
}

/* ── Validated singletons ─────────────────────────────────────────── */

export const SCHEDULE_CONFIG = parseScheduleConfig(rawSchedule);
export const THEME = parseThemeConfig(rawTheme);
export const SLIDES_CONFIG = parseSlidesConfig(rawSlides);

/** Absolute URL for a theme.json-relative art path. */
export function artUrl(path) {
  return `${import.meta.env.BASE_URL}shared/${path}`;
}

/** Local YYYY-MM-DD for `d` — local date parts, never toISOString (TZ shift). */
export function localDateKey(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
