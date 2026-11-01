// Send the congregation deck to the sync Worker, SEALED (owner 2026-11-01:
// "Always the latest", "Sealed"; worker/src/routes.md 10.14, CLAUDE.md
// "Presentation"). Run by AwanaReports' weekly refresh-data.yml after it
// rebuilds deck/index.html:
//
//   node scripts/presentation/publish-deck.mjs <path to deck/index.html>
//
// It asks the Worker for history:pub (GET /v1/presentation/key), seals the
// deck to it with shared/cloud-crypto.js sealDocument (ECIES, its own doc1:
// suite, padded to the next 64 KiB), and uploads the ciphertext in parts
// (POST /v1/presentation/deck, PUT .../<rev>/<n>, POST .../<rev>/done). The
// job can seal but never open: only the passphrase unwraps the private key,
// in the browser at awana.kvbchurch.org/presentation/.
//
// Env: SYNC_URL (default https://awana.kvbchurch.org/api), PRESENTATION_TOKEN.
// Logs only sizes and status codes, never the deck.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bytesToBase64Url, randomBytes, sealDocument } from '../../shared/cloud-crypto.js';

export const DEFAULT_SYNC_URL = 'https://awana.kvbchurch.org/api';
const RETRIES = 3;

/** Today in Eastern time, YYYY-MM-DD. @param {Date} [d] */
export function easternDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/**
 * Seal and upload one deck. Throws with a plain reason on failure.
 * @param {{ html: string, base?: string, token: string, fetchFn?: typeof fetch, now?: Date, log?: (s: string) => void }} opts
 * @returns {Promise<{ rev: number, parts: number, chars: number }>}
 */
export async function publishDeck({ html, base = DEFAULT_SYNC_URL, token, fetchFn = fetch, now = new Date(), log = () => {} }) {
  if (typeof html !== 'string' || !/<html[\s>]/i.test(html)) throw new Error('That is not a deck (no <html>).');
  if (!token) throw new Error('PRESENTATION_TOKEN is not set.');
  const root = base.replace(/\/+$/, '');
  /** @param {string} path @param {RequestInit & { json?: unknown }} [o] */
  const call = async (path, o = {}) => {
    const headers = { Authorization: `Bearer ${token}`, ...(o.json !== undefined ? { 'Content-Type': 'application/json' } : { 'Content-Type': 'text/plain' }) };
    let last = null;
    for (let i = 0; i < RETRIES; i += 1) {
      try {
        const res = await fetchFn(root + path, { method: o.method || 'GET', headers, body: o.json !== undefined ? JSON.stringify(o.json) : o.body });
        let body = null;
        try { body = await res.json(); } catch { /* not JSON */ }
        if (res.status >= 500 && i < RETRIES - 1) { last = `${res.status}`; continue; }
        return { status: res.status, body };
      } catch (err) {
        last = /** @type {Error} */ (err).message;
      }
    }
    throw new Error(`Could not reach the sync service (${last}).`);
  };

  const key = await call('/v1/presentation/key');
  log(`key: ${key.status}`);
  if (key.status === 503) throw new Error('The Worker has no PRESENTATION_TOKEN secret yet.');
  if (key.status !== 200 || !key.body?.pub) throw new Error(`No history key from the Worker (${key.status} ${key.body?.reason || ''}).`);

  const builtAt = now.toISOString();
  const doc = { id: bytesToBase64Url(randomBytes(16)), night: easternDate(now), kind: 'deck', record: { html, builtAt } };
  const wire = await sealDocument(key.body.pub, doc);
  if (!wire) throw new Error('The deck could not be sealed (too big?).');
  const chars = wire.ct.length;
  log(`sealed: ${chars} characters`);

  const start = await call('/v1/presentation/deck', { method: 'POST', json: { v: wire.v, id: doc.id, night: doc.night, kind: doc.kind, kid: wire.kid, epk: wire.epk, iv: wire.iv, chars, builtAt } });
  log(`start: ${start.status}`);
  if (start.status !== 200) throw new Error(`The Worker refused the deck (${start.status} ${start.body?.reason || ''}).`);
  const { rev, parts, partChars } = start.body;
  for (let n = 0; n < parts; n += 1) {
    const r = await call(`/v1/presentation/deck/${rev}/${n}`, { method: 'PUT', body: wire.ct.slice(n * partChars, (n + 1) * partChars) });
    if (r.status !== 200) throw new Error(`Part ${n + 1} of ${parts} was refused (${r.status} ${r.body?.reason || ''}).`);
  }
  const done = await call(`/v1/presentation/deck/${rev}/done`, { method: 'POST', json: {} });
  log(`done: ${done.status}`);
  if (done.status !== 200) throw new Error(`The Worker did not take the deck (${done.status} ${done.body?.reason || ''}).`);
  return { rev, parts, chars };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = process.argv[2];
  if (!file) { console.error('Usage: node publish-deck.mjs <deck/index.html>'); process.exit(2); }
  publishDeck({
    html: readFileSync(file, 'utf8'),
    base: process.env.SYNC_URL || DEFAULT_SYNC_URL,
    token: process.env.PRESENTATION_TOKEN || '',
    log: (s) => console.log(s),
  }).then(
    (r) => console.log(`The deck is up: version ${r.rev}, ${r.parts} parts.`),
    (err) => { console.error(`::error::${err.message}`); process.exit(1); },
  );
}
