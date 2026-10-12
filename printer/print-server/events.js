// Awana event bus — pure payload builders + resilient publisher.
//
// The print server is the ONLY publisher on the live channel (it relays every
// frame to the sync Worker, which fans it out); the check-in display and the
// countdown app are subscribe-only consumers.
// Every payload shape here is pinned by contract-vectors.json (validated by
// scripts/test-contracts.cjs) and mirrored in the consumer repos.
//
// PRIVACY RULE: only first names ever ride the channel. No lastName, no
// allergies, no contact info, no birth years — the builders enforce this
// structurally by never accepting those fields.

'use strict';

const crypto = require('crypto');
const { cleanText, plainText: sharedPlainText } = require('./textClean');

const OPS_TYPES = ['print-failure', 'canary', 'selector-fail', 'update-ok'];
const NOTICE_LEVELS = ['info', 'warn', 'critical'];

const NAME_MAX = 40;
const RECAP_MAX = 15;
const BIRTHDAYS_MAX = 40;
const TALLY_CLUBS_MAX = 30;
const POINTS_GROUPS_MAX = 20;
const NOTICE_MAX = 200;
const TITLE_MAX = 60;

// Whole non-negative integer, or 0 when the input is unusable. Every
// contract-v3 counter is a count of things — never a name, never a rate.
function wholeCount(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function nowIso() {
  return new Date().toISOString();
}

function cleanName(s) {
  return cleanText(s, NAME_MAX, { coerce: true });
}

// Bounded plain text: strips anything markup-shaped and collapses whitespace
// (including the newlines TwoTimTwo's textareas allow) so display copy can
// never inject markup or blow up a fixed-height banner.
function plainText(s, max) {
  return sharedPlainText(s, max, { coerce: true });
}

// ── checkin ───────────────────────────────────────────────────────────────────
// v2 of the original 4-field event: `id` lets consumers dedupe live vs recap
// delivery, `at` lets them age out stale replays. Consumers treat both as
// optional so deploy order between producer and consumers doesn't matter.
function buildCheckin(input) {
  const src = input || {};
  const out = {
    id: crypto.randomUUID(),
    at: nowIso(),
    firstName: cleanName(src.firstName),
    club: cleanName(src.club),
    isBirthday: !!src.isBirthday,
    isFirstTimer: !!src.isFirstTimer,
  };
  // OPTIONAL celebration flags (contract optionalFields), sealed with the
  // rest of the payload so a name-bearing celebration never rides plaintext:
  //   welcomeBack — a RETURNING kid's first night of the season (#9).
  //   milestone   — the season night-count on the night a label milestone
  //                 is hit (5/10/25/50), for the display's milestone wall
  //                 (#10). A count alone is low-risk, but it rides the
  //                 sealed envelope regardless because it's per-child data.
  // Optional forever: old displays drop unknown fields, deploy order never
  // matters, and the fixed 512-byte checkin pad has ~100 bytes of headroom
  // these short fields fit inside (test:envelope proves length uniformity).
  if (src.welcomeBack === true) out.welcomeBack = true;
  // oneOff (7.18.0): a one-off name tag (a lost tag, a child not checking in
  // tonight). The screens play the welcome but never count it.
  if (src.oneOff === true) out.oneOff = true;
  const ms = Number(src.milestone);
  if (Number.isInteger(ms) && ms > 0 && ms <= 999) out.milestone = ms;
  return out;
}

// ── recap ─────────────────────────────────────────────────────────────────────
// Rolling replay of tonight's recent check-ins so a display that reconnects
// mid-event can celebrate the kids it missed. Entries are verbatim checkin
// payloads (id + at required — consumers dedupe on id).
function buildRecap(checkins) {
  const entries = (Array.isArray(checkins) ? checkins : [])
    .filter(c => c && typeof c.id === 'string' && typeof c.at === 'string')
    .slice(-RECAP_MAX)
    .map(c => {
      const e = {
        id: c.id,
        at: c.at,
        firstName: cleanName(c.firstName),
        club: cleanName(c.club),
        isBirthday: !!c.isBirthday,
        isFirstTimer: !!c.isFirstTimer,
      };
      // Replayed entries keep the celebration flags (#9/#10) so a display
      // that reconnects mid-night still knows — quietly — who was new-season
      // and who hit a milestone.
      if (c.welcomeBack === true) e.welcomeBack = true;
      if (Number.isInteger(c.milestone) && c.milestone > 0) e.milestone = c.milestone;
      return e;
    });
  return { entries, at: nowIso() };
}

// ── checkout (contract v4) ────────────────────────────────────────────────────
// Who is still in the building. TwoTimTwo's /clubber/checkout page IS the live
// list of children currently checked in, so this carries that SET rather than a
// departure signal — there is no "child left" event to miss.
//
// Same data class as `checkin`: first name + club, nothing else. It is sealed by
// the same transport for the same reason, and it needs it MORE than the others:
// a list of who is still unattended is the single most sensitive thing this
// system could put on a wire.
//
// `printed` (how many labels were printed tonight) travels alongside so a
// consumer can show the board honestly — "12 of 43 still here" — rather than
// implying the list is a verified headcount. It is NOT a headcount: it reflects
// whether volunteers performed checkout, which during a pickup rush they often
// do not. Consumers must treat it as "recorded checkouts", gate it behind an
// operator setting, and stop naming individuals once the count gets small.
const CHECKOUT_MAX = 60;

function buildCheckout(rawEntries, printed) {
  const entries = [];
  for (const item of Array.isArray(rawEntries) ? rawEntries : []) {
    if (entries.length >= CHECKOUT_MAX) break;
    if (!item || typeof item !== 'object') continue;
    const firstName = cleanName(item.firstName);
    if (!firstName) continue;
    // Structurally only these two fields — a lastName or clubberId on the input
    // object cannot reach the payload even if a caller passes one.
    entries.push({ firstName, club: cleanName(item.club) });
  }
  const payload = { entries, at: nowIso() };
  const p = Number(printed);
  if (Number.isFinite(p) && p >= 0) payload.printed = Math.floor(p);
  return payload;
}

// ── tally ─────────────────────────────────────────────────────────────────────
// Per-club checked-in counts — pure numbers, zero PII. Keys are club display
// names exactly as the check-in system reports them; each consumer normalizes
// through its own alias map.
function buildTally(byClub, total, extras) {
  const counts = {};
  let sum = 0;
  const entries = Object.entries(byClub && typeof byClub === 'object' ? byClub : {})
    .slice(0, TALLY_CLUBS_MAX);
  for (const [club, n] of entries) {
    const v = Number(n);
    if (!Number.isFinite(v) || v < 0) continue;
    const key = cleanName(club);
    if (!key) continue;
    counts[key] = Math.floor(v);
    sum += counts[key];
  }
  const t = Number(total);
  const out = {
    counts,
    total: Number.isFinite(t) && t >= 0 ? Math.floor(t) : sum,
    at: nowIso(),
  };
  // OPTIONAL, plaintext, zero-PII extras (contract optionalFields):
  //   season    — unified theming (#18): the printer's season broadcast, a
  //               lowercase slug like 'christmas', so screens and labels
  //               switch together. Absent when the operator turned art off.
  //   rehearsal — rehearsal mode (#19): true while a training run is armed,
  //               so displays can watermark themselves. Absent otherwise.
  // Both must stay optional forever: old displays drop unknown fields, and
  // deploy order between the repos must never matter (CONTRACT.md).
  if (extras && typeof extras === 'object') {
    const s = String(extras.season || '').toLowerCase();
    if (/^[a-z][a-z-]{1,19}$/.test(s)) out.season = s;
    if (extras.rehearsal === true) out.rehearsal = true;
  }
  return out;
}

// ── birthdays ─────────────────────────────────────────────────────────────────
// This week's birthday kids: first name + club + the birthday's calendar
// month/day (ints, NO year) so the countdown app can reuse its pure
// week-matching directly. Invalid entries are dropped, never passed through.
function buildBirthdays(rawEntries) {
  const entries = [];
  for (const item of Array.isArray(rawEntries) ? rawEntries : []) {
    if (entries.length >= BIRTHDAYS_MAX) break;
    if (!item || typeof item !== 'object') continue;
    const firstName = cleanName(item.firstName);
    const club = cleanName(item.club);
    const month = Math.floor(Number(item.month));
    const day = Math.floor(Number(item.day));
    if (!firstName) continue;
    if (!Number.isFinite(month) || month < 1 || month > 12) continue;
    if (!Number.isFinite(day) || day < 1 || day > 31) continue;
    entries.push({ firstName, club, month, day });
  }
  return { entries, at: nowIso() };
}

// ── ops ───────────────────────────────────────────────────────────────────────
// Operator-only telemetry (print failures, selector drift). Carries a type,
// an optional club, and a timestamp — NEVER a name. Displays surface these on
// status widgets, never as public banners.
function buildOps(type, club, extras) {
  const t = OPS_TYPES.includes(type) ? type : null;
  if (!t) return null;
  const payload = { type: t, at: nowIso() };
  const c = cleanName(club);
  if (c) payload.club = c;
  // Update health beacon (#5): version + ok flag ONLY — a bare semver string
  // is the entire payload beyond the type. Junk (or anything non-semver) is
  // dropped rather than published; there is structurally nothing else here.
  const x = extras || {};
  if (typeof x.version === 'string' && /^\d+\.\d+\.\d+$/.test(x.version)) {
    payload.version = x.version;
  }
  return payload;
}

// ── canary ────────────────────────────────────────────────────────────────────
// End-to-end "is the pipe alive" test event fired by POST /canary.
function buildCanary() {
  return { at: nowIso(), nonce: crypto.randomBytes(8).toString('hex') };
}

// ── tonight (contract v3, roadmap D-1) ────────────────────────────────────────
// Aggregate counters for the lobby "tonight" ticker, derived by the extension
// from TwoTimTwo's own check-in report + meeting report. PURE NUMBERS — there
// is structurally no field here that could carry a name.
function buildTonight(input) {
  const src = input || {};
  return {
    checkedIn: wholeCount(src.checkedIn),
    booksCompleted: wholeCount(src.booksCompleted),
    awardsEarned: wholeCount(src.awardsEarned),
    friendsBrought: wholeCount(src.friendsBrought),
    at: nowIso(),
  };
}

// ── points (contract v3, roadmap D-2) ─────────────────────────────────────────
// Color-group points race (TwoTimTwo /meeting/colorGroup). Keys are color-team
// display names ("Red", "Blue"), values whole points. Team names, never kids.
function buildPoints(byGroup, club) {
  const groups = {};
  const entries = Object.entries(byGroup && typeof byGroup === 'object' ? byGroup : {})
    .slice(0, POINTS_GROUPS_MAX);
  for (const [group, n] of entries) {
    const key = cleanName(group);
    if (!key) continue;
    const v = Number(n);
    if (!Number.isFinite(v) || v < 0) continue;
    groups[key] = Math.floor(v);
  }
  const payload = { groups, at: nowIso() };
  const c = cleanName(club);
  if (c) payload.club = c;
  return payload;
}

// ── schedule (contract v3, roadmap D-3) ───────────────────────────────────────
// Next-meeting facts read from TwoTimTwo's iCal feed, so the countdown/signage
// never has to guess when club actually meets. Date is a bare calendar date
// (no time-of-day, no attendee data); title is the church-authored meeting
// theme shown publicly on the calendar.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function buildSchedule(input) {
  const src = input || {};
  const payload = { at: nowIso() };
  const date = String(src.nextMeetingDate == null ? '' : src.nextMeetingDate).trim();
  if (ISO_DATE_RE.test(date)) payload.nextMeetingDate = date;
  const title = plainText(src.title, TITLE_MAX);
  if (title) payload.title = title;
  if (src.noClubThisWeek !== undefined) payload.noClubThisWeek = !!src.noClubThisWeek;
  return payload;
}

