// @ts-check
// Pure shaping for the History section: trends from night_summary, a night's
// rows as a table, and the CSV. No network, no crypto, no DOM.
//
// Row records are what the desk seals (P2): { first, last, club, ts, ... }.
// Anything else in a record is ignored here, never guessed at.

/** The Awana year runs August to July: "2026-27". @param {string} night YYYY-MM-DD */
export function seasonOf(night) {
  const y = Number(night.slice(0, 4));
  const m = Number(night.slice(5, 7));
  const start = m >= 8 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * Per-night numbers from the Worker's summary lines and nights list.
 * @param {{ night: string, club: string, checkedIn: number, checkedOut: number, undone: number, prints: number }[]} lines
 * @param {{ night: string, kinds?: Record<string, number> }[]} nights
 */
export function buildTrends(lines, nights) {
  const clubs = [...new Set(lines.map((l) => l.club))];
  const dates = [...new Set([...lines.map((l) => l.night), ...nights.map((n) => n.night)])].sort();
  const visitorsOn = new Map(nights.map((n) => [n.night, Number(n.kinds?.visitor) || 0]));
  const perNight = dates.map((night) => {
    const mine = lines.filter((l) => l.night === night);
    const byClub = Object.fromEntries(clubs.map((c) => [c, mine.find((l) => l.club === c)?.checkedIn ?? 0]));
    const checkedIn = mine.reduce((n, l) => n + l.checkedIn, 0);
    const checkedOut = mine.reduce((n, l) => n + l.checkedOut, 0);
    return { night, season: seasonOf(night), byClub, checkedIn, checkedOut, visitors: visitorsOn.get(night) || 0 };
  });
  const seasons = [...new Set(perNight.map((p) => p.season))];
  return { clubs, perNight, seasons };
}

/**
 * Average attendance per club per season (nights the club had any check-in).
 * @param {ReturnType<typeof buildTrends>} t
 */
export function seasonAverages(t) {
  return t.seasons.map((season) => {
    const nights = t.perNight.filter((p) => p.season === season);
    /** @type {Record<string, number>} */
    const avg = {};
    for (const c of t.clubs) {
      const counts = nights.map((n) => n.byClub[c]).filter((n) => n > 0);
      avg[c] = counts.length ? Math.round((counts.reduce((a, b) => a + b, 0) / counts.length) * 10) / 10 : 0;
    }
    return { season, nights: nights.length, avg };
  });
}

/** Share of checked-in children recorded as checked out, as a whole percent (null with no check-ins). @param {number} out @param {number} inn */
export function checkoutRate(out, inn) {
  return inn > 0 ? Math.min(100, Math.round((out / inn) * 100)) : null;
}

/** "Wed, Oct 14" for a YYYY-MM-DD. @param {string} night */
export function nightWords(night) {
  const d = new Date(`${night}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? night : d.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
}

/** @param {unknown} ts */
function clock(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return '';
  return new Date(n).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
}

/**
 * A night's opened rows as table lines. Only the fields a leader needs.
 * @param {{ id: string, kind: string, record: Record<string, any> }[]} rows
 */
export function rowLines(rows) {
  return rows.map((r) => {
    const rec = r.record || {};
    const str = (/** @type {unknown} */ v) => (typeof v === 'string' ? v : '');
    return {
      id: r.id,
      time: clock(rec.ts),
      kind: r.kind,
      name: [str(rec.first), str(rec.last)].filter(Boolean).join(' '),
      club: str(rec.club),
      friend: str(rec.friendFirst),
    };
  });
}

/** One CSV cell; a leading = + - @ is defused so a spreadsheet never runs a typed name as a formula. @param {unknown} v */
export function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** @param {string} night @param {ReturnType<typeof rowLines>} lines */
export function nightCsv(night, lines) {
  const head = ['Night', 'Time', 'What', 'Name', 'Club', 'Friend'];
  const body = lines.map((l) => [night, l.time, l.kind, l.name, l.club, l.friend].map(csvCell).join(','));
  return `${[head.join(','), ...body].join('\r\n')}\r\n`;
}
