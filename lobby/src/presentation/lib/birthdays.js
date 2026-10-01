/**
 * Clubber birthdays — pure roster rules and week matching. Storage and
 * React wiring live in hooks/useBirthdays.js; everything here is a
 * plain function so it can be unit-tested like the schedule engine.
 *
 * The roster is fed ONLY by the print server's `birthdays` broadcast
 * (first names, month/day, club — no years), the same sanitized-socket
 * source the check-in display uses. The old operator-uploaded CSV path
 * was retired by request; there is nothing to upload or keep in sync.
 */

/** Map any reasonable club spelling ("T&T", "Truth & Training") to an id. */
export function normalizeClub(raw) {
  const s = raw.toLowerCase().replace(/[^a-z]/g, '');
  if (s.includes('puggle')) return 'puggles';
  if (s.includes('cubbie') || s.includes('cubby')) return 'cubbies';
  if (s.includes('spark')) return 'sparks';
  if (s === 'tt' || s.includes('tnt') || s.includes('truth')) return 'tnt';
  if (s.includes('trek')) return 'trek';
  if (s.includes('journey')) return 'journey';
  return null;
}

/** "Ava" · "Ava & Liam" · "Ava, Liam & Noah" — for the on-screen line. */
export function listNames(names) {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

/* ── Live (Pusher-synced) birthdays ───────────────────────────────── */

/**
 * A birthday learned from the print server's `birthdays` broadcast
 * (first names only — the privacy contract never puts last names on
 * the channel). Stamped with receipt time so stale entries age out.
 */

/** Live entries older than this are pruned (a bit over a week). */
export const LIVE_BIRTHDAY_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000;

const firstToken = (name) => name.trim().split(/\s+/)[0]?.toLowerCase() ?? '';

/**
 * Live broadcast entries → the display roster: stale entries (older
 * than LIVE_BIRTHDAY_MAX_AGE_MS) are pruned and duplicates within the
 * list (same club + first name) collapse to the first occurrence.
 * Pure — storage lives in hooks/useBirthdays.
 */
export function liveRoster(live, now) {
  const seen = new Set();
  const roster = [];
  for (const l of live) {
    if (now.getTime() - l.receivedAt > LIVE_BIRTHDAY_MAX_AGE_MS) continue;
    const key = `${l.club}|${firstToken(l.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    roster.push({ name: l.name, month: l.month, day: l.day, club: l.club });
  }
  return roster;
}

/* ── Week matching ────────────────────────────────────────────────── */

/** Sunday (local midnight) of the week containing `date`. */
export function weekStart(date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  return start;
}

const isLeapYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/**
 * Entries whose birthday falls in the Sun–Sat week containing `date`,
 * ordered by day of week. The week is walked day by day, so year
 * boundaries just work; Feb 29 birthdays count on Feb 28 in common years.
 */
export function birthdaysThisWeek(entries, date) {
  const start = weekStart(date);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push({ month: d.getMonth() + 1, day: d.getDate(), year: d.getFullYear() });
  }

  const matchIndex = (e) =>
    days.findIndex(
      (d) =>
        (d.month === e.month && d.day === e.day) ||
        (e.month === 2 && e.day === 29 && d.month === 2 && d.day === 28 && !isLeapYear(d.year)),
    );

  return entries
    .map((e) => ({ e, idx: matchIndex(e) }))
    .filter(({ idx }) => idx >= 0)
    .sort((a, b) => a.idx - b.idx)
    .map(({ e }) => e);
}