// ── notice (contract v3, roadmap D-5) ─────────────────────────────────────────
// A church-authored announcement (e.g. "CLUB CANCELLED TONIGHT") from
// TwoTimTwo's /msg/admin, mirrored to the screens.
//
// PRIVACY NOTE: `message` is the ONLY free-text field on the whole channel. It
// exists because this copy is written BY church staff FOR public display, so it
// is intentionally shown verbatim. It is still bounded and forced to plain text
// (markup stripped) so it can neither break the layout nor inject markup, and
// it is never derived from roster data. Returns null for an empty message so a
// blank notice can't blank the screen.
function buildNotice(level, message) {
  const text = plainText(message, NOTICE_MAX);
  if (!text) return null;
  const lvl = NOTICE_LEVELS.includes(level) ? level : 'info';
  return { level: lvl, message: text, at: nowIso() };
}

// ── slides (contract v5) ──────────────────────────────────────────────────────
// The lobby displays' typed slide deck, published once by the operator so every
// screen shows the same announcements. TEXT ONLY, by contract: the display app
// also supports per-device video slides whose bytes live in that device's
// IndexedDB, so a video entry is meaningless on any other screen — the builder
// drops them (and any unknown type) rather than publishing a dead reference.
//
// The deck is arbitrary operator-authored copy ("Pray for the Smiths"), so the
// event rides SEALED like the name-bearing four. One deck can exceed the
// per-frame ceiling (FRAME_MAX_BYTES), so it is split into chunks; every chunk of one publish
// carries identical {deckRev, publishedAt} and its {seq, total}. publishedAt is
// the ONE ordering authority on the consumer (deckRev is an operator-facing
// counter that restarts harmlessly if this server loses its state file), so
// rebroadcasts must reuse the stored publishedAt byte-identically.
//
// These caps mirror the display repo's src/lib/slides.js and are pinned on both
// sides by contract-vectors.json.
const SLIDE_THEMES = ['sky', 'sunset', 'night', 'meadow', 'lavender'];
const SLIDE_TEXT_SIZES = ['auto', 'xl', 'lg', 'md'];
const SLIDES_MAX = 50;
const SLIDE_TEXT_MAX = 500;
const SLIDE_EYEBROW_MAX = 60;
const SLIDE_ID_MAX = 64;
const SLIDE_MIN_DURATION_SEC = 3;
const SLIDE_MAX_DURATION_SEC = 600;
// One chunk's JSON must seal into the 4096 pad rung (4 length-prefix bytes
// spare), and 12 chunks must cover any deck the size gate below admits. The
// budget leaves margin for the {deckRev, publishedAt, seq, total} wrapper.
// The optional showFrom/showUntil pair costs 49 more bytes per slide and
// holdCheckIns another 20, which eats into this budget: the worst deck the
// caps admit (50 slides, 500-char text, a 60-char eyebrow, both dates and
// holdCheckIns, 35,251 bytes) still needs 10 of the 12 chunks, pinned in
// scripts/test-contracts.cjs so a future field cannot quietly overflow it.
const SLIDES_CHUNK_JSON_BUDGET = 3900;
const SLIDES_TOTAL_MAX = 12;
// Coarse publish-time cap on the whole sanitized deck's serialized size —
// far beyond any deck a lobby loop can actually show. NOT a chunk-count
// guarantee: greedy packing can strand nearly a full slide of slack per
// chunk, so the publish endpoint additionally dry-runs buildSlidesChunks and
// refuses any deck it returns null for. Both refusals are a clear 413, never
// silent truncation.
const SLIDES_DECK_JSON_MAX = 40000;

