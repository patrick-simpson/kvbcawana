// Cast: a PowerPoint into slides (owner 2026-11-08: "Support pptx upload and show a
// preview on the phone screen", the exact copy, ~1 min). Run by
// .github/workflows/cast-convert.yml, which the sync Worker starts for a presenter
// (worker/src/cast.js, routes.md 10.18) with ONE input, JOB = `<id>.<key>`.
//
// 1. Reads the scrambled upload from the Worker with the machine token
//    (PRINT_FETCH_TOKEN = the HANDBOOK_TOKEN secret, the print job's).
// 2. Opens it (AES-256-GCM: 12-byte IV + ciphertext, the key from JOB).
// 3. LibreOffice Impress turns it into a PDF (pictures kept at most IMAGE_DPI, so a
//    photo-heavy deck stays under the room's 20 MB; a second, smaller try if not).
// 4. Sends the PDF back (PUT .../result): it becomes a file of the Cast room and the
//    presenter's page puts it up. Any failure is reported (POST .../failed {reason}),
//    so the page says why instead of waiting.
//
// SPEAKER NOTES (owner 2026-11-15: "The converter would pull the notes out alongside the
// slides, and they'd show only on the presenter's phone"): from a .pptx only (a .ppt or
// .odp has none here), read straight from the file (a zip: ppt/presentation.xml's slide
// order, each slide's rels to its notesSlide, the notes placeholder's text; hidden slides
// left out, as LibreOffice's PDF leaves them out) with a small zip reader and Node's own
// zlib, no package. They stay as private as the file: sealed with the SAME per-job key
// (AES-256-GCM, a fresh IV) and sent BEFORE the PDF (PUT .../notes), so they are there
// the moment the slides are; only the presenter's page, which holds the key, opens them.
// A deck with no notes sends none. Notes never fail the job.
//
// No package: Node's own fetch, WebCrypto, zlib and child_process. The log names sizes and
// status codes only: never the file's name or anything in it. The working folder is
// deleted whatever happens.

import { execFile } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const PDF_MAX = 20 * 1024 * 1024;
export const IMAGE_DPI = [220, 110];
export const CONVERT_TIMEOUT_MS = 5 * 60 * 1000;
const JOB_RE = /^(c[a-z0-9]{16})\.([A-Za-z0-9_-]{43})$/;

class Failure extends Error {
  /** @param {string} reason one of the Worker's CONVERT_FAILS @param {string} message */
  constructor(reason, message) { super(message); this.reason = reason; }
}

const log = (/** @type {string} */ s) => console.log(s);

/** JOB = `<id>.<key>`. @param {unknown} v */
export function parseJob(v) {
  const m = JOB_RE.exec(String(v || '').trim());
  if (!m) throw new Failure('key', 'JOB is not a conversion id and key.');
  return { id: m[1], key: m[2] };
}

/** The Worker's conversion routes under SITE_ORIGIN's /api. @param {Record<string, string | undefined>} env @param {string} id */
export function jobBase(env, id) {
  const origin = String(env.SITE_ORIGIN || 'https://awana.kvbchurch.org').replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/?#]+$/.test(origin)) throw new Error('SITE_ORIGIN is not an origin.');
  return `${origin}/api/v1/cast/convert/${id}`;
}

/** Open the browser's scrambling. @param {Uint8Array} raw @param {string} key */
export async function openUpload(raw, key) {
  if (raw.length < 29) throw new Failure('type', 'The upload is empty.');
  const k = await crypto.subtle.importKey('raw', Buffer.from(key, 'base64url'), 'AES-GCM', false, ['decrypt']);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12) }, k, raw.subarray(12)));
  } catch {
    throw new Failure('key', 'The upload could not be opened with its key.');
  }
}

/**
 * What the file is, from its first bytes: 'pptx' (a zip: .pptx, .odp), 'ppt' (the
 * old binary format), or '' (not a presentation LibreOffice should be handed).
 * @param {Uint8Array} b
 */
export function presentationKind(b) {
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) {
    // A zip. An .odp says so in its mimetype file (stored plain, so it can be read here). A PowerPoint's
    // [Content_Types].xml is compressed, so its type cannot be read cheaply: any other zip goes to
    // LibreOffice, which refuses what is not a presentation (reported as a 'convert' failure).
    const head = Buffer.from(b.subarray(0, Math.min(b.length, 64 * 1024))).toString('latin1');
    if (head.includes('application/vnd.oasis.opendocument.presentation')) return 'odp';
    return 'pptx';
  }
  if (b.length >= 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0 && b[4] === 0xa1 && b[5] === 0xb1 && b[6] === 0x1a && b[7] === 0xe1) return 'ppt';
  return '';
}

