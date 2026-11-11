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
// No package: Node's own fetch, WebCrypto and child_process. The log names sizes and
// status codes only: never the file's name or anything in it. The working folder is
// deleted whatever happens.

import { execFile } from 'node:child_process';
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
    const pdf = await toPdf(await openUpload(raw, job.key), deps);
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