// Slide text keeps its newlines (decks are typed multi-line) but never control
// characters, which bloat as \uXXXX escapes and can mangle logs.
function slideText(value, max) {
  const s = String(value == null ? '' : value);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    out += code === 0x0a ? '\n' : ((code < 0x20 || code === 0x7f) ? ' ' : s[i]);
  }
  return out.trim().slice(0, max);
}

// Optional per-slide date window (#345): "AWANA STORE NEXT WEEK" retires
// itself instead of advertising a night that already happened.
//
// A BARE LOCAL DATE, on purpose. The value is exactly the YYYY-MM-DD the
// operator typed, carries no timezone, and is never converted to one here —
// every consumer compares it against ITS OWN local date key (never
// toISOString(), which in a US-Eastern evening has already rolled to
// tomorrow, i.e. exactly club hours). Anything that is not a real calendar
// date is DROPPED, never guessed at: a slide with a junk window shows
// always, which is the same behaviour as a slide with no window at all and
// strictly better than a slide that silently never appears.
const SLIDE_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
function slideDate(value) {
  const m = SLIDE_DATE_RE.exec(typeof value === 'string' ? value.trim() : '');
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  // Date.UTC is used ONLY to ask "does this calendar date exist" (leap years,
  // month lengths). Nothing derived from it is stored or compared — the string
  // the operator typed is what rides the wire.
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * Sanitize one raw deck into publishable text slides. Video and unknown-type
 * entries are DROPPED (device-local by design), blank text drops the slide,
 * every field is clamped to the contract caps. Never throws.
 */
function buildSlidesDeck(rawSlides) {
  const slides = [];
  for (const item of Array.isArray(rawSlides) ? rawSlides : []) {
    if (slides.length >= SLIDES_MAX) break;
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    if (item.type !== undefined) continue;               // video / future types: device-local
    const text = slideText(item.text, SLIDE_TEXT_MAX);
    if (!text) continue;
    const slide = {
      eyebrow: slideText(item.eyebrow, SLIDE_EYEBROW_MAX).replace(/\n/g, ' '),
      text,
      theme: SLIDE_THEMES.includes(item.theme) ? item.theme : 'auto',
      textSize: SLIDE_TEXT_SIZES.includes(item.textSize) ? item.textSize : 'auto',
      durationSec: 0,
    };
    const dur = Number(item.durationSec);
    if (Number.isFinite(dur) && dur > 0) {
      slide.durationSec = Math.min(SLIDE_MAX_DURATION_SEC, Math.max(SLIDE_MIN_DURATION_SEC, Math.round(dur)));
    }
    // The optional show window. Omitted (not null, not '') when absent or
    // unparseable, so a deck without dates is byte-identical to before.
    const showFrom = slideDate(item.showFrom);
    if (showFrom) slide.showFrom = showFrom;
    const showUntil = slideDate(item.showUntil);
    if (showUntil) slide.showUntil = showUntil;
    // The optional "Hold check-ins" mark: while this slide is up the displays
    // hold their check-in banners and play them afterwards at full length.
    // Literal true ONLY, and otherwise OMITTED, never written as false: an
    // unmarked slide is byte-identical to before the field existed, and a
    // 'true' string or a 1 from a hand-edited export is not the operator
    // marking the slide, so it is not guessed into one.
    if (item.holdCheckIns === true) slide.holdCheckIns = true;
    // The display keys its React lists and dedupe on ids; a clean one passes
    // through, anything else is omitted and the consumer mints its own.
    if (typeof item.id === 'string' && item.id.trim() && item.id.length <= SLIDE_ID_MAX
        && !hasSlideControlChars(item.id)) {
      slide.id = item.id;
    }
    slides.push(slide);
  }
  return slides;
}

function hasSlideControlChars(s) {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** Serialized size of the sanitized deck — the publish endpoint's size gate. */
function slidesDeckJsonBytes(slides) {
  return Buffer.byteLength(JSON.stringify(slides), 'utf8');
}

/**
 * Split one sanitized deck into sealed-transport chunks. Greedy byte-budget
 * packing; every chunk carries identical {deckRev, publishedAt} plus its
 * {seq, total}. An EMPTY deck is one chunk with slides:[] — "the operator
 * published nothing" must propagate, it is not the absence of a publish.
 *
 * Returns null (fail closed — nothing publishable) when the deck cannot fit
 * SLIDES_TOTAL_MAX chunks. The publish endpoint dry-runs this and refuses
 * (413) any deck that returns null BEFORE committing state, so a null from
 * the heartbeat/startup path can only mean a state file written by something
 * other than an accepted publish.
 */
function buildSlidesChunks(slides, deckRev, publishedAt) {
  const deck = Array.isArray(slides) ? slides : [];
  const rev = Math.max(1, Math.floor(Number(deckRev) || 1));
  const stamp = String(publishedAt);
  const groups = [[]];
  let groupBytes = 0;
  for (const slide of deck) {
    const bytes = Buffer.byteLength(JSON.stringify(slide), 'utf8') + 1;
    if (groups[groups.length - 1].length > 0 && groupBytes + bytes > SLIDES_CHUNK_JSON_BUDGET) {
      groups.push([]);
      groupBytes = 0;
    }
    groups[groups.length - 1].push(slide);
    groupBytes += bytes;
  }
  if (groups.length > SLIDES_TOTAL_MAX) return null;
  const total = groups.length;
  const chunks = groups.map((group, seq) => ({
    deckRev: rev,
    publishedAt: stamp,
    seq,
    total,
    slides: group,
  }));
  // The budget must guarantee every chunk seals into the slides pad ladder; a
  // chunk that could not would make publish() fail closed mid-deck.
  for (const chunk of chunks) {
    if (paddedSize('slides', Buffer.byteLength(JSON.stringify(chunk), 'utf8')) == null) return null;
  }
  return chunks;
}

// ── Shared display settings (contract v6) ─────────────────────────────────────
// The lobby screens' SHARED settings, published from the display app's Settings
// on the check-in computer (POST /api/display-settings) and mirrored to every
// screen over the sealed `settings` event, so a change made once reaches every
// screen. Per-screen settings (what plays behind the names, the uploads, this
// TV's sound, motion, confetti and wake lock, simplified mode, the sync keys)
// are not in this table and can never ride the wire.
//
// One table, mirrored in contract-vectors.json `events.settings.keys` (and in
// the display repo's src/lib/sharedSettings.js); test-contracts.cjs fails if
// the two drift. Every key is optional: a payload carries only what the
// publisher had, and a consumer keeps its own value for anything absent.
//
// No names, ever: these are thresholds, switches, times and church-authored
// copy (the welcome wording and one short line per club).
const SETTINGS_SPEC = {
  standardDisplayMs: { type: 'int', min: 2000, max: 20000 },
  specialDisplayMs: { type: 'int', min: 3000, max: 25000 },
  clubPhrases: { type: 'phrases', maxKeys: 15, maxKey: 40, maxValue: 80 },
  showBirthdayWeekRibbon: { type: 'bool' },
  clubTintBackground: { type: 'bool' },
  firstArrivalMoment: { type: 'bool' },
  milestoneEvery: { type: 'int', min: 0, max: 10000 },
  clubMilestoneEvery: { type: 'int', min: 0, max: 1000 },
  bookMilestones: { type: 'intList', maxItems: 8, min: 1, max: 10000 },
  awardMilestones: { type: 'intList', maxItems: 8, min: 1, max: 10000 },
  showClock: { type: 'bool' },
  showTally: { type: 'bool' },
  showTallySyncNote: { type: 'bool' },
  showWeatherChip: { type: 'bool' },
  weatherLocationName: { type: 'string', max: 80 },
  weatherLat: { type: 'number', min: -90, max: 90 },
  weatherLon: { type: 'number', min: -180, max: 180 },
  weatherUnits: { type: 'enum', values: ['fahrenheit', 'celsius'] },
  calendarEnabled: { type: 'bool' },
  calendarUrl: { type: 'url', max: 300 },
  calendarWelcomeText: { type: 'string', max: 80 },
  calendarShowWelcome: { type: 'bool' },
  calendarShowNextWeek: { type: 'bool' },
  calendarShowRemaining: { type: 'bool' },
  seasonPromos: { type: 'bool' },
  checkoutBoardMode: { type: 'enum', values: ['off', 'pickup', 'always'] },
  checkoutBoardNamesAbove: { type: 'int', min: 0, max: 200 },
  checkoutBoardStaleMin: { type: 'int', min: 1, max: 120 },
  checkoutBoardFrom: { type: 'time' },
  checkoutBoardUntil: { type: 'time' },
  cornerStillHere: { type: 'bool' },
  nightTheme: { type: 'slug', max: 32 },
  followPrinterTheme: { type: 'bool' },
  particleEffect: { type: 'enum', values: ['auto', 'off', 'snow', 'rain', 'sparkle'] },
  weatherTheme: { type: 'bool' },
  aprilFools: { type: 'bool' },
};
// The whole settings object's serialized JSON. The worst case the caps admit
// (15 full club lines, every string at its cap) is ~3.3 KB; with the envelope's
// length prefix and the {rev, publishedAt} wrapper it seals into the 4096 rung.
const SETTINGS_JSON_MAX = 3800;
const SETTINGS_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const SETTINGS_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/** One value against its spec: the clean value, or undefined to drop it. */
function settingValue(spec, v) {
  switch (spec.type) {
    case 'bool':
      return typeof v === 'boolean' ? v : undefined;
    case 'int': {
      if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
      const n = Math.round(v);
      return Math.min(spec.max, Math.max(spec.min, n));
    }
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
      return Math.min(spec.max, Math.max(spec.min, v));
    case 'enum':
      return spec.values.includes(v) ? v : undefined;
    case 'string': {
      if (typeof v !== 'string') return undefined;
      return plainText(v, spec.max);
    }
    case 'url': {
      if (typeof v !== 'string') return undefined;
      const s = v.trim();
      if (!s) return '';
      if (s.length > spec.max || !/^https:\/\/[^\s<>"']+$/i.test(s)) return undefined;
      return s;
    }
    case 'time':
      return typeof v === 'string' && SETTINGS_TIME_RE.test(v) ? v : undefined;
    case 'slug':
      return typeof v === 'string' && v.length <= spec.max && SETTINGS_SLUG_RE.test(v) ? v : undefined;
    case 'intList': {
      if (!Array.isArray(v)) return undefined;
      const out = [...new Set(v
        .filter((x) => typeof x === 'number' && Number.isFinite(x))
        .map((x) => Math.round(x))
        .filter((x) => x >= spec.min && x <= spec.max))]
        .sort((a, b) => a - b)
        .slice(0, spec.maxItems);
      return out;
    }
    case 'phrases': {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
      const out = {};
      for (const [k, phrase] of Object.entries(v).slice(0, spec.maxKeys)) {
        const key = String(k).trim().toLowerCase().slice(0, spec.maxKey);
        if (!key || typeof phrase !== 'string') continue;
        const text = plainText(phrase, spec.maxValue);
        if (text) out[key] = text;
      }
      return out;
    }
    default:
      return undefined;
  }
}

/**
 * Reduce an incoming settings object to exactly the shared allowlist, every
 * value checked against its spec. Unknown keys, wrong types and per-screen
 * keys are dropped, never coerced from strings. Returns {} for junk.
 */
function buildDisplaySettings(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, spec] of Object.entries(SETTINGS_SPEC)) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    const clean = settingValue(spec, raw[key]);
    if (clean !== undefined) out[key] = clean;
  }
  return out;
}

/** Serialized size of sanitized settings — the publish endpoint's size gate. */
function displaySettingsJsonBytes(settings) {
  return Buffer.byteLength(JSON.stringify(settings), 'utf8');
}

/** The wire payload: {rev, publishedAt, settings}, or null if it cannot seal. */
function buildSettingsPayload(settings, rev, publishedAt) {
  const payload = {
    rev: Math.max(1, Math.floor(Number(rev) || 1)),
    publishedAt: String(publishedAt),
    settings: buildDisplaySettings(settings),
  };
  if (paddedSize('settings', Buffer.byteLength(JSON.stringify(payload), 'utf8')) == null) return null;
  return payload;
}

// ── Club-night window ─────────────────────────────────────────────────────────
// clubNights: [{ dow: 0-6 (Sunday=0), start: "HH:MM", end: "HH:MM" }].
// Pure function of the supplied date (defaults to now) so it's testable.
function parseHM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s == null ? '' : s).trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// `graceMinutes` pushes the END of each window out without moving the window
// itself, for the one caller that legitimately outlives club time: the periodic
// tally. The last children of the night are checked out after the published end
// time, and a lobby screen that stops being told the number goes stale rather
// than quiet. Everything else (recap, birthdays) still uses the real window, so
// the channel stays silent the other ~165 hours a week. Clamped to midnight
// rather than rolled into the next day - a window that ends at 23:30 gets its
// grace up to 24:00 and no further, which is honest about what this function
// can express (one day, one window).
function isClubNightNow(clubNights, date, graceMinutes = 0, leadMinutes = 0) {
  if (!Array.isArray(clubNights)) return false;
  const d = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
  const mins = d.getHours() * 60 + d.getMinutes();
  const minutes = (raw) => { const n = Number(raw); return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0; };
  const grace = minutes(graceMinutes);
  const lead = minutes(leadMinutes);
  return clubNights.some(w => {
    if (!w || typeof w !== 'object') return false;
    if (Number(w.dow) !== d.getDay()) return false;
    const start = parseHM(w.start);
    const end = parseHM(w.end);
    if (start === null || end === null) return false;
    return mins >= Math.max(start - lead, 0) && mins < Math.min(end + grace, 24 * 60);
  });
}