/* ── Speaker notes, from the .pptx itself ── */

/** One slide's notes, at most this many characters; this many slides at most. */
export const NOTE_MAX = 4000;
export const NOTES_SLIDES_MAX = 500;
/** The sealed notes, at most (the Worker's CAST_NOTES_MAX_BYTES, shared/classroomRemote.js). */
export const NOTES_MAX_BYTES = 256 * 1024;
/** An XML part of the zip is never inflated past this (a zip bomb stops here). */
const XML_PART_MAX = 8 * 1024 * 1024;

/**
 * The zip's entries by name: { method, size, csize, offset }. Only what a .pptx needs (no
 * zip64, no encryption); null when it is not a zip that can be read.
 * @param {Uint8Array} b
 */
export function zipEntries(b) {
  const buf = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  /** @type {Map<string, { method: number, size: number, csize: number, offset: number }>} */
  const out = new Map();
  for (let n = 0; n < count; n += 1) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(at + 10);
    const csize = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const offset = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString('utf8');
    out.set(name, { method, size, csize, offset });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** One entry's text (stored or deflated), or null. @param {Uint8Array} b @param {ReturnType<typeof zipEntries>} entries @param {string} name */
function zipText(b, entries, name) {
  const e = entries && entries.get(name);
  if (!e || e.size > XML_PART_MAX) return null;
  const buf = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  if (e.offset + 30 > buf.length || buf.readUInt32LE(e.offset) !== 0x04034b50) return null;
  const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
  const data = buf.subarray(start, start + e.csize);
  try {
    if (e.method === 0) return data.toString('utf8');
    if (e.method === 8) return inflateRawSync(data, { maxOutputLength: XML_PART_MAX }).toString('utf8');
  } catch { /* damaged */ }
  return null;
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
/** XML text to plain text. @param {string} s */
function unescapeXml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return XML_ENTITIES[/** @type {keyof typeof XML_ENTITIES} */ (e.toLowerCase())] || '';
  });
}

/** A relationships part: Id -> { type, target } (target resolved against `dir`). @param {string | null} xml @param {string} dir */
function rels(xml, dir) {
  /** @type {Map<string, { type: string, target: string }>} */
  const out = new Map();
  for (const m of String(xml || '').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]*)"/.exec(m[0])?.[1];
    const type = /\bType="([^"]*)"/.exec(m[0])?.[1] || '';
    const target = /\bTarget="([^"]*)"/.exec(m[0])?.[1];
    if (!id || !target || /\bTargetMode="External"/.test(m[0])) continue;
    const parts = (target.startsWith('/') ? target.slice(1) : `${dir}/${target}`).split('/');
    const path = [];
    for (const p of parts) { if (p === '..') path.pop(); else if (p && p !== '.') path.push(p); }
    out.set(id, { type, target: path.join('/') });
  }
  return out;
}

/** The text a notes slide carries in its notes placeholder (paragraphs on their own lines). @param {string} xml */
export function notesText(xml) {
  const lines = [];
  for (const sp of String(xml).matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)) {
    // The notes are the body placeholder (the slide picture and number are others).
    if (!/<p:ph\b[^>]*\btype="body"/.test(sp[0])) continue;
    for (const para of sp[0].matchAll(/<a:p\b[^>]*?(?:\/>|>[\s\S]*?<\/a:p>)/g)) {
      let line = '';
      for (const piece of para[0].matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<a:t\s*\/>|<a:br\b[^>]*\/>/g)) {
        if (piece[0].startsWith('<a:br')) line += '\n';
        else line += unescapeXml(piece[1] || '');
      }
      lines.push(line);
    }
  }
  return lines.join('\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, NOTE_MAX);
}

/**
 * A .pptx's speaker notes, one string per slide the PDF will have (hidden slides left out,
 * '' for a slide with none), or null when the file cannot be read as a PowerPoint.
 * @param {Uint8Array} bytes
 */
