// @ts-check
// The downstairs classroom's Sparks remote (owner 2026-10-18; src/routes.md
// 10.13): the shared button list, the files it shows, what the classroom TV
// should show (the stage), and the TV's report back. Rules (one copy, shared
// with the remote and the screen): ../../shared/classroomRemote.js.
//
// Storage (the free plan's SQLite-backed object; small writes):
//   classroom:buttons   {rev, savedAt, buttons}        one put per edit
//   classroom:stage     {rev, show, preview, cmds}     one put per press (Cast's adds `black`)
//   cmeta:<id>          {id, type, bytes, parts, name, done, at}
//   cpart:<id>:<n>      one part of the file, CLASSROOM_FILE_PART_BYTES (under the 128 KiB body cap)
// A file not named by the button list is deleted when the list is saved
// (one that is still uploading, younger than FILE_PENDING_MS, is kept).
// Pictures and PDFs are the church's own lesson material (never a name); a
// link is COPIED here once (the screen never depends on another site, and a
// PDF needs no CORS), so the TV reads every file from this service.
//
// The TV (classroom/public/src/app.js) reads the stage when the doorbell
// `changed {what: 'classroom', rev}` rings (its embedded lobby passes it up)
// and every few seconds as a fallback; KVBC Awana's display reads it too, to
// open a closed screen for a /settings preview. The TV reports what it shows
// (memory only) while a remote watched within CLASSROOM_WATCH_MS.

import {
  CLASSROOM_CMDS_MAX,
  CLASSROOM_CMD_TTL_MS,
  CLASSROOM_FILE_MAX_BYTES,
  CLASSROOM_FILE_PART_BYTES,
  CLASSROOM_FILE_TYPES,
  CLASSROOM_PLAYABLE_KINDS,
  CLASSROOM_PREVIEW_MS,
  CLASSROOM_HOLD_MS,
  CLASSROOM_WATCH_MS,
  fileLimits,
  fileLinkFrom,
  filesOf,
  isClipType,
  isFileId,
  kindOfType,
  oneLine,
  sanitizeButtons,
  sanitizeClassroomNow,
  sanitizeClassroomPress,
  sanitizeSignal,
  sanitizeStage,
} from '../../shared/classroomRemote.js';
import { fail, json } from './http.js';
import { sessionKeyOf, takeToken } from './journeyRemote.js';

const BUTTONS_KEY = 'classroom:buttons';
const STAGE_KEY = 'classroom:stage';
const FILE_PREFIX = 'cmeta:';
const PART_PREFIX = 'cpart:';
/** An upload that never finished is cleaned up after this long. */
export const FILE_PENDING_MS = 60 * 60 * 1000;
/** A link the Worker copies: give up after this long. */
const IMPORT_TIMEOUT_MS = 25 * 1000;

/**
 * A second link copy while one is still running in this room (IP-20261111-17): each
 * holds up to 20 MB in memory, so several at once could restart the Worker. One at a
 * time per room; the second is told to wait.
 */
export function linkCopyBusy() {
  return fail('Another link is still being copied to the screen. Wait a moment, then try again.', 429, { reason: 'busy' });
}
/** Redirects a copied link may take (a Drive or Docs link takes one or two), each to https only. */
export const IMPORT_REDIRECTS_MAX = 3;

/**
 * A response's (or request's) body, read piece by piece and given up the moment it
 * passes `max` (a body with no Content-Length could otherwise fill memory: the entry
 * point reads every request body with it too). Null = too big.
 * @param {{ body: ReadableStream<Uint8Array> | null }} res @param {number} max
 */
export async function readLimited(res, max) {
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      try { await reader.cancel(); } catch { /* already gone */ }
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}
/** The TV counts as on while it read the stage within this long. */
export const CLASSROOM_ONLINE_MS = 45 * 1000;

/** @param {number} bytes */
const partsFor = (bytes) => Math.max(1, Math.ceil(bytes / CLASSROOM_FILE_PART_BYTES));

/** A screen share's offer waits for its answer this long (memory only). */
export const SIGNAL_TTL_MS = 2 * 60 * 1000;

/** A new id: a letter then lowercase base36 from random bytes. @param {string} letter @param {number} n */
export function newId(letter, n) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return letter + [...bytes].map((b) => (b % 36).toString(36)).join('');
}

