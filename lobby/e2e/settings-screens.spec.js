import { expect, test } from '@playwright/test';

// The settings page's Screens (SETTINGS.md, phase 2), against a stand-in sync
// Worker: the list, a lobby TV opened in the same Settings panel with its
// "This screen" cards back and writing to the Worker, the actions sent to it,
// and a projector's switches edited in its row.

const SYNC = 'https://sync.test';
const SESSION = 'v1.1.1790839331729.oWr6n92IJW5ldPGmtiyjPHAZpca-QGToNlKGXlKI6vc';
const TV = 'tv_aaaaaaaaaaaaaaaaaaaa';
const PJ = 'pj_bbbbbbbbbbbbbbbbbbbb';

function standIn() {
  const now = new Date().toISOString();
  return {
    calls: [],
    screens: {
      [TV]: { id: TV, kind: 'lobby', name: 'Front door TV', createdAt: now, lastSeen: now, online: true, live: true },
      [PJ]: { id: PJ, kind: 'projector', name: 'Gym projector', createdAt: now, lastSeen: '2026-10-07T23:00:00.000Z', online: false, live: false },
    },
    settings: {
      [TV]: { savedAt: now, settings: { audioMuted: true, confettiLevel: 'full', followSharedSettings: true } },
      [PJ]: { savedAt: now, settings: { lowPower: false } },
    },
  };
}

test.beforeEach(async ({ page }) => {
  const w = standIn();
  page.w = w;
  await page.route(/open-meteo|pusher|twotimtwo|kvbchurch\.org/, (route) => route.abort());
  await page.route('**/shared/sync.json', (route) => route.fulfill({ json: { url: SYNC } }));
  await page.routeWebSocket(/sync\.test/, () => {});
  await page.route(`${SYNC}/**`, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const body = req.postData() ? JSON.parse(req.postData()) : undefined;
    w.calls.push({ method: req.method(), path, body });
    if (path === '/v1/state') return route.fulfill({ json: { settings: null, slides: null, template: null, journey: null, calendar: null, kid: 'abcd1234' } });
    if (path === '/v1/screens') return route.fulfill({ json: { screens: Object.values(w.screens), max: 40 } });
    const m = /^\/v1\/screens\/([^/]+)(?:\/(settings|name|action))?$/.exec(path);
    if (m && m[2] === 'settings' && req.method() === 'GET') return route.fulfill({ json: { screen: w.screens[m[1]], settings: w.settings[m[1]] } });
    if (m && m[2] === 'settings') {
      w.settings[m[1]] = { savedAt: new Date().toISOString(), settings: body.settings };
      return route.fulfill({ json: { ...w.settings[m[1]], dropped: [] } });
    }
    if (m && m[2] === 'name') { w.screens[m[1]].name = body.name; return route.fulfill({ json: { screen: w.screens[m[1]] } }); }
    if (m && m[2] === 'action') return route.fulfill({ json: { ok: true, delivered: w.screens[m[1]].online } });
    return route.fulfill({ status: 404, json: { error: 'Not found.' } });
  });
  await page.addInitScript((s) => { localStorage.setItem('awanaSyncSession.v1', s); }, SESSION);
  await page.goto('/settings.html?lowPower=1');
});

test('Screens lists every screen by kind, on or off', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('tab', { name: 'Screens' }).click();
  await expect(dialog.getByText('1 of 2')).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Lobby TVs' })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Projectors' })).toBeVisible();
  const tv = dialog.locator(`[data-screen="${TV}"]`);
  await expect(tv).toContainText('Front door TV');
  await expect(tv).toContainText('On now');
  await expect(dialog.locator(`[data-screen="${PJ}"]`)).toContainText('Off');
});