// ── Sealed envelopes ──────────────────────────────────────────────────────────
// The write side of the encrypted realtime pipe. The consumer half is
// Awana-Check-in-Display/src/lib/envelope.js and the framing below MUST stay
// byte-compatible with it.
//
// WHY: the screens' channel was a PUBLIC Pusher channel (retired 2026-10-03),
// where anyone who viewed a screen's source could subscribe from anywhere in
// the world and read every event forever, and the design has no server-side
// authorization primitive. The sync Worker's channel is signed in, but names
// stay sealed end to end under the same rules. The first-names-only rule above is still
// the primary defence and still holds, but "a stranger can read every child's
// first name and club, live, from anywhere" was never acceptable.
//
// The four name-bearing events are sealed, and so is `slides` — the operator's
// typed deck is arbitrary church-authored text that has no business being
// world-readable forever. The remaining events stay plaintext ON PURPOSE: they
// are counts and short public copy, and their readability is what lets a screen
// distinguish "the pipe is down" from "I can't read the names" from "quiet
// night". See SECURITY.md in the display repo for what remains exposed (timing
// and headcount, irreducibly).
//
//   envelope  = { v: 1, kid, iv, ct }          // base64 except v
//   aad       = utf8("1:" + eventName)         // binds a frame to its event
//   plaintext = u32be(jsonByteLength) || json || zero filler
//   ct        = aesgcm_ciphertext || 16-byte tag   (WebCrypto's layout)
const ENVELOPE_VERSION = 1;
const ENCRYPTED_EVENTS = new Set(['checkin', 'recap', 'birthdays', 'checkout', 'slides', 'settings']);
// checkin gets a FIXED pad: it is the frame that matters, one child per event,
// so its length must reveal nothing at all. 512 covers the true worst case —
// note the builders cap names at 40 CHARACTERS, and a character can be 4 bytes
// in UTF-8, so the worst case is ~380 bytes, not the ~220 that ASCII suggests.
const CHECKIN_PAD = 512;
// The bulk events (recap, birthdays) are periodic rebroadcasts of many entries
// and cannot use a fixed pad: a frame over FRAME_MAX_BYTES is refused, and
// their worst case padded to a single size would exceed it. They get a
// coarse ladder instead, which hides the exact byte size — so name lengths
// within a rung are indistinguishable — while leaking a rough bucket of the
// entry count. That bucket is not sensitive: the PLAINTEXT tally already
// publishes exact per-club counts by design, so the count of recent check-ins
// is public knowledge either way. What must stay hidden is WHO, and it does.
// The ladder starts high on purpose, so realistic recaps all land in one rung.
const PAD_LADDER = [2048, 4096, 8192];
// `slides` gets its own SHORTER ladder with NO round-up past the top rung: an
// 8192-padded plaintext base64-inflates past the 10 KB frame ceiling, so a rung
// the transport cannot actually deliver must not exist for this event. The
// chunker guarantees every chunk fits 4096; if one ever did not, publish()
// fails closed rather than leaking a bigger-than-declared frame.
const SLIDES_PAD_LADDER = [2048, 4096];
const LEN_PREFIX = 4;
// The per-frame ceiling (10 KB, the old channel's limit, kept as the budget the
// padding ladders were designed against). Base64 inflates by 4/3, so a padded
// plaintext above ~7 KB would not fit. Asserted against realistic worst cases
// in scripts/test-envelope.cjs.
const FRAME_MAX_BYTES = 10240;

