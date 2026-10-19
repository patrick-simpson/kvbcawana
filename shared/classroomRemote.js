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

export const CLASSROOM_VIDEOS_MAX = 4;
export const CLASSROOM_ITEMS_MAX = 8;
export const CLASSROOM_TITLE_MAX = 60;
export const CLASSROOM_HEADING_MAX = 60;
export const CLASSROOM_TEXT_MAX = 400;
/** An uploaded or copied file: at most this big, sent in parts of PART bytes (under the Worker's 128 KiB body cap). */
export const CLASSROOM_FILE_MAX_BYTES = 20 * 1024 * 1024;
export const CLASSROOM_FILE_PART_BYTES = 96 * 1024;
export const CLASSROOM_FILE_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']);
/** The looks /settings can preview on the TV, and for how long (owner: one minute). */
export const CLASSROOM_LOOKS = Object.freeze(['cubbies', 'sparks', 'lobby']);
export const CLASSROOM_PREVIEW_MS = 60 * 1000;
/** Momentary commands older than this are not run (a pause 30 s late is worse than none). */
export const CLASSROOM_CMD_TTL_MS = 20 * 1000;
export const CLASSROOM_CMDS_MAX = 8;
/** The screen reports what it shows only while a remote asked within this long. */
export const CLASSROOM_WATCH_MS = 30 * 1000;
/** A seek moves exactly this far; one volume press this many percent. */
export const CLASSROOM_SEEK_S = 10;
export const CLASSROOM_VOLUME_STEP_PCT = 10;
export const CLASSROOM_TEXT_LOOKS = Object.freeze(['page', 'board']);
export const CLASSROOM_ITEM_KINDS = Object.freeze(['image', 'pdf', 'text']);
/** Everything a remote (or /settings) may ask. */
export const CLASSROOM_ACTIONS = Object.freeze(['show', 'back', 'video', 'page', 'preview', 'preview-end', 'sparky']);
export const CLASSROOM_VIDEO_OPS = Object.freeze(['toggle', 'play', 'pause', 'seek', 'volume', 'mute', 'unmute']);
/** What the screen can be showing (its report's `view`). */
export const CLASSROOM_VIEWS = Object.freeze(['off', 'cubbies', 'black', 'sparks', 'lobby', 'board', 'video', 'image', 'pdf', 'text']);

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
  if (u.hostname === 'drive.google.com') {
    const m = /^\/file\/d\/([A-Za-z0-9_-]{10,})/.exec(u.pathname);
    const id = m ? m[1] : u.searchParams.get('id');
    if (id && /^[A-Za-z0-9_-]{10,}$/.test(id)) return `https://drive.google.com/uc?export=download&id=${id}`;
  }
  return u.href;
}

/** The kind of item a stored file makes. @param {unknown} type */
export function kindOfType(type) {
  if (type === 'application/pdf') return 'pdf';
  return typeof type === 'string' && CLASSROOM_FILE_TYPES.includes(type) ? 'image' : '';
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
 * One picture, PDF or text button, or null.
 * @param {unknown} v
 * @returns {{ id: string, kind: string, title: string, file?: string, type?: string, heading?: string, text?: string, look?: string } | null}
 */
export function sanitizeItem(v) {
  if (!isObj(v) || !isButtonId(v.id) || !CLASSROOM_ITEM_KINDS.includes(v.kind)) return null;
  if (v.kind === 'text') {
    const text = cleanText(v.text);
    if (!text) return null;
    const heading = oneLine(v.heading, CLASSROOM_HEADING_MAX);
    const look = CLASSROOM_TEXT_LOOKS.includes(v.look) ? v.look : 'page';
    return { id: v.id, kind: 'text', title: oneLine(v.title, CLASSROOM_TITLE_MAX) || oneLine(text, CLASSROOM_TITLE_MAX), text, ...(heading ? { heading } : {}), look };
  }
  if (!isFileId(v.file) || kindOfType(v.type) !== v.kind) return null;
  return { id: v.id, kind: v.kind, title: oneLine(v.title, CLASSROOM_TITLE_MAX) || (v.kind === 'pdf' ? 'PDF' : 'Picture'), file: v.file, type: v.type };
}

/**
 * The shared button list: unknown entries dropped, ids unique, capped.
 * @param {unknown} v
 */
export function sanitizeButtons(v) {
  const seen = new Set();
  const keep = (b) => { if (!b || seen.has(b.id)) return false; seen.add(b.id); return true; };
  const videos = (isObj(v) && Array.isArray(v.videos) ? v.videos : []).map(sanitizeVideo).filter(keep).slice(0, CLASSROOM_VIDEOS_MAX);
  const items = (isObj(v) && Array.isArray(v.items) ? v.items : []).map(sanitizeItem).filter(keep).slice(0, CLASSROOM_ITEMS_MAX);
  return { videos: /** @type {NonNullable<ReturnType<typeof sanitizeVideo>>[]} */ (videos), items: /** @type {NonNullable<ReturnType<typeof sanitizeItem>>[]} */ (items) };
}

/** Every stored file a button list names. @param {{ items: { file?: string }[] }} buttons */
export function filesOf(buttons) {
  return new Set((buttons?.items || []).map((i) => i.file).filter(isFileId));
}

/** A button as it went up on the stage: a video or an item (a copy). @param {unknown} v */
export function sanitizeShown(v) {
  if (!isObj(v)) return null;
  if (v.kind === 'video') {
    const video = sanitizeVideo(v);
    return video ? { ...video, kind: 'video' } : null;
  }
  return sanitizeItem(v);
}

/**
 * One press, or null. data: show {button}, video {op, by?|step?}, page {step},
 * preview {look}; the others none. Never free text.
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
    case 'page': return d.step === 1 || d.step === -1 ? { action, data: { step: d.step } } : null;
    case 'preview': return CLASSROOM_LOOKS.includes(d.look) ? { action, data: { look: d.look } } : null;
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
  const preview = isObj(s.preview) && CLASSROOM_LOOKS.includes(s.preview.look) && typeof s.preview.until === 'number' ? { look: s.preview.look, until: s.preview.until } : null;
  const cmds = (Array.isArray(s.cmds) ? s.cmds : []).map(sanitizeCmd).filter(Boolean).slice(-CLASSROOM_CMDS_MAX);
  return { rev: Number.isInteger(s.rev) && s.rev >= 0 ? s.rev : 0, show, preview, cmds };
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