/** What a picture or PDF really is, from its first bytes ('' when neither). @param {Uint8Array} b */
export function sniffType(b) {
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return 'application/pdf';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  // A video: an MP4/MOV 'ftyp' box ('qt  ' brand = QuickTime), or WebM's EBML header.
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return b[8] === 0x71 && b[9] === 0x74 ? 'video/quicktime' : 'video/mp4';
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm';
  return '';
}

export class Classroom {
  /**
   * @param {{ storage: any, now: () => number, ring: (payload: Record<string, unknown>) => void, fetchFn?: typeof fetch,
   *   room?: { what: string, buttonsKey: string, stageKey: string, filePrefix: string, partPrefix: string, cast?: boolean } }} deps
   * `room`: the lobby's Cast screen (cast.js) runs a second copy under its own keys and doorbell;
   * `room.cast` lets it take the presses only Cast has (Black).
   */
  constructor({ storage, now, ring, fetchFn, room }) {
    this.room = room || { what: 'classroom', buttonsKey: BUTTONS_KEY, stageKey: STAGE_KEY, filePrefix: FILE_PREFIX, partPrefix: PART_PREFIX };
    this.storage = storage;
    this.now = now;
    this.ring = ring;
    this.fetchFn = fetchFn || ((u, i) => fetch(u, i));
    /** @type {any} */
    this.stageCache = null;
    /** @type {any} */
    this.report = null;
    this.reportAt = 0;
    this.watchAt = 0;
    this.screenAt = 0;
    this.seq = 0;
    /** @type {Map<string, { tokens: number, t: number }>} */
    this.buckets = new Map();
    /** Told when a share ends or is replaced (turn.js revokes its relay credentials). @type {(id: string) => void} */
    this.onShareEnd = () => {};
    /** @type {{ id: string, offer: any, answer: any, at: number, by?: string } | null} */
    this.share = null;
    /** A link copy is running in this room (memory only; one at a time). */
    this.importing = false;
  }

  /** The screen share now up: its offer and answer (memory only); `by` = who started it. */
  get rtc() { return this.share; }

  set rtc(v) {
    const old = this.share;
    this.share = v;
    if (old && (!v || v.id !== old.id)) {
      try { this.onShareEnd(old.id); } catch { /* never in the way */ }
    }
  }

  watching() { return this.watchAt > 0 && this.now() - this.watchAt <= CLASSROOM_WATCH_MS; }

  /** @returns {Promise<{ rev: number, savedAt: string | null, buttons: ReturnType<typeof sanitizeButtons> }>} */
  async buttonsDoc() {
    const d = await this.storage.get(this.room.buttonsKey);
    return { rev: Number.isInteger(d?.rev) ? d.rev : 0, savedAt: typeof d?.savedAt === 'string' ? d.savedAt : null, buttons: sanitizeButtons(d?.buttons) };
  }

  /** @param {any} body */
  async putButtons(body) {
    const doc = await this.buttonsDoc();
    if (body?.baseRev !== doc.rev) return fail('Someone else changed the buttons. They have been reloaded; make your change again.', 409, { reason: 'stale', rev: doc.rev, buttons: doc.buttons });
    const buttons = sanitizeButtons(body?.buttons);
    // Every file a button names must be a finished file here.
    for (const f of filesOf(buttons)) {
      const meta = await this.storage.get(this.room.filePrefix + f);
      if (!meta?.done) return fail('A picture or PDF is still uploading, or was removed. Add it again.', 400, { reason: 'file-missing' });
    }
    const next = { rev: doc.rev + 1, savedAt: new Date(this.now()).toISOString(), buttons };
    await this.storage.put(this.room.buttonsKey, next);
    await this.sweepFiles(buttons);
    return json({ ok: true, ...next });
  }

  /** Deletes every file the list does not name (unfinished uploads younger than an hour stay). @param {ReturnType<typeof sanitizeButtons>} buttons */
  async sweepFiles(buttons) {
    const keep = filesOf(buttons);
    // The stage's button is a copy: keep its file while it is up.
    const shown = (await this.stage()).show?.button;
    if (shown && 'file' in shown && shown.file) keep.add(shown.file);
    const metas = await this.storage.list({ prefix: this.room.filePrefix });
    const t = this.now();
    for (const [, meta] of metas) {
      if (!meta || !isFileId(meta.id) || keep.has(meta.id)) continue;
      if (!meta.done && t - (meta.at || 0) < FILE_PENDING_MS) continue;
      await this.deleteFile(meta);
    }
  }

