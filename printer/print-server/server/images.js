'use strict';
// Temp files, the club image a job may carry.
// One of the modules server.js was split into (server.js loads them in the order the old
// file ran them). Another module's names are reached as $module.name.

const { CLUB_TABLE, clubKeyByLabel } = require('../clubTable');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');

// What other modules (and server.js) read from this one; live bindings, so cycles are safe.
Object.defineProperties(exports, {
  CLUB_MONOGRAM: { enumerable: true, get: () => CLUB_MONOGRAM },
  resolveImageBuffer: { enumerable: true, get: () => resolveImageBuffer },
  sweepOrphanedTempFiles: { enumerable: true, get: () => sweepOrphanedTempFiles },
  tmpFilePath: { enumerable: true, get: () => tmpFilePath },
});

// ── Unique temp file path ─────────────────────────────────────────────────────
// Date.now() alone can collide when two prints land in the same millisecond
// (double-tap on the check-in screen) — one request would then delete the
// other's file mid-print. A random suffix makes names collision-proof.
function tmpFilePath(prefix, ext) {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
}

// ── Orphaned temp file sweep ──────────────────────────────────────────────────
// If a previous run crashed between writing a temp PNG/PS1 and unlinking it,
// the file stays behind forever. Sweep anything matching our prefixes that is
// older than an hour (never touches files a live request might still need).
// Runs once at startup; never throws.
function sweepOrphanedTempFiles() {
  try {
    const dir = os.tmpdir();
    const cutoff = Date.now() - 3600000;
    let removed = 0;
    for (const f of fs.readdirSync(dir)) {
      if (!/^awana-(print-)?\d+.*\.(png|ps1)$/.test(f)) continue;
      const full = path.join(dir, f);
      try {
        if (fs.statSync(full).mtimeMs < cutoff) { fs.unlinkSync(full); removed++; }
      } catch { /* vanished or locked — skip */ }
    }
    if (removed) console.log(`[cleanup] Removed ${removed} orphaned temp file(s) from previous runs`);
  } catch { /* tmpdir unreadable — non-critical */ }
}

// ── Resolve clubImageData → Buffer (or null) ──────────────────────────────────
// Only an inline image (data:image/...;base64,...) is ever used (10.14.0). Until then
// any http(s) URL in a job body was fetched from the check-in laptop, which let whoever
// could put a job in front of it make the laptop call any address on the church network
// (SSRF). Nothing sends a URL today: the Worker's jobs carry no club image, and the six
// known clubs always print the kit's official mark (label-render.js), so a URL is simply
// ignored and the label prints with its mark or monogram.
const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const DATA_IMAGE_RE = /^data:image\/(png|jpeg|jpg|gif|webp|bmp);base64,/i;
async function resolveImageBuffer(clubImageData) {
  if (!clubImageData || typeof clubImageData !== 'string') return null;
  try {
    const m = clubImageData.match(DATA_IMAGE_RE);
    if (!m) {
      if (/^https?:\/\//i.test(clubImageData)) throw new Error('a URL is never fetched');
      throw new Error('not an inline image');
    }
    const b64 = clubImageData.slice(m[0].length);
    if (b64.length > Math.ceil(IMAGE_MAX_BYTES / 3) * 4) throw new Error(`too large (over ${IMAGE_MAX_BYTES} bytes)`);
    return Buffer.from(b64, 'base64');
  } catch (e) {
    console.log(`[icon] Could not load club image: ${e.message}`);
  }
  return null;
}

// Monogram, the icon panel's LAST resort: when the client doesn't supply a
// club logo (page layout changed, image failed to scrape) the panel shows the
// official club mark from the brand kit, and only when that is missing too
// does the label fall back to a solid badge with the club's monogram. TR (not
// T) for Trek so it can't be confused with T&T.
const CLUB_MONOGRAM = Object.fromEntries(CLUB_TABLE.map((c) => [c.key, c.monogram]));