export function notesFromPptx(bytes) {
  const entries = zipEntries(bytes);
  if (!entries) return null;
  const pres = zipText(bytes, entries, 'ppt/presentation.xml');
  if (!pres) return null;
  const presRels = rels(zipText(bytes, entries, 'ppt/_rels/presentation.xml.rels'), 'ppt');
  const list = /<p:sldIdLst\b[^>]*>([\s\S]*?)<\/p:sldIdLst>/.exec(pres)?.[1] || '';
  const notes = [];
  for (const m of list.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)) {
    if (notes.length >= NOTES_SLIDES_MAX) break;
    const slide = presRels.get(m[1])?.target;
    if (!slide) continue;
    const slideXml = zipText(bytes, entries, slide) || '';
    // A hidden slide is not in LibreOffice's PDF: no page, so no notes either.
    if (/<p:sld\b[^>]*\bshow="(0|false)"/.test(slideXml)) continue;
    const dir = slide.slice(0, slide.lastIndexOf('/'));
    const name = slide.slice(slide.lastIndexOf('/') + 1);
    const slideRels = rels(zipText(bytes, entries, `${dir}/_rels/${name}.rels`), dir);
    const notesPart = [...slideRels.values()].find((r) => r.type.endsWith('/notesSlide'))?.target;
    const xml = notesPart ? zipText(bytes, entries, notesPart) : null;
    notes.push(xml ? notesText(xml) : '');
  }
  return notes;
}

/**
 * The notes sealed with the job's own key: 12-byte IV + AES-256-GCM of
 * `{"v":1,"notes":[...]}`. Null when there is nothing to send (no notes at all), or it
 * would not fit NOTES_MAX_BYTES even with each note cut shorter.
 * @param {string[] | null} notes @param {string} key
 */
export async function sealNotes(notes, key) {
  if (!Array.isArray(notes) || !notes.some((n) => n)) return null;
  const k = await crypto.subtle.importKey('raw', Buffer.from(key, 'base64url'), 'AES-GCM', false, ['encrypt']);
  for (const max of [NOTE_MAX, 1500, 500]) {
    const plain = new TextEncoder().encode(JSON.stringify({ v: 1, notes: notes.map((n) => n.slice(0, max)) }));
    if (plain.length + 28 > NOTES_MAX_BYTES) continue;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, plain));
    const out = new Uint8Array(12 + ct.length);
    out.set(iv);
    out.set(ct, 12);
    return out;
  }
  return null;
}

/** LibreOffice's PDF export, pictures at most dpi. @param {number} dpi */
export function exportFilter(dpi) {
  const opts = {
    ReduceImageResolution: { type: 'boolean', value: 'true' },
    MaxImageResolution: { type: 'long', value: String(dpi) },
    Quality: { type: 'long', value: dpi >= 200 ? '90' : '75' },
    ExportNotesPages: { type: 'boolean', value: 'false' },
  };
  return `pdf:impress_pdf_Export:${JSON.stringify(opts)}`;
}

/**
 * The ONLY environment LibreOffice gets: what it needs to find itself, its
 * fonts, a locale and a temp folder. Never the job's secrets (PRINT_FETCH_TOKEN
 * and whatever else the workflow sets): a hostile presentation runs inside
 * LibreOffice, so nothing it could read is handed to it.
 * @param {Record<string, string | undefined>} [from]
 */
export function sofficeEnv(from = process.env) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const k of SOFFICE_ENV_KEYS) if (typeof from[k] === 'string') env[k] = /** @type {string} */ (from[k]);
  return env;
}
const SOFFICE_ENV_KEYS = ['PATH', 'HOME', 'LANG', 'LANGUAGE', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TMP', 'TEMP',
  'FONTCONFIG_FILE', 'FONTCONFIG_PATH', 'SAL_USE_VCLPLUGIN', 'SystemRoot', 'windir'];

/**
 * LibreOffice: the presentation in `dir/in.<ext>` to a PDF; its bytes.
 * @param {string} dir @param {string} file @param {number} dpi
 */
export function soffice(dir, file, dpi) {
  return new Promise((resolve, reject) => {
    execFile('soffice', [
      '--headless', '--norestore', '--nolockcheck', `-env:UserInstallation=file://${join(dir, 'profile')}`,
      '--convert-to', exportFilter(dpi), '--outdir', join(dir, 'out'), file,
    ], { timeout: CONVERT_TIMEOUT_MS, maxBuffer: 1024 * 1024, env: sofficeEnv() }, async (err) => {
      if (err) { reject(new Failure('convert', `LibreOffice stopped (${err.killed ? 'took too long' : `exit ${err.code}`}).`)); return; }
      try {
        const out = (await readdir(join(dir, 'out'))).find((f) => f.endsWith('.pdf'));
        if (!out) throw new Error('no pdf');
        resolve(new Uint8Array(await readFile(join(dir, 'out', out))));
      } catch {
        reject(new Failure('convert', 'LibreOffice made no PDF (the file may be damaged).'));
      }
    });
  });
}

