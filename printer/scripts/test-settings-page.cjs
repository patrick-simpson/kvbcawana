#!/usr/bin/env node
// Tests for the settings page's way in (ROADMAP.md#settings-page phase 3): the one https
// origin awana.kvbchurch.org calling this server on localhost.
//
// What is pinned: the preflight (the exact origin, Authorization, Chrome's
// Private Network Access opt-in) on the routes the page uses and ONLY those;
// the publish token on every one of them but /health; the printer's own keys
// as the only thing POST /config takes from the page, so a PIN, a key, the
// network switch or the CORS list can never be changed from it; and that the
// dashboard's own calls (no Origin, same origin) are exactly what they were.
//
// Online only (2026-10-12): the dashboard is gone, so every tool it had that is
// still needed is a route here (leader tags, one-off and custom labels, a
// stretch reprint, the attendance audit, rehearsal mode, this computer's own
// sync sign-in). Each is pinned below: listed, preflighted, refused without
// proof, allowed with it. The secrets are not: the display key, the publish
// token and the session are never in the table, never readable and never
// settable from the page.
//
// Run: node scripts/test-settings-page.cjs

'use strict';

// A crashed suite must FAIL, not pass (see test-lobby-slides.cjs).
let __suiteFinished = false;
process.on('exit', (code) => {
  if (code === 0 && !__suiteFinished) {
    console.error('✗ Test suite terminated before completing (crash swallowed?) — failing.');
    process.exitCode = 1;
  }
});

const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.AWANA_TEST_PORT || require('./free-port.cjs')());
const BASE = `http://127.0.0.1:${PORT}`;
const PAGE = 'https://awana.kvbchurch.org';
const OLD_SITE = 'https://patrick-simpson.github.io';
const SYNC = 'https://sync.example.org';
const GOOD_SESSION = 'v1.2.1700000000000.settingspagesettingspagesettings';
const GOOD_SESSION_B = 'v1.2.1700000000001.settingspagesecondsessionsecond';
const syncChecks = [];
const loginUrls = [];
const NEW_SESSION = 'v1.9.1700000000000.printserverrelogin0000000000';
const SERVICE_KEY = Buffer.alloc(32, 7).toString('base64');
// The Worker's church settings doc (routes.md 10.3); null: a Worker without the route.
let churchDoc = null;

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const security = require(path.join(__dirname, '..', 'print-server', 'security.js'));

async function j(pathname, opts) {
  const res = await fetch(BASE + pathname, opts);
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
}
const post = (pathname, body, headers) => j(pathname, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(headers || {}) },
  body: JSON.stringify(body || {}),
});
const preflight = (pathname, method, origin, extra) => fetch(BASE + pathname, {
  method: 'OPTIONS',
  headers: {
    Origin: origin,
    'Access-Control-Request-Method': method,
    'Access-Control-Request-Headers': 'content-type,authorization',
    'Access-Control-Request-Private-Network': 'true',
    ...(extra || {}),
  },
});

