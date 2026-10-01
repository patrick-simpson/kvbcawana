import { useSyncExternalStore } from 'react';
import { FLAGS } from '../lib/flags.js';

// One question, three answers folded together: should the heavy ambient
// layers (particles, orbs, sparkles, weather scene, confetti) render?
//
//   · ?vr=1            — screenshots must be deterministic
//   · OS reduced-motion — the operator asked every app to calm down
//   · Low-power toggle  — QuickNav switch for weak projector hardware,
//                         persisted per device
//
// Components call useLowPower() and return null when it's true; the
// core content (timers, slides, tallies) is never affected.

const STORAGE_KEY = 'awanaPresentationLowPower.v1';

const listeners = new Set();

function readStored() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

let stored = readStored();

const media = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null;

media?.addEventListener?.('change', () => notify());

function notify() {
  for (const fn of listeners) fn();
}

export function isLowPower() {
  return FLAGS.vr || stored || !!media?.matches;
}

export function setLowPowerPreference(on) {
  stored = !!on;
  try {
    if (on) localStorage.setItem(STORAGE_KEY, '1');
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage blocked — in-memory value still applies this session */
  }
  notify();
}

/** The operator's saved preference alone (for rendering the toggle). */
export function lowPowerPreference() {
  return stored;
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useLowPower() {
  return useSyncExternalStore(subscribe, isLowPower, isLowPower);
}
