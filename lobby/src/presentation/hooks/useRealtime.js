import { useCallback, useEffect, useState } from 'react';
import { useSocket } from '../../hooks/useSocket.js';
import { useConfig } from '../../hooks/useConfig.js';
import { normalizeClub } from '../lib/birthdays.js';
import { saveLiveBirthdays } from './useBirthdays.js';

/**
 * The presentation page's ONLY socket-adjacent code. All realtime data
 * arrives through the display's sanctioned privacy boundary —
 * src/hooks/useSocket.js binding the strict allowlist sanitizers in
 * src/lib/eventSanitizers.js — never through a second Pusher stack.
 * (This replaces the original repo's pusher.ts/useTally/useBirthdaySync.)
 *
 * - `tally` events → { counts, total, at: Date } for GameTimeView's
 *   check-in counters (sanitizeTally already floors counts and drops
 *   non-numeric values; only the epoch-ms `at` needs adapting to the
 *   Date the views expect).
 * - `birthdays` broadcasts → the localStorage live-roster via
 *   saveLiveBirthdays (first name / club / month / day only — exactly
 *   the sanitizer's allowlist). Each broadcast carries the full current
 *   list, so storage is replaced, not accumulated.
 * - `schedule` broadcasts → { at: Date, nextMeetingDate?, title?,
 *   noClubThisWeek? } — passed straight through to useSchedule() as an
 *   ADVISORY layer (lib/scheduleAdvisory.js), never a replacement for
 *   shared/schedule.json or the device skip-weeks overlay.
 *
 * Pusher credentials come from the display's shared device config
 * (`awanaConfig.v1`): set once in the signage Settings panel or QuickNav,
 * or passed as `?key=...&cluster=...` — adopted below into the persisted
 * overrides so a one-time provisioning URL survives reloads (the same
 * semantics the original app's ?pusherKey= flag had).
 */
export function useRealtime() {
  const { config, updateConfig } = useConfig();
  const [tally, setTally] = useState(null);
  const [schedule, setSchedule] = useState(null);

  // One-time startup chore: persist ?key=/&cluster= provisioning.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const key = (params.get('key') || '').trim();
    const cluster = (params.get('cluster') || '').trim();
    if (!key) return;
    updateConfig(cluster ? { pusherAppKey: key, pusherCluster: cluster } : { pusherAppKey: key });
  }, [updateConfig]); // updateConfig is a stable useCallback — this runs once at mount

  const onTally = useCallback((safe) => {
    setTally({ counts: safe.counts, total: safe.total, at: new Date(safe.at) });
  }, []);

  const onBirthdays = useCallback((safe) => {
    saveLiveBirthdays(toLiveBirthdays(safe.entries));
  }, []);

  const onSchedule = useCallback((safe) => {
    setSchedule({
      at: new Date(safe.at),
      nextMeetingDate: safe.nextMeetingDate,
      title: safe.title,
      noClubThisWeek: safe.noClubThisWeek,
    });
  }, []);

  const { status } = useSocket({ onTally, onBirthdays, onSchedule });
  return {
    tally,
    schedule,
    socketStatus: status,
    pusherConfigured: Boolean(config.pusherAppKey),
  };
}

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Sanitized broadcast entries → LiveBirthday shape for the roster
 * store. The sanitizer guarantees firstName/club strings and 1–12 /
 * 1–31 integers; the residual display-side rules from the original
 * parseBirthdayBroadcast still apply: club must normalize to a known
 * club id, and the day must exist in its month.
 */
function toLiveBirthdays(rawEntries) {
  const receivedAt = Date.now();
  const entries = [];
  for (const e of rawEntries) {
    const club = normalizeClub(e.club);
    if (!club) continue;
    if (e.day > DAYS_IN_MONTH[e.month - 1]) continue;
    entries.push({ name: e.firstName.trim().slice(0, 40), month: e.month, day: e.day, club, receivedAt });
  }
  return entries;
}