// PADDING IS NOT OPTIONAL. GCM is CTR-based and adds no padding of its own, so
// an unpadded envelope reveals len(firstName) + len(club) exactly. Club is
// inferable by correlating the plaintext `tally`, and first names run 3-9
// characters, so against a known roster over a season that is a real
// re-identification channel — it would reduce the claim from "cannot read the
// names" to "can often guess the names". scripts/test-envelope.cjs asserts
// every valid checkin vector seals to an IDENTICAL ciphertext length.
function paddedSize(event, jsonByteLength) {
  const needed = LEN_PREFIX + jsonByteLength;
  if (event === 'checkin') {
    // Deliberately no fallback to a larger rung: that would reintroduce the
    // length channel for exactly the frames that matter most. The builders cap
    // name and club length upstream so this is unreachable; if it ever fires,
    // publish() fails closed rather than leaking a length.
    return needed <= CHECKIN_PAD ? CHECKIN_PAD : null;
  }
  // `settings` (contract v6) rides the same short ladder for the same reason:
  // one frame, capped well under 4096, and no rung the frame ceiling forbids.
  if (event === 'slides' || event === 'settings') {
    for (const rung of SLIDES_PAD_LADDER) if (needed <= rung) return rung;
    return null;   // fail closed — see SLIDES_PAD_LADDER above
  }
  for (const rung of PAD_LADDER) if (needed <= rung) return rung;
  const step = PAD_LADDER[PAD_LADDER.length - 1];
  return Math.ceil(needed / step) * step;
}