async function main() {
  console.log('\nsettings page: the route table (pure)');
  {
    const r = security.settingsPageRoute;
    check('/health is open to the page', r(PAGE, '/health', 'GET') && r(PAGE, '/health', 'GET').open === true);
    check('/printers needs the token (not open)', r(PAGE, '/printers', 'GET') && !r(PAGE, '/printers', 'GET').open);
    check('the method must be one the route lists', r(PAGE, '/config', 'POST') && !r(PAGE, '/health', 'POST') && !r(PAGE, '/printers', 'POST'));
    check('only that exact origin', !r(OLD_SITE, '/health', 'GET') && !r('https://awana.kvbchurch.org.evil.example', '/health', 'GET')
      && !r('http://awana.kvbchurch.org', '/health', 'GET') && !r('https://evil.example', '/health', 'GET') && !r(undefined, '/health', 'GET'));
    check('nothing outside the table', !r(PAGE, '/stats/tonight', 'GET') && !r(PAGE, '/phone/roster', 'POST')
      && !r(PAGE, '/api/lobby-slides', 'GET') && !r(PAGE, '/config/display-key/generate', 'POST')
      && !r(PAGE, '/config/slides-token/generate', 'POST') && !r(PAGE, '/config/display-login/generate', 'POST')
      && !r(PAGE, '/config/sync-logout', 'POST') && !r(PAGE, '/update-now', 'POST') && !r(PAGE, '/reconcile', 'GET')
      && !r(PAGE, '/attendance-audit', 'GET') && !r(PAGE, '/attendance-audit/apply', 'POST')
      && !r(PAGE, '/constructor', 'GET') && !r(PAGE, '/__proto__', 'GET'));
    // The tools that moved here from the dashboard (Online only): each is a row of its own.
    check('the moved tools are in the table, with their own methods', [
      ['/leaders', 'GET'], ['/leaders/forget', 'POST'], ['/print-leader', 'POST'], ['/print-oneoff', 'POST'], ['/print-custom', 'POST'],
      ['/reprint-range', 'POST'], ['/rehearsal', 'POST'],
      ['/config/sync-login', 'POST'],
    ].every(([p, m]) => r(PAGE, p, m) && !r(PAGE, p, 'DELETE') && !r(PAGE, p, m === 'GET' ? 'POST' : 'GET') && !r(PAGE, p, m).open));
    check('the print station\'s status, its clear and the history import are rows of their own', [
      ['/cloud/print-status', 'GET'], ['/cloud/print-status/clear', 'POST'], ['/cloud/import-history', 'POST'],
    ].every(([p, m]) => r(PAGE, p, m) && !r(PAGE, p, 'DELETE') && !r(PAGE, p, m === 'GET' ? 'POST' : 'GET') && !r(PAGE, p, m).open));
    check('...and none of them is open (each needs the sign-in)', Object.keys(security.SETTINGS_PAGE_ROUTES).filter((p) => security.SETTINGS_PAGE_ROUTES[p].open).join() === '/health');
    check('...a secret-minting or secret-reading route is never in the table', !['/config/display-key/generate', '/config/slides-token/generate', '/config/display-login/generate', '/config/sync-logout', '/api/lobby-slides', '/api/display-settings']
      .some((p) => Object.prototype.hasOwnProperty.call(security.SETTINGS_PAGE_ROUTES, p)));
    check('the Wi-Fi phone page is not in the table', !r(PAGE, '/phone', 'GET') && !r(PAGE, '/phone/ym', 'GET'));
    const refusals = security.settingsPageConfigRefusals;
    check('the printer keys pass', refusals({ printerName: 'A', backupPrinterName: '', pickupClubs: ['Sparks'], labelFooter: 'x' }).length === 0);
    check('every secret key is refused', ['pusherSecret', 'phonePin', 'displayKey', 'slidesPublishToken', 'displayLoginPassphrase', 'syncSession']
      .every((k) => refusals({ [k]: 'x' }).includes(k)));
    check('so is the network, CORS and the check-in URL',
      ['lanAccess', 'allowedOrigins', 'checkinUrl', 'fleetConfigUrl', 'historyRetentionDays']
        .every((k) => refusals({ [k]: 'x' }).includes(k)));
    check('the two switches that moved here pass (update beacon, driven check-ins)',
      refusals({ updateBeacon: true, enableDrivenCheckin: false, musicalPrinter: true }).length === 0);
    check('one bad key refuses the whole body', refusals({ printerName: 'A', phonePin: '1234' }).join() === 'phonePin');
    check('a body that is not an object has nothing to allow', refusals(null).length > 0 && refusals([]).length > 0 && refusals('x').length > 0);
    check('none of the secrets is in the allowed list',
      !security.SETTINGS_PAGE_CONFIG_KEYS.some((k) => ['pusherSecret', 'phonePin', 'displayKey', 'slidesPublishToken', 'displayLoginPassphrase', 'syncSession', 'allowedOrigins', 'lanAccess'].includes(k)));
  }

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-settings-page-'));
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
    printerName: 'Fake',
    checkinUrl: 'https://example.com/checkin',
    phonePin: '4321',
    displayKey: 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=',
    // Signed in to the sync service, as the check-in laptop is.
    syncUrl: SYNC, syncSession: 'v1.1.1700000000000.printserverprintserverprintserver',
  }, null, 2));
  // The sync service, faked: /v1/state answers 200 for GOOD_SESSION only.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (!String(url).startsWith(SYNC)) return realFetch(url, opts);
    const auth = (opts && opts.headers && (opts.headers.Authorization || opts.headers.authorization)) || '';
    if (String(url) === `${SYNC}/v1/state`) {
      syncChecks.push(auth);
      return new Response(JSON.stringify({}), { status: auth === `Bearer ${GOOD_SESSION}` || auth === `Bearer ${GOOD_SESSION_B}` || /printserver/.test(auth) ? 200 : 401 });
    }
    if (String(url) === `${SYNC}/v1/login`) {
      loginUrls.push(String(url));
      const said = JSON.parse((opts && opts.body) || '{}').passphrase;
      if (said !== 'kennebec') return new Response(JSON.stringify({ error: 'no', triesLeft: 4 }), { status: 401 });
      return new Response(JSON.stringify({ session: NEW_SESSION, displayKey: SERVICE_KEY }), { status: 200 });
    }
    if (String(url) === `${SYNC}/v1/church/settings` && churchDoc) return new Response(JSON.stringify(churchDoc), { status: 200 });
    return new Response(JSON.stringify({ error: 'not here' }), { status: 404 });
  };

  process.env.AWANA_DATA_DIR = dataDir;
  process.env.AWANA_PORT = String(PORT);
  process.env.AWANA_BIND_HOST = '127.0.0.1';

  const server = require(path.join(__dirname, '..', 'print-server', 'server.js'));
  const listener = server.startListening();
  await new Promise((resolve) => {
    if (listener.listening) return resolve();
    listener.once('listening', resolve);
  });
  const savedConfig = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'));

  console.log('settings page: the preflight');
  {
    const res = await preflight('/config', 'POST', PAGE);
    check('204 for the settings page', res.status === 204, String(res.status));
    check('echoes the exact origin, never *', res.headers.get('access-control-allow-origin') === PAGE);
    check('admits Authorization (the token)', /authorization/i.test(res.headers.get('access-control-allow-headers') || ''));
    check('opts in to Private Network Access when asked', res.headers.get('access-control-allow-private-network') === 'true');
    check('no credentials mode', !res.headers.get('access-control-allow-credentials'));
    const quiet = await preflight('/config', 'POST', PAGE, { 'Access-Control-Request-Private-Network': '' });
    check('and does not volunteer it when not asked', quiet.status === 204 && !quiet.headers.get('access-control-allow-private-network'));
    const probe = await preflight('/health', 'GET', PAGE);
    check('the /health probe is preflighted too', probe.status === 204 && probe.headers.get('access-control-allow-private-network') === 'true');

    // The same page may not use anything outside its table, or a method the
    // table does not list for a path.
    for (const [p, m] of [['/stats/tonight', 'GET'], ['/phone/roster', 'POST'], ['/phone', 'GET'],
      ['/config/display-key/generate', 'POST'], ['/config/sync-logout', 'POST'], ['/config/slides-token/generate', 'POST'],
      ['/update-csv', 'POST'], ['/print', 'POST'], ['/health', 'POST'], ['/printers', 'POST'],
      ['/rehearsal', 'GET'], ['/print-leader', 'GET'], ['/attendance-audit', 'GET']]) {
      const r = await preflight(p, m, PAGE);
      check(`preflight for ${m} ${p} is refused`, r.status === 403 && !r.headers.get('access-control-allow-origin'), String(r.status));
    }
    // The moved tools are preflighted for the page, with Private Network Access, and for nobody else.
    for (const [p, m] of [['/leaders', 'GET'], ['/leaders/forget', 'POST'], ['/print-leader', 'POST'], ['/print-oneoff', 'POST'],
      ['/print-custom', 'POST'], ['/reprint-range', 'POST'],
      ['/rehearsal', 'POST'], ['/config/sync-login', 'POST']]) {
      const r = await preflight(p, m, PAGE);
      check(`preflight for ${m} ${p} is answered for the page`, r.status === 204 && r.headers.get('access-control-allow-origin') === PAGE
        && r.headers.get('access-control-allow-private-network') === 'true', String(r.status));
      const other = await preflight(p, m, 'https://evil.example');
      check(`...and refused for another origin (${p})`, other.status === 403 && !other.headers.get('access-control-allow-origin'), String(other.status));
    }
    // Never widened to another origin, the archived display site included.
    for (const origin of [OLD_SITE, 'https://awana.kvbchurch.org.evil.example', 'http://awana.kvbchurch.org', 'https://evil.example', 'null']) {
      const r = await preflight('/config', 'POST', origin);
      check(`preflight from ${origin} is refused`, r.status === 403 && !r.headers.get('access-control-allow-origin'), String(r.status));
    }
  }

  console.log('settings page: the token');
  {
    const open = await j('/health', { headers: { Origin: PAGE } });
    check('/health answers the page without a token', open.status === 200 && open.headers.get('access-control-allow-origin') === PAGE);
    check('/health still names the version', typeof open.body.version === 'string');
    check('/health gives the page no folder path', !open.body.extension || !open.body.extension.folder);

    const none = await j('/printers', { headers: { Origin: PAGE } });
    check('no publish token on the server yet: 403 saying to sign in', none.status === 403 && /sign in to the settings page/i.test(none.body.error), JSON.stringify(none.body));

    const gen = await post('/config/slides-token/generate');
    const token = gen.body.token;
    await post('/config', { slidesPublishToken: token });
    check('the dashboard (no Origin) set the token', Boolean(savedConfig().slidesPublishToken));

    const missing = await j('/config', { headers: { Origin: PAGE } });
    check('a read without the token is refused', missing.status === 403 && /Wrong publish token/i.test(missing.body.error));
    const wrong = await j('/config', { headers: { Origin: PAGE, Authorization: 'Bearer nope-nope-nope-nope-nope-nope' } });
    check('a wrong token is refused', wrong.status === 403);
    const wrongWrite = await post('/config', { printerName: 'Evil' }, { Origin: PAGE, Authorization: 'Bearer nope-nope-nope-nope-nope-nope' });
    check('a write with a wrong token is refused and changes nothing', wrongWrite.status === 403 && savedConfig().printerName === 'Fake');
    const noTokenWrite = await post('/config', { printerName: 'Evil' }, { Origin: PAGE });
    check('a write without a token is refused and changes nothing', noTokenWrite.status === 403 && savedConfig().printerName === 'Fake');
    const stranger = await post('/config', { printerName: 'Evil' }, { Origin: 'https://evil.example', Authorization: `Bearer ${token}` });
    check('another origin is refused even WITH the token', stranger.status === 403 && savedConfig().printerName === 'Fake');
    const oldSite = await post('/config', { printerName: 'Evil' }, { Origin: OLD_SITE, Authorization: `Bearer ${token}` });
    check('the archived display site is refused even WITH the token', oldSite.status === 403 && savedConfig().printerName === 'Fake');
    const outside = await post('/config/display-key/generate', {}, { Origin: PAGE, Authorization: `Bearer ${token}` });
    check('a route outside the table is refused even WITH the token', outside.status === 403);
    const outside2 = await post('/config/slides-token/generate', {}, { Origin: PAGE, Authorization: `Bearer ${token}` });
    check('so is minting a publish token', outside2.status === 403);
    const roster = await j('/stats/tonight', { headers: { Origin: PAGE, Authorization: `Bearer ${token}` } });
    check('a read outside the table carries no CORS header, so the page cannot read it', !roster.headers.get('access-control-allow-origin'));
    const deck = await j('/api/lobby-slides', { headers: { Origin: PAGE, Authorization: `Bearer ${token}` } });
    check('the lobby deck stays unreadable to the page', deck.status === 403);

    const ok = await j('/config', { headers: { Origin: PAGE, Authorization: `Bearer ${token}` } });
    check('the right token reads the config', ok.status === 200 && ok.body.printerName === 'Fake', JSON.stringify(ok.body));
    check('and the secrets are still left out of it',
      !('phonePin' in ok.body) && !('displayKey' in ok.body) && !('slidesPublishToken' in ok.body), Object.keys(ok.body).join());
    const hist = await j('/history/today', { headers: { Origin: PAGE, Authorization: `Bearer ${token}` } });
    check('the right token reads tonight\'s history', hist.status === 200 && Array.isArray(hist.body));
    const clubs = await j('/clubs', { headers: { Origin: PAGE, Authorization: `Bearer ${token}` } });
    check('and the club list', clubs.status === 200 && Array.isArray(clubs.body.clubs));
    const sched = await j('/config/schedule', { headers: { Origin: PAGE, Authorization: `Bearer ${token}` } });
    check('and the schedule', sched.status === 200 && Array.isArray(sched.body.schedule));
    const prev = await fetch(`${BASE}/preview?firstName=Maya`, { headers: { Origin: PAGE, Authorization: `Bearer ${token}` } });
    check('and a label preview (a PNG)', prev.status === 200 && /image\/png/.test(prev.headers.get('content-type') || ''), String(prev.status));
    check('...which needs the token too', (await fetch(`${BASE}/preview?firstName=Maya`, { headers: { Origin: PAGE } })).status === 403);
    const diag = await j('/diagnostics', { headers: { Origin: PAGE, Authorization: `Bearer ${token}` } });
    check('and the diagnostics', diag.status === 200 && Array.isArray(diag.body));

    // From here on every call carries the token.
    const H = { Origin: PAGE, Authorization: `Bearer ${token}` };

    console.log('settings page: what it may change');
    const set = await post('/config', { printerName: 'Dock', backupPrinterName: 'Spare', pickupClubs: ['Sparks', 'T&T'], labelFooter: 'KVBC Awana', lateGraceMin: 15 }, H);
    check('the printer keys save', set.status === 200, JSON.stringify(set.body));
    const disk = savedConfig();
    check('...to disk', disk.printerName === 'Dock' && disk.backupPrinterName === 'Spare' && disk.labelFooter === 'KVBC Awana' && disk.lateGraceMin === 15
      && JSON.stringify(disk.pickupClubs) === JSON.stringify(['Sparks', 'T&T']), JSON.stringify(disk));
    check('...and kept what it did not send (the key, the token)', disk.phonePin === '4321' && Boolean(disk.displayKey) && disk.slidesPublishToken === token);

    const sw = await post('/config', { updateBeacon: true, enableDrivenCheckin: false, musicalPrinter: true }, H);
    check('the three switches save from the page (update beacon, driven check-ins, musical printer)', sw.status === 200
      && savedConfig().updateBeacon === true && savedConfig().enableDrivenCheckin === false && savedConfig().musicalPrinter === true, JSON.stringify(sw.body));
    await post('/config', { musicalPrinter: false, enableDrivenCheckin: true, updateBeacon: false }, H);
    for (const body of [{ phonePin: '9999' }, { displayKey: '' }, { slidesPublishToken: 'x' }, { pusherSecret: 'x' }, { displayLoginPassphrase: 'x' },
      { lanAccess: true }, { allowedOrigins: ['https://evil.example'] }, { checkinUrl: 'https://evil.example/' }, { printerName: 'Dock', phonePin: '9999' }]) {
      const before = JSON.stringify(savedConfig());
      const r = await post('/config', body, H);
      check(`POST /config ${JSON.stringify(Object.keys(body))} from the page is refused and changes nothing`,
        r.status === 403 && JSON.stringify(savedConfig()) === before, `${r.status} ${JSON.stringify(r.body)}`);
    }
    const appKey = await post('/config', { displayKey: SERVICE_KEY });
    check('the app on this computer (no Origin) still sets the display key, which the page cannot', appKey.status === 200 && savedConfig().displayKey === SERVICE_KEY);

    const tpl = await post('/config/label-templates', { templates: { spark: { showFooter: false } } }, H);
    check('label templates save from the page', tpl.status === 200 && savedConfig().labelTemplates && savedConfig().labelTemplates.spark.showFooter === false, JSON.stringify(tpl.body));
    const tplRead = await j('/config/label-templates', { headers: H });
    check('and read back', tplRead.status === 200 && tplRead.body.templates.spark.showFooter === false && Array.isArray(tplRead.body.knownClubs));
    const tplBad = await post('/config/label-templates', { templates: 'nope' }, H);
    check('a bad template is still a 400, not a pass', tplBad.status === 400);

    const sch = await post('/config/schedule', { schedule: [{ club: 'Sparks', startTime: '18:30', location: 'Games', room: 'Hall' }] }, H);
    check('the schedule saves', sch.status === 200 && savedConfig().schedule[0].club === 'Sparks');

    const tune = await post('/play-tune', {}, H);
    check('the test tune is allowed through (409: musical printer is off here)', tune.status === 409, `${tune.status} ${JSON.stringify(tune.body)}`);
    const clear = await post('/printer/clear-queue', { confirm: true }, H);
    check('clearing the queue is allowed through (not a 403; Linux has no Windows queue)', clear.status !== 403, `${clear.status} ${JSON.stringify(clear.body)}`);
    const clearNo = await post('/printer/clear-queue', {}, H);
    check('...and still needs confirm:true', clearNo.status === 400);
    const rep = await post('/reprint', { name: 'Nobody Here' }, H);
    check('a reprint is allowed through (404: no such child)', rep.status === 404, `${rep.status} ${JSON.stringify(rep.body)}`);
    check('...and is refused without the token', (await post('/reprint', { name: 'Nobody Here' }, { Origin: PAGE })).status === 403);
    check('the test print is allowed through', (await post('/canary', {}, H)).status !== 403);
  }

  console.log('settings page: the tools that moved here from the dashboard');
  {
    const token = savedConfig().slidesPublishToken;
    const H = { Origin: PAGE, Authorization: `Bearer ${token}` };
    const noProof = { Origin: PAGE };
    const WRONG = { Origin: PAGE, Authorization: 'Bearer nope-nope-nope-nope-nope-nope' };
    const STRANGER = { Origin: 'https://evil.example', Authorization: `Bearer ${token}` };
    // Every one of them: refused without proof, and answered (not a 403) with it.
    const calls = [
      ['GET', '/leaders'], ['POST', '/leaders/forget'], ['POST', '/print-leader'], ['POST', '/print-oneoff'], ['POST', '/print-custom'],
      ['POST', '/reprint-range'], ['POST', '/rehearsal'],
    ];
    const call = (m, p, headers) => (m === 'GET' ? j(p, { headers }) : post(p, {}, headers));
    for (const [m, p] of calls) {
      const bare = await call(m, p, noProof);
      check(`${m} ${p} without proof is refused`, bare.status === 403, String(bare.status));
      const wrong = await call(m, p, WRONG);
      check(`${m} ${p} with a wrong token is refused`, wrong.status === 403, String(wrong.status));
      const stranger = await call(m, p, STRANGER);
      // A write from a stranger is refused outright; a read carries no CORS header, so the browser never lets the page see it.
      check(`${m} ${p} from another origin is refused even WITH the token`, !stranger.headers.get('access-control-allow-origin') && (m === 'GET' || stranger.status === 403), String(stranger.status));
    }
    const leaders = await j('/leaders', { headers: H });
    check('the remembered leaders read', leaders.status === 200 && Array.isArray(leaders.body.leaders) && Array.isArray(leaders.body.clubs), JSON.stringify(leaders.body));
    check('...with CORS for the page', leaders.headers.get('access-control-allow-origin') === PAGE);
    const forget = await post('/leaders/forget', { key: 'nobody' }, H);
    check('forgetting a leader is allowed through (nobody to forget)', forget.status === 200 && forget.body.removed === false, JSON.stringify(forget.body));
    check('...and still wants a key', (await post('/leaders/forget', {}, H)).status === 400);
    const tag = await post('/print-leader', { name: '', clubName: 'Sparks' }, H);
    check('a leader tag is allowed through (400: no name)', tag.status === 400, `${tag.status} ${JSON.stringify(tag.body)}`);
    const one = await post('/print-oneoff', { firstName: '', clubName: 'Sparks' }, H);
    check('a one-off tag is allowed through (400: no name)', one.status === 400, `${one.status} ${JSON.stringify(one.body)}`);
    const custom = await post('/print-custom', { text: '' }, H);
    check('a custom label is allowed through (400: no text)', custom.status === 400, `${custom.status} ${JSON.stringify(custom.body)}`);
    const range = await post('/reprint-range', { fromTs: 'x', toTs: 'y' }, H);
    check('a stretch reprint is allowed through (400: not times)', range.status === 400, `${range.status} ${JSON.stringify(range.body)}`);
    const audit = await j('/attendance-audit', { headers: H });
    check('the retired attendance audit is not there (10.0.0)', audit.status === 403 || audit.status === 404, String(audit.status));

    // Rehearsal: the page arms and disarms it (before this it was the dashboard's alone).
    const arm = await post('/rehearsal', { on: true }, H);
    check('rehearsal mode arms from the page', arm.status === 200 && arm.body.rehearsal === true, `${arm.status} ${JSON.stringify(arm.body)}`);
    const armed = await j('/health', { headers: { Origin: PAGE } });
    check('...and /health says so', armed.body.rehearsal === true);
    const disarm = await post('/rehearsal', { on: false }, H);
    check('...and disarms', disarm.status === 200 && disarm.body.rehearsal === false && (await j('/health')).body.rehearsal === false);
    check('a wrong token cannot arm it', (await post('/rehearsal', { on: true }, WRONG)).status === 403
      && (await j('/health')).body.rehearsal === false);
    check('the app on this computer (no Origin) still can', (await post('/rehearsal', { on: false })).status === 200);

    // The page may NOT mint or read the other secrets.
    for (const [m, p] of [['POST', '/config/display-key/generate'], ['POST', '/config/slides-token/generate'], ['POST', '/config/display-login/generate'],
      ['POST', '/config/sync-logout'], ['GET', '/api/lobby-slides']]) {
      const r = await call(m, p, H);
      check(`${m} ${p} stays refused for the page`, r.status === 403, String(r.status));
    }
  }

  console.log('settings page: this computer\'s sync sign-in from the page');
  {
    const sync = (s) => ({ Origin: PAGE, Authorization: `Sync ${s}` });
    const before = JSON.stringify(savedConfig());
    const none = await post('/config/sync-login', { passphrase: 'kennebec' }, { Origin: PAGE });
    check('without proof it is refused', none.status === 403 && JSON.stringify(savedConfig()) === before);
    const bad = await post('/config/sync-login', { passphrase: 'kennebec' }, sync('v1.3.1700000000000.notasessionnotasessionnotases'));
    check('a session the sync service refuses is refused', bad.status === 403 && JSON.stringify(savedConfig()) === before);
    const wrong = await post('/config/sync-login', { passphrase: 'wrong words' }, sync(GOOD_SESSION_B));
    check('a wrong passphrase is the service\'s 401, and nothing changes', wrong.status === 401 && JSON.stringify(savedConfig()) === before, `${wrong.status} ${JSON.stringify(wrong.body)}`);
    const blank = await post('/config/sync-login', { passphrase: '  ' }, sync(GOOD_SESSION_B));
    check('a blank passphrase is a 400', blank.status === 400);
    // The page never names the service: a url in the body is ignored for it.
    loginUrls.length = 0;
    const ok = await post('/config/sync-login', { passphrase: '  Kennebec ', url: 'https://evil.example' }, sync(GOOD_SESSION_B));
    check('a confirmed session and the passphrase sign this computer in again', ok.status === 200 && ok.body.ok === true, `${ok.status} ${JSON.stringify(ok.body)}`);
    check('...to the service this computer already uses, never one the page named', loginUrls.length === 1 && loginUrls[0].startsWith(SYNC) && !loginUrls.some((u) => /evil/.test(u)), loginUrls.join());
    check('...saving the new session', savedConfig().syncSession === NEW_SESSION && savedConfig().syncUrl === SYNC);
    check('...and answering with no secret in it', Object.keys(ok.body).sort().join() === 'changedKey,kid,ok', JSON.stringify(ok.body));

    // Signed out (the passphrase was changed elsewhere): the address is still known, so the page's own
    // new session is still confirmed and it can sign the laptop in again.
    const cfg = savedConfig();
    delete cfg.syncSession;
    fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify(cfg, null, 2));
    server.applySavedConfig(cfg);
    const signedOut = await post('/config/sync-login', { passphrase: 'kennebec' }, sync(GOOD_SESSION_B));
    check('signed out of the service, a session the service confirms can sign it back in', signedOut.status === 200 && savedConfig().syncSession === NEW_SESSION, `${signedOut.status} ${JSON.stringify(signedOut.body)}`);

    // Never set up: no address to confirm anything against, so the page cannot start from nothing.
    const bare = savedConfig();
    delete bare.syncSession; delete bare.syncUrl;
    fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify(bare, null, 2));
    server.applySavedConfig(bare);
    const none2 = await post('/config/sync-login', { passphrase: 'kennebec', url: SYNC }, sync(GOOD_SESSION_B));
    check('a computer with no sync service on record cannot be signed in from the page (the app\'s Set up does that)', none2.status === 403 && !savedConfig().syncSession && /Set up this computer/i.test(none2.body.error), `${none2.status} ${JSON.stringify(none2.body)}`);
    const dash = await post('/config/sync-login', { passphrase: 'kennebec', url: SYNC });
    check('the app\'s own wizard (loopback, no Origin) still can, naming the address', dash.status === 200 && savedConfig().syncUrl === SYNC && savedConfig().syncSession === NEW_SESSION);
    const evil = await post('/config/sync-login', { passphrase: 'kennebec', url: SYNC }, { Origin: 'https://evil.example' });
    check('a stranger\'s origin is refused', evil.status === 403);
  }

  console.log('settings page: the app is unchanged; the extension and TwoTimTwo are out (10.0.0)');
  {
    const own = `http://127.0.0.1:${PORT}`;
    const fromDashboard = await post('/config', { printerName: 'Back' }, { Origin: own });
    check('the dashboard\'s own origin still saves', fromDashboard.status === 200 && savedConfig().printerName === 'Back');
    const KEY2 = Buffer.alloc(32, 9).toString('base64');
    const fromExtension = await post('/config', { displayKey: KEY2 }, { Origin: 'chrome-extension://abcdefghijklmnop' });
    check('an extension page can no longer set a key', fromExtension.status === 403 && savedConfig().displayKey !== KEY2, String(fromExtension.status));
    const fromApp = await post('/config', { displayKey: KEY2 });
    check('the app itself (no Origin) still can', fromApp.status === 200 && savedConfig().displayKey === KEY2);
    const noOrigin = await j('/config');
    check('GET /config without an Origin still carries the secrets (this computer)', noOrigin.status === 200 && noOrigin.body.displayKey === KEY2);
    check('...and a stale PIN left in an old config.json is never read, never written', noOrigin.body.phonePin === '4321' && savedConfig().phonePin === '4321');
    const evil = await post('/config', { printerName: 'Evil' }, { Origin: 'https://evil.example' });
    check('a stranger\'s origin is still refused', evil.status === 403 && savedConfig().printerName === 'Back');
    const slides = await fetch(`${BASE}/api/display-settings`, { method: 'OPTIONS', headers: { Origin: PAGE, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization', 'Access-Control-Request-Private-Network': 'true' } });
    check('the slides publish preflight is as it was', slides.status === 204 && slides.headers.get('access-control-allow-private-network') === 'true');
    const twotimtwo = await preflight('/print', 'POST', 'https://kvbchurch.twotimtwo.com');
    check('a TwoTimTwo page can no longer print here', twotimtwo.status === 403 && !twotimtwo.headers.get('access-control-allow-origin'), String(twotimtwo.status));
  }

  console.log('settings page: signed in with the passphrase instead of the token');
  {
    const sync = (s) => ({ Origin: PAGE, Authorization: `Sync ${s}` });
    const before = syncChecks.length;
    const ok = await j('/history/today', { headers: sync(GOOD_SESSION) });
    check('a session the sync service confirms is let in', ok.status === 200, String(ok.status));
    await j('/config', { headers: sync(GOOD_SESSION) });
    check('...and is asked about once, then remembered', syncChecks.length === before + 1, String(syncChecks.length - before));
    const cfg = await j('/config', { headers: sync(GOOD_SESSION) });
    check('...and still sees no secret', cfg.status === 200 && cfg.body.phonePin === undefined && cfg.body.displayKey === undefined && cfg.body.syncSession === undefined);
    const pin = await post('/config', { phonePin: '1111' }, sync(GOOD_SESSION));
    check('...and still cannot change one', pin.status === 403);
    const bad = await j('/printers', { headers: sync('v1.3.1700000000000.notasessionnotasessionnotases') });
    check('a session the service refuses is refused', bad.status === 403 && /sign/i.test(bad.body.error), String(bad.status));
    const junk = await j('/printers', { headers: sync('../../etc') });
    check('a malformed one is refused without asking the service', junk.status === 403);
    const health = await j('/health', { headers: { Origin: PAGE } });
    check('/health still needs nothing', health.status === 200);
  }

  console.log('settings page: the church-wide settings are the Worker\'s (409 church-managed)');
  {
    const sync = { Origin: PAGE, Authorization: `Sync ${GOOD_SESSION}` };
    const SWITCHES = { CLOUD_PRINT: 'off', SINGLE_PUBLISHER: 'off', YM_CHECKOUT: 'off', CHURCH_SETTINGS: 'on', NOTICES: 'on', CHANGE_LOG: 'on' };
    churchDoc = { rev: 3, savedAt: '2026-10-12T12:00:00.000Z', seeded: true, paused: false, settings: { labelFooter: 'From the Worker', lateGraceMin: 12 }, switches: SWITCHES, switchesRev: 1 };
    check('this computer applies the Worker\'s church settings', (await server.churchSync.syncNow()) === 'applied' && savedConfig().labelFooter === 'From the Worker');
    const footer = await post('/config', { labelFooter: 'Typed on the page' }, sync);
    check('the page writing a church key directly is refused with 409 church-managed, and nothing is saved', footer.status === 409 && footer.body.reason === 'church-managed'
      && /church-wide setting now: change it under Printing/.test(footer.body.error) && savedConfig().labelFooter === 'From the Worker', JSON.stringify(footer.body));
    const mixed = await post('/config', { printerName: 'Mixed', pickupClubs: ['Sparks'] }, sync);
    check('a body with a printer key AND a church key is refused whole', mixed.status === 409 && savedConfig().printerName !== 'Mixed');
    const own = await post('/config', { printerName: 'Dock 2', musicalPrinter: false }, sync);
    check('the printer\'s own keys still save from the page', own.status === 200 && savedConfig().printerName === 'Dock 2', JSON.stringify(own.body));
    const sched = await post('/config/schedule', { schedule: [{ club: 'Sparks', startTime: '18:30' }] }, sync);
    check('the schedule is refused from the page', sched.status === 409 && sched.body.reason === 'church-managed', JSON.stringify(sched.body));
    const tmpl = await post('/config/label-templates', { templates: { Sparks: { showLastName: false } } }, sync);
    check('and so are the label templates', tmpl.status === 409 && tmpl.body.reason === 'church-managed', JSON.stringify(tmpl.body));
    const ext = await post('/config', { labelFooter: 'From the extension' });
    check('this computer\'s own writes (the extension, the app: no Origin) still save', ext.status === 200 && savedConfig().labelFooter === 'From the extension');
    const extSched = await post('/config/schedule', { schedule: [{ club: 'Sparks', startTime: '18:30' }] });
    check('...the schedule too', extSched.status === 200 && savedConfig().schedule.length === 1);
    churchDoc = { ...churchDoc, rev: 4, paused: true, switches: { ...SWITCHES, CHURCH_SETTINGS: 'off' }, switchesRev: 2 };
    check('CHURCH_SETTINGS off (paused): nothing is applied', (await server.churchSync.syncNow()) === 'paused' && savedConfig().labelFooter === 'From the extension');
    const paused = await post('/config', { labelFooter: 'Paused: the page edits here again' }, sync);
    check('and the page may change the church keys here again (At the laptop)', paused.status === 200 && savedConfig().labelFooter === 'Paused: the page edits here again', JSON.stringify(paused.body));
    const health = await j('/health', { headers: { Origin: PAGE } });
    check('/health says where the church settings come from, with no values', health.body.church && health.body.church.paused === true && health.body.church.source === 'config'
      && health.body.church.rev === 3 && !JSON.stringify(health.body.church).includes('Worker'), JSON.stringify(health.body.church));
    server.stopChurchSync();
  }

  console.log('settings page: every settings entry point goes to it, and there is no dashboard');
  {
    const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
    const URL_ = 'https://awana.kvbchurch.org/settings';
    const options = read('chrome-extension', 'options.html');
    check('the options page links to the settings page', options.includes(`href="${URL_}"`));
    check('...and no longer points at the dashboard', !options.includes('localhost:3456') && !/print dashboard/i.test(options.replace(/<!--[\s\S]*?-->/g, '')));
    const optionsJs = read('chrome-extension', 'options.js');
    check('options.js sends an online tab there', optionsJs.includes(URL_) && /location\.replace/.test(optionsJs));
    check('...but not an offline one (the card says the desk still prints)', /onLine\s*===\s*false/.test(optionsJs));
    check('options.html loads it (no inline script: Manifest V3 forbids it)', options.includes('src="options.js"') && !/<script>/.test(options));
    const popupJs = read('chrome-extension', 'popup.js');
    const popupHtml = read('chrome-extension', 'popup.html');
    check('the popup\'s Settings button opens the settings page', popupJs.includes(`url: '${URL_}'`));
    check('the popup has no dashboard button any more', !/dashboard/i.test(popupJs) && !/dashboard/i.test(popupHtml) && !popupJs.includes("localhost:3456/'"));
    check('the check-in page\'s "Printing to … Change" link opens the settings page', read('chrome-extension', 'content.js').includes(`printingToChange.href = '${URL_}'`));
    check('the dashboard page is gone and the server serves none', !fs.existsSync(path.join(__dirname, '..', 'print-server', 'public', 'index.html')));
    const manifest = JSON.parse(read('chrome-extension', 'manifest.json'));
    check('the manifest still points options at options.html', manifest.options_ui.page === 'options.html');
    const tray = read('electron-app', 'main.js');
    check('the app\'s tray and status window open the settings page', tray.includes(`const SETTINGS_URL = '${URL_}'`)
      && /openExternalSafely\(SETTINGS_URL, 'tray menu'\)/.test(tray) && /ipcMain\.handle\('open-settings'/.test(tray));
    check('the app no longer offers a firewall rule or a LAN address for phones', !/FIREWALL_RULE|enable-phone-checkin|get-lan-address/.test(tray)
      && !/enablePhone|getLanAddress|:3456\/phone/.test(read('electron-app', 'renderer', 'components', 'StatusPanel.jsx')));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  __suiteFinished = true;
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('suite crashed:', e);
  __suiteFinished = true;
  process.exit(1);
});
