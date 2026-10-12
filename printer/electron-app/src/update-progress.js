'use strict';
// Update download progress, shown in the tray and the status window.
// Pure: no Electron, no timers. main.js feeds it electron-updater's
// 'download-progress' payload ({percent, transferred, total, bytesPerSecond})
// and asks it whether the tray is worth repainting yet (at most about once a
// second, so a fast download does not rebuild the menu hundreds of times).

const MB = 1024 * 1024;
const GB = 1024 * MB;
const MIN_REPAINT_MS = 1000;

function num(n) { return Number.isFinite(n) && n > 0 ? n : 0; }

// "71 of 170 MB", or "0.9 of 1.4 GB" once the file is that big.
function formatSizes(transferred, total) {
  const t = num(transferred);
  const all = num(total);
  if (!all) return '';
  const big = all >= GB;
  const unit = big ? GB : MB;
  const fmt = (n) => {
    const v = n / unit;
    return big || v < 10 ? String(Math.round(v * 10) / 10) : String(Math.round(v));
  };
  return `${fmt(Math.min(t, all))} of ${fmt(all)} ${big ? 'GB' : 'MB'}`;
}

// "about 3 min left", "less than a minute left", '' when unknown.
function formatTimeLeft(transferred, total, bytesPerSecond) {
  const rate = num(bytesPerSecond);
  const all = num(total);
  if (!rate || !all) return '';
  const seconds = Math.max(0, all - num(transferred)) / rate;
  if (seconds < 60) return 'less than a minute left';
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `about ${minutes} min left`;
  const hours = Math.round(seconds / 360) / 10;
  return `about ${hours} hr left`;
}

function clampPercent(p) {
  const v = Number(p);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

// 'Downloading update 42% (71 of 170 MB)'. withTime adds ", about 3 min left".
function formatProgress(p, withTime) {
  const pct = clampPercent(p && p.percent);
  const sizes = p ? formatSizes(p.transferred, p.total) : '';
  let line = `Downloading update ${pct}%`;
  const inner = [];
  if (sizes) inner.push(sizes);
  if (withTime && p) {
    const left = formatTimeLeft(p.transferred, p.total, p.bytesPerSecond);
    if (left) inner.push(left);
  }
  if (inner.length) line += ` (${inner.join(', ')})`;
  return line;
}

function createProgress({ now = Date.now, minRepaintMs = MIN_REPAINT_MS } = {}) {
  let latest = null;
  let lastPaint = 0;
  let lastPercent = -1;

  return {
    // Takes a progress payload. True when the tray should repaint now.
    update(p) {
      latest = p || null;
      if (!latest) return false;
      const pct = clampPercent(latest.percent);
      const t = now();
      const first = lastPercent < 0;
      const done = pct >= 100 && lastPercent < 100;
      if (!first && !done && (pct === lastPercent || t - lastPaint < minRepaintMs)) return false;
      lastPaint = t;
      lastPercent = pct;
      return true;
    },
    active() { return latest !== null; },
    percent() { return latest ? clampPercent(latest.percent) : null; },
    // Tray line (short) and window line (with time left); null when idle.
    line() { return latest ? formatProgress(latest, false) : null; },
    detail() { return latest ? formatProgress(latest, true) : null; },
    reset() { latest = null; lastPaint = 0; lastPercent = -1; },
  };
}

module.exports = { createProgress, formatProgress, formatSizes, formatTimeLeft, MIN_REPAINT_MS };