/**
 * The presentation's bytes to a PDF of PDF_MAX at most (a smaller try when the first is too big).
 * @param {Uint8Array} bytes @param {{ convert?: typeof soffice }} [deps]
 */
export async function toPdf(bytes, deps = {}) {
  const kind = presentationKind(bytes);
  if (!kind) throw new Failure('type', 'That file is not a PowerPoint.');
  const dir = await mkdtemp(join(tmpdir(), 'cast-'));
  try {
    const file = join(dir, `in.${kind}`);
    await writeFile(file, bytes);
    for (const dpi of IMAGE_DPI) {
      const pdf = await (deps.convert || soffice)(dir, file, dpi);
      log(`PDF at ${dpi} dpi: ${pdf.length} bytes.`);
      if (String.fromCharCode(...pdf.subarray(0, 5)) !== '%PDF-') throw new Failure('convert', 'LibreOffice made something that is not a PDF.');
      if (pdf.length <= PDF_MAX) return pdf;
    }
    throw new Failure('too-big', 'The slides are over 20 MB even with smaller pictures.');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * The whole job. Answers what happened ('done' | 'failed:<reason>').
 * @param {Record<string, string | undefined>} env
 * @param {{ get?: typeof fetch, convert?: typeof soffice }} [deps]
 */
export async function run(env, deps = {}) {
  const get = deps.get || fetch;
  const token = String(env.PRINT_FETCH_TOKEN || '');
  if (!token) throw new Error('PRINT_FETCH_TOKEN is needed (the HANDBOOK_TOKEN secret).');
  const auth = { Authorization: `Bearer ${token}` };
  let job;
  try { job = parseJob(env.JOB); } catch (e) { log(`::error::${/** @type {Error} */ (e).message}`); return 'failed:key'; }
  const base = jobBase(env, job.id);
  try {
    const res = await get(`${base}/job`, { headers: auth, cache: 'no-store' });
    if (res.status === 404) throw new Error('The upload is gone (made already, or the room was closed).');
    if (!res.ok) throw new Error(`Could not read the upload (HTTP ${res.status}).`);
    const raw = new Uint8Array(await res.arrayBuffer());
    log(`Upload: ${raw.length} bytes.`);
    const file = await openUpload(raw, job.key);
    // The speaker notes first (a .pptx only), so they are there the moment the slides are.
    // Optional: whatever goes wrong here, the slides still go up.
    if (presentationKind(file) === 'pptx') {
      try {
        const notes = notesFromPptx(file);
        const sealed = await sealNotes(notes, job.key);
        log(`Notes: ${notes ? notes.filter(Boolean).length : 0} of ${notes ? notes.length : 0} slides${sealed ? `, ${sealed.length} bytes sealed` : ', none sent'}.`);
        if (sealed) {
          const r = await get(`${base}/notes`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/octet-stream' }, body: sealed });
          log(`Sent the notes: HTTP ${r.status}.`);
        }
      } catch {
        log('The notes could not be read; the slides go up without them.');
      }
    }
    const pdf = await toPdf(file, deps);
    const put = await get(`${base}/result`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/pdf' }, body: pdf });
    log(`Sent the slides back: HTTP ${put.status}.`);
    if (!put.ok) throw new Failure('convert', `The sync service did not take the PDF (HTTP ${put.status}).`);
    return 'done';
  } catch (e) {
    const err = /** @type {any} */ (e);
    const reason = err instanceof Failure ? err.reason : 'convert';
    log(`::error::The slides were NOT made. ${err.message || err}`);
    try {
      const r = await get(`${base}/failed`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) });
      log(`Told the sync service (${reason}): HTTP ${r.status}.`);
    } catch {
      log('Could not tell the sync service; the page stops waiting after a few minutes.');
    }
    return `failed:${reason}`;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = await run(process.env).catch((e) => { console.log(`::error::${e.message || e}`); return 'failed'; });
  if (out !== 'done') process.exitCode = 1;
}
