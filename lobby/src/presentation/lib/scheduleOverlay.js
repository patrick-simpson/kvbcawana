// Device-local specialDates overlay — the QuickNav "Skip weeks" editor
// writes here. shared/schedule.json stays the canonical, validated
// source for the whole app family; this overlay only lets the operator
// at the projector cancel a night ("no club") without a deploy, the
// same trust model as the device-local Pusher key.
//
// Deliberately narrow: overlay entries are ONLY `{ noClub: true }` (+
// label). Reshaped window tables keep going through schedule.json,
// where the strict validator and CI can see them.

import { SCHEDULE_CONFIG } from './shared-config.js';

const STORAGE_KEY = 'awanaScheduleOverlay.v1';
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const LABEL_MAX = 60;
const MAX_ENTRIES = 30;

const listeners = new Set();

function sanitizeOverlay(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const clean = {};
  for (const [key, val] of Object.entries(raw).slice(0, MAX_ENTRIES)) {
    if (!DATE_KEY_RE.test(key)) continue;
    if (!val || typeof val !== 'object' || val.noClub !== true) continue;
    const entry = { noClub: true };
    if (typeof val.label === 'string' && val.label.trim()) {
      entry.label = val.label.trim().slice(0, LABEL_MAX);
    }
    clean[key] = entry;
  }
  return clean;
}

function load() {
  try {
    return sanitizeOverlay(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    return {};
  }
}

let overlay = load();
let merged = mergeConfig();

function mergeConfig() {
  return Object.keys(overlay).length === 0
    ? SCHEDULE_CONFIG
    : {
        ...SCHEDULE_CONFIG,
        // Overlay wins on conflict: the operator at the projector is
        // more current than the last deploy.
        specialDates: { ...SCHEDULE_CONFIG.specialDates, ...overlay },
      };
}

function persistAndNotify() {
  try {
    if (Object.keys(overlay).length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(overlay));
  } catch {
    /* storage blocked — in-memory overlay still applies this session */
  }
  merged = mergeConfig();
  for (const fn of listeners) fn();
}

/** The schedule config with this device's overlay applied. */
export function effectiveScheduleConfig() {
  return merged;
}

/** This device's own overlay entries (for the editor list). */
export function overlayEntries() {
  return overlay;
}

/** Mark a date (YYYY-MM-DD) as "no club". Returns an error string or null. */
export function addSkipDate(dateKey, label) {
  if (!DATE_KEY_RE.test(dateKey || '')) return 'Pick a date first';
  if (Object.keys(overlay).length >= MAX_ENTRIES) return 'Too many overrides — clean up old ones';
  overlay = sanitizeOverlay({ ...overlay, [dateKey]: { noClub: true, label } });
  persistAndNotify();
  return null;
}

export function removeSkipDate(dateKey) {
  if (!(dateKey in overlay)) return;
  const next = { ...overlay };
  delete next[dateKey];
  overlay = next;
  persistAndNotify();
}

export function subscribeOverlay(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
