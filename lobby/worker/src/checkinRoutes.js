// The online check-in routes of the Worker core (routes.md 4, 5, 6): stations,
// the print lease, and the desk's claim API. ONE mount line in SyncCore. The
// handlers are thin: the behaviour is stations.js, printq.js, ledger.js and
// desk.js, each tested on its own.
//
// Owners: the print role (P2) CALLS these; the desk page (P3) calls the
// /v1/desk/* ones; history (P6) adds its own file and one `mountHistory` line.
//
// Names: `GET /v1/print/next`, `POST /v1/print/done|failed|heartbeat` are the
// canonical lease routes. routes.md's first draft called them
// `POST /v1/print/lease|ack|hello`; those answer too, as aliases, so a client
// built from either document works.

import { churchNight } from '../../shared/cloud-crypto.js';
import { fail, json } from './http.js';
import { LEASE_MAX, LEASE_MS, validJobId } from './printq.js';
import { PRINT_JOB_KIND } from './adopt.js';

const RESULTS = ['printed', 'already-spooled'];
const REPRINT_RE = /^reprint:/;

/** @param {import('./registry.js').Registry} registry @param {any} core the SyncCore */
export function mountCheckin(registry, core) {
  const lookup = (/** @type {string} */ night, /** @type {string} */ tag) => core.ledger.peek(night, tag);
  const loadAll = () => Promise.all([core.ledger.load(), core.printq.load(), core.stations.load()]);

  // ── stations (routes.md 4) ─────────────────────────────────────────────────

  registry.add('POST', '/v1/station/register', 'session', async ({ body }) => {
    const r = await core.stations.register(await body());
    return r.ok ? json({ ok: true, station: r.station, stations: await core.stations.list() }) : fail(r.error, r.status);
  });

  registry.add('GET', '/v1/stations', 'session', async () => json(await core.stations.list()));

  registry.add('DELETE', '/v1/stations/:id', 'session', async ({ params }) => {
    const r = await core.stations.revoke(params.id);
    return r.ok ? json({ ok: true, stations: r.stations }) : fail('No such station.', 404);
  });

  // ── the print lease (routes.md 6) ──────────────────────────────────────────

  /** Lease up to `max` jobs to this station. At most one job is sealed first (the free plan's CPU). */
  const next = async (/** @type {string} */ stationId, /** @type {unknown} */ max) => {
    await loadAll();
    await core.adopt.load();
    if (core.adopt.pending() > 0) await core.adopt.drain(1);
    const jobs = await core.printq.lease(stationId, Math.min(LEASE_MAX, Number(max) || 1), lookup);
    return json({ jobs, leaseMs: LEASE_MS });
  };
  registry.add('GET', '/v1/print/next', 'station', ({ url, stationId }) => next(/** @type {string} */ (stationId), url.searchParams.get('max')));
  registry.add('POST', '/v1/print/lease', 'station', async ({ stationId, body }) => next(/** @type {string} */ (stationId), (await body()).max));

  /** A station says a label is out ('printed') or was already spooled by an earlier try. */
  const done = async (/** @type {any} */ b) => {
    if (!validJobId(b.jobId)) return fail('That is not a job id.', 400);
    const result = b.result === undefined ? 'printed' : b.result;
    if (!RESULTS.includes(result)) return fail('result is printed or already-spooled.', 400);
    await loadAll();
    const r = await core.printq.done(b.jobId, result);
    // The claim is printed only if the job still belongs to its gen.
    if (r.known && !r.already && r.tag && r.night) await core.ledger.markPrinted(r.night, r.tag, /** @type {number} */ (r.gen));
    return json({ ok: true, already: r.already, ...(result === 'already-spooled' ? { checkThePrinter: true } : {}) });
  };
  const failed = async (/** @type {any} */ b) => {
    if (!validJobId(b.jobId)) return fail('That is not a job id.', 400);
    await loadAll();
    const r = await core.printq.failed(b.jobId, b.error);
    return json({ ok: true, state: r.state ?? null });
  };
  registry.add('POST', '/v1/print/done', 'station', async ({ body }) => done(await body()));
  registry.add('POST', '/v1/print/failed', 'station', async ({ body }) => failed(await body()));
  registry.add('POST', '/v1/print/ack', 'station', async ({ body }) => {
    const b = await body();
    return b.result === 'failed' ? failed(b) : done(b);
  });

  /** Every 30 s (and during a print, every few seconds with the job id): the lease stays alive and the printer's state is noted. */
  const heartbeat = async (/** @type {string} */ stationId, /** @type {any} */ b) => {
    await loadAll();
    await core.stations.touch(stationId, b.printer);
    if (b.jobId === undefined) return json({ ok: true });
    if (!validJobId(b.jobId)) return fail('That is not a job id.', 400);
    const r = await core.printq.heartbeat(b.jobId, stationId, lookup);
    return json(r.ok ? { ok: true, leaseUntil: r.leaseUntil } : { ok: false, reason: r.reason });
  };
  registry.add('POST', '/v1/print/heartbeat', 'station', async ({ stationId, body }) => heartbeat(/** @type {string} */ (stationId), await body()));
  registry.add('POST', '/v1/print/hello', 'station', async ({ stationId, body }) => heartbeat(/** @type {string} */ (stationId), await body()));

  registry.add('GET', '/v1/print/status', 'session', async () => {
    await loadAll();
    await core.adopt.load();
    const night = churchNight(core.now());
    return json({
      ...(await core.printq.status()),
      claims: await core.ledger.counts(night),
      pendingToSeal: core.adopt.pending(),
      cloudPrint: core.adopt.on,
      stations: (await core.stations.list()).map((s) => ({ stationId: s.stationId, name: s.name, lastSeenAt: s.lastSeenAt, printer: s.printer })),
    });
  });

  /** A reprint: sealed by a client like any job, `reprint:<uuid>`, and it bypasses the claims. */
  registry.add('POST', '/v1/print/reprint', 'session', async ({ body }) => {
    const b = await body();
    const night = churchNight(core.now());
    if (!REPRINT_RE.test(String(b.jobId)) || !validJobId(b.jobId)) return fail('A reprint job id is reprint:<uuid>.', 400);
    await loadAll();
    const ok = core.stations.checkBundle(b.bundle, { night, kind: PRINT_JOB_KIND });
    if (!ok.ok) return json({ ok: false, reason: ok.reason, ...(ok.reason === 'stations-changed' ? { stations: await core.stations.list() } : {}) }, ok.status);
    const r = await core.printq.enqueue({ jobId: b.jobId, kind: 'reprint', night, bundle: b.bundle });
    return r.ok ? json({ ok: true, jobId: b.jobId, existing: r.existing }) : fail('The queue would not take that job.', 409, { reason: r.reason });
  });

  // ── the desk's claim API (routes.md 5): thin; the logic is desk.js ──────────

  registry.add('GET', '/v1/desk/roster', 'session', () => core.desk.roster());
  registry.add('GET', '/v1/desk/families', 'session', () => core.desk.families());
  registry.add('POST', '/v1/desk/checkin', 'session', async ({ body }) => core.desk.checkIn(await body()));
  registry.add('POST', '/v1/desk/undo', 'session', async ({ body }) => core.desk.undo(await body()));
  registry.add('POST', '/v1/desk/checkout', 'session', async ({ body }) => core.desk.checkout(await body()));
}
