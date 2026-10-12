// @ts-check
// The settings page's way to the check-in laptop's print server (ROADMAP.md#settings-page
// phase 3). An https page may call http://localhost, so on the laptop itself
// awana.kvbchurch.org/settings reaches the server the dashboard talks to; on
// any other device nothing answers and the page says so.
//
// The server decides what the page may do (print-server/security.js,
// SETTINGS_PAGE_ROUTES): /health is open, everything else needs the publish
// token this page already holds for slides, and POST /config takes only the
// printer's own keys. This file is the client half and the pure helpers the
// Laptop section draws from; it never throws.

export const PRINT_SERVER = 'http://localhost:3456';
/** The dashboard on the laptop: the fallback, and where the PIN and keys are set. */
export const PRINT_DASHBOARD_URL = `${PRINT_SERVER}/#settings`;

/** How long the probe waits: a laptop answers in milliseconds, nothing else ever does. */
export const PROBE_TIMEOUT_MS = 2500;
const CALL_TIMEOUT_MS = 20000;

/**
 * @typedef {{ type?: string, message: string }} HealthWarning
 * @typedef {{ status: string, printer: string, version: string, warnings: HealthWarning[], rehearsal?: boolean,
 *   musicalTune?: { enabled?: boolean }, lobbySlides?: { tokenConfigured?: boolean }, spooler?: any }} Health
 * @typedef {{ found: true, health: Health } | { found: false, reason: 'unreachable' | 'not-ours' }} Probe
 */

/**
 * @param {string} url
 * @param {RequestInit} init
 * @param {number} timeoutMs
 * @param {typeof fetch} fetchFn
 */
async function timed(url, init, timeoutMs, fetchFn) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Is there a Club Label Printer server on this computer? Only /health, which
 * answers without the token. A server that is not ours (some other app on
 * port 3456) is told apart by the shape of what it says.
 * @param {{ fetchFn?: typeof fetch, timeoutMs?: number }} [opts]
 * @returns {Promise<Probe>}
 */
export async function probePrintServer(opts) {
  const fetchFn = opts?.fetchFn || fetch;
  try {
    const res = await timed(`${PRINT_SERVER}/health`, {}, opts?.timeoutMs ?? PROBE_TIMEOUT_MS, fetchFn);
    if (!res.ok) return { found: false, reason: 'not-ours' };
    const body = await res.json();
    if (!body || body.status !== 'ok' || typeof body.version !== 'string' || typeof body.printer !== 'string') {
      return { found: false, reason: 'not-ours' };
    }
    const warnings = Array.isArray(body.warnings)
      ? body.warnings.filter((/** @type {any} */ w) => w && typeof w.message === 'string')
      : [];
    return { found: true, health: { ...body, warnings } };
  } catch {
    return { found: false, reason: 'unreachable' };
  }
}

/**
 * @typedef {{ ok: true, data: any }
 *   | { ok: false, reason: 'no-token' | 'no-token-on-server' | 'wrong-token' | 'sign-in-refused' | 'refused' | 'unreachable' | 'rejected', status: number, error: string }} Reply
 */

/**
 * One call to the print server, proven by the page's sync sign-in (owner,
 * 2026-10-11: the passphrase is enough; the print server asks the sync
 * service) or, pasted once, the publish token, which wins when both are held.
 * @param {string} path
 * @param {{ token?: string, session?: string, method?: 'GET' | 'POST', body?: unknown, raw?: boolean, fetchFn?: typeof fetch, timeoutMs?: number }} opts
 * @returns {Promise<Reply>}
 */
export async function callPrintServer(path, opts) {
  const token = String(opts.token || '').trim();
  const session = String(opts.session || '').trim();
  if (!token && !session) return { ok: false, reason: 'no-token', status: 0, error: 'Sign in under Setup first.' };
  const fetchFn = opts.fetchFn || fetch;
  const post = opts.method === 'POST';
  /** @type {Record<string, string>} */
  const headers = { Authorization: token ? `Bearer ${token}` : `Sync ${session}` };
  if (post) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await timed(`${PRINT_SERVER}${path}`, {
      method: post ? 'POST' : 'GET',
      headers,
      body: post ? JSON.stringify(opts.body ?? {}) : undefined,
    }, opts.timeoutMs ?? CALL_TIMEOUT_MS, fetchFn);
  } catch {
    return { ok: false, reason: 'unreachable', status: 0, error: 'The print server did not answer.' };
  }
  if (res.ok) {
    if (opts.raw) return { ok: true, data: await res.blob() };
    try { return { ok: true, data: await res.json() }; } catch { return { ok: true, data: null }; }
  }
  /** @type {any} */
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  const error = body && typeof body.error === 'string' ? body.error : `HTTP ${res.status}`;
  if (res.status === 403 && /No publish token/i.test(error)) return { ok: false, reason: 'no-token-on-server', status: 403, error };
  if (res.status === 403 && /Wrong publish token/i.test(error)) return { ok: false, reason: 'wrong-token', status: 403, error };
  if (res.status === 403 && !token && /sync service|sign in/i.test(error)) return { ok: false, reason: 'sign-in-refused', status: 403, error };
  if (res.status === 403) return { ok: false, reason: 'refused', status: 403, error };
  return { ok: false, reason: 'rejected', status: res.status, error };
}

// ── Pure helpers ──────────────────────────────────────────────────────────

