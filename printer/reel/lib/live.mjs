// A stand-in for the sync Worker's live channel, the way the lobby's own e2e
// suite drives the screens (lobby/e2e/liveChannel.js): the page finds the
// service through shared/sync.json, holds a session, opens one WebSocket to
// <base>/v1/live, and every frame is {e, d}. Frames are published plaintext,
// as a printer with no display key does, so they pass the screens' own
// sanitizers exactly like the real wire. Names are made up.
export const SYNC_BASE = 'https://sync.reel.test/api';
const SESSION = 'v1.1.1790839331729.oWr6n92IJW5ldPGmtiyjPHAZpca-QGToNlKGXlKI6vc';

/**
 * Sign the page in to the stand-in service. Resolves to `send(event, data)`.
 * @param {import('playwright-core').Page} page
 * @param {{ answer?: (url: URL, method: string, body: any) => any }} [opts]
 */
export async function liveChannel(page, { answer } = {}) {
  const sockets = [];
  await page.route(/shared\/sync\.json/, (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ url: SYNC_BASE }),
    headers: { 'Access-Control-Allow-Origin': '*' },
  }));
  await page.route(`${SYNC_BASE}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    let body = null;
    try { body = req.postDataJSON(); } catch { body = null; }
    const out = answer ? await answer(url, req.method(), body) : undefined;
    await route.fulfill({
      status: out ? out.status || 200 : 503,
      contentType: 'application/json',
      body: JSON.stringify(out ? out.body ?? {} : {}),
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' },
    });
  });
  await page.addInitScript((session) => {
    try { localStorage.setItem('awanaSyncSession.v1', session); } catch { /* blocked storage */ }
  }, SESSION);
  await page.routeWebSocket(/\/v1\/live/, (ws) => {
    sockets.push(ws);
    ws.onMessage((raw) => { if (String(raw) === 'ping') ws.send('pong'); });
  });
  return async (event, data) => {
    const t0 = Date.now();
    while (!sockets.length) {
      if (Date.now() - t0 > 10000) throw new Error('the page never opened its live socket');
      await new Promise((r) => setTimeout(r, 50));
    }
    sockets[sockets.length - 1].send(JSON.stringify({ e: event, d: data }));
  };
}
