// The Sparks remote's words and choices, pure (no DOM, no network), so the
// tests can ask them anything (classroom/test/remote-logic.test.mjs).

/** m:ss (or h:mm:ss) for a number of seconds. @param {number} s */
export function clock(s) {
  const n = Math.max(0, Math.floor(Number(s) || 0));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const sec = String(n % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

const VIEW_WORDS = {
  off: 'The screen is off (no club right now)',
  cubbies: 'The Cubbies card',
  black: 'Black, while the clubs change rooms',
  sparks: 'Sparks Large Group Time',
  lobby: 'The lobby screen',
  board: 'The black board (a pen is up)',
};
const KIND_WORDS = { video: 'Video', image: 'Picture', pdf: 'PDF', text: 'Text' };

/**
 * What the "On the classroom TV" card says.
 * @param {{ now: any, stage: any, screenOnline: boolean, offline?: boolean }} s
 * @returns {{ kicker: string, main: string, sub: string, live: boolean }}
 */
export function nowWords({ now, stage, screenOnline, offline }) {
  if (offline) return { kicker: 'Last heard · not live', main: 'This phone is offline', sub: 'Check its internet; the remote will catch up.', live: false };
  const shown = stage && stage.show ? stage.show.button : null;
  if (shown) {
    const kind = KIND_WORDS[shown.kind] || 'Button';
    let sub = '';
    if (now && now.button === shown.id && now.video) sub = `${clock(now.video.t)} / ${clock(now.video.d)}${now.video.paused ? ' · paused' : ''} · volume ${now.video.volume}%${now.video.muted ? ' (muted)' : ''}`;
    else if (now && now.button === shown.id && now.pages) sub = `Page ${now.page} of ${now.pages}`;
    else if (shown.kind === 'pdf') sub = `Page ${stage.show.page}`;
    if (now && now.board) sub = sub ? `${sub} · the black board is over it` : 'The black board is over it';
    return { kicker: `On the classroom TV · ${kind}`, main: shown.title, sub: sub || (screenOnline ? 'Showing until you press Back to schedule.' : 'Waiting for the classroom TV to pick it up…'), live: screenOnline };
  }
  if (stage && stage.preview) return { kicker: 'On the classroom TV · preview', main: VIEW_WORDS[stage.preview.look] || 'A preview', sub: 'For a minute, then back to the schedule.', live: screenOnline };
  if (!screenOnline) return { kicker: 'On the classroom TV', main: 'The classroom TV is not on', sub: 'Buttons still work: it shows them when it comes on.', live: false };
  return { kicker: 'On the classroom TV', main: now ? VIEW_WORDS[now.view] || 'The schedule' : 'The schedule', sub: '', live: true };
}

/** A new button id (the shared rules' shape: b + 10 lowercase base36). */
export function newButtonId() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return `b${[...bytes].map((b) => (b % 36).toString(36)).join('')}`;
}

/** File sizes in words. @param {number} n */
export function size(n) {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/**
 * The editor's rows into the shared list, or the first problem in words.
 * Video rows: {id, title, link}; item rows: {id, kind: 'file'|'text', title,
 * file?, type?, fileKind?, heading?, text?, look?}.
 * @param {{ videos: any[], items: any[] }} rows @param {any} rules the shared rules
 * @returns {{ ok: true, buttons: any } | { ok: false, error: string, at: string }}
 */
export function buttonsFromRows(rows, rules) {
  const videos = [];
  for (const [i, r] of rows.videos.entries()) {
    const link = String(r.link || '').trim();
    if (!link && !String(r.title || '').trim()) continue;
    const youtube = rules.youtubeIdFrom(link);
    if (!youtube) return { ok: false, error: `Video ${i + 1}: paste a YouTube link (youtube.com or youtu.be).`, at: `video-${i}` };
    videos.push({ id: r.id, title: rules.oneLine(r.title, rules.CLASSROOM_TITLE_MAX) || `Video ${i + 1}`, youtube, start: rules.youtubeStartFrom(link) });
  }
  const items = [];
  for (const [i, r] of rows.items.entries()) {
    if (r.kind === 'text') {
      const text = rules.cleanText(r.text);
      if (!text) { if (!String(r.title || '').trim() && !String(r.heading || '').trim()) continue; return { ok: false, error: `Button ${i + 1}: type the words to show.`, at: `item-${i}` }; }
      items.push({ id: r.id, kind: 'text', title: rules.oneLine(r.title, rules.CLASSROOM_TITLE_MAX), heading: rules.oneLine(r.heading, rules.CLASSROOM_HEADING_MAX), text, look: r.look === 'board' ? 'board' : 'page' });
    } else {
      if (!r.file) { if (!String(r.title || '').trim()) continue; return { ok: false, error: `Button ${i + 1}: choose a picture or PDF, or paste a link to one.`, at: `item-${i}` }; }
      items.push({ id: r.id, kind: r.fileKind, title: rules.oneLine(r.title, rules.CLASSROOM_TITLE_MAX), file: r.file, type: r.type });
    }
  }
  const buttons = rules.sanitizeButtons({ videos, items });
  if (buttons.videos.length !== videos.length || buttons.items.length !== items.length) return { ok: false, error: 'One of the buttons could not be saved. Check each one.', at: '' };
  return { ok: true, buttons };
}

/** The shared list into editor rows. @param {{ videos: any[], items: any[] }} buttons */
export function rowsFromButtons(buttons) {
  return {
    videos: buttons.videos.map((v) => ({ id: v.id, title: v.title, link: `https://youtu.be/${v.youtube}${v.start ? `?t=${v.start}` : ''}` })),
    items: buttons.items.map((b) => (b.kind === 'text'
      ? { id: b.id, kind: 'text', title: b.title, heading: b.heading || '', text: b.text, look: b.look }
      : { id: b.id, kind: 'file', title: b.title, file: b.file, type: b.type, fileKind: b.kind })),
  };
}