  /** @param {{ id: string, parts: number }} meta */
  async deleteFile(meta) {
    for (let n = 0; n < (meta.parts || 0); n += 1) await this.storage.delete(`${this.room.partPrefix}${meta.id}:${n}`);
    await this.storage.delete(this.room.filePrefix + meta.id);
  }

  /**
   * POST /v1/classroom/files: {type, bytes, name} starts an upload ({id, parts,
   * partBytes}); {url} copies a picture or PDF from a link and answers the
   * finished file.
   * @param {any} body
   */
  async startFile(body) {
    if (typeof body?.url === 'string') return this.importFile(body.url, body.name);
    const type = body?.type;
    const bytes = body?.bytes;
    if (!CLASSROOM_FILE_TYPES.includes(type) && !isClipType(type)) return fail('Only a picture (JPEG, PNG, GIF, WebP), a PDF or a video (MP4, MOV, WebM) can go on the screen.', 400, { reason: 'type' });
    if (!Number.isInteger(bytes) || bytes < 1) return fail('That file is empty.', 400, { reason: 'empty' });
    const { max, partBytes } = fileLimits(type);
    if (bytes > max) return fail(isClipType(type) ? 'That video is too big (200 MB at most).' : 'That file is too big (20 MB at most).', 413, { reason: 'too-big' });
    // `parts` = stored 96 KiB parts; `reqBytes`/`reqs` = the upload's requests (a clip
    // sends ten parts a request; a picture or PDF one).
    const reqs = Math.max(1, Math.ceil(bytes / partBytes));
    const meta = { id: newId('f', 16), type, bytes, parts: partsFor(bytes), reqBytes: partBytes, reqs, next: 0, name: oneLine(body?.name, 80), done: false, at: this.now() };
    await this.storage.put(this.room.filePrefix + meta.id, meta);
    return json({ ok: true, id: meta.id, parts: reqs, partBytes });
  }

  /** PUT /v1/classroom/files/:id/:n with the part's bytes. @param {string} id @param {string} n @param {Request} request */
  async putPart(id, n, request) {
    const meta = isFileId(id) ? await this.storage.get(this.room.filePrefix + id) : null;
    const i = Number(n);
    if (!meta || meta.done) return fail('There is no upload by that name.', 404);
    // Parts arrive in order (the remote sends one at a time); a repeat of the
    // last one (its answer was lost) is taken again.
    const reqBytes = meta.reqBytes || CLASSROOM_FILE_PART_BYTES;
    const reqs = meta.reqs || meta.parts;
    if (!Number.isInteger(i) || i < 0 || i >= reqs || i > meta.next || i < meta.next - 1) return fail('That part is out of order.', 409, { reason: 'order', next: meta.next });
    const buf = new Uint8Array(await request.arrayBuffer());
    const want = i === reqs - 1 ? meta.bytes - i * reqBytes : reqBytes;
    if (buf.length !== want) return fail('That part is the wrong size.', 400, { reason: 'size' });
    const per = reqBytes / CLASSROOM_FILE_PART_BYTES;
    for (let j = 0; j * CLASSROOM_FILE_PART_BYTES < buf.length; j += 1) {
      await this.storage.put(`${this.room.partPrefix}${id}:${i * per + j}`, buf.slice(j * CLASSROOM_FILE_PART_BYTES, (j + 1) * CLASSROOM_FILE_PART_BYTES));
    }
    // `lastAt`: when a part last arrived, so Cast can tell a dropped upload from a slow one.
    if (i === meta.next) await this.storage.put(this.room.filePrefix + id, { ...meta, next: i + 1, lastAt: this.now() });
    return json({ ok: true, next: Math.max(meta.next, i + 1) });
  }

