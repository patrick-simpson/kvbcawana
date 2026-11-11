// @ts-check
// The Sparks remote's rules (owner 2026-10-18: "Similar to the journey remote,
// we need a sparks remote ... paste up to 4 YouTube videos ... a PDF or a image
// URL or file ... or simply text"). ONE copy, pure, no imports, used by:
//   - the sync Worker (worker/src/classroom.js), which checks every button
//     list, every press and every report
//   - the remote (classroom/public/remote/) and the classroom screen
//     (classroom/public/src/app.js), byte copies in classroom/public/src/shared/
//     made by scripts/family-assets.mjs, which clean what the Worker hands back
//   - the tests on every side.
//
// The BUTTONS are one shared list (anyone signed in edits it on the remote):
// up to CLASSROOM_VIDEOS_MAX YouTube videos and CLASSROOM_ITEMS_MAX others,
// each a picture, a PDF (a stored file: uploaded, or copied by the Worker
// from a link) or text (a look: the handbook page or the black board).
// The STAGE is what the classroom TV should show: one button up (a copy of
// it as pressed, so editing the list never changes what is on the screen),
// a PDF's page, a /settings preview of one look for a minute, and the last
// few momentary commands (a video's pause, seek, volume; Sparky's flight),
// each run once by id.
//
// Cast (owner 2026-11-08: "set it up kind of like an air server ... present from
// their laptop but through a webpage"): the SAME rules drive the lobby computer's
// Cast screen (worker/src/cast.js, site/cast/). A guest there has no button list,
// so a press may put an item up directly (`item`), and either room may show a
// laptop's SCREEN, shared live (`screen`): the picture goes laptop to TV over the
// church network (WebRTC); the Worker only passes the offer and the answer
// (sanitizeSignal), never the picture.
//
// Owner 2026-11-08, later: "support Facebook video" (Cast: kind `facebook`, a public
// video's link played by Facebook's own embedded player) and "Add videos option for
// both sparks and this" (kind `clip`: a video FILE uploaded like a picture, up to
// CLASSROOM_CLIP_MAX_BYTES, sent in CLASSROOM_CLIP_PART_BYTES requests). Both take the
// same video presses as a YouTube video.
//
// Owner 2026-11-11 ("All of those sound fantastic. Let's build them"), Cast only:
// BLACK. The press `black {on}` sets `stage.black`: the Cast TV goes pure black over
// whatever is up (a playing video is paused by the TV) until `black {on: false}`
// brings the same thing back. Back, a new thing going up, a new code and the tray's
// reset all clear it. The classroom room refuses the press (worker/src/classroom.js).
// THE HOUSE SLIDE: with nothing up the Cast TV shows the church's logo and ONE optional
// line set at the lobby computer's desk (CAST_HOUSE_LINE_MAX, sanitizeHouse). It is the
// church's own, kept across rooms (worker/src/cast.js `cast:house`), never a guest's.
// A COUNTDOWN AND A CLOCK: two more items a presenter or the desk may put up. Kind
// `timer {seconds, title, endsAt}`: 15 s to 60 min in steps of 15 s; the WORKER sets
// `endsAt` from its own clock when it takes the press, and every screen counts down to
// it. Kind `clock {}`: the time of day, drawn by the TV from its own clock. Neither is a
// Sparks button, and the classroom room refuses them (CAST_ONLY_KINDS).
// THE LINE-UP (owner 2026-11-11: "Load several things before the event (a video, the
// slides, a picture) and tap through them in order"): a short ordered list the room keeps
// (worker/src/cast.js `cast:lineup`), each entry `{id, item}` with the item exactly as an
// `item` press takes it (never a shared screen; a countdown's `endsAt` is set only when it
// goes up). At most CAST_LINEUP_MAX entries and CAST_LINEUP_CHARS_MAX characters of items.
// Cleaned by cleanLineupEntries (an edit: all or nothing) and sanitizeLineup (a read).

