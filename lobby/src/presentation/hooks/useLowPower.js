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
//
// The weather scene asks the two halves apart (owner 2026-10-13): the
// switch (?vr=1 or the QuickNav toggle, a weak-PC switch) hides it, the OS
// setting (an accessibility one) shows its still frame instead, a finished
// picture with nothing moving: useLowPowerSwitch() and useReducedMotion().

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

// Another window of this profile (the configure page, ?configure=1) may flip
// the switch: take it live.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY && e.key !== null) return;
    stored = readStored();
    notify();
  });
}

function notify() {
  for (const fn of listeners) fn();
}

/** The device's switch alone: ?vr=1 or the saved QuickNav toggle. */
export function isLowPowerSwitch() {
  return FLAGS.vr || stored;
}

/** The OS (or browser) reduced-motion setting alone. */
export function isReducedMotion() {
  return !!media?.matches;
}

export function isLowPower() {
  return isLowPowerSwitch() || isReducedMotion();
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

/** Follow the saved preference (the screen registry sends a change up). */
export const subscribeLowPower = subscribe;

export function useLowPower() {
  return useSyncExternalStore(subscribe, isLowPower, isLowPower);
}

/** Only the switch (?vr=1, the QuickNav toggle): the OS setting is not in it. */
export function useLowPowerSwitch() {
  return useSyncExternalStore(subscribe, isLowPowerSwitch, isLowPowerSwitch);
}

/** Only the OS reduced-motion setting, followed live. */
export function useReducedMotion() {
  return useSyncExternalStore(subscribe, isReducedMotion, isReducedMotion);
}