  /** POST /v1/classroom/files/:id/done: every part is here and the file is what it says. @param {string} id */
  async finishFile(id) {
    const meta = isFileId(id) ? await this.storage.get(this.room.filePrefix + id) : null;
    if (!meta) return fail('There is no upload by that name.', 404);
    if (meta.done) return json({ ok: true, id, type: meta.type, bytes: meta.bytes, kind: kindOfType(meta.type) });
    if (meta.next !== (meta.reqs || meta.parts)) return fail('Part of the file did not arrive. Try again.', 400, { reason: 'parts', next: meta.next });
    const first = await this.storage.get(`${this.room.partPrefix}${id}:0`);
    const sniffed = sniffType(new Uint8Array(first));
    // A video's box says MP4 or QuickTime loosely (an iPhone .mov, an .mp4 from a Mac): any video type for any video.
    if (sniffed !== meta.type && !(isClipType(sniffed) && isClipType(meta.type))) {
      await this.deleteFile(meta);
      return fail('That file is not the picture, PDF or video it says it is.', 400, { reason: 'type' });
    }
    await this.storage.put(this.room.filePrefix + id, { ...meta, done: true });
    return json({ ok: true, id, type: meta.type, bytes: meta.bytes, kind: kindOfType(meta.type) });
  }

  /**
   * Copies a picture or PDF from a link (a Google Drive share link works).
   * `maxBytes`: a lower cap than 20 MB (Cast's room allowance).
   * @param {string} link @param {unknown} name @param {{ maxBytes?: number }} [opts]
   */
  async importFile(link, name, opts = {}) {
    // Checked and set in one synchronous step, before any wait; let go however it ends.
    if (this.importing) return linkCopyBusy();
    this.importing = true;
    try {
      return await this.copyLink(link, name, opts);
    } finally {
      this.importing = false;
    }
  }