test('a lobby TV opens in the same panel, its own cards back, and writes to the Worker', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('tab', { name: 'Screens' }).click();
  await dialog.getByRole('button', { name: 'Open settings for Front door TV' }).click();

  await expect(dialog.getByRole('heading', { name: 'Front door TV', level: 2 })).toBeVisible();
  await expect(dialog.getByRole('tab', { name: 'Screens' })).toHaveCount(0);
  await expect(dialog.getByRole('heading', { name: 'On the screen' })).toBeVisible();

  await dialog.getByRole('button', { name: 'Preview a check-in' }).click();
  await expect(dialog.getByText('Sent to Front door TV.')).toBeVisible();
  expect(page.w.calls.some((c) => c.path === `/v1/screens/${TV}/action` && c.body.action === 'preview-checkin')).toBe(true);

  await dialog.getByRole('tab', { name: 'Screen & corner' }).click();
  await expect(dialog.getByRole('heading', { name: 'This TV' })).toBeVisible();
  await expect(dialog.locator('.scope-tag--screen').first()).toHaveText('Front door TV only');
  await expect(dialog.getByRole('heading', { name: 'Simplified mode' })).toHaveCount(0);
  await expect(dialog.locator('.scope-tag--shared').first()).toBeVisible();

  const chime = dialog.getByRole('checkbox', { name: 'Play a chime with each welcome' });
  await expect(chime).not.toBeChecked();
  await chime.check();
  await expect.poll(() => page.w.settings[TV].settings.audioMuted).toBe(false);
  // Only the TV's own keys travel, never a shared one or panic mode.
  const put = page.w.calls.filter((c) => c.method === 'PUT' && c.path === `/v1/screens/${TV}/settings`).at(-1);
  expect(Object.keys(put.body.settings)).not.toContain('standardDisplayMs');
  expect(Object.keys(put.body.settings)).not.toContain('panicMode');

  await dialog.getByRole('tab', { name: 'Setup' }).click();
  await expect(dialog.getByRole('heading', { name: 'Sign in' })).toHaveCount(0);
  await expect(dialog.getByRole('checkbox', { name: 'Follow the shared settings' })).toBeVisible();

  await dialog.getByRole('button', { name: '← All screens' }).click();
  await expect(dialog.getByRole('tab', { name: 'Screens' })).toHaveAttribute('aria-selected', 'true');
});

test('a projector is edited in its row', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('tab', { name: 'Screens' }).click();
  await dialog.getByRole('button', { name: 'Open settings for Gym projector' }).click();
  const row = dialog.locator(`[data-screen="${PJ}"]`);
  await row.getByRole('checkbox', { name: 'Low power' }).check();
  await expect.poll(() => page.w.settings[PJ].settings).toEqual({ lowPower: true });
  await expect(row.getByText(/Saved\. Gym projector takes it/)).toBeVisible();
});

test('a KVBC Awana computer: turning its print server off says it waits for the last label, and a held change shows', async ({ page }) => {
  const PC = 'pc_cccccccccccccccccccc';
  const now = new Date().toISOString();
  page.w.screens[PC] = { id: PC, kind: 'computer', name: 'Check-in laptop', createdAt: now, lastSeen: now, online: true, live: false };
  page.w.settings[PC] = { savedAt: now, settings: { printRole: true, displayRole: false, displayFrom: '17:00', displayUntil: '20:00' } };
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('tab', { name: 'Screens' }).click();
  await dialog.getByRole('button', { name: 'Open settings for Check-in laptop' }).click();
  const row = dialog.locator(`[data-screen="${PC}"]`);
  let asked = '';
  page.once('dialog', (d) => { asked = d.message(); d.accept(); });
  await row.getByRole('checkbox', { name: 'Print server' }).uncheck();
  await expect.poll(() => page.w.settings[PC].settings.printRole).toBe(false);
  expect(asked).toMatch(/If a label is printing or waiting, it finishes first/);
  // The computer's next hello says it is holding the change.
  page.w.screens[PC].pendingRoleChange = { printRole: false, displayRole: false };
  await dialog.getByRole('button', { name: 'Check again' }).click();
  await expect(row).toContainText('print server off once the last label prints');
});
