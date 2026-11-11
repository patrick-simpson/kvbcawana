// Cast's words and choices, pure (no DOM, no network, no imports), so the tests can
// ask them anything (site/test/cast.test.mjs). The shared rules
// (shared/classroomRemote.js) are handed in as `R` where a choice needs them, so this
// file carries no copy of them.
//
// Cast (owner 2026-11-08: "set it up kind of like an air server ... present from
// their laptop but through a webpage that is controlling that computer"; "TV code
// only"): worker/src/routes.md 10.18.

export const CODE_DIGITS = 6;
export const TOKEN_KEY = 'awanaCastToken.v1';
/** A presenter's token: the Worker's shape (t + base36). */
export const TOKEN_RE = /^t[a-z0-9]{24,40}$/;

/** The digits of whatever was typed or pasted ("123 456", "123-456"), at most six. @param {unknown} text */
export function cleanCode(text) {
  return typeof text === 'string' ? text.replace(/\D/g, '').slice(0, CODE_DIGITS) : '';
}

/** Six digits, not starting with 0 (the Worker never makes one). @param {unknown} code */
export function codeReady(code) {
  return typeof code === 'string' && /^[1-9]\d{5}$/.test(code);
}

/** The code as the TV shows it: two groups of three. @param {unknown} code */
export function formatCode(code) {
  const d = cleanCode(typeof code === 'string' ? code : '');
  return d.length > 3 ? `${d.slice(0, 3)} ${d.slice(3)}` : d;
}

/** A placeholder button id (the Worker gives the real one): the shared rules' shape. */
export function placeholderId() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return `b${[...bytes].map((b) => (b % 36).toString(36)).join('')}`;
}