/**
 * The options for a printer menu: Windows' list, plus the saved choice even
 * when Windows is not listing it right now, so saving can never drop it (the
 * dashboard does the same).
 * @param {{ name: string, isWindowsDefault?: boolean }[] | null | undefined} printers
 * @param {string} saved
 * @returns {{ value: string, label: string }[]}
 */
export function printerOptions(printers, saved) {
  const list = Array.isArray(printers) ? printers.filter((p) => p && typeof p.name === 'string') : [];
  const names = list.map((p) => p.name);
  if (saved && !names.includes(saved)) names.unshift(saved);
  return names.map((n) => ({
    value: n,
    label: list.find((p) => p.name === n)?.isWindowsDefault ? `${n} (Windows default)` : n,
  }));
}

export const PICKUP_CLUBS = ['Puggles', 'Cubbies', 'Sparks', 'T&T', 'Trek', 'Journey'];
/** What the pickup list is until one is saved (print-server/pickup.js). */
export const PICKUP_DEFAULT = ['Puggles', 'Cubbies', 'Sparks', 'T&T'];

/** @param {unknown} saved @returns {string[]} the ticked clubs (the default when none was saved) */
export function pickupTicked(saved) {
  return Array.isArray(saved) ? saved.filter((c) => PICKUP_CLUBS.includes(c)) : PICKUP_DEFAULT.slice();
}

export const TEMPLATE_FIELDS = [
  ['showIconPanel', 'Club logo panel'],
  ['showLastName', 'Last name'],
  ['showClubLine', 'Club name line'],
  ['showGroupLine', 'Handbook group line'],
  ['showVisitorPill', 'VISITOR pill'],
  ['showFooter', 'Label footer'],
];
export const TEMPLATE_CLUB_NAMES = { puggle: 'Puggles', cubbie: 'Cubbies', spark: 'Sparks', 't&t': 'T&T', trek: 'Trek', journey: 'Journey' };
export const NAME_SIZE_MIN = 18;
export const NAME_SIZE_MAX = 48;

/**
 * A template as the form shows it: every box ticked unless the saved
 * overrides turn it off.
 * @param {Record<string, any> | undefined} t
 */
export function templateToForm(t) {
  /** @type {Record<string, any>} */
  const form = {};
  for (const [key] of TEMPLATE_FIELDS) form[key] = !t || t[key] !== false;
  const n = t && typeof t.nameMaxPt === 'number' && t.nameMaxPt >= NAME_SIZE_MIN && t.nameMaxPt <= NAME_SIZE_MAX ? t.nameMaxPt : NAME_SIZE_MAX;
  form.nameMaxPt = n;
  return form;
}

/**
 * The form back to overrides only (an all-default form is an empty object, and
 * the club's entry goes), the same normalisation the server applies.
 * @param {Record<string, any>} form
 */
export function formToTemplate(form) {
  /** @type {Record<string, any>} */
  const t = {};
  for (const [key] of TEMPLATE_FIELDS) if (form[key] === false) t[key] = false;
  const n = Number(form.nameMaxPt);
  if (n >= NAME_SIZE_MIN && n < NAME_SIZE_MAX) t.nameMaxPt = n;
  return t;
}

/**
 * @param {Record<string, Record<string, any>>} all
 * @param {string} key
 * @param {Record<string, any>} template
 */
export function withTemplate(all, key, template) {
  const next = { ...all };
  if (Object.keys(template).length) next[key] = template;
  else delete next[key];
  return next;
}

/** @param {string} clubName the key the server's clubKey() gives */
export function templateClubLabel(clubName) {
  return /** @type {Record<string, string>} */ (TEMPLATE_CLUB_NAMES)[clubName] || clubName;
}

/**
 * Schedule rows as the server keeps them: a row without a club is dropped,
 * the time must be H:MM.
 * @param {{ club?: string, startTime?: string, location?: string, room?: string }[]} rows
 */
export function cleanScheduleRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((r) => ({
      club: String(r?.club || '').trim(),
      startTime: String(r?.startTime || '').trim(),
      location: String(r?.location || '').trim(),
      room: String(r?.room || '').trim(),
    }))
    .filter((r) => r.club);
}

/** @param {string} startTime */
export function validStartTime(startTime) {
  return startTime === '' || /^\d{1,2}:\d{2}$/.test(startTime);
}

/**
 * What the status card says about the laptop, in plain words.
 * @param {Health} health
 * @returns {{ tone: 'ok' | 'warn', headline: string, lines: string[] }}
 */
export function healthSummary(health) {
  const lines = (health.warnings || []).map((w) => w.message);
  if (health.rehearsal) lines.unshift('Rehearsal mode is on: every label prints with a TEST band and nothing is recorded.');
  return {
    tone: lines.length ? 'warn' : 'ok',
    headline: lines.length ? `${lines.length} thing${lines.length === 1 ? '' : 's'} to check` : 'Everything looks right',
    lines,
  };
}

/** What a history row calls itself on the list. @param {any} e */
export function historyTags(e) {
  const tags = [];
  if (e.success === false) tags.push('Failed');
  if (e.isLeader) tags.push('Leader');
  if (e.oneOff) tags.push('One-off');
  if (e.isAward) tags.push('Award');
  if (e.isConnectCard) tags.push('Connect card');
  if (e.undone) tags.push('Undone');
  return tags;
}

/** A row the reprint button can send (award slips and connect cards cannot). @param {any} e */
export function canReprint(e) {
  return !(e.isAward || e.isConnectCard || e.isLeader || e.oneOff) && Boolean(e.firstName);
}
