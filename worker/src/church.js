// @ts-check
// Church settings (routes.md 10.3, docs/SETTINGS-OVERHAUL.md section 4): the
// check-in laptop's church-wide printing settings (label footer, templates,
// schedule, pickup list, Screen season, BARF nights...), kept here and edited
// from awana.kvbchurch.org/settings. The print station fetches and applies
// them (it learns of a change from GET /v1/print/next's `church.rev`), and
// keeps config.json as the offline copy.
//
// ONE allowlist: shared/churchSettings.js (the print server runs the same
// source). Values are church-authored, never child data.
//
// STORAGE `church` = {v: 1, rev, savedAt, by, seededBy: {stationId, name, at}|null,
// settings}: `rev: 0, settings: null` until the first station seeds it with its
// config.json (first writer wins) or the owner starts from defaults. Every
// check-and-set is one synchronous step on the in-memory document (doc.js),
// written through before the answer.

import { CHURCH_JSON_MAX, mergeChurch, sanitizeChurch } from '../../shared/churchSettings.js';
import { Doc } from './doc.js';
import { fail, json } from './http.js';
import { DOORBELL_EVENT, frameText } from './live.js';
import { changedSince, changedSinceRefusal, diffKeys } from './changes.js';

/** @param {unknown} v */
const bytes = (v) => new TextEncoder().encode(JSON.stringify(v)).length;

export class Church {
  /** @param {{ storage: import('./sync.js').Store, now: () => number }} deps */
  constructor({ storage, now }) {
    this.now = now;
    /** The size cap (CHURCH_JSON_MAX; a valid document stays well under it, so a test lowers it). */
    this.max = CHURCH_JSON_MAX;
    this.doc = new Doc(storage, 'church', () => ({ v: 1, rev: 0, savedAt: null, by: null, seededBy: null, settings: null }));
  }

  load() {
    return this.doc.load();
  }

  /** (after load) */
  get rev() {
    return this.doc.data ? this.doc.data.rev : 0;
  }

  /** For the overview. @param {boolean} paused */
  async summary(paused) {
    await this.load();
    const d = this.doc.data;
    return { rev: d.rev, savedAt: d.savedAt, seeded: !!d.seededBy, paused };
  }
}

/**
 * The routes (routes.md 10.3) and the `church` undoer.
 * @param {import('./registry.js').Registry} registry @param {any} core the SyncCore
 */
