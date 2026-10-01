import { useEffect, useState } from 'react';
import { CLUBS } from '../config.js';
import { liveRoster } from '../lib/birthdays.js';

/**
 * Birthday roster persistence — live sync ONLY, exactly the way the
 * check-in display learns birthdays: the print server's `birthdays`
 * Pusher broadcast (first names / club / month / day, no years) lands
 * through the sanitized socket (hooks/useRealtime.js) and is stored
 * here. Entries are stamped with receipt time and pruned after ~8 days
 * (lib/birthdays.liveRoster), so a kid who leaves the roster ages out
 * on his own. The old operator-uploaded CSV path was retired: there is
 * nothing to upload, clear between years, or keep in sync by hand.
 *
 * The app has no backend; all storage access fails silently (an empty
 * roster just means no birthday chips).
 */

const LIVE_STORAGE_KEY = 'kvbc-awana-live-birthdays';
const CHANGE_EVENT = 'awana:birthdays-changed';

function isValidLiveEntry(value) {
  if (typeof value !== 'object' || value === null) return false;
  const e = value;
  return (
    typeof e.name === 'string' &&
    typeof e.month === 'number' &&
    typeof e.day === 'number' &&
    typeof e.club === 'string' &&
    e.club in CLUBS &&
    typeof e.receivedAt === 'number'
  );
}

export function loadLiveBirthdays() {
  try {
    const raw = localStorage.getItem(LIVE_STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data.filter(isValidLiveEntry) : [];
  } catch {
    return [];
  }
}

/** Replace the live roster (each broadcast carries the full current list). */
export function saveLiveBirthdays(entries) {
  try {
    localStorage.setItem(LIVE_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Operator "Clear" wipes the stored roster (it refills on the next broadcast). */
export function clearBirthdays() {
  try {
    localStorage.removeItem(LIVE_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function buildRoster() {
  return liveRoster(loadLiveBirthdays(), new Date());
}

/** The live roster, updating on any change (broadcast/clear, any tab). */
export function useBirthdays() {
  const [roster, setRoster] = useState(buildRoster);

  useEffect(() => {
    const refresh = () => setRoster(buildRoster());
    window.addEventListener(CHANGE_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(CHANGE_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  return roster;
}