// The key this server seals with. Held in a module-level slot rather than
// threaded through publish()'s signature so all ~20 call sites in server.js are
// untouched and cannot individually forget it.
let displayKeyBytes = null;
let displayKeyId = null;

/** 32 raw bytes, base64-encoded. */
function isValidDisplayKey(value) {
  const s = String(value == null ? '' : value).trim();
  if (!/^[A-Za-z0-9+/]{42,44}={0,2}$/.test(s)) return false;
  try {
    return Buffer.from(s, 'base64').length === 32;
  } catch {
    return false;
  }
}

/** Generate a fresh key for the dashboard's "Generate display key" button. */
function generateDisplayKey() {
  return crypto.randomBytes(32).toString('base64');
}

/**
 * Install (or clear) the sealing key. Returns true when a usable key is set.
 * An invalid key CLEARS rather than half-configures, so the fail-closed branch
 * in publish() catches it instead of a later crypto throw.
 */
function setDisplayKey(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s || !isValidDisplayKey(s)) {
    displayKeyBytes = null;
    displayKeyId = null;
    return false;
  }
  displayKeyBytes = Buffer.from(s, 'base64');
  displayKeyId = kidFor(displayKeyBytes);
  return true;
}

/** The public fingerprint of a key: first 8 hex chars of SHA-256(keyBytes). */
function kidFor(keyBytes) {
  return crypto.createHash('sha256').update(keyBytes).digest('hex').slice(0, 8);
}