export function mountChurch(registry, core) {
  /** @type {Church} */
  const church = core.church;
  const paused = () => core.switches.value('CHURCH_SETTINGS') === 'off';
  const offRefusal = { ok: false, status: 503, reason: 'church-off', error: 'Church-wide settings are paused: change these at the laptop.' };
  const ring = () => core.broadcast(frameText(DOORBELL_EVENT, { what: 'church', rev: church.rev }));

  registry.add('GET', '/v1/church/settings', 'session', async () => {
    await church.load();
    const d = church.doc.data;
    return json({
      rev: d.rev, savedAt: d.savedAt, by: d.by, seeded: !!d.seededBy, paused: paused(),
      settings: d.settings, switches: core.switches.values(), switchesRev: core.switches.rev,
    });
  });

  /**
   * An edit: the one write path a PUT and an Undo take.
   * @param {{ patch: Record<string, unknown>, baseRev: number, fromDefaults?: boolean, device: any, undoOf?: number,
   *   expect?: (settings: Record<string, any>) => string[] }} e
   */
  const edit = async (e) => {
    if (paused()) return offRefusal;
    await church.load();
    // From here on, no await until the save: the rev check and the write are one step.
    const d = church.doc.data;
    if (d.rev === 0 && e.fromDefaults !== true) return { ok: false, status: 409, reason: 'not-seeded', error: 'The check-in laptop has not sent its settings yet.' };
    if (e.baseRev !== d.rev) return { ok: false, status: 409, reason: 'stale', rev: d.rev, settings: d.settings, error: 'Someone else changed this a moment ago; check and save again.' };
    const prev = d.settings || {};
    if (e.expect) {
      const moved = e.expect(prev);
      if (moved.length) return changedSinceRefusal(moved);
    }
    const next = mergeChurch(prev, e.patch);
    if (bytes(next) > church.max) return { ok: false, status: 413, reason: 'too-big', error: 'Those settings are too big to keep. Shorten the schedule or the templates.' };
    const diff = diffKeys(prev, next);
    if (d.rev > 0 && !diff.keys.length) return { ok: true, seq: null, body: { ok: true, rev: d.rev, savedAt: d.savedAt, settings: d.settings } };
    church.doc.data = { ...d, rev: d.rev + 1, savedAt: new Date(core.now()).toISOString(), by: e.device, settings: next };
    await church.doc.save();
    ring();
    const seq = diff.keys.length ? await core.logChange(null, { device: e.device, undoOf: e.undoOf }, { what: 'church', ...diff }) : null;
    const s = church.doc.data;
    return { ok: true, seq, body: { ok: true, rev: s.rev, savedAt: s.savedAt, settings: s.settings } };
  };

  /** The first station's config.json: first writer wins. @param {any} b @param {Request} request */
  const seed = async (b, request) => {
    if (paused()) return fail(offRefusal.error, 503, { reason: 'church-off' });
    const stationId = request.headers.get('X-Station') || '';
    await core.stations.load();
    const station = core.stations.get(stationId);
    if (!station) return fail('Only a registered print station seeds the church settings.', 403, { reason: 'unknown-station' });
    await core.stations.touch(stationId);
    const { settings } = sanitizeChurch(b.settings);
    if (bytes(settings) > church.max) return fail('Those settings are too big to keep.', 413, { reason: 'too-big' });
    const device = await core.deviceOf(request);
    await church.load();
    // One step: the check that nobody seeded and the write.
    if (church.doc.data.rev > 0) return json({ already: true, rev: church.doc.data.rev });
    const at = new Date(core.now()).toISOString();
    church.doc.data = { v: 1, rev: 1, savedAt: at, by: device, seededBy: { stationId, name: station.name, at }, settings };
    await church.doc.save();
    ring();
    await core.logChange(null, { device }, { what: 'church', keys: Object.keys(settings).sort(), undoable: false });
    return json({ rev: 1 }, 201);
  };

  registry.add('PUT', '/v1/church/settings', 'session', async ({ body, request }) => {
    const b = await body();
    if (b.seed === true) return seed(b, request);
    if (!Number.isInteger(b.baseRev)) return fail('Send baseRev, the rev you edited.', 400, { reason: 'bad-rev' });
    const raw = b.settings;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('No settings.', 400, { reason: 'bad-settings', dropped: [] });
    // Cleaned by the one allowlist; a null stays (it deletes the key).
    const { settings: patch, dropped } = sanitizeChurch(raw, { patch: true });
    if (!Object.keys(patch).length && !(b.fromDefaults === true && !dropped.length)) {
      return fail('None of those settings could be kept.', 400, { reason: 'bad-settings', dropped });
    }
    const r = await edit({ patch, baseRev: b.baseRev, fromDefaults: b.fromDefaults === true, device: await core.deviceOf(request) });
    if (!r.ok) {
      const extra = r.reason === 'stale' ? { rev: r.rev, settings: r.settings } : {};
      return fail(r.error, r.status, { reason: r.reason, ...extra });
    }
    return json({ ...r.body, ...(dropped.length ? { dropped } : {}) });
  });

  core.undoers.church = async (/** @type {{ entry: any, before: any, device: any, undoOf: number }} */ { entry, before, device, undoOf }) => {
    await church.load();
    const keys = Object.keys(before);
    return edit({
      patch: before, baseRev: church.rev, device, undoOf,
      expect: (settings) => changedSince(entry, Object.fromEntries(keys.map((k) => [k, settings[k] ?? null]))),
    });
  };
}