export const CLASSROOM_VIDEOS_MAX = 4;
export const CLASSROOM_ITEMS_MAX = 8;
export const CLASSROOM_TITLE_MAX = 60;
export const CLASSROOM_HEADING_MAX = 60;
export const CLASSROOM_TEXT_MAX = 400;
/** Cast's house slide: its one optional line under the church logo is at most this long. */
export const CAST_HOUSE_LINE_MAX = 60;
/** An uploaded or copied file: at most this big, sent in parts of PART bytes (under the Worker's 128 KiB body cap). */
export const CLASSROOM_FILE_MAX_BYTES = 20 * 1024 * 1024;
export const CLASSROOM_FILE_PART_BYTES = 96 * 1024;
export const CLASSROOM_FILE_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']);
/** An uploaded video (a clip): these types, at most this big, sent in requests of PART bytes. */
export const CLASSROOM_CLIP_TYPES = Object.freeze(['video/mp4', 'video/quicktime', 'video/webm']);
export const CLASSROOM_CLIP_MAX_BYTES = 200 * 1024 * 1024;
/** Ten file parts a request (the Worker stores each 96 KiB part under its own key). */
export const CLASSROOM_CLIP_PART_BYTES = 10 * CLASSROOM_FILE_PART_BYTES;
/** Clips in the Sparks remote's button list at once (each one stays stored while it is a button). */
export const CLASSROOM_CLIPS_MAX = 3;
/** The looks /settings can preview on the TV, and for how long (owner: one minute). */
export const CLASSROOM_LOOKS = Object.freeze(['cubbies', 'sparks', 'lobby']);
export const CLASSROOM_PREVIEW_MS = 60 * 1000;
/**
 * A HELD look (owner 2026-11-04: "an option in the Sparks remote that allows anyone
 * to push the Sparks screen up on the TV ... at any time"): the remote's Sparks
 * screen tile sends `preview {look, hold: true}`; it stays until Back (or another
 * button), at most this long.
 */
export const CLASSROOM_HOLD_MS = 6 * 60 * 60 * 1000;
/** Momentary commands older than this are not run (a pause 30 s late is worse than none). */
export const CLASSROOM_CMD_TTL_MS = 20 * 1000;
export const CLASSROOM_CMDS_MAX = 8;
/** The screen reports what it shows only while a remote asked within this long. */
export const CLASSROOM_WATCH_MS = 30 * 1000;
/** A seek moves exactly this far; one volume press this many percent. */
export const CLASSROOM_SEEK_S = 10;
export const CLASSROOM_VOLUME_STEP_PCT = 10;
export const CLASSROOM_TEXT_LOOKS = Object.freeze(['page', 'board']);
export const CLASSROOM_ITEM_KINDS = Object.freeze(['image', 'pdf', 'text', 'clip', 'facebook', 'timer', 'clock']);
/** Items only Cast shows: never in the Sparks list, refused by the classroom room. */
export const CAST_ONLY_KINDS = Object.freeze(['timer', 'clock']);
/** A countdown: this short at least, this long at most, in steps of this (the scoreboard timer's steps). */
export const CAST_TIMER_MIN_S = 15;
export const CAST_TIMER_MAX_S = 60 * 60;
export const CAST_TIMER_STEP_S = 15;
/** Cast's line-up: at most this many entries, and this many characters of items in all (it is stored as one value). */
export const CAST_LINEUP_MAX = 12;
export const CAST_LINEUP_CHARS_MAX = 96 * 1024;
/** The kinds a video press works on: YouTube, an uploaded clip, a Facebook video. */
export const CLASSROOM_PLAYABLE_KINDS = Object.freeze(['video', 'clip', 'facebook']);
/** Everything a remote (or /settings) may ask. */
export const CLASSROOM_ACTIONS = Object.freeze(['show', 'back', 'video', 'page', 'preview', 'preview-end', 'sparky', 'item', 'screen', 'black']);
/** A screen share's offer or answer (SDP text) is at most this long. */
export const CLASSROOM_SIGNAL_MAX = 24000;
export const CLASSROOM_VIDEO_OPS = Object.freeze(['toggle', 'play', 'pause', 'seek', 'volume', 'mute', 'unmute']);
/** What the screen can be showing (its report's `view`). */
export const CLASSROOM_VIEWS = Object.freeze(['off', 'cubbies', 'black', 'sparks', 'lobby', 'board', 'video', 'image', 'pdf', 'text', 'screen', 'waiting', 'clip', 'facebook', 'timer', 'clock']);