function getDisplayKeyState() {
  return { configured: !!displayKeyBytes, kid: displayKeyId };
}

function aadFor(event) {
  return Buffer.from(`${ENVELOPE_VERSION}:${event}`, 'utf8');
}

/**
 * Seal one payload. Returns the envelope, or null when it cannot be sealed —
 * callers MUST treat null as "do not publish", never as "publish plaintext".
 */
function seal(event, payload) {
  if (!displayKeyBytes) return null;
  return sealWith(displayKeyBytes, displayKeyId, event, payload);
}

/**
 * The envelope under an explicit key (seal() passes the display key).
 */
function sealWith(keyBytes, kid, event, payload) {
  const json = Buffer.from(JSON.stringify(payload), 'utf8');
  const size = paddedSize(event, json.length);
  if (size == null) return null;
  const plain = Buffer.alloc(size);           // zero-filled: the filler is
  plain.writeUInt32BE(json.length, 0);        // inside the ciphertext, so it
  json.copy(plain, LEN_PREFIX);               // reveals nothing.
  // A fresh random IV per frame. Never a counter, never derived from a clock:
  // a repeated (key, IV) pair in GCM is catastrophic, not merely weak.
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBytes, iv);
  cipher.setAAD(aadFor(event));
  const ct = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  return {
    v: ENVELOPE_VERSION,
    kid,
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
  };
}

/** Test seam — the consumer's job in production, but needed for round-trips. */
function openForTest(keyBase64, event, envelope) {
  return openWithForTest(Buffer.from(String(keyBase64).trim(), 'base64'), event, envelope);
}

function openWithForTest(key, event, envelope) {
  const ct = Buffer.from(envelope.ct, 'base64');
  const iv = Buffer.from(envelope.iv, 'base64');
  const tag = ct.subarray(ct.length - 16);
  const body = ct.subarray(0, ct.length - 16);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAAD(aadFor(event));
  d.setAuthTag(tag);
  const plain = Buffer.concat([d.update(body), d.final()]);
  const len = plain.readUInt32BE(0);
  return JSON.parse(plain.subarray(LEN_PREFIX, LEN_PREFIX + len).toString('utf8'));
}

