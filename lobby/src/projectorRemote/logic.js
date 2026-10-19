// The opening-ceremony remote's words and choices, pure (no DOM, no network),
// so the tests can ask them anything (logic.test.js).

/**
 * The projectors on the screen list (GET /v1/screens), each cleaned to what
 * the remote shows: id, name, online.
 * @param {any} body
 * @returns {{id: string, name: string, online: boolean}[]}
 */
export function projectorsFrom(body) {
  const list = Array.isArray(body?.screens) ? body.screens : [];
  return list
    .filter((s) => s && s.kind === 'projector' && typeof s.id === 'string')
    .map((s) => ({ id: s.id, name: String(s.name || 'Projector').slice(0, 60), online: s.online === true }))
    .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
}

/** Every projector that is on: a press goes to each (normally there is one). */
export function targetsFor(projectors) {
  return projectors.filter((p) => p.online);
}

/** The line under "Game time projector". @param {{id: string, name: string, online: boolean}[] | null} projectors */
export function targetWords(projectors) {
  if (projectors === null) return 'Looking for the projector…';
  if (projectors.length === 0) return 'No projector is set up yet. Sign the projector in on its computer first.';
  const on = targetsFor(projectors);
  if (on.length === 0) return `${projectors[0].name} is off. Turn the projector computer on.`;
  if (on.length === 1) return `${on[0].name} · on`;
  return `${on.map((p) => p.name).join(' and ')} · all on (each press goes to every one)`;
}

const WHAT = {
  next: 'Next',
  prev: 'Back',
  'us-flag': 'The American flag',
  'awana-flag': 'The Awana flag',
  verse: '2 Timothy 2:15',
  'backup-end': 'Backup down',
};

/**
 * The press line after a press.
 * @param {string} what next|prev|us-flag|awana-flag|verse|backup-end
 * @param {{ok: boolean, status: number, body: any}[]} results one per projector sent to
 */
export function pressWords(what, results) {
  const label = WHAT[what] || 'That';
  if (results.length === 0) return 'No projector is on right now, so nothing was sent.';
  if (results.some((r) => r.ok && r.body?.delivered)) return `${label}: sent ✓`;
  if (results.some((r) => r.status === 0)) return 'Could not reach the service. Check this phone’s internet.';
  if (results.some((r) => r.ok)) return `${label}: the projector did not answer. Is its page open?`;
  return `${label} was not sent. Try again.`;
}

/** The action and data one press sends. @param {string} what */
export function actionFor(what) {
  if (what === 'next') return { action: 'slide-next' };
  if (what === 'prev') return { action: 'slide-prev' };
  if (what === 'backup-end') return { action: 'backup-end' };
  if (['us-flag', 'awana-flag', 'verse'].includes(what)) return { action: 'backup', data: { what } };
  return null;
}