const BUTTON_ID_RE = /^b[a-z0-9]{6,20}$/;
const FILE_ID_RE = /^f[a-z0-9]{12,24}$/;
const CMD_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** One line, control characters out, trimmed and cut. @param {unknown} v @param {number} max */
export function oneLine(v, max) {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Free text for a text button: line breaks kept (at most 8 lines), nothing else odd. @param {unknown} v */
export function cleanText(v) {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const lines = v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim());
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  while (lines.length && !lines[0]) lines.shift();
  return lines.slice(0, 8).join('\n').slice(0, CLASSROOM_TEXT_MAX);
}

/**
 * Cast's house slide (what the TV shows with nothing up): `{line}`, one line, '' = the
 * logo alone. Cleaned the same way by the Worker, the desk and the TV.
 * @param {unknown} v @returns {{ line: string }}
 */
export function sanitizeHouse(v) {
  return { line: oneLine(isObj(v) ? v.line : '', CAST_HOUSE_LINE_MAX) };
}

export const isButtonId = (v) => typeof v === 'string' && BUTTON_ID_RE.test(v);
export const isFileId = (v) => typeof v === 'string' && FILE_ID_RE.test(v);

/**
 * The video id in anything a leader might paste: youtu.be/<id>,
 * youtube.com/watch?v=<id>, /shorts/<id>, /embed/<id>, /live/<id>,
 * youtube-nocookie.com/embed/<id>, m. and music. hosts, or the bare id.
 * '' when it is not a YouTube video.
 * @param {unknown} text
 */
export function youtubeIdFrom(text) {
  const s = oneLine(text, 400);
  if (YOUTUBE_ID_RE.test(s)) return s;
  let u;
  try { u = new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`); } catch { return ''; }
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  let id = '';
  if (host === 'youtu.be') id = u.pathname.split('/')[1] || '';
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] === 'watch') id = u.searchParams.get('v') || '';
    else if (['shorts', 'embed', 'live', 'v'].includes(parts[0])) id = parts[1] || '';
  }
  return YOUTUBE_ID_RE.test(id) ? id : '';
}

/** Where a pasted video starts, in whole seconds (t=90, t=1m30s, start=90), else 0. @param {unknown} text */
export function youtubeStartFrom(text) {
  const s = oneLine(text, 400);
  let u;
  try { u = new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`); } catch { return 0; }
  const t = u.searchParams.get('t') || u.searchParams.get('start') || '';
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(t);
  if (!t || !m) return 0;
  const n = (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
  return Number.isFinite(n) ? Math.min(Math.max(0, Math.floor(n)), 36000) : 0;
}

/**
 * A Google Drive share link as a direct download (the Worker copies the file
 * from it); any other https link as it is; '' for anything else.
 * @param {unknown} text
 */
export function fileLinkFrom(text) {
  const s = oneLine(text, 2000);
  let u;
  try { u = new URL(s); } catch { return ''; }
  if (u.protocol !== 'https:' || u.username || u.password) return '';
  // A Google Slides or Docs link (owner 2026-11-08: "PowerPoint/google slides"): its PDF
  // export, which the Worker copies like any PDF (the file must be shared "anyone with the link").
  if (u.hostname === 'docs.google.com') {
    const m = /^\/(presentation|document)\/d\/([A-Za-z0-9_-]{10,})/.exec(u.pathname);
    if (m) return `https://docs.google.com/${m[1]}/d/${m[2]}/export/pdf`;
  }
  if (u.hostname === 'drive.google.com') {
    const m = /^\/file\/d\/([A-Za-z0-9_-]{10,})/.exec(u.pathname);
    const id = m ? m[1] : u.searchParams.get('id');
    if (id && /^[A-Za-z0-9_-]{10,}$/.test(id)) return `https://drive.google.com/uc?export=download&id=${id}`;
  }
  return u.href;
}

/**
 * A Facebook video's link, as Facebook's embedded player takes it, or ''. Public
 * videos only (the player shows nothing for a private one). Takes what "Copy link"
 * gives: facebook.com/<page>/videos/<id>, /watch?v=<id>, /reel/<id>,
 * /share/v/<code>, /share/r/<code>, fb.watch/<code>; m. and web. hosts too.
 * @param {unknown} text
 */
