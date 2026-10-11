#!/usr/bin/env node
// Tests for the settings page's way in (SETTINGS.md phase 3): the one https
// origin awana.kvbchurch.org calling this server on localhost.
//
// What is pinned: the preflight (the exact origin, Authorization, Chrome's
// Private Network Access opt-in) on the routes the page uses and ONLY those;
// the publish token on every one of them but /health; the printer's own keys
// as the only thing POST /config takes from the page, so a PIN, a key, the
// network switch or the CORS list can never be changed from it; and that the
// dashboard's own calls (no Origin, same origin) are exactly what they were.
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

const PORT = Number(process.env.AWANA_TEST_PORT || 34583);
const BASE = `http://127.0.0.1:${PORT}`;
const PAGE = 'https://awana.kvbchurch.org';
const OLD_SITE = 'https://patrick-simpson.github.io';
const SYNC = 'https://sync.example.org';
const GOOD_SESSION = 'v1.2.1700000000000.settingspagesettingspagesettings';
const syncChecks = [];

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
      && !r(PAGE, '/rehearsal', 'POST') && !r(PAGE, '/api/lobby-slides', 'GET') && !r(PAGE, '/config/display-key/generate', 'POST')
      && !r(PAGE, '/config/sync-login', 'POST') && !r(PAGE, '/constructor', 'GET') && !r(PAGE, '/__proto__', 'GET'));
    const refusals = security.settingsPageConfigRefusals;
    check('the printer keys pass', refusals({ printerName: 'A', backupPrinterName: '', pickupClubs: ['Sparks'], labelFooter: 'x' }).length === 0);
    check('every secret key is refused', ['pusherSecret', 'phonePin', 'displayKey', 'slidesPublishToken', 'displayLoginPassphrase', 'syncSession']
      .every((k) => refusals({ [k]: 'x' }).includes(k)));
    check('so is the network, CORS and the check-in URL',
      ['lanAccess', 'allowedOrigins', 'checkinUrl', 'fleetConfigUrl', 'enableDrivenCheckin', 'historyRetentionDays']
        .every((k) => refusals({ [k]: 'x' }).includes(k)));
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
      return new Response(JSON.stringify({}), { status: auth === `Bearer ${GOOD_SESSION}` || /printserver/.test(auth) ? 200 : 401 });
    }
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
    for (const [p, m] of [['/stats/tonight', 'GET'], ['/phone/roster', 'POST'], ['/rehearsal', 'POST'],
      ['/config/display-key/generate', 'POST'], ['/config/sync-login', 'POST'],
      ['/update-csv', 'POST'], ['/print', 'POST'], ['/health', 'POST'], ['/printers', 'POST']]) {
      const r = await preflight(p, m, PAGE);
      check(`preflight for ${m} ${p} is refused`, r.status === 403 && !r.headers.get('access-control-allow-origin'), String(r.status));
    }
    // Never widened to another origin, the archived github.io site included.
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
    check('no publish token on the server yet: 403 with the way to make one', none.status === 403 && /Generate publish token/i.test(none.body.error), JSON.stringify(none.body));

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
    const outside = await post('/rehearsal', { on: true }, { Origin: PAGE, Authorization: `Bearer ${token}` });
    check('a route outside the table is refused even WITH the token', outside.status === 403);
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
    check('...and kept what it did not send (the PIN, the key, the token)', disk.phonePin === '4321' && Boolean(disk.displayKey) && disk.slidesPublishToken === token);

    for (const body of [{ phonePin: '9999' }, { displayKey: '' }, { slidesPublishToken: 'x' }, { pusherSecret: 'x' }, { displayLoginPassphrase: 'x' },
      { lanAccess: true }, { allowedOrigins: ['https://evil.example'] }, { checkinUrl: 'https://evil.example/' }, { printerName: 'Dock', phonePin: '9999' }]) {
      const before = JSON.stringify(savedConfig());
      const r = await post('/config', body, H);
      check(`POST /config ${JSON.stringify(Object.keys(body))} from the page is refused and changes nothing`,
        r.status === 403 && JSON.stringify(savedConfig()) === before, `${r.status} ${JSON.stringify(r.body)}`);
    }
    const dashboardPin = await post('/config', { phonePin: '5555' });
    check('the dashboard (no Origin) still sets the PIN', dashboardPin.status === 200 && savedConfig().phonePin === '5555');

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

  console.log('settings page: the dashboard and the extension are unchanged');
  {
    const own = `http://127.0.0.1:${PORT}`;
    const fromDashboard = await post('/config', { printerName: 'Back' }, { Origin: own });
    check('the dashboard\'s own origin still saves', fromDashboard.status === 200 && savedConfig().printerName === 'Back');
    const fromExtension = await post('/config', { phonePin: '6666' }, { Origin: 'chrome-extension://abcdefghijklmnop' });
    check('the extension can still set the PIN', fromExtension.status === 200 && savedConfig().phonePin === '6666');
    const noOrigin = await j('/config');
    check('GET /config without an Origin still carries the secrets (this computer)', noOrigin.status === 200 && noOrigin.body.phonePin === '6666');
    const evil = await post('/config', { printerName: 'Evil' }, { Origin: 'https://evil.example' });
    check('a stranger\'s origin is still refused', evil.status === 403 && savedConfig().printerName === 'Back');
    const slides = await fetch(`${BASE}/api/display-settings`, { method: 'OPTIONS', headers: { Origin: PAGE, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization', 'Access-Control-Request-Private-Network': 'true' } });
    check('the slides publish preflight is as it was', slides.status === 204 && slides.headers.get('access-control-allow-private-network') === 'true');
    const twotimtwo = await preflight('/print', 'POST', 'https://kvbchurch.twotimtwo.com');
    check('TwoTimTwo\'s own calls are as they were (no private-network opt-in)', twotimtwo.status === 204 && !twotimtwo.headers.get('access-control-allow-private-network'));
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
    check('...and still sees no secret', cfg.status === 200 && cfg.body.phonePin === undefined && cfg.body.syncSession === undefined);
    const pin = await post('/config', { phonePin: '1111' }, sync(GOOD_SESSION));
    check('...and still cannot change one', pin.status === 403);
    const bad = await j('/printers', { headers: sync('v1.3.1700000000000.notasessionnotasessionnotases') });
    check('a session the service refuses is refused', bad.status === 403 && /sign/i.test(bad.body.error), String(bad.status));
    const junk = await j('/printers', { headers: sync('../../etc') });
    check('a malformed one is refused without asking the service', junk.status === 403);
    const health = await j('/health', { headers: { Origin: PAGE } });
    check('/health still needs nothing', health.status === 200);
  }

  console.log('settings page: every settings entry point goes to it');
  {
    const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
    const URL_ = 'https://awana.kvbchurch.org/settings';
    const options = read('chrome-extension', 'options.html');
    check('the options page links to the settings page', options.includes(`href="${URL_}"`));
    check('...and keeps the dashboard as the offline fallback', options.includes('http://localhost:3456/#settings'));
    const optionsJs = read('chrome-extension', 'options.js');
    check('options.js sends an online tab there', optionsJs.includes(URL_) && /location\.replace/.test(optionsJs));
    check('...but not an offline one (the fallback link must stay readable)', /onLine\s*===\s*false/.test(optionsJs));
    check('options.html loads it (no inline script: Manifest V3 forbids it)', options.includes('src="options.js"') && !/<script>/.test(options));
    check('the popup\'s Settings button opens the settings page', read('chrome-extension', 'popup.js').includes(`url: '${URL_}'`));
    check('the popup still reaches the dashboard', read('chrome-extension', 'popup.js').includes("url: 'http://localhost:3456/'"));
    check('the check-in page\'s "Printing to … Change" link opens the settings page', read('chrome-extension', 'content.js').includes(`printingToChange.href = '${URL_}'`));
    const dash = read('print-server', 'public', 'index.html');
    check('the dashboard\'s Settings tab says where settings live now', /id="settings-moved"/.test(dash) && dash.includes(`href="${URL_}"`));
    const manifest = JSON.parse(read('chrome-extension', 'manifest.json'));
    check('the manifest still points options at options.html', manifest.options_ui.page === 'options.html');
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