  /** importFile's work (only from importFile). @param {string} link @param {unknown} name @param {{ maxBytes?: number }} opts */
  async copyLink(link, name, opts) {
    const max = Math.min(CLASSROOM_FILE_MAX_BYTES, opts.maxBytes ?? CLASSROOM_FILE_MAX_BYTES);
    let url = fileLinkFrom(link);
    if (!url) return fail('That is not an https link.', 400, { reason: 'link' });
    const signal = AbortSignal.timeout(IMPORT_TIMEOUT_MS);
    let res;
    // Redirects followed by hand: at most IMPORT_REDIRECTS_MAX, each to https again.
    for (let hop = 0; ; hop += 1) {
      try {
        res = await this.fetchFn(url, { redirect: 'manual', headers: { Accept: 'image/*,application/pdf' }, signal });
      } catch {
        return fail('That link did not answer.', 502, { reason: 'unreachable' });
      }
      const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!location) break;
      try { await res.body?.cancel(); } catch { /* nothing to drop */ }
      if (hop >= IMPORT_REDIRECTS_MAX) return fail('That link sends you on too many times. Use the link to the file itself, or upload it.', 502, { reason: 'redirects' });
      let next;
      try { next = new URL(location, url); } catch { return fail('That link sends you somewhere unreadable.', 502, { reason: 'redirects' }); }
      if (next.protocol !== 'https:' || next.username || next.password) return fail('That link sends you to a page that is not https.', 502, { reason: 'redirects' });
      url = next.href;
    }
    if (!res.ok) return fail(`That link answered ${res.status}.`, 502, { reason: 'status' });
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > max) return fail('That file is too big (20 MB at most).', 413, { reason: 'too-big' });
    let bytes;
    try { bytes = await readLimited(res, max); } catch { return fail('That link stopped answering.', 502, { reason: 'unreachable' }); }
    if (!bytes) return fail('That file is too big (20 MB at most).', 413, { reason: 'too-big' });
    const file = await this.storeBytes(bytes, oneLine(name, 80) || oneLine(new URL(url).pathname.split('/').pop(), 80));
    if (!file) return fail('That link is not a picture or a PDF (a web page, perhaps). Use the link to the file itself, or upload it.', 400, { reason: 'type' });
    return json({ ok: true, ...file });
  }

  /**
   * Stores whole bytes as a finished file (a copied link, Cast's converted PowerPoint).
   * Null when they are not a picture or a PDF (or too big).
   * @param {Uint8Array} bytes @param {string} name
   */
  async storeBytes(bytes, name) {
    const type = sniffType(bytes);
    if (!type || bytes.length > CLASSROOM_FILE_MAX_BYTES) return null;
    const meta = { id: newId('f', 16), type, bytes: bytes.length, parts: partsFor(bytes.length), next: partsFor(bytes.length), name: oneLine(name, 80), done: false, at: this.now() };
    for (let n = 0; n < meta.parts; n += 1) {
      await this.storage.put(`${this.room.partPrefix}${meta.id}:${n}`, bytes.slice(n * CLASSROOM_FILE_PART_BYTES, (n + 1) * CLASSROOM_FILE_PART_BYTES));
    }
    await this.storage.put(this.room.filePrefix + meta.id, { ...meta, done: true });
    return { id: meta.id, type, bytes: meta.bytes, kind: kindOfType(type), name: meta.name };
  }

  /** GET /v1/classroom/files/:id: the file, part by part (never all in memory at once). @param {string} id */
  async readFile(id) {
    const meta = isFileId(id) ? await this.storage.get(this.room.filePrefix + id) : null;
    if (!meta?.done) return fail('There is no such file.', 404);
    const storage = this.storage;
    const partPrefix = this.room.partPrefix;
    let n = 0;
    const body = new ReadableStream({
      async pull(controller) {
        if (n >= meta.parts) { controller.close(); return; }
        const part = await storage.get(`${partPrefix}${id}:${n}`);
        n += 1;
        if (!part) { controller.error(new Error('missing part')); return; }
        controller.enqueue(new Uint8Array(part));
      },
    });
    return new Response(body, { headers: { 'Content-Type': meta.type, 'Content-Length': String(meta.bytes), 'Cache-Control': 'private, max-age=86400, immutable' } });
  }

  /** The stage, from memory after the first read. */
  async stage() {
    if (!this.stageCache) this.stageCache = sanitizeStage(await this.storage.get(this.room.stageKey));
    return this.stageCache;
  }

  /** @param {any} next */
  async saveStage(next) {
    const clean = sanitizeStage({ ...next, rev: (await this.stage()).rev + 1 });
    this.stageCache = clean;
    await this.storage.put(this.room.stageKey, clean);
    this.ring({ what: this.room.what, rev: clean.rev });
    return clean;
  }

  /**
   * POST /v1/classroom/remote {action, data?}: one press from a remote (or a
   * /settings preview). The stage changes and the doorbell rings.
   * @param {string} who @param {any} body
   */
  async press(who, body) {
    const p = sanitizeClassroomPress(body?.action, body?.data);
    if (!p) return fail('That is not something the Sparks remote can ask.', 400);
    const t = this.now();
    const taken = takeToken(this.buckets.get(who), t);
    this.buckets.delete(who);
    this.buckets.set(who, taken.bucket);
    while (this.buckets.size > 64) this.buckets.delete(/** @type {string} */ (this.buckets.keys().next().value));
    if (!taken.ok) return fail('Too many presses at once. Wait a moment.', 429, { retryAfterMs: taken.retryMs });
    const stage = await this.stage();
    const cmds = stage.cmds.filter((c) => t - c.at <= CLASSROOM_CMD_TTL_MS);
    const cmd = (action, data) => {
      this.seq += 1;
      return [...cmds, { id: `c${t.toString(36)}${this.seq.toString(36)}`, action, ...(data ? { data } : {}), at: t }].slice(-CLASSROOM_CMDS_MAX);
    };
    let next;
    switch (p.action) {
      case 'show': {
        const { buttons } = await this.buttonsDoc();
        const video = buttons.videos.find((v) => v.id === p.data?.button);
        const item = buttons.items.find((v) => v.id === p.data?.button);
        if (!video && !item) return fail('That button is gone. The list has been reloaded.', 404, { reason: 'no-button' });
        // One thing up at a time: a button takes a held look (the Sparks screen) down.
        next = { ...stage, show: { button: video ? { ...video, kind: 'video' } : item, at: t, page: 1 }, preview: stage.preview?.held ? null : stage.preview, cmds, black: false };
        this.rtc = null;
        break;
      }
      // Cast (cast.js): an item put up directly; its file must be a finished file of this room.
      case 'item': {
        const item = /** @type {any} */ (p.data?.item);
        if (item.file) {
          const meta = await this.storage.get(this.room.filePrefix + item.file);
          if (!meta?.done) return fail('That picture or PDF is still uploading, or was removed. Add it again.', 400, { reason: 'file-missing' });
        }
        next = { ...stage, show: { button: { ...item, id: newId('b', 10) }, at: t, page: 1 }, preview: stage.preview?.held ? null : stage.preview, cmds, black: false };
        this.rtc = null;
        break;
      }
      // A screen share starting: the screen button goes up; its offer follows (putSignal).
      case 'screen': {
        const id = newId('b', 10);
        this.rtc = { id, offer: null, answer: null, at: t, by: who };
        next = { ...stage, show: { button: { id, kind: 'screen', title: p.data?.title || 'Shared screen' }, at: t, page: 1 }, preview: stage.preview?.held ? null : stage.preview, cmds, black: false };
        break;
      }
      // Back to the schedule: whatever the remote put up goes, a held look too.
      case 'back': next = { ...stage, show: null, preview: stage.preview?.held ? null : stage.preview, cmds, black: false }; this.rtc = null; break;
      // Cast's Black button (owner 2026-11-11): the TV goes black over whatever is up, or
      // shows it again. What is up, its page and a screen share all stay as they are; a new
      // thing going up or Back (above) clears it. Not in the classroom room.
      case 'black': {
        if (!this.room.cast) return fail('That is not something the Sparks remote can ask.', 400);
        const on = p.data?.on === true;
        if (Boolean(stage.black) === on) return json({ ok: true, already: true, rev: stage.rev, screenOnline: this.screenOnline() });
        next = { ...stage, black: on, cmds };
        break;
      }
      case 'video':
        if (!CLASSROOM_PLAYABLE_KINDS.includes(stage.show?.button?.kind)) return fail('No video is on the screen.', 409, { reason: 'no-video' });
        next = { ...stage, cmds: cmd('video', p.data) };
        break;
      case 'page': {
        if (stage.show?.button?.kind !== 'pdf') return fail('No PDF is on the screen.', 409, { reason: 'no-pdf' });
        const pages = this.report?.button === stage.show.button.id && this.report.pages ? this.report.pages : 9999;
        const want = Number.isInteger(p.data?.to) ? p.data.to : stage.show.page + (p.data?.step || 0);
        const page = Math.min(Math.max(1, want), pages);
        if (page === stage.show.page) return json({ ok: true, already: true, rev: stage.rev });
        next = { ...stage, show: { ...stage.show, page }, cmds };
        break;
      }
      // A /settings preview (one minute), or the remote's held look (until Back): it
      // replaces whatever button was up.
      case 'preview': next = p.data?.hold
        ? { ...stage, show: null, preview: { look: p.data.look, until: t + CLASSROOM_HOLD_MS, held: true }, cmds }
        : { ...stage, preview: { look: p.data?.look, until: t + CLASSROOM_PREVIEW_MS }, cmds };
        this.watchAt = t; break;
      case 'preview-end': next = { ...stage, preview: null, cmds }; break;
      case 'sparky': next = { ...stage, cmds: cmd('sparky') }; break;
      default: return fail('That is not something the Sparks remote can ask.', 400);
    }
    const saved = await this.saveStage(next);
    const shown = saved.show?.button;
    return json({ ok: true, rev: saved.rev, screenOnline: this.screenOnline(), ...(p.action === 'screen' || p.action === 'item' ? { button: shown?.id } : {}) });
  }

  /**
   * A screen share's offer (the presenter) or answer (the TV): {signal}. Only for
   * the share now up; an answer only after its offer. The doorbell rings so the
   * other side reads it at once (memory only, never stored).
   * @param {any} body
   */
  async putSignal(body) {
    const sig = sanitizeSignal(body?.signal);
    if (!sig) return fail('That screen share message is not readable.', 400);
    const t = this.now();
    if (!this.rtc || this.rtc.id !== sig.id || t - this.rtc.at > SIGNAL_TTL_MS + 60 * 60 * 1000) return fail('That screen share has ended.', 409, { reason: 'ended' });
    if (sig.type === 'offer') this.rtc = { id: sig.id, offer: sig, answer: null, at: t, by: this.rtc.by };
    else if (!this.rtc.offer) return fail('There is no offer to answer.', 409, { reason: 'no-offer' });
    else this.rtc = { ...this.rtc, answer: sig };
    this.ring({ what: this.room.what, rtc: sig.type, rev: (await this.stage()).rev });
    return json({ ok: true });
  }

  /** GET the share's offer (the TV) or answer (the presenter): {signal | null}. @param {'offer'|'answer'} type @param {string | null} id */
  readSignal(type, id) {
    const r = this.rtc;
    const fresh = r && (!id || r.id === id) && this.now() - r.at <= SIGNAL_TTL_MS;
    return json({ signal: fresh ? r[type] : null, id: r?.id || null });
  }

  screenOnline() { return this.screenAt > 0 && this.now() - this.screenAt <= CLASSROOM_ONLINE_MS; }

  /** GET /v1/classroom/stage (the TV, and KVBC Awana's display): the stage, and whether to report. @param {boolean} [screen] */
  async readStage(screen = true) {
    const t = this.now();
    if (screen) this.screenAt = t;
    const stage = await this.stage();
    const live = { ...stage, preview: stage.preview && stage.preview.until > t ? stage.preview : null, cmds: stage.cmds.filter((c) => t - c.at <= CLASSROOM_CMD_TTL_MS) };
    return json({ stage: live, watch: this.watching(), serverNow: t });
  }

  /** POST /v1/classroom/now {now}: the TV says what it shows (memory only). @param {any} body */
  async putNow(body) {
    const now = sanitizeClassroomNow(body?.now);
    if (!now) return fail('That report is not readable.', 400);
    this.screenAt = this.now();
    this.report = now;
    this.reportAt = this.screenAt;
    return json({ ok: true, watch: this.watching() });
  }

  /** GET /v1/classroom/remote/state: the list, the stage and the TV's report; reading it is watching. */
  async remoteState() {
    const t = this.now();
    const was = this.watching();
    this.watchAt = t;
    if (!was) this.ring({ what: this.room.what, rev: (await this.stage()).rev, watch: true });
    const doc = await this.buttonsDoc();
    const stage = await this.stage();
    return json({
      buttons: doc.buttons, rev: doc.rev, savedAt: doc.savedAt,
      stage: { ...stage, preview: stage.preview && stage.preview.until > t ? stage.preview : null, cmds: [] },
      now: this.report && t - this.reportAt <= CLASSROOM_ONLINE_MS ? { ...this.report, at: new Date(this.reportAt).toISOString() } : null,
      screenOnline: this.screenOnline(),
      serverNow: t,
      watchMs: CLASSROOM_WATCH_MS,
    });
  }
}

