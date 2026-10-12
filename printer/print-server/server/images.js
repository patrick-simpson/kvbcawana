'use strict';
// Temp files, remote images, club icon cache.
// One of the modules server.js was split into (server.js loads them in the order the old
// file ran them). Another module's names are reached as $module.name.

const { CLUB_TABLE, clubKeyByLabel } = require('../clubTable');
const http  = require('http');
const https = require('https');
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

// ── Download a remote image into a Buffer ─────────────────────────────────────
// A club logo is a small PNG. Anything else the URL answers with is refused
// before it is buffered: the icon is decoration, and a label must never wait
// on, or hold in memory, whatever a misconfigured or hostile URL sends.
const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const req = proto.get(url, { timeout: 4000 }, (res) => {
      if (res.statusCode !== 200) {
        // Close the socket: a stalled upstream must not be held open until
        // the agent gives up on it.
        req.destroy();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const type = String(res.headers['content-type'] || '').toLowerCase();
      if (type && !type.startsWith('image/')) {
        req.destroy();
        reject(new Error(`not an image (${type.split(';')[0]})`));
        return;
      }
      const declared = Number(res.headers['content-length']);
      if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) {
        req.destroy();
        reject(new Error(`too large (${declared} bytes)`));
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > IMAGE_MAX_BYTES) { req.destroy(new Error(`too large (over ${IMAGE_MAX_BYTES} bytes)`)); return; }
        chunks.push(c);
      });
      res.on('error', reject);
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
  });
}

// ── Club icon cache ───────────────────────────────────────────────────────────
// Remote club logos are downloaded once per URL and kept in memory, so every
// print doesn't re-fetch the same PNG and a mid-event network blip doesn't
// cost the label its icon. Bounded so a misbehaving client can't grow it.
const iconCache = new Map();  // url → Buffer
const ICON_CACHE_MAX = 20;

// ── Resolve clubImageData → Buffer (or null) ──────────────────────────────────
async function resolveImageBuffer(clubImageData) {
  if (!clubImageData) return null;
  try {
    if (clubImageData.startsWith('data:')) {
      // base64 data URL
      const b64 = clubImageData.replace(/^data:[^;]+;base64,/, '');
      return Buffer.from(b64, 'base64');
    }
    if (/^https?:\/\//.test(clubImageData)) {
      if (iconCache.has(clubImageData)) return iconCache.get(clubImageData);
      // One retry — venue Wi-Fi hiccups are routine, a second attempt 400ms
      // later usually succeeds and the result is cached for the whole event.
      let buf;
      try {
        buf = await downloadImage(clubImageData);
      } catch (firstErr) {
        await new Promise(r => setTimeout(r, 400));
        buf = await downloadImage(clubImageData);
      }
      if (iconCache.size >= ICON_CACHE_MAX) {
        iconCache.delete(iconCache.keys().next().value);  // evict oldest entry
      }
      iconCache.set(clubImageData, buf);
      return buf;
    }
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
