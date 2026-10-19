import { expect } from '@playwright/test';

// A stand-in for the sync Worker's live channel (page.routeWebSocket), for the
// specs that need a screen that is signed in, and for the ones that need a real
// first name on the wire: only the socket can deliver one. Publish plaintext,
// as a printer with no display key does. Shared by signage.events.spec.js,
// embedded.events.spec.js, setup-card.events.spec.js and the specs that only
// want a connected screen (a plain module: Playwright refuses a spec that
// imports another).
//
// The page learns where the service is from shared/sync.json (routed here to a
// made-up host), holds a session (seeded into localStorage), and opens one
// WebSocket to <base>/v1/live; every frame is {e, d}. Anything else the page
// asks the service answers 503, which reads as "offline", never "signed out".

export const SYNC_BASE = 'https://sync.e2e.test/api';
const SESSION = 'v1.1.1790839331729.oWr6n92IJW5ldPGmtiyjPHAZpca-QGToNlKGXlKI6vc';

const byPage = new WeakMap();

/**
 * Sign this page in to a fake sync service and listen for its live socket.
 * Idempotent per page. Resolves to `send(event, data)`, which waits for the
 * page to have opened its socket and then delivers one frame.
 */
export async function liveChannel(page) {
  if (byPage.has(page)) return byPage.get(page);
  const sockets = [];
  await page.route(/shared\/sync\.json/, (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ url: SYNC_BASE }),
    headers: { 'Access-Control-Allow-Origin': '*' },
  }));
  await page.route(`${SYNC_BASE}/**`, (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: '{}',
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' },
  }));
  await page.addInitScript((session) => {
    try { localStorage.setItem('awanaSyncSession.v1', session); } catch { /* blocked storage: the spec will say so */ }
  }, SESSION);
  await page.routeWebSocket(/\/v1\/live/, (ws) => {
    sockets.push(ws);
    ws.onMessage((raw) => { if (String(raw) === 'ping') ws.send('pong'); });
  });
  const send = async (event, data) => {
    await expect.poll(() => sockets.length, { timeout: 10000 }).toBeGreaterThan(0);
    sockets[sockets.length - 1].send(JSON.stringify({ e: event, d: data }));
  };
  // Every socket the page has opened, as the Worker broadcasts (a page with a
  // frame of its own on the channel, like the lobby's ceremony mirror).
  send.all = async (event, data) => {
    await expect.poll(() => sockets.length, { timeout: 10000 }).toBeGreaterThan(0);
    for (const ws of sockets) {
      try { ws.send(JSON.stringify({ e: event, d: data })); } catch { /* a socket the page already closed */ }
    }
  };
  byPage.set(page, send);
  return send;
}