/**
 * The routes (src/routes.md 10.13), all behind a session.
 * @param {import('./registry.js').Registry} registry
 * @param {any} core
 */
export function mountClassroom(registry, core) {
  const c = () => /** @type {Classroom} */ (core.classroom);
  registry.add('GET', '/v1/classroom/buttons', 'session', async () => { const d = await c().buttonsDoc(); return json(d); });
  registry.add('PUT', '/v1/classroom/buttons', 'session', async ({ body }) => c().putButtons(await body()));
  registry.add('POST', '/v1/classroom/files', 'session', async ({ body }) => c().startFile(await body()));
  registry.add('PUT', '/v1/classroom/files/:id/:n', 'session', async ({ params, request }) => c().putPart(params.id, params.n, request));
  registry.add('POST', '/v1/classroom/files/:id/done', 'session', async ({ params }) => c().finishFile(params.id));
  registry.add('GET', '/v1/classroom/files/:id', 'session', async ({ params }) => c().readFile(params.id));
  registry.add('POST', '/v1/classroom/remote', 'session', async ({ request, body }) => c().press(sessionKeyOf(request), await body()));
  registry.add('GET', '/v1/classroom/remote/state', 'session', async () => c().remoteState());
  registry.add('GET', '/v1/classroom/stage', 'session', async ({ url }) => c().readStage(url.searchParams.get('from') !== 'app'));
  registry.add('POST', '/v1/classroom/now', 'session', async ({ body }) => c().putNow(await body()));
  // A screen share (owner 2026-11-08): the remote's offer, the TV's answer; each reads the other's.
  registry.add('POST', '/v1/classroom/signal', 'session', async ({ body }) => c().putSignal(await body()));
  registry.add('GET', '/v1/classroom/signal', 'session', async ({ url }) => c().readSignal(url.searchParams.get('type') === 'answer' ? 'answer' : 'offer', url.searchParams.get('id')));
}
