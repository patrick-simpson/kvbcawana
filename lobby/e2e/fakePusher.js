import { expect } from '@playwright/test';

// A stand-in for Pusher (page.routeWebSocket), for the specs that need a real
// first name on the wire: only the socket can deliver one. Publish plaintext,
// as a printer with no display key does. Shared by signage.events.spec.js,
// embedded.events.spec.js and setup-card.events.spec.js (a plain module:
// Playwright refuses a spec that imports another).

/** A stand-in Pusher socket; resolves to `send(event, data)` once the page has subscribed. */
export async function fakePusher(page) {
  const sockets = [];
  let subscribed = false;
  await page.route(/open-meteo|twotimtwo|stats\.pusher|sockjs|pusher\.com\/.*\.(js|json)/, (route) => route.abort());
  await page.routeWebSocket(/pusher/, (ws) => {
    sockets.push(ws);
    ws.onMessage((raw) => {
      let m;
      try { m = JSON.parse(String(raw)); } catch { return; }
      if (m.event === 'pusher:subscribe') {
        ws.send(JSON.stringify({ event: 'pusher_internal:subscription_succeeded', channel: m.data.channel, data: '{}' }));
        if (m.data.channel === 'awana-channel') subscribed = true;
      } else if (m.event === 'pusher:ping') {
        ws.send(JSON.stringify({ event: 'pusher:pong', data: '{}' }));
      }
    });
    ws.send(JSON.stringify({ event: 'pusher:connection_established', data: JSON.stringify({ socket_id: '1234.5678', activity_timeout: 120 }) }));
  });
  return async (event, data) => {
    await expect.poll(() => subscribed, { timeout: 10000 }).toBe(true);
    sockets[sockets.length - 1].send(JSON.stringify({ event, channel: 'awana-channel', data: JSON.stringify(data) }));
  };
}
