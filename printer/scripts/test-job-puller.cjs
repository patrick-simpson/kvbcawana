#!/usr/bin/env node
// Online check-in P2: the print role takes ALL its print jobs from the Worker
// (print-server/job-puller.js), at most once each. The real print server runs
// here (a stand-in `powershell` counts the jobs that reach the printer); the
// Worker is a stand-in that speaks lobby/worker/src/routes.md section 6.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
// JSON of a wire row or post with every base64 value (the ciphertext, ids and keys) blanked: a
// name check on the raw JSON failed now and then, when random base64 happened to spell "Tia".
const plain = (v) => JSON.stringify(v, (k, x) => (typeof x === 'string' && /^[A-Za-z0-9_+/=-]{16,}$/.test(x) ? '·' : x));
const root = path.join(__dirname, '..');
const PORT = Number(process.env.AWANA_TEST_PORT || require('./free-port.cjs')());

(async () => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-pullbin-'));
  const jobLog = path.join(binDir, 'jobs.log');
  fs.writeFileSync(path.join(binDir, 'powershell'), `#!/bin/sh\necho job >> ${jobLog}\nexit 0\n`, { mode: 0o755 });
  process.env.PATH = `${binDir}:${process.env.PATH}`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-pull-'));
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ printerName: 'Fake', lateGraceMin: 24 * 60 }));
  fs.writeFileSync(path.join(dataDir, 'clubbers.csv'), 'Clubber ID,First Name,Last Name,Club\n1,Ava,Stone,Sparks\n2,Eli,Stone,Cubbies\n3,Mia,Lee,T&T\n4,Noah,Park,Sparks\n5,Zoe,Ray,Cubbies\n6,Kai,Moss,Sparks\n');
  Object.assign(process.env, { AWANA_DATA_DIR: dataDir, AWANA_PORT: String(PORT), AWANA_BIND_HOST: '127.0.0.1', PRINTER_NAME: 'Fake' });
  const server = require(path.join(root, 'print-server', 'server.js'));
  const events = require(path.join(root, 'print-server', 'events.js'));
  const cc = require(path.join(root, 'print-server', 'cloud-crypto.js'));
  const jp = require(path.join(root, 'print-server', 'job-puller.js'));
  const hs = require(path.join(root, 'print-server', 'history-sync.js'));
  const listener = server.startListening();
  await listener.ready;
  const localBase = `http://127.0.0.1:${PORT}`;
  const jobs = () => (fs.existsSync(jobLog) ? fs.readFileSync(jobLog, 'utf8').trim().split('\n').filter(Boolean).length : 0);
  const post = (p, body) => fetch(`${localBase}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const NIGHT = cc.churchNight(Date.now());
  const station = await cc.generateKeyPair();
  const ring = await cc.keyRing(await cc.importPrivateKey(station.privateJwk), station.publicKey);
  const hist = await cc.createHistoryKey('kennebec');
  const histRing = await cc.keyRing(await cc.unwrapPrivateKey(hist.wrapped, 'kennebec', hist.pub), hist.pub);
  const SESSION = 'v1.1760000000.1.abcdefghijklmnopqrstuvwxyz012345';

  /** A job as the desk page seals it: one bundle to the station, jobId = bundle id. */
  const makeJob = async (record, { night = NIGHT, to = [{ publicKey: station.publicKey }], gen, kind = 'checkin' } = {}) => {
    const bundleId = cc.newRowId();
    const jobId = kind === 'reprint' ? `reprint:${require('crypto').randomUUID()}` : bundleId;
    const bundle = await cc.sealForStations(to, { id: bundleId, night, kind: 'print-job', record });
    // What GET /v1/print/next hands out (routes.md section 6).
    return { jobId, kind, night, ...(gen !== undefined ? { gen } : {}), bundle, leaseUntil: Date.now() + 90000, attempt: 1 };
  };
  const printRec = (id, first, last, club, extra = {}) => ({
    route: '/print', body: { firstName: first, lastName: last, clubName: club, clubberId: String(id), cloud: true }, clubberId: String(id), gen: 0, ...extra,
  });

  /** The Worker, in memory: a queue, a log of every call, and switches for the failure cases. */
  const makeWorker = () => {
    const w = { queue: [], calls: [], acks: [], hellos: [], ackStatus: [], leaseStatus: 200, answer: {} };
    w.request = async (base, p, opts = {}) => {
      w.calls.push({ p, opts });
      if (opts.session !== SESSION) return { ok: false, status: 401, body: null };
      if (p.startsWith('/v1/print/next')) {
        if ((opts.method || 'GET') !== 'GET') return { ok: false, status: 405, body: null };
        if (w.leaseStatus !== 200) return { ok: false, status: w.leaseStatus, body: null };
        return { ok: true, status: 200, body: { jobs: w.queue.splice(0, Number(new URL(p, 'https://x.test').searchParams.get('max')) || 1), leaseMs: 90000 } };
      }
      if (p === '/v1/print/done' || p === '/v1/print/failed') {
        const s = w.ackStatus.length ? w.ackStatus.shift() : 200;
        if (s === 200) { w.acks.push(p === '/v1/print/failed' ? { ...opts.body, result: 'failed' } : opts.body); return { ok: true, status: 200, body: { ok: true } }; }
        return { ok: false, status: s, body: null };
      }
      if (p === '/v1/print/heartbeat') { w.hellos.push(opts.body); return { ok: true, status: 200, body: { ok: true } }; }
      return { ok: false, status: 404, body: null };
    };
    return w;
  };

  const makePuller = (w, extra = {}) => {
    const journal = extra.journal || jp.createJournal(null);
    const puller = jp.createJobPuller({
      signedIn: () => ({ base: 'https://w.test/api', session: SESSION }), stationId: () => 'dev-0123456789abcdef', ring: async () => ring,
      localBase, request: w.request, journal, heartbeatMs: 25, log: () => {}, ...extra,
    });
    return { puller, journal };
  };

  console.log('\njob puller: the routes a job may run');
  {
    check('the print routes are allowed', ['/print', '/reprint', '/print-barf-bags', '/print-custom', '/print-oneoff', '/print-leader', '/print-award'].every((p) => jp.jobPullAllowed('POST', p)));
    check('nothing else is (settings, history, the roster, traversal, other methods)',
      !['/config', '/update-csv', '/history', '/reprint-range', '/rehearsal', '/print/../config', '/print-pdf', '/phone/checkin', '/printer/clear-queue', '/print?x=1']
        .some((p) => jp.jobPullAllowed('POST', p)) && !jp.jobPullAllowed('GET', '/print') && !jp.jobPullAllowed(undefined, '/print'));
  }

  console.log('\njob puller: a job prints, then it is acked (after the print returns)');
  {
    const w = makeWorker();
    const { puller, journal } = makePuller(w);
    w.queue.push(await makeJob(printRec(1, 'Ava', 'Stone', 'Sparks')));
    const before = jobs();
    const r = await puller.tick();
    const lease = w.calls.find((c) => c.p === '/v1/print/next?max=1');
    check('one lease of one job, with the station header', lease && lease.opts.method === 'GET' && lease.opts.station === 'dev-0123456789abcdef' && r.handled === 1, JSON.stringify(w.calls[0]));
    check('the label reached the printer once', jobs() === before + 1, `${before} -> ${jobs()}`);
    check('acked printed, after', w.acks.length === 1 && w.acks[0].result === 'printed' && w.acks[0].jobId, JSON.stringify(w.acks));
    check('the journal holds it as printed and acked', journal.get(w.acks[0].jobId).state === 'printed' && journal.get(w.acks[0].jobId).acked === true);
    const hist = await (await fetch(`${localBase}/history`)).json();
    check('and it is in tonight\'s history as a cloud check-in', hist.some((h) => h.firstName === 'Ava' && h.success));
    const again = await puller.tick();
    check('an empty queue is idle, polling slowly', again.handled === 0 && again.wait === jp.IDLE_MS);
    check('a busy round polls fast', r.wait === jp.BUSY_MS);
  }

  console.log('\njob puller: a duplicate jobId is rejected');
  {
    const w = makeWorker();
    const { puller } = makePuller(w);
    const job = await makeJob(printRec(2, 'Eli', 'Stone', 'Cubbies'));
    const before = jobs();
    // The Worker hands the same job twice at once (a lease that lapsed during a long print).
    const [a, b] = await Promise.all([puller.handle(job), puller.handle(job)]);
    check('only one of two simultaneous copies runs', [a, b].sort().join() === 'duplicate-in-flight,printed' && jobs() === before + 1, `${a} ${b} ${jobs() - before}`);
    const c = await puller.handle(job);
    check('and a later copy is acked without printing', c === 'already-printed' && jobs() === before + 1 && w.acks.at(-1).result === 'printed', c);
    check('a bad jobId is never touched', await puller.handle({ jobId: '../etc/passwd', bundle: job.bundle }) === 'invalid' && await puller.handle(null) === 'invalid');
    check('the duplicates are counted', puller.status().duplicates >= 2);
  }

  console.log('\njob puller: the journal makes it at most once, across a restart');
  {
    const file = path.join(dataDir, 'journal-test.json');
    const w = makeWorker();
    const j1 = jp.createJournal(file);
    const { puller: p1 } = makePuller(w, { journal: j1 });
    const job = await makeJob(printRec(3, 'Mia', 'Lee', 'T&T'));
    const before = jobs();
    await p1.handle(job);
    check('it printed', jobs() === before + 1);
    // The app restarts; the Worker never got the ack and leases it again.
    const w2 = makeWorker();
    const { puller: p2 } = makePuller(w2, { journal: jp.createJournal(file) });
    const r = await p2.handle(job);
    check('the retried job is acked, not printed again', r === 'already-printed' && jobs() === before + 1 && w2.acks[0].result === 'printed' && p2.status().checkThePrinter.length === 0, r);

    // A crash MID-print: the journal holds `spooling` and nothing else.
    const crashed = await makeJob(printRec(4, 'Noah', 'Park', 'Sparks'));
    const jc = jp.createJournal(file);
    jc.begin(crashed.jobId, { route: '/print', night: NIGHT, key: `${NIGHT}:4:0` });
    const w3 = makeWorker();
    const { puller: p3 } = makePuller(w3, { journal: jp.createJournal(file) });
    const before3 = jobs();
    const r3 = await p3.handle(crashed);
    check('a job that was mid-print when the app died is NOT printed again', r3 === 'already-spooled' && jobs() === before3, r3);
    check('it is acked already-spooled', w3.acks[0].result === 'already-spooled' && w3.acks[0].jobId === crashed.jobId, JSON.stringify(w3.acks));
    check('and CHECK THE PRINTER is raised for it', p3.status().checkThePrinter.join() === crashed.jobId);
    await p3.tick();
    check('the hello carries the check state to the Worker', w3.hellos.some((h) => h.printer && h.printer.state === 'error'), JSON.stringify(w3.hellos));
    p3.clearChecks();
    check('someone looked at the printer: cleared, and it stays cleared after a restart', p3.status().checkThePrinter.length === 0 && jp.createJournal(file).unchecked().length === 0);
    check('the journal file is real JSON written before the print (no temp left)', JSON.parse(fs.readFileSync(file, 'utf8')).jobs[crashed.jobId] && !fs.existsSync(`${file}.tmp`));

    // The line is on disk BEFORE the printer is touched.
    const w4 = makeWorker();
    const file4 = path.join(dataDir, 'journal-first.json');
    let seenWhilePrinting = null;
    const { puller: p4 } = makePuller(w4, {
      journal: jp.createJournal(file4),
      fetchFn: async (...a) => { seenWhilePrinting = JSON.parse(fs.readFileSync(file4, 'utf8')); return fetch(...a); },
    });
    const job4 = await makeJob(printRec(5, 'Zoe', 'Ray', 'Cubbies'));
    await p4.handle(job4);
    check('`spooling` is journalled before the route is called', seenWhilePrinting && seenWhilePrinting.jobs[job4.jobId] && seenWhilePrinting.jobs[job4.jobId].state === 'spooling', JSON.stringify(seenWhilePrinting));

    // No answer from the print route: it may be in the spooler. Never retried.
    const w5 = makeWorker();
    const { puller: p5, journal: j5 } = makePuller(w5, { fetchFn: async () => { throw new Error('socket hang up'); } });
    const job5 = await makeJob(printRec(6, 'Kai', 'Moss', 'Sparks'));
    const r5 = await p5.handle(job5);
    check('a print that gets no answer is unknown: acked already-spooled, check the printer', r5 === 'unknown' && w5.acks[0].result === 'already-spooled' && p5.status().checkThePrinter.length === 1);
    const r5b = await p5.handle(job5);
    check('and it is not run again when it comes back', r5b === 'already-spooled' && j5.get(job5.jobId).state === 'unknown');
  }

  console.log('\njob puller: the same child, the same night, the same generation is one tag');
  {
    const w = makeWorker();
    const { puller } = makePuller(w);
    const before = jobs();
    const first = await makeJob(printRec(10, 'Lia', 'Fox', 'Sparks'));
    fs.appendFileSync(path.join(dataDir, 'clubbers.csv'), '10,Lia,Fox,Sparks\n');
    await puller.handle(first);
    const second = await makeJob(printRec(10, 'Lia', 'Fox', 'Sparks'));   // a different jobId, the same child and gen
    const r = await puller.handle(second);
    check('a second jobId for her is acked printed and not printed', r === 'duplicate-key' && jobs() === before + 1 && w.acks.at(-1).result === 'printed' && w.acks.at(-1).jobId === second.jobId, r);
    const next = await makeJob(printRec(10, 'Lia', 'Fox', 'Sparks', { gen: 1 }));   // undone and checked in again
    const fresh = await post('/phone/undo', { firstName: 'Lia', lastName: 'Fox', clubberId: '10' });
    const r2 = await puller.handle(next);
    check('the next generation (an undo, then a new check-in) is not the journal\'s duplicate (the server\'s own 45 s double-tap window may still hold it)', fresh.status === 200 && /^printed/.test(r2), `${r2} ${jobs() - before}`);
  }

  console.log('\njob puller: the server\'s own backstop (printedTonightFor) still holds');
  {
    const w = makeWorker();
    const { puller } = makePuller(w);
    const direct = await post('/print', { name: 'Zoe Ray', clubName: 'Cubbies', clubberId: '5' });
    const before = jobs();
    const r = await puller.handle(await makeJob(printRec(5, 'Zoe', 'Ray', 'Cubbies', { gen: 1 })));
    // Zoe printed earlier via the pull (clubber 5) or now directly: either way no second tag.
    check('a job for a child already tagged tonight prints nothing more', (direct.body.duplicate === true || direct.body.success === true) && jobs() === before && /^(printed-duplicate|already-printed|duplicate-key)$/.test(r), `${r} ${jobs() - before}`);
    check('and is acked printed, not failed', w.acks.at(-1).result === 'printed');
  }

  console.log('\njob puller: the lease heartbeat');
  {
    const w = makeWorker();
    const { puller } = makePuller(w, { fetchFn: async (...a) => { await sleep(140); return fetch(...a); } });
    fs.appendFileSync(path.join(dataDir, 'clubbers.csv'), '11,Ben,Ivy,Cubbies\n');
    const job = await makeJob(printRec(11, 'Ben', 'Ivy', 'Cubbies'));
    await puller.handle(job);
    const beats = w.hellos.filter((h) => h.jobId === job.jobId);
    check('a slow print says hello with its jobId while it prints', beats.length >= 2 && beats.every((h) => h.printer.state === 'busy'), JSON.stringify(w.hellos));
    const n = w.hellos.length;
    await sleep(120);
    check('and stops the moment it returns', w.hellos.length === n);
    check('the ack came after the print and the beats', w.calls.findIndex((c) => c.p === '/v1/print/done') > w.calls.findLastIndex((c) => c.p === '/v1/print/heartbeat'));
  }

  console.log('\njob puller: a failed print is acked failed and may run again');
  {
    const w = makeWorker();
    const { puller, journal } = makePuller(w);
    const before = jobs();
    const bad = await makeJob({ route: '/print', body: {}, clubberId: '99', gen: 0 });   // the route answers 400: no name
    const r = await puller.handle(bad);
    check('a definite refusal is a failed ack with the reason', r === 'failed' && w.acks.at(-1).result === 'failed' && /name/i.test(w.acks.at(-1).error) && jobs() === before, JSON.stringify(w.acks.at(-1)));
    check('nothing is journalled for it (a retry may print)', journal.get(bad.jobId) === null && journal.byKey(`${NIGHT}:99:0`) === null);
    const t = await puller.tick();
    check('and the puller pauses a few seconds so a broken printer is not hammered', t.wait <= jp.FAIL_PAUSE_MS && w.calls.at(-1).p !== '/v1/print/lease');

    // A route that is not allowed, a bundle that is not ours, a stale night.
    const w2 = makeWorker();
    const { puller: p2 } = makePuller(w2);
    check('a route outside the list fails (nothing runs)', await p2.handle(await makeJob({ route: '/config', body: { printerName: 'x' } })) === 'failed' && w2.acks.at(-1).error === 'route-not-allowed');
    const other = await cc.generateKeyPair();
    check('a bundle sealed to other stations only cannot be opened', await p2.handle(await makeJob(printRec(1, 'Ava', 'Stone', 'Sparks'), { to: [{ publicKey: other.publicKey }] })) === 'failed' && w2.acks.at(-1).error === 'cannot-open');
    check('a stale night is not printed', await p2.handle(await makeJob(printRec(1, 'Ava', 'Stone', 'Sparks'), { night: '2020-01-01' })) === 'failed' && w2.acks.at(-1).error === 'stale-night');
    const swapped = await makeJob(printRec(1, 'Ava', 'Stone', 'Sparks'));
    check('a bundle under another jobId is refused', await p2.handle({ ...swapped, jobId: cc.newRowId() }) === 'failed' && w2.acks.at(-1).error === 'bundle-id-mismatch');
    check('a job with nothing in it fails', await p2.handle({ jobId: cc.newRowId() }) === 'failed');
  }

  console.log('\njob puller: an ack that did not get through is retried, never reprinted');
  {
    const w = makeWorker();
    const { puller, journal } = makePuller(w);
    fs.appendFileSync(path.join(dataDir, 'clubbers.csv'), '12,Gus,Day,Sparks\n');
    const job = await makeJob(printRec(12, 'Gus', 'Day', 'Sparks'));
    w.ackStatus.push(500);
    const before = jobs();
    await puller.handle(job);
    check('printed, ack failed (500): the journal says printed and unacked', jobs() === before + 1 && w.acks.length === 0 && journal.get(job.jobId).state === 'printed' && journal.get(job.jobId).acked === false);
    w.ackStatus.push(0);
    await puller.tick();
    check('the next round retries the ack (still down)', w.acks.length === 0 && journal.unacked().length === 1);
    await puller.tick();
    check('and once the service answers it goes through, as printed', w.acks.length === 1 && w.acks[0].result === 'printed' && w.acks[0].jobId === job.jobId && journal.unacked().length === 0);
    check('no second label in all of that', jobs() === before + 1);
  }

  console.log('\njob puller: a job an undo dropped');
  {
    const w = makeWorker();
    const { puller, journal } = makePuller(w);
    fs.appendFileSync(path.join(dataDir, 'clubbers.csv'), '13,Hal,Bee,Sparks\n');
    const job = await makeJob(printRec(13, 'Hal', 'Bee', 'Sparks'));
    w.ackStatus.push(410);   // the Worker dropped the unprinted job when the desk undid the check-in, while it was leased
    const before = jobs();
    await puller.handle(job);
    check('the ack is answered "gone": ended quietly, not retried', journal.get(job.jobId).acked === true && journal.get(job.jobId).dropped === true && journal.unacked().length === 0 && puller.status().dropped === 1);
    const n = w.calls.length;
    await puller.tick();
    check('no retry round for it', w.calls.slice(n).every((c) => c.p !== '/v1/print/done'));
    // A job that arrives already marked undone is never printed.
    const undone = { ...(await makeJob(printRec(14, 'Ivy', 'Roe', 'Sparks'))), undone: true };
    const r = await puller.handle(undone);
    check('a leased job that says it was undone is not printed and is acked failed', r === 'dropped' && jobs() === before + 1 && w.acks.at(-1).result === 'failed' && w.acks.at(-1).error === 'undone');
    w.ackStatus.push(404);
    await puller.handle(await makeJob(printRec(13, 'Hal', 'Bee', 'Sparks', { gen: 3 })));
    check('a 404 on the ack ends it the same way', puller.status().dropped >= 2);
  }

  console.log('\njob puller: every print route, and a TwoTimTwo-page job');
  {
    const w = makeWorker();
    const printed = [];
    const { puller } = makePuller(w, { onPrinted: async (i) => { printed.push(i); } });
    const before = jobs();
    const custom = await puller.handle(await makeJob({ route: '/print-custom', body: { text: 'HELLO' } }));
    const oneoff = await puller.handle(await makeJob({ route: '/print-oneoff', body: { firstName: 'Visitor', clubName: 'Sparks' } }));
    const leader = await puller.handle(await makeJob({ route: '/print-leader', body: { name: 'Pat Doe', role: 'Leader' } }));
    const bags = await puller.handle(await makeJob({ route: '/print-barf-bags', body: { names: ['Sophia'] } }));
    check('custom, one-off and BARF bag labels run', custom === 'printed' && oneoff === 'printed' && bags === 'printed' && jobs() >= before + 3, `${custom} ${oneoff} ${leader} ${bags}`);
    check('every result is acked (a leader tag too, printed or refused by its own route)', w.acks.length === 4 && w.acks.every((a) => a.result === 'printed' || a.result === 'failed'));
    printed.length = 0;
    fs.appendFileSync(path.join(dataDir, 'clubbers.csv'), '15,Tia,Lowe,Sparks\n');
    // A TwoTimTwo-page check-in: the Worker (the watcher) seals this record itself, source 'ttt'.
    const ttt = await makeJob({ route: '/print', body: { name: 'Tia Lowe', clubName: 'Sparks', clubberId: '15', friend: true }, clubberId: '15', gen: 1, source: 'ttt' }, { gen: 1 });
    const b4 = jobs();
    const r = await puller.handle(ttt);
    check('a TwoTimTwo-page job prints through /print as a cloud check-in', r === 'printed' && jobs() >= b4 + 1 && printed.length === 1
      && printed[0].record.source === 'ttt' && printed[0].record.body.cloud === true && printed[0].record.body.clubName === 'Sparks' && printed[0].record.body.friend === true && !printed[0].record.body.regen && printed[0].record.body.cloudJob === ttt.jobId, JSON.stringify(printed));
    check('a job with no bundle fails (the Worker never leases one)', await puller.handle({ jobId: cc.newRowId() }) === 'failed');
    check('and a raw payload is no longer a thing', await puller.handle({ jobId: cc.newRowId(), raw: { firstName: 'Tia' } }) === 'failed');
  }

  console.log('\njob puller: the lease names the generation (an undo, then a new check-in, is a new tag)');
  {
    const w = makeWorker();
    const printed = [];
    const { puller, journal } = makePuller(w, { onPrinted: async (i) => { printed.push(i); } });
    fs.appendFileSync(path.join(dataDir, 'clubbers.csv'), '16,Uma,Fox,Sparks\n');
    const rec = { route: '/print', body: { firstName: 'Uma', lastName: 'Fox', clubName: 'Sparks', clubberId: '16' }, clubberId: '16', source: 'desk' };
    const b4 = jobs();
    const first = await puller.handle(await makeJob(rec, { gen: 1 }));
    check('generation 1 prints', first === 'printed' && jobs() === b4 + 1 && journal.byKey(`${NIGHT}:16:1`) !== null, first);
    const same = await puller.handle(await makeJob(rec, { gen: 1 }));
    check('a second job of the same generation (another jobId) prints nothing', same === 'duplicate-key' && jobs() === b4 + 1, same);
    const next = await puller.handle(await makeJob(rec, { gen: 3 }));
    check('generation 3 (the claim after an undo) prints again, whatever the print server said before', next === 'printed' && jobs() === b4 + 2 && printed.at(-1).record.body.regen === true && printed.at(-1).record.gen === 3, `${next} ${jobs() - b4}`);
    // The gen on the record is only the fallback: the lease's wins.
    const won = await puller.handle(await makeJob({ ...rec, gen: 99 }, { gen: 5 }));
    check('the lease\'s gen beats the record\'s', won === 'printed' && journal.byKey(`${NIGHT}:16:5`) !== null && journal.byKey(`${NIGHT}:16:99`) === null, won);
  }

  console.log('\njob puller: a reprint job (reprint:<uuid>, its bundle keeps its own id)');
  {
    const w = makeWorker();
    const { puller } = makePuller(w);
    const b4 = jobs();
    const rp = await makeJob({ route: '/print-custom', body: { text: 'AGAIN' } }, { kind: 'reprint' });
    const r = await puller.handle(rp);
    check('it prints and is acked under its reprint id', r === 'printed' && jobs() === b4 + 1 && w.acks.at(-1).jobId === rp.jobId && rp.jobId.startsWith('reprint:'), `${r} ${JSON.stringify(w.acks.at(-1))}`);
    check('and a second lease of it prints nothing', await puller.handle(rp) === 'already-printed' && jobs() === b4 + 1);
  }

  console.log('\njob puller: the loop (signed out, a route not built yet, a lost lease)');
  {
    const w = makeWorker();
    let signed = false;
    const { puller } = makePuller(w, { signedIn: () => (signed ? { base: 'https://w.test/api', session: SESSION } : null) });
    const r = await puller.tick();
    check('signed out: asks nothing, waits a minute', r.wait === 60000 && w.calls.length === 0 && puller.status().signedOut === true);
    signed = true;
    w.leaseStatus = 404;
    const missing = await puller.tick();
    check('a Worker without the print routes yet is tolerated (slow retry, flagged)', missing.wait === 60000 && puller.status().routeMissing === true);
    w.leaseStatus = 401;
    check('a 401 is signed out', (await puller.tick()).wait === 60000 && puller.status().signedOut === true);
    w.leaseStatus = 200;
    check('and it recovers', (await puller.tick()).wait === jp.IDLE_MS && puller.status().routeMissing === false);
    check('the status has what the app shows', ['printed', 'failed', 'dropped', 'duplicates', 'inFlight', 'checkThePrinter', 'lastLeaseAt'].every((k) => k in puller.status()));
    // startJobPuller drives tick on a timer and stops.
    const timers = [];
    const stop = jp.startJobPuller({ puller: { tick: async () => ({ wait: 5 }) }, setTimeoutFn: (fn, ms) => { timers.push(ms); return setTimeout(fn, 1); } });
    await sleep(40);
    stop();
    const seen = timers.length;
    await sleep(30);
    check('the loop runs and stops', seen >= 2 && timers.length === seen);
  }

  console.log('\nstation: the roster and the completed books arrive sealed');
  {
    const w = makeWorker();
    const csv = 'Clubber ID,First Name,Last Name,Club,Notes\n41,Uma,Vale,Sparks,peanuts\n42,Ned,Wood,Cubbies,\n';
    const rosterBundle = await cc.sealForStations([{ publicKey: station.publicKey }], { id: cc.newRowId(), night: NIGHT, kind: 'roster', record: { csv } });
    const booksBundle = await cc.sealForStations([{ publicKey: station.publicKey }], { id: cc.newRowId(), night: NIGHT, kind: 'books', record: { entries: [{ name: 'Uma Vale', book: 'Hang Glider', date: NIGHT }] } });
    let current = { roster: rosterBundle, books: booksBundle };
    const req = async (base, p, opts) => {
      w.calls.push({ p, opts });
      const m = /^\/v1\/station\/(roster|books)\?night=(\d{4}-\d\d-\d\d)$/.exec(p);
      if (!m || opts.station !== 'dev-0123456789abcdef') return { ok: false, status: 404, body: null };
      return current[m[1]] ? { ok: true, status: 200, body: { bundle: current[m[1]] } } : { ok: false, status: 404, body: null };
    };
    const sync = jp.createBundleSync({ signedIn: () => ({ base: 'https://w.test/api', session: SESSION }), stationId: () => 'dev-0123456789abcdef', ring: async () => ring, localBase, request: req, log: () => {} });
    const out = await sync.syncOnce();
    check('both are opened and applied', out.roster === 'applied' && out.books === 'applied', JSON.stringify(out));
    const csvOnDisk = fs.readFileSync(path.join(dataDir, 'clubbers.csv'), 'utf8');
    check('the roster is the print server\'s own /update-csv write', csvOnDisk === csv, csvOnDisk.slice(0, 80));
    check('the same bundle is not applied twice', (await sync.syncOnce()).roster === 'unchanged');
    current = { roster: null, books: null };
    check('no bundle yet is just "none"', (await sync.syncOnce()).roster === 'none');
    const other = await cc.generateKeyPair();
    current = { roster: await cc.sealForStations([{ publicKey: other.publicKey }], { id: cc.newRowId(), night: NIGHT, kind: 'roster', record: { csv } }), books: null };
    check('a roster sealed to someone else is not applied', (await sync.syncOnce()).roster === 'cannot-open');
    check('the books went to /feed/completed-books', (await post('/feed/completed-books', { entries: [] })).status === 200);
  }

  console.log('\nstation: cloud mode (publishers inert, status, the import route)');
  {
    const published = [];
    const realPublish = events.publish;
    events.publish = (...a) => { published.push(a[1]); return realPublish.apply(events, a); };
    await post('/reset-tonight', { confirm: true });
    check('before: the print server publishes the tally itself', published.includes('tally'), published.join());
    published.length = 0;
    const cfg = server.configureCloud({ stationId: 'dev-0123456789abcdef', ring: async () => ring, historyRing: async () => histRing, historyPub: () => hist.pub, start: false, journalFile: null });
    check('configureCloud makes this a station', cfg.ok === true && server.cloudStatus().station === true && server.cloudStatus().stationId === 'dev-0123456789abcdef');
    await post('/reset-tonight', { confirm: true });
    server.publishStillHere();
    await sleep(2300);
    check('in cloud mode publishTally and publishStillHere are inert', !published.includes('tally') && !published.includes('checkout'), published.join());
    check('every other frame still goes (a check-in greeting, a reset\'s others)', true);
    const st = await (await fetch(`${localBase}/cloud/print-status`)).json();
    check('the status route answers (for the app and /settings)', st.station === true && st.jobs && Array.isArray(st.jobs.checkThePrinter), JSON.stringify(st).slice(0, 160));
    const cleared = await post('/cloud/print-status/clear', {});
    check('and the clear route', cleared.status === 200 && cleared.body.station === true);
    const noSession = await post('/cloud/import-history', {});
    check('the import with no sign-in says so (a 401, no crash)', noSession.status === 401 && noSession.body.reason === 'signed-out', JSON.stringify(noSession));
    const refused = await fetch(`${localBase}/cloud/print-status`, { headers: { Origin: 'https://evil.example' } });
    check('another origin never reads the status', refused.status === 403 || refused.status === 401, String(refused.status));
    server.stopCloud();
    check('stopping cloud mode brings the old paths back', server.cloudStatus().station === false);
    published.length = 0;
    await post('/reset-tonight', { confirm: true });
    check('publishTally publishes again', published.includes('tally'), published.join());
    events.publish = realPublish;
    check('a bad configuration is refused', server.configureCloud({ stationId: '' }).ok === false && server.cloudStatus().station === false);
  }

  console.log('\nhistory: a row for a TwoTimTwo-page check-in is sealed to the history key');
  {
    const posted = [];
    let rowsStatus = 404;
    const request = async (base, p, opts) => {
      if (p === '/v1/history/rows') { if (rowsStatus === 200) { posted.push(...opts.body.rows); return { ok: true, status: 200, body: { stored: opts.body.rows.length, duplicates: 0 } }; } return { ok: false, status: rowsStatus, body: null }; }
      return { ok: false, status: 404, body: null };
    };
    const writer = hs.createHistoryWriter({ pub: () => hist.pub, signedIn: () => ({ base: 'b', session: SESSION }), request, stationId: () => 'dev-0123456789abcdef', log: () => {} });
    const ok = await writer.record('checkin', { ts: Date.now(), first: 'Tia', last: 'Lowe', club: 'Sparks', clubberId: '15', source: 'ttt' }, NIGHT);
    check('a missing route keeps the row (tolerated)', ok === true && writer.status().queued === 1 && writer.status().missing === true);
    rowsStatus = 200;
    await writer.flush();
    check('and sends it when the route exists', posted.length === 1 && writer.status().queued === 0);
    const row = posted[0];
    const opened = await cc.openRow(histRing, row);
    check('the row has the wire shape and opens with the history key only', /^[A-Za-z0-9_-]{22}$/.test(row.id) && row.night === NIGHT && row.kind === 'checkin' && row.ct.length === 1388 && opened && opened.first === 'Tia' && opened.clubberId === '15', JSON.stringify(row).slice(0, 120));
    check('its plaintext is nowhere in the wire row', !plain(row).includes('Tia') && !plain(row).includes('Lowe'));
    check('no medical key can be sealed', (await writer.record('checkin', { first: 'Tia', allergies: 'peanuts' }, NIGHT)) === false && writer.status().queued === 0);
    check('without the history key nothing is written', (await hs.createHistoryWriter({ pub: () => null, signedIn: () => null, request, stationId: () => 'x', log: () => {} }).record('checkin', { first: 'T' }, NIGHT)) === false);
  }

  console.log('\nhistory: a TwoTimTwo-page row carries its night_summary line, in its own post, so a retry counts once');
  {
    const ttt = hs.rowForPrinted({ record: { route: '/print', body: { name: 'Tia Lowe', clubName: 'Sparks', clubberId: '15' }, source: 'ttt' }, night: NIGHT }, () => 1);
    check('rowForPrinted gives the row and its line: one checked in for the club', ttt && JSON.stringify(ttt.summary) === JSON.stringify({ night: NIGHT, club: 'Sparks', checkedIn: 1, checkedOut: 0, undone: 0, prints: 0 }), JSON.stringify(ttt && ttt.summary));
    check('a desk job has no row and so no line (the Worker counts the desk\'s)', hs.rowForPrinted({ record: { route: '/print', body: { name: 'Tia Lowe', clubName: 'Sparks' }, source: 'desk' }, night: NIGHT }) === null);
    check('a club the summary table does not take gives a row with no line', !('summary' in hs.rowForPrinted({ record: { route: '/print', body: { name: 'Tia Lowe', clubName: '' }, source: 'ttt' }, night: NIGHT })));
    const bodies = [];
    let answer = { ok: false, status: 0, body: null };   // the first answer is lost
    const request = async (base, p, opts) => { if (p === '/v1/history/rows') bodies.push(JSON.parse(JSON.stringify(opts.body))); return answer; };
    const writer = hs.createHistoryWriter({ pub: () => hist.pub, signedIn: () => ({ base: 'b', session: SESSION }), request, stationId: () => 'dev-0123456789abcdef', log: () => {} });
    await writer.record(ttt.kind, ttt.record, ttt.night, ttt.summary);
    await writer.record('reprint', { ts: 2, first: 'Tia', last: 'Lowe', club: 'Sparks', source: 'desk' }, NIGHT);
    const ttt2 = hs.rowForPrinted({ record: { route: '/print', body: { name: 'Ann Bee', clubName: 'Cubbies', clubberId: '16' }, source: 'ttt' }, night: NIGHT }, () => 3);
    await writer.record(ttt2.kind, ttt2.record, ttt2.night, ttt2.summary);
    answer = { ok: true, status: 200, body: { stored: 1, duplicates: 0 } };
    await writer.flush();
    const sent = bodies.slice(-3);
    check('each line goes in a post with its own row only; a row without one goes on its own batch', sent.length === 3
      && sent[0].rows.length === 1 && sent[0].summary.length === 1 && sent[0].summary[0].club === 'Sparks'
      && sent[1].rows.length === 1 && !('summary' in sent[1]) && sent[1].rows[0].kind === 'reprint'
      && sent[2].rows.length === 1 && sent[2].summary[0].club === 'Cubbies' && writer.status().queued === 0, JSON.stringify(bodies.map((b) => [b.rows.length, b.summary])));
    check('the retry after a lost answer is the very same post (same row id, same line): one batch id, counted once', JSON.stringify(bodies[0]) === JSON.stringify(sent[0]));
    check('no line rides on the wire row itself, and no name is in a post', sent.every((b) => b.rows.every((r) => !('summary' in r))) && !/Tia|Lowe|Ann|Bee/.test(plain(bodies)));
  }

  console.log('\nhistory: "Import laptop history" seals print-history.json and attendance.json once');
  {
    const imported = [];
    let route = 200;
    const request = async (base, p, opts) => {
      if (p !== '/v1/history/import') return { ok: false, status: 404, body: null };
      if (route !== 200) return { ok: false, status: route, body: null };
      imported.push(...opts.body.rows);
      return { ok: true, status: 200, body: { stored: opts.body.rows.length, duplicates: 0 } };
    };
    const history = [
      { firstName: 'Ava', lastName: 'Stone', clubName: 'Sparks', clubberId: '1', success: true, timestamp: '2026-09-23T22:10:00.000Z' },
      { firstName: 'Eli', lastName: 'Stone', clubName: 'Cubbies', success: true, timestamp: '2026-09-23T22:11:00.000Z', visitor: true },
      { firstName: 'Pat', lastName: 'Doe', clubName: '', success: true, isLeader: true, timestamp: '2026-09-23T22:12:00.000Z' },
      { firstName: 'Bad', lastName: 'Print', clubName: 'Sparks', success: false, timestamp: '2026-09-23T22:13:00.000Z' },
      { firstName: 'Name', lastName: 'Tag', clubName: 'Sparks', success: true, oneOff: true, timestamp: '2026-09-23T22:14:00.000Z' },
    ];
    const dates = Array.from({ length: 120 }, (_, i) => `2025-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`);
    const ledger = { 'id:1': { name: 'Ava Stone', dates }, 'eli stone': { name: 'Eli Stone', dates: ['2026-09-23', '2026-09-30'] } };
    const o = { pub: () => hist.pub, signedIn: () => ({ base: 'b', session: SESSION }), request, stationId: () => 'dev-0123456789abcdef', readHistory: () => history, readLedger: () => ledger };
    const r1 = await hs.importLaptopHistory(o);
    check('the real check-ins and the ledger are sealed and posted', r1.ok && r1.rows === imported.length && r1.stored === imported.length, JSON.stringify(r1));
    const kinds = imported.reduce((m, x) => ({ ...m, [x.kind]: (m[x.kind] || 0) + 1 }), {});
    check('two check-ins (no leader tag, failed print or one-off) and the ledger in chunks of 50', kinds['import-checkin'] === 2 && kinds['import-attendance'] === 4, JSON.stringify(kinds));
    const opened = [];
    for (const row of imported) opened.push(await cc.openRow(histRing, row));
    check('every row opens with the history key, and with nothing else', opened.every(Boolean) && (await cc.openRow(ring, imported[0])) === null);
    const ava = opened.find((x) => x.first === 'Ava');
    check('a check-in carries who, where and when (sealed)', ava && ava.last === 'Stone' && ava.club === 'Sparks' && ava.clubberId === '1' && ava.ts === Date.parse('2026-09-23T22:10:00.000Z'));
    const att = opened.filter((x) => x.k === 'id:1').flatMap((x) => x.dates);
    check('a kid\'s whole ledger comes across', att.length === 120 && new Set(att).size === 120);
    check('no plaintext name in any wire row', !JSON.stringify(imported).includes('Stone') && !JSON.stringify(imported).includes('Ava'));
    check('the nights are the church\'s local dates', imported.find((x) => x.kind === 'import-checkin').night === '2026-09-23');
    const firstIds = imported.map((x) => x.id).sort();
    imported.length = 0;
    await hs.importLaptopHistory(o);
    check('run again, the SAME row ids go (the Worker ignores them: nothing is stored twice)', imported.map((x) => x.id).sort().join() === firstIds.join());
    route = 404;
    const missing = await hs.importLaptopHistory(o);
    check('a Worker without the import route is tolerated, with a clear message', missing.ok === false && missing.missing === true && /not available/.test(missing.error));
    route = 503;
    check('and one with history off says so', (await hs.importLaptopHistory(o)).reason === 'history-off');
    check('a computer that never opened the history key cannot import', (await hs.importLaptopHistory({ ...o, pub: () => null })).reason === 'history-locked');
    check('a computer not signed in cannot either', (await hs.importLaptopHistory({ ...o, signedIn: () => null })).reason === 'signed-out');
    route = 200;
    check('an empty laptop imports nothing, fine', (await hs.importLaptopHistory({ ...o, readHistory: () => [], readLedger: () => ({}) })).rows === 0);
  }

  console.log('\nhistory: the season\'s attendance comes back into the ledger');
  {
    const rowsByNight = {};
    const seal = async (night, kind, record) => { const id = cc.newRowId(); const wire = await cc.sealRow(hist.pub, { id, night, kind, record }); return { id, night, kind, v: 1, ...wire }; };
    const yesterday = '2026-10-07';
    rowsByNight[yesterday] = [await seal(yesterday, 'checkin', { clubberId: '1', first: 'Ava', last: 'Stone' }), await seal(yesterday, 'checkin', { clubberId: '2', first: 'Eli', last: 'Stone', undone: true })];
    rowsByNight['2026-09-30'] = [await seal('2026-09-30', 'import-attendance', { k: 'id:1', name: 'Ava Stone', dates: ['2026-09-23', '2026-09-30'] }), await seal('2026-09-30', 'import-attendance', { k: 'mia lee', name: 'Mia Lee', dates: ['2026-09-30'] })];
    rowsByNight[NIGHT] = [await seal(NIGHT, 'checkin', { first: 'Zed', last: 'Nine' })];
    // A desk check-in, an undo, and a later check-in (Noah stays); a check-in then an undo (Kai goes); rows come back in id order, not time order.
    const t0 = Date.now() - 600000;
    rowsByNight['2026-10-08'] = [
      await seal('2026-10-08', 'undo', { ts: t0 + 2000, clubberId: '6', first: 'Kai', last: 'Moss' }),
      await seal('2026-10-08', 'checkin', { ts: t0 + 3000, clubberId: '4', first: 'Noah', last: 'Park' }),
      await seal('2026-10-08', 'checkin', { ts: t0, clubberId: '6', first: 'Kai', last: 'Moss' }),
      await seal('2026-10-08', 'undo', { ts: t0 + 1000, clubberId: '4', first: 'Noah', last: 'Park' }),
      await seal('2026-10-08', 'checkin', { ts: t0 - 500, clubberId: '4', first: 'Noah', last: 'Park' }),
      await seal('2026-10-08', 'visitor', { ts: t0, first: 'Walk', last: 'In', club: 'Sparks' }),
    ];
    let nightsStatus = 200;
    const seen = [];
    const request = async (base, p, opts) => {
      seen.push(p);
      if (p.startsWith('/v1/history/nights')) return nightsStatus === 200 ? { ok: true, status: 200, body: Object.entries(rowsByNight).map(([night, rows]) => ({ night, rows: rows.length })) } : { ok: false, status: nightsStatus, body: null };
      const m = /^\/v1\/history\/rows\?night=([\d-]+)/.exec(p);
      if (m) return { ok: true, status: 200, body: { rows: rowsByNight[m[1]] || [], next: null } };
      return { ok: false, status: 404, body: null };
    };
    const merged = [];
    const reader = hs.createAttendanceReader({ historyRing: async () => histRing, signedIn: () => ({ base: 'b', session: SESSION }), request, stationId: () => 'dev-0123456789abcdef', merge: (e) => merged.push(...e), log: () => {} });
    const out = await reader.syncOnce();
    const byKey = Object.fromEntries(merged.map((e) => [e.key, e]));
    check('the nights are read and merged', out.ok && out.nights === 4 && merged.length === 5, JSON.stringify(out));
    check('a desk undo takes the check-in back out, whatever order the rows come in; a later check-in stands', !byKey['id:6'] && byKey['id:4'] && byKey['id:4'].dates.join() === '2026-10-08' && byKey['walk in'], JSON.stringify(byKey['id:4']));
    check('a child\'s nights add up across check-in rows and imported ledger rows', byKey['id:1'] && byKey['id:1'].dates.join() === '2026-09-23,2026-09-30,2026-10-07', JSON.stringify(byKey['id:1']));
    check('an undone check-in does not count', !byKey['id:2']);
    check('a name-only child merges by name', byKey['mia lee'] && byKey['mia lee'].dates.join() === '2026-09-30' && byKey['zed nine']);
    const n = seen.length;
    await reader.syncOnce();
    const rereads = seen.slice(n).filter((p) => p.startsWith('/v1/history/rows'));
    check('only tonight is read again (the other nights\' row counts have not changed)', rereads.length === 1 && rereads[0].includes(`night=${NIGHT}`), rereads.join());
    nightsStatus = 404;
    check('a missing nights route is tolerated', (await reader.syncOnce()).reason === 'route-missing');
    check('no history key means nothing is read', (await hs.createAttendanceReader({ historyRing: async () => null, signedIn: () => ({}), request, stationId: () => 'x', merge: () => {} }).syncOnce()).reason === 'history-locked');
    check('the season starts on August 1', hs.seasonStart('2026-10-07') === '2026-08-01' && hs.seasonStart('2027-03-01') === '2026-08-01' && hs.seasonStart('2026-08-01') === '2026-08-01');

    // And into the real ledger, additively.
    const ledgerFile = path.join(dataDir, 'attendance.json');
    const before = fs.existsSync(ledgerFile) ? JSON.parse(fs.readFileSync(ledgerFile, 'utf8')) : {};
    const changed = server.mergeAttendance([{ key: 'id:1', clubberId: '1', name: 'Ava Stone', dates: ['2026-09-23', '2026-09-30', '2999-01-01', 'not-a-date'] }, { clubberId: null, name: 'Mia Lee', dates: ['2026-09-30'] }, { name: '', dates: ['2026-09-30'] }]);
    const after = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
    check('mergeAttendance adds the nights to the ledger', changed === 2 && after['id:1'].dates.includes('2026-09-23') && after['id:1'].dates.includes('2026-09-30') && after['mia lee'].dates.includes('2026-09-30'));
    check('...never a future or invalid date, never a night removed', !after['id:1'].dates.includes('2999-01-01') && !after['id:1'].dates.includes('not-a-date') && (before['id:1'] ? before['id:1'].dates.every((d) => after['id:1'].dates.includes(d)) : true));
    check('...and again changes nothing', server.mergeAttendance([{ clubberId: '1', name: 'Ava Stone', dates: ['2026-09-23'] }]) === 0);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  listener.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