export function facebookVideoFrom(text) {
  const s = oneLine(text, 600);
  let u;
  try { u = new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`); } catch { return ''; }
  if (u.username || u.password) return '';
  const host = u.hostname.toLowerCase().replace(/^(www|m|web|mbasic)\./, '');
  const parts = u.pathname.split('/').filter(Boolean);
  const ok = (p) => /^[A-Za-z0-9._-]{1,80}$/.test(p || '');
  if (host === 'fb.watch') return ok(parts[0]) ? `https://fb.watch/${parts[0]}/` : '';
  if (host !== 'facebook.com') return '';
  if (parts[0] === 'watch') { const v = u.searchParams.get('v'); return v && /^\d{5,25}$/.test(v) ? `https://www.facebook.com/watch/?v=${v}` : ''; }
  if (parts[0] === 'reel' && /^\d{5,25}$/.test(parts[1] || '')) return `https://www.facebook.com/reel/${parts[1]}`;
  if (parts[0] === 'share' && (parts[1] === 'v' || parts[1] === 'r') && ok(parts[2])) return `https://www.facebook.com/share/${parts[1]}/${parts[2]}/`;
  const vi = parts.indexOf('videos');
  if (vi >= 1 && ok(parts[0]) && /^\d{5,25}$/.test(parts[vi + 1] || '')) return `https://www.facebook.com/${parts[0]}/videos/${parts[vi + 1]}/`;
  return '';
}

/** An uploaded video's type. @param {unknown} type */
export const isClipType = (type) => typeof type === 'string' && CLASSROOM_CLIP_TYPES.includes(type);

/** The kind of item a stored file makes. @param {unknown} type */
export function kindOfType(type) {
  if (type === 'application/pdf') return 'pdf';
  if (isClipType(type)) return 'clip';
  return typeof type === 'string' && CLASSROOM_FILE_TYPES.includes(type) ? 'image' : '';
}

/** The largest file of a type, and the size of each upload request. @param {unknown} type */
export function fileLimits(type) {
  return isClipType(type)
    ? { max: CLASSROOM_CLIP_MAX_BYTES, partBytes: CLASSROOM_CLIP_PART_BYTES }
    : { max: CLASSROOM_FILE_MAX_BYTES, partBytes: CLASSROOM_FILE_PART_BYTES };
}

/**
 * One video button, or null.
 * @param {unknown} v
 * @returns {{ id: string, title: string, youtube: string, start: number } | null}
 */
export function sanitizeVideo(v) {
  if (!isObj(v) || !isButtonId(v.id)) return null;
  const youtube = youtubeIdFrom(v.youtube);
  if (!youtube) return null;
  const start = Number.isInteger(v.start) && v.start > 0 ? Math.min(v.start, 36000) : 0;
  return { id: v.id, title: oneLine(v.title, CLASSROOM_TITLE_MAX) || 'Video', youtube, start };
}

/**
 * One picture, PDF or text button (or, for Cast, a countdown or the clock), or null.
 * @param {unknown} v
 * @returns {{ id: string, kind: string, title: string, file?: string, type?: string, heading?: string, text?: string, look?: string, seconds?: number, endsAt?: number } | null}
 */
export function sanitizeItem(v) {
  if (!isObj(v) || !isButtonId(v.id) || !CLASSROOM_ITEM_KINDS.includes(v.kind)) return null;
  // A countdown: whole steps within the limits; the title line is optional ('' = none).
  // `endsAt` (ms) is the Worker's: it is kept here only so the stored stage reads back whole.
  if (v.kind === 'timer') {
    const s = v.seconds;
    if (!Number.isInteger(s) || s < CAST_TIMER_MIN_S || s > CAST_TIMER_MAX_S || s % CAST_TIMER_STEP_S !== 0) return null;
    const endsAt = typeof v.endsAt === 'number' && Number.isFinite(v.endsAt) && v.endsAt > 0 ? Math.round(v.endsAt) : 0;
    return { id: v.id, kind: 'timer', title: oneLine(v.title, CLASSROOM_TITLE_MAX), seconds: s, ...(endsAt ? { endsAt } : {}) };
  }
  if (v.kind === 'clock') return { id: v.id, kind: 'clock', title: '' };
  if (v.kind === 'text') {
    const text = cleanText(v.text);
    if (!text) return null;
    const heading = oneLine(v.heading, CLASSROOM_HEADING_MAX);
    const look = CLASSROOM_TEXT_LOOKS.includes(v.look) ? v.look : 'page';
    return { id: v.id, kind: 'text', title: oneLine(v.title, CLASSROOM_TITLE_MAX) || oneLine(text, CLASSROOM_TITLE_MAX), text, ...(heading ? { heading } : {}), look };
  }
  if (v.kind === 'facebook') {
    const href = facebookVideoFrom(v.href);
    return href ? { id: v.id, kind: 'facebook', title: oneLine(v.title, CLASSROOM_TITLE_MAX) || 'Facebook video', href } : null;
  }
  if (!isFileId(v.file) || kindOfType(v.type) !== v.kind) return null;
  const fallback = { pdf: 'PDF', clip: 'Video' }[v.kind] || 'Picture';
  return { id: v.id, kind: v.kind, title: oneLine(v.title, CLASSROOM_TITLE_MAX) || fallback, file: v.file, type: v.type };
}

/**
 * The shared button list: unknown entries dropped, ids unique, capped.
 * @param {unknown} v
 */
export function sanitizeButtons(v) {
  const seen = new Set();
  const keep = (b) => { if (!b || seen.has(b.id)) return false; seen.add(b.id); return true; };
  const videos = (isObj(v) && Array.isArray(v.videos) ? v.videos : []).map(sanitizeVideo).filter(keep).slice(0, CLASSROOM_VIDEOS_MAX);
  let clips = 0;
  const items = (isObj(v) && Array.isArray(v.items) ? v.items : []).map(sanitizeItem)
    // The Sparks list: no Facebook (the classroom TV has no Facebook player), no countdown or
    // clock (Cast only), at most CLIPS_MAX clips.
    .filter((b) => b && b.kind !== 'facebook' && !CAST_ONLY_KINDS.includes(b.kind) && (b.kind !== 'clip' || (clips += 1) <= CLASSROOM_CLIPS_MAX))
    .filter(keep).slice(0, CLASSROOM_ITEMS_MAX);
  return { videos: /** @type {NonNullable<ReturnType<typeof sanitizeVideo>>[]} */ (videos), items: /** @type {NonNullable<ReturnType<typeof sanitizeItem>>[]} */ (items) };
}

/** Every stored file a button list names. @param {{ items: { file?: string }[] }} buttons */
export function filesOf(buttons) {
  return new Set((buttons?.items || []).map((i) => i.file).filter(isFileId));
}

/** A button as it went up on the stage: a video, an item (a copy), or a shared screen. @param {unknown} v */
export function sanitizeShown(v) {
  if (!isObj(v)) return null;
  if (v.kind === 'screen') return isButtonId(v.id) ? { id: v.id, kind: 'screen', title: oneLine(v.title, CLASSROOM_TITLE_MAX) || 'Shared screen' } : null;
  if (v.kind === 'video') {
    const video = sanitizeVideo(v);
    return video ? { ...video, kind: 'video' } : null;
  }
  return sanitizeItem(v);
}

/**
 * One line-up entry (Cast): `{id, item}`, the item as an `item` press takes it (a video or
 * an item; never a shared screen, which only exists live). A countdown's `endsAt` is left
 * off: the Worker sets it when the entry goes up. Null when it is not one.
 * @param {unknown} v
 */
export function sanitizeLineupEntry(v) {
  if (!isObj(v) || !isButtonId(v.id)) return null;
  const item = /** @type {Record<string, any> | null} */ (sanitizeShown(v.item));
  if (!item || item.kind === 'screen') return null;
  const rest = { ...item };
  delete rest.endsAt;
  return { id: v.id, item: rest };
}

/** The characters an entry's item costs against CAST_LINEUP_CHARS_MAX. @param {{ item: unknown }} e */
const lineupChars = (e) => JSON.stringify(e.item).length;

/**
 * A line-up as an edit sends it (the whole list, in order): all or nothing. `problem`
 * is '' (clean), 'full' (more than CAST_LINEUP_MAX entries or CAST_LINEUP_CHARS_MAX
 * characters) or 'entry' (one is not an entry, or an id is repeated).
 * @param {unknown} list
 * @returns {{ entries: { id: string, item: Record<string, any> }[], problem: '' | 'full' | 'entry' }}
 */
export function cleanLineupEntries(list) {
  if (!Array.isArray(list)) return { entries: [], problem: 'entry' };
  if (list.length > CAST_LINEUP_MAX) return { entries: [], problem: 'full' };
  const seen = new Set();
  const entries = [];
  let chars = 0;
  for (const raw of list) {
    const e = sanitizeLineupEntry(raw);
    if (!e || seen.has(e.id)) return { entries: [], problem: 'entry' };
    seen.add(e.id);
    chars += lineupChars(e);
    if (chars > CAST_LINEUP_CHARS_MAX) return { entries: [], problem: 'full' };
    entries.push(e);
  }
  return { entries, problem: '' };
}

/**
 * The line-up as the Worker answers it (read forgivingly: a bad entry is dropped, the
 * caps hold). `on` = the entry last put up from it (Next goes on from there); `button` =
 * the stage button that put up, so a page can tell "on the TV now" from "shown last".
 * @param {unknown} v
 * @returns {{ rev: number, savedAt: string | null, entries: { id: string, item: Record<string, any> }[], on: string | null, button: string | null }}
 */
export function sanitizeLineup(v) {
  const s = isObj(v) ? v : {};
  const seen = new Set();
  const entries = [];
  let chars = 0;
  for (const raw of Array.isArray(s.entries) ? s.entries : []) {
    const e = sanitizeLineupEntry(raw);
    if (!e || seen.has(e.id)) continue;
    chars += lineupChars(e);
    if (entries.length >= CAST_LINEUP_MAX || chars > CAST_LINEUP_CHARS_MAX) break;
    seen.add(e.id);
    entries.push(e);
  }
  const on = typeof s.on === 'string' && seen.has(s.on) ? s.on : null;
  return {
    rev: Number.isInteger(s.rev) && s.rev >= 0 ? s.rev : 0,
    savedAt: typeof s.savedAt === 'string' ? s.savedAt.slice(0, 40) : null,
    entries,
    on,
    button: on && isButtonId(s.button) ? s.button : null,
  };
}

/**
 * One press, or null. data: show {button}, video {op, by?|step?}, page {step}|{to},
 * preview {look, hold?}, item {item} (a video or an item put up directly, Cast),
 * screen {title?} (a screen share starting), black {on} (Cast: the TV black, or
 * showing again); the others none. Never free text
 * but an item's own (cleaned by sanitizeShown).
 * @param {unknown} action @param {unknown} data
 * @returns {{ action: string, data?: Record<string, any> } | null}
 */
export function sanitizeClassroomPress(action, data) {
  if (typeof action !== 'string' || !CLASSROOM_ACTIONS.includes(action)) return null;
  const d = isObj(data) ? data : {};
  switch (action) {
    case 'show': return isButtonId(d.button) ? { action, data: { button: d.button } } : null;
    case 'video': {
      if (!CLASSROOM_VIDEO_OPS.includes(d.op)) return null;
      if (d.op === 'seek') return d.by === CLASSROOM_SEEK_S || d.by === -CLASSROOM_SEEK_S ? { action, data: { op: 'seek', by: d.by } } : null;
      if (d.op === 'volume') return d.step === 1 || d.step === -1 ? { action, data: { op: 'volume', step: d.step } } : null;
      return { action, data: { op: d.op } };
    }
    // A step (Back/Next), or straight to a page (Cast's slide strip, owner 2026-11-08).
    case 'page':
      if (d.step === 1 || d.step === -1) return { action, data: { step: d.step } };
      return Number.isInteger(d.to) && d.to >= 1 && d.to <= 9999 ? { action, data: { to: d.to } } : null;
    case 'preview': return CLASSROOM_LOOKS.includes(d.look) ? { action, data: { look: d.look, ...(d.hold === true ? { hold: true } : {}) } } : null;
    case 'item': {
      const item = sanitizeShown(d.item);
      return item && item.kind !== 'screen' ? { action, data: { item } } : null;
    }
    case 'screen': return { action, data: { title: oneLine(d.title, CLASSROOM_TITLE_MAX) || 'Shared screen' } };
    // Cast's Black button: on or off, said outright (a repeat of the same press changes nothing).
    case 'black': return typeof d.on === 'boolean' ? { action, data: { on: d.on } } : null;
    default: return { action };
  }
}

/** One momentary command on the stage. @param {unknown} v */
function sanitizeCmd(v) {
  if (!isObj(v) || typeof v.id !== 'string' || !CMD_ID_RE.test(v.id) || typeof v.at !== 'number' || !Number.isFinite(v.at)) return null;
  if (v.action === 'sparky') return { id: v.id, action: 'sparky', at: v.at };
  if (v.action !== 'video') return null;
  const p = sanitizeClassroomPress('video', v.data);
  return p ? { id: v.id, action: 'video', data: p.data, at: v.at } : null;
}

/**
 * What the classroom TV should show (the Worker's answer, cleaned again by
 * the screen and the remote).
 * @param {unknown} v
 */
export function sanitizeStage(v) {
  const s = isObj(v) ? v : {};
  const shown = sanitizeShown(s.show?.button);
  const show = shown && typeof s.show.at === 'number' ? { button: shown, at: s.show.at, page: Number.isInteger(s.show.page) && s.show.page >= 1 ? Math.min(s.show.page, 9999) : 1 } : null;
  const preview = isObj(s.preview) && CLASSROOM_LOOKS.includes(s.preview.look) && typeof s.preview.until === 'number' ? { look: s.preview.look, until: s.preview.until, ...(s.preview.held === true ? { held: true } : {}) } : null;
  const cmds = (Array.isArray(s.cmds) ? s.cmds : []).map(sanitizeCmd).filter(Boolean).slice(-CLASSROOM_CMDS_MAX);
  // `black` (Cast) is only there while it is on, so a stage without it reads as before.
  return { rev: Number.isInteger(s.rev) && s.rev >= 0 ? s.rev : 0, show, preview, cmds, ...(s.black === true ? { black: true } : {}) };
}

/**
 * The screen's report of what it shows (the remote words it).
 * @param {unknown} v
 */
export function sanitizeClassroomNow(v) {
  if (!isObj(v) || !CLASSROOM_VIEWS.includes(v.view)) return null;
  const out = /** @type {Record<string, any>} */ ({ view: v.view });
  if (isButtonId(v.button)) out.button = v.button;
  const title = oneLine(v.title, CLASSROOM_TITLE_MAX);
  if (title) out.title = title;
  if (Number.isInteger(v.page) && Number.isInteger(v.pages) && v.pages >= 1 && v.page >= 1 && v.page <= v.pages) { out.page = v.page; out.pages = Math.min(v.pages, 9999); }
  if (isObj(v.video)) {
    const n = (x, max) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(Math.max(0, x), max) : 0);
    out.video = { t: Math.round(n(v.video.t, 36000)), d: Math.round(n(v.video.d, 36000)), paused: v.video.paused === true, muted: v.video.muted === true, volume: Math.round(n(v.video.volume, 100)) };
  }
  if (CLASSROOM_LOOKS.includes(v.preview)) out.preview = v.preview;
  if (v.board === true) out.board = true;
  return out;
}

/**
 * A screen share's offer or answer: {type, sdp, id}, or null. The SDP is the
 * browser's own text (line breaks kept, nothing else odd, capped); `id` names
 * the share it belongs to (the stage's screen button id).
 * @param {unknown} v
 */
export function sanitizeSignal(v) {
  if (!isObj(v) || (v.type !== 'offer' && v.type !== 'answer') || typeof v.sdp !== 'string' || !isButtonId(v.id)) return null;
  // eslint-disable-next-line no-control-regex
  if (!v.sdp.startsWith('v=0') || v.sdp.length > CLASSROOM_SIGNAL_MAX || /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/.test(v.sdp)) return null;
  return { type: v.type, sdp: v.sdp, id: v.id };
}