// What the lobby-slides publish token must look like (server.js validates the
// operator's value with it).
const SLIDES_TOKEN_RE = /^[A-Za-z0-9_-]{24,64}$/;
// The optional FLEET-CONFIG URL (#394): where a screen fetches its display
// settings JSON from, the address a display accepts as `?config=<url>`. NOT a
// secret. https ONLY (a display served over https cannot fetch http without
// mixed-content blocking, and an http URL is trivially tamperable in a church
// lobby), length-capped, credentials-in-URL refused.
const FLEET_CONFIG_URL_MAX = 200;
function isValidFleetConfigUrl(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s || s.length > FLEET_CONFIG_URL_MAX) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(s)) return false;
  let url;
  try { url = new URL(s); } catch { return false; }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  return true;
}

// ── Publisher ─────────────────────────────────────────────────────────────────
// Seals a frame and hands it to the relay (the sync service's live channel,
// installed by server.js): publish() NEVER throws and never rejects, so an
// outage can never take a print down with it. Health state is recorded for
// /health so the dashboard can show "last publish OK / failed at HH:MM".
const publishState = {
  configured: false,
  lastPublishOk: null,   // true | false | null (never attempted)
  lastPublishAt: null,   // ISO string of the last attempt
  lastEvent: null,       // event name of the last attempt
  lastError: null,       // message of the last failure
  encrypting: null,      // true once the name-bearing events are being sealed
};

function getPublishState() {
  return { ...publishState };
}

// The sync service's live channel (server.js installs this): every frame
// publish() sends, after sealing, goes there. It is the only pipe.
let relay = null;
function setRelay(fn) {
  relay = typeof fn === 'function' ? fn : null;
  publishState.configured = !!relay;
}

// `meta` rides to the relay untouched (a station's greeting names the print job it is for).
function publish(channel, event, payload, meta) {
  publishState.configured = !!relay;
  if (!relay || !payload) return Promise.resolve(false);

  // Seal the name-bearing events. FAIL CLOSED: if a display key is
  // configured-but-unusable, or the payload somehow will not fit its fixed
  // padding, we publish NOTHING rather than falling back to plaintext. A
  // silent downgrade would be the worst outcome available — every screen would
  // keep rendering names while the operator believed the channel was sealed.
  let body = payload;
  if (ENCRYPTED_EVENTS.has(event)) {
    if (!displayKeyBytes) {
      // Not an error during rollout: with no key set the publisher is expected
      // to stay plaintext so an un-keyed screen still works (see the migration
      // order in SECURITY.md). Recorded so /health can say which mode we are in.
      publishState.encrypting = false;
    } else {
      const sealed = seal(event, payload);
      if (!sealed) {
        publishState.lastPublishOk = false;
        publishState.lastPublishAt = nowIso();
        publishState.lastEvent = event;
        publishState.lastError = `could not seal ${event} — NOT published (fail closed)`;
        console.error(`[publish] ${publishState.lastError}`);
        return Promise.resolve(false);
      }
      publishState.encrypting = true;
      body = sealed;
    }
  }

  // Handed over synchronously (the frame is on its way before publish() returns);
  // a throwing or rejecting relay is just a failed publish.
  let handed;
  try { handed = Promise.resolve(relay(channel, event, body, meta)); } catch (e) { handed = Promise.resolve(false); }
  return handed.then((ok) => ok === true, () => false).then((ok) => {
    publishState.lastPublishOk = ok;
    publishState.lastPublishAt = nowIso();
    publishState.lastEvent = event;
    publishState.lastError = ok ? null : 'the sync service did not take it';
    return ok;
  });
}

module.exports = {
  OPS_TYPES,
  NOTICE_LEVELS,
  RECAP_MAX,
  CHECKOUT_MAX,
  POINTS_GROUPS_MAX,
  buildCheckin,
  buildRecap,
  buildCheckout,
  buildTally,
  buildBirthdays,
  buildOps,
  buildCanary,
  buildTonight,
  buildPoints,
  buildSchedule,
  buildNotice,
  buildSlidesDeck,
  buildSlidesChunks,
  slideDate,
  slidesDeckJsonBytes,
  SLIDES_MAX,
  SLIDES_TOTAL_MAX,
  SLIDES_DECK_JSON_MAX,
  SLIDES_CHUNK_JSON_BUDGET,
  SETTINGS_SPEC,
  SETTINGS_JSON_MAX,
  buildDisplaySettings,
  buildSettingsPayload,
  displaySettingsJsonBytes,
  isClubNightNow,
  parseHM,
  publish,
  getPublishState,
  setRelay,
  // Sealed envelopes — see the block above publish().
  ENVELOPE_VERSION,
  ENCRYPTED_EVENTS,
  CHECKIN_PAD,
  PAD_LADDER,
  SLIDES_PAD_LADDER,
  FRAME_MAX_BYTES,
  paddedSize,
  isValidDisplayKey,
  generateDisplayKey,
  setDisplayKey,
  getDisplayKeyState,
  seal,
  sealWith,
  kidFor,
  openForTest,
  SLIDES_TOKEN_RE,
  FLEET_CONFIG_URL_MAX,
  isValidFleetConfigUrl,
};