/** m:ss (or h:mm:ss). @param {number} s */
export function clock(s) {
  const n = Math.max(0, Math.floor(Number(s) || 0));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const sec = String(n % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** File sizes in words. @param {number} n */
export function size(n) {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** A title from a file name: no extension, underscores as spaces. @param {unknown} name */
export function titleFromName(name) {
  if (typeof name !== 'string') return '';
  return name.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

/**
 * A YouTube link (and an optional title) as an item press, or the problem in words.
 * @param {{ link: string, title?: string }} form @param {any} R
 */
export function videoPress(form, R) {
  const youtube = R.youtubeIdFrom(form.link);
  if (!youtube) return { ok: false, error: 'That does not look like a YouTube link. Copy it from the Share button on YouTube.' };
  const item = { id: placeholderId(), kind: 'video', youtube, start: R.youtubeStartFrom(form.link), title: R.oneLine(form.title, R.CLASSROOM_TITLE_MAX) || 'YouTube video' };
  return checked(item, R);
}

/**
 * Text (an optional heading, up to 8 lines) as an item press, or the problem in words.
 * @param {{ heading?: string, text: string, look?: string }} form @param {any} R
 */
export function textPress(form, R) {
  const text = R.cleanText(form.text);
  if (!text) return { ok: false, error: 'Type something to show first.' };
  const lines = String(form.text).replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim()).length;
  if (lines > 8) return { ok: false, error: 'Eight lines at most. Shorten it a little.' };
  if (String(form.text).trim().length > R.CLASSROOM_TEXT_MAX) return { ok: false, error: `That is too long for the TV (${R.CLASSROOM_TEXT_MAX} letters at most).` };
  const heading = R.oneLine(form.heading, R.CLASSROOM_HEADING_MAX);
  const look = form.look === 'board' ? 'board' : 'page';
  return checked({ id: placeholderId(), kind: 'text', title: heading || R.oneLine(text, R.CLASSROOM_TITLE_MAX), text, ...(heading ? { heading } : {}), look }, R);
}

/**
 * A finished upload (the Worker's answer: {id, type, kind}) as an item press.
 * @param {{ id: string, type: string, kind?: string }} file @param {string} title @param {any} R
 */
export function filePress(file, title, R) {
  const kind = R.kindOfType(file && file.type);
  if (!kind) return { ok: false, error: 'Only a picture, a PDF or a video can go on the TV.' };
  const fallback = { pdf: 'Slides', clip: 'Video' }[kind] || 'Picture';
  return checked({ id: placeholderId(), kind, file: file.id, type: file.type, title: R.oneLine(title, R.CLASSROOM_TITLE_MAX) || fallback }, R);
}

/**
 * A Facebook video link (and an optional title) as an item press, or the problem.
 * @param {{ link: string, title?: string }} form @param {any} R
 */
export function facebookPress(form, R) {
  const href = R.facebookVideoFrom(form.link);
  if (!href) return { ok: false, error: 'That does not look like a Facebook video link. On the video, tap Share, then Copy link.' };
  return checked({ id: placeholderId(), kind: 'facebook', href, title: R.oneLine(form.title, R.CLASSROOM_TITLE_MAX) || 'Facebook video' }, R);
}

/**
 * A YouTube search result ({youtube, title}) as an item press.
 * @param {{ youtube: string, title?: string }} result @param {any} R
 */
export function resultPress(result, R) {
  return videoPress({ link: result && result.youtube, title: result && result.title }, R);
}

/** Cast's own address (owner 2026-11-09): the presenter page at its root, the TV at /screen/. */
export const CAST_HOME = 'https://cast.kvbchurch.org/';

/**
 * The presenter page a TV page sends people to: the folder above the TV page, so
 * cast.kvbchurch.org/screen/ says cast.kvbchurch.org/ (and the old
 * awana.kvbchurch.org/cast/screen/ copy its own /cast/). Off https (a test, a file):
 * Cast's own address.
 * @param {unknown} tvHref the TV page's address
 */
export function presenterUrl(tvHref) {
  try {
    const u = new URL('../', String(tvHref));
    if (u.protocol === 'https:') return `${u.origin}${u.pathname}`;
  } catch { /* not an address */ }
  return CAST_HOME;
}

/** The presenter page's address in words: no https://, no trailing slash. @param {string} url */
export function addressWords(url) {
  return String(url).replace(/^https:\/\//, '').replace(/\/$/, '');
}

/** The code in the QR's link (cast.kvbchurch.org/#code=123456), '' when none. @param {unknown} hash */
export function codeFromHash(hash) {
  const m = /(?:^#|&)code=(\d{6})(?:&|$)/.exec(typeof hash === 'string' ? hash : '');
  return m && codeReady(m[1]) ? m[1] : '';
}

/** Through the shared rules, as the Worker will check it. */
function checked(item, R) {
  const p = R.sanitizeClassroomPress('item', { item });
  return p ? { ok: true, press: p } : { ok: false, error: 'That cannot go on the TV.' };
}

/**
 * Why a chosen file cannot be sent ('' = it can). @param {{ type: string, size: number }} file
 * @param {'image'|'pdf'|'clip'} want @param {any} R
 */
export function fileProblem(file, want, R) {
  const kind = R.kindOfType(file && file.type);
  if (want === 'pdf' && kind !== 'pdf') return 'Choose a PDF. From PowerPoint: File, Save As, PDF.';
  if (want === 'image' && kind !== 'image') return 'Choose a picture (JPEG, PNG, GIF or WebP).';
  if (want === 'clip') {
    if (kind !== 'clip') return 'Choose a video (MP4, MOV or WebM).';
    if (file.size > R.CLASSROOM_CLIP_MAX_BYTES) return `That video is ${size(file.size)}; 200 MB at most. Trim it, or share your screen.`;
    return file.size ? '' : 'That file is empty.';
  }
  if (file.size > R.CLASSROOM_FILE_MAX_BYTES) return `That file is ${size(file.size)}; 20 MB at most.`;
  if (!file.size) return 'That file is empty.';
  return '';
}

/**
 * A pasted Slides/PDF link: what the Worker should copy, or the problem.
 * @param {string} text @param {any} R
 */
export function linkToCopy(text, R) {
  const url = R.fileLinkFrom(text);
  if (!url) return { ok: false, error: 'Paste a full link that starts with https://.' };
  return { ok: true, url, google: /^https:\/\/docs\.google\.com\//.test(url) };
}

/**
 * The words for a refused join (the Worker's own sentence when it sent one).
 * @param {number} status @param {any} body
 */
export function joinWords(status, body) {
  if (status === 0) return 'This page could not reach the internet. Check the Wi-Fi and try again.';
  if ((status === 403 || status === 429) && body && typeof body.error === 'string') return body.error;
  if (status === 429) return 'Too many tries. Wait a few minutes, then try again.';
  return (body && typeof body.error === 'string' && body.error) || 'That did not work. Try again.';
}

/**
 * Any other refusal as one plain sentence.
 * @param {number} status @param {any} body
 */
export function errorWords(status, body) {
  if (status === 0) return 'That did not reach the TV. Check the internet and try again.';
  if (status === 429) return 'Too many at once. Wait a moment, then try again.';
  return (body && typeof body.error === 'string' && body.error) || 'That did not work. Try again.';
}

const KIND_WORDS = { video: 'a YouTube video', clip: 'a video', facebook: 'a Facebook video', image: 'a picture', pdf: 'slides', text: 'text', screen: 'a shared screen' };

/**
 * The "On the TV now" line. `short` leaves off the "On the TV now: " lead-in, for a page
 * that already has "On the TV now" as the heading above it (the desk).
 * @param {{ stage: any, now: any, screenOnline: boolean }} s
 * @param {{ short?: boolean }} [opts]
 * @returns {{ main: string, sub: string, online: boolean }}
 */
export function tvWords({ stage, now, screenOnline }, opts = {}) {
  const shown = stage && stage.show ? stage.show.button : null;
  // The Black button (owner 2026-11-11): the TV is black over whatever is up.
  const black = Boolean(stage && stage.black);
  if (!shown) {
    if (black && screenOnline) return { main: 'The TV is black.', sub: 'Nothing is up underneath.', online: true };
    return screenOnline
      ? { main: 'Nothing yet. The TV is showing its code.', sub: '', online: true }
      : { main: 'The TV is not answering right now.', sub: 'It may be turning on. Anything you send will show when it does.', online: false };
  }
  const mine = now && now.button === shown.id ? now : null;
  let sub = '';
  if (mine && mine.video) sub = `${clock(mine.video.t)} of ${clock(mine.video.d)}${mine.video.paused ? ', paused' : ''}${mine.video.muted ? ', muted' : `, volume ${mine.video.volume}%`}`;
  else if (mine && mine.pages) sub = `Page ${mine.page} of ${mine.pages}`;
  else if (shown.kind === 'pdf') sub = `Page ${stage.show.page}`;
  if (!screenOnline) sub = 'Waiting for the TV to pick it up.';
  const title = shown.kind === 'screen' || !shown.title ? '' : `: ${shown.title}`;
  const what = KIND_WORDS[shown.kind] || 'something';
  if (black) return { main: 'The TV is black.', sub: screenOnline ? `Underneath: ${what}${shown.kind === 'screen' || !shown.title ? '' : `, ${shown.title}`}.` : sub, online: screenOnline };
  const main = opts.short ? `${what.charAt(0).toUpperCase()}${what.slice(1)}${title}` : `On the TV now: ${what}${title}`;
  return { main, sub, online: screenOnline };
}

/**
 * The volume between the − and + buttons: "Volume 60%", " · muted" when it is. The TV's
 * report carries the level; with no report yet it just says "Volume".
 * @param {{ muted?: boolean, volume?: number } | null | undefined} video
 */
export function volumeWords(video) {
  if (!video || typeof video.volume !== 'number') return 'Volume';
  return `Volume ${video.volume}%${video.muted ? ' · muted' : ''}`;
}

/** The screen share's state in words. @param {string} state @param {string} [error] */
export function shareWords(state, error) {
  switch (state) {
    case 'choosing': return 'Choose a screen, window or tab to share.';
    case 'connecting': case 'new': return 'Connecting to the TV…';
    case 'waiting': return 'Waiting for the TV to answer…';
    case 'connected': return 'Sharing. The TV shows what you see.';
    case 'disconnected': return 'The connection dropped for a moment. Trying to hold on…';
    case 'failed': return error || 'Sharing stopped. The laptop and the TV may not be on the same Wi-Fi.';
    case 'closed': case 'stopped': return 'Sharing stopped.';
    default: return '';
  }
}

/** The browser's refusal of getDisplayMedia, in words. @param {unknown} err */
export function captureWords(err) {
  const name = err && typeof err === 'object' && 'name' in err ? String(err.name) : '';
  if (name === 'NotAllowedError' || name === 'AbortError') return 'Sharing was cancelled.';
  if (name === 'NotFoundError') return 'There was nothing to share.';
  return 'This browser could not share the screen.';
}

/* ── PowerPoint into slides, and the phone's preview (owner 2026-11-08: "Support pptx
   upload and show a preview on the phone screen"; the exact copy, current + next) ── */

/** The largest PowerPoint the Worker takes (its CONVERT_MAX_BYTES). */
export const PRESENTATION_MAX_BYTES = 40 * 1024 * 1024;
const PRESENTATION_TYPES = [
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/vnd.oasis.opendocument.presentation',
];
/** What the slides file picker accepts: a PDF or a PowerPoint (Keynote: export as PowerPoint). */
export const SLIDES_ACCEPT = ['application/pdf', '.pdf', '.pptx', '.ppt', '.odp', ...PRESENTATION_TYPES].join(',');

/** A PowerPoint (or LibreOffice) presentation, by type or name. @param {{ type?: string, name?: string }} file */
export function isPresentation(file) {
  if (!file) return false;
  return PRESENTATION_TYPES.includes(String(file.type || '')) || /\.(pptx|ppt|odp)$/i.test(String(file.name || ''));
}

/**
 * A chosen slides file: 'pdf' (sent as it is), 'pptx' (turned into slides first), or
 * the problem in words. @param {{ type: string, name?: string, size: number }} file @param {any} R
 * @returns {{ ok: true, kind: 'pdf' | 'pptx' } | { ok: false, error: string }}
 */
export function slidesChoice(file, R) {
  if (!file || !file.size) return { ok: false, error: 'That file is empty.' };
  if (isPresentation(file)) {
    if (file.size > PRESENTATION_MAX_BYTES) return { ok: false, error: `That PowerPoint is ${size(file.size)}; 40 MB at most. Save it as a PDF, or share your screen.` };
    return { ok: true, kind: 'pptx' };
  }
  const problem = fileProblem(file, 'pdf', R);
  if (problem) return { ok: false, error: /PowerPoint/.test(problem) ? 'Choose a PDF or a PowerPoint (.pptx).' : problem };
  return { ok: true, kind: 'pdf' };
}

/** Making the slides takes about this long; the page stops waiting after CONVERT_GIVE_UP_MS. */
export const CONVERT_POLL_MS = 3000;
export const CONVERT_GIVE_UP_MS = 6 * 60 * 1000;

/**
 * Where a PowerPoint is, in words (the Worker's status and error, routes.md 10.18).
 * @param {string} status @param {string} [error] @param {number} [seconds] since the job started
 */
export function convertWords(status, error, seconds = 0) {
  switch (status) {
    case 'uploading': return 'Sending the PowerPoint…';
    case 'converting':
      if (seconds >= 150) return `Still making the slides (${clock(seconds)}). GitHub may be busy; it usually takes about a minute.`;
      return `Making the slides… this takes about a minute${seconds >= 5 ? ` (${clock(seconds)})` : ''}.`;
    case 'done': return '';
    case 'failed':
      if (error === 'type') return 'That file is not a PowerPoint LibreOffice can open. Save it as a PDF and send that.';
      if (error === 'too-big') return 'The slides came out over 20 MB. Save it as a PDF with smaller pictures, or share your screen.';
      return 'The slides could not be made from that file. Save it as a PDF and send that, or share your screen.';
    case 'gave-up': return 'Making the slides is taking too long. Try again, or save it as a PDF.';
    default: return '';
  }
}

/**
 * The phone's preview of the slides on the TV: which page is up, which is next.
 * @param {number} page the page on the TV (1-based) @param {number} pages 0 while unknown
 * @returns {{ now: number, next: number, label: string, first: boolean, last: boolean }}
 */
export function slideView(page, pages) {
  const known = Number.isInteger(pages) && pages >= 1;
  const now = Math.max(1, Math.min(Number.isInteger(page) ? page : 1, known ? pages : 9999));
  const last = known && now >= pages;
  return {
    now,
    next: last ? 0 : now + 1,
    label: known ? `Slide ${now} of ${pages}` : `Slide ${now}`,
    first: now <= 1,
    last,
  };
}
