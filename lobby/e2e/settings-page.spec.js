import { expect, test } from '@playwright/test';
import { SYNC_BASE, installWorker, makeWorld } from './settingsStub.js';

// The one settings page (awana.kvbchurch.org/settings → settings.html,
// ROADMAP.md#settings-page, docs/SETTINGS-OVERHAUL.md section 1): configure mode on a
// device that is not a screen. The seven-section rail (Tonight, Screens, What
// screens show, Slides & look, Printing, History, Account & app), the old rail
// behind ?rail=classic, every removed control gone, the TV preview column.

const RAIL = ['Tonight', 'Screens', 'What screens show', 'Slides & look', 'Printing', 'History', 'Account & app'];

test.describe('not signed in', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(/open-meteo|twotimtwo|kvbchurch\.org/, (route) => route.abort());
    await page.goto('/settings.html?lowPower=1');
  });

  test('it is Settings alone: seven sections, opening on Account & app with the sign-in', async ({ page }) => {
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible();
    await expect(page).toHaveTitle('KVBC Awana Settings');
    await expect(page.locator('html')).toHaveClass(/configure-mode/);
    await expect(dialog.getByRole('heading', { name: 'KVBC Awana Settings' })).toBeVisible();
    await expect(dialog.locator('.settings-nav__label')).toHaveText(RAIL);
    await expect(dialog.getByRole('tab', { name: 'Account & app' })).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(dialog.getByLabel('Passphrase', { exact: true }).first()).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Done' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open settings' })).toHaveCount(0);
    await expect(dialog.getByText('Sign in under Account & app to change every screen.')).toBeVisible();
  });

  test('the removed controls are nowhere on the page', async ({ page }) => {
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    for (const name of RAIL) {
      await dialog.getByRole('tab', { name, exact: true }).click();
      for (const gone of [/Display login/, /Display key/, /Publish token/, /paste keys by hand/i, /Other screens/, /Allow driven check-ins from phones/, /Club Label Printer/]) {
        await expect(dialog.getByText(gone), `${name}: ${gone}`).toHaveCount(0);
        await expect(dialog.getByLabel(gone), `${name}: ${gone}`).toHaveCount(0);
      }
    }
  });

  test('no section shows a "This screen" card or a button that acts on a screen', async ({ page }) => {
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    for (const name of RAIL) {
      await dialog.getByRole('tab', { name, exact: true }).click();
      await expect(dialog.locator('.scope-tag--screen'), name).toHaveCount(0);
    }
    await dialog.getByRole('tab', { name: 'What screens show' }).click();
    await expect(dialog.getByRole('button', { name: /Preview a check-in/ })).toHaveCount(0);
    await expect(dialog.locator('.scope-tag--shared').first()).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Simplified mode' })).toHaveCount(0);
    await expect(dialog.getByRole('heading', { name: 'This TV' })).toHaveCount(0);
    await dialog.getByRole('tab', { name: 'Slides & look' }).click();
    await expect(dialog.getByRole('button', { name: /Edit slides/ })).toBeVisible();
    await expect(dialog.getByRole('checkbox', { name: 'Follow published slides' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: /Forget received deck/ })).toHaveCount(0);
    await dialog.getByRole('tab', { name: 'Account & app' }).click();
    await expect(dialog.getByRole('button', { name: /Reset tonight/ })).toHaveCount(0);
  });

  test('Account & app: sign-in, passphrase, KVBC Awana, the release notes retitled', async ({ page }) => {
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    for (const h of ['Sign in', 'KVBC Awana for Windows', 'KVBC Awana release notes', 'About']) {
      await expect(dialog.getByRole('heading', { name: h }), h).toBeVisible();
    }
    await expect(dialog.getByText('Club Label Printer')).toHaveCount(0);
    await expect(dialog.getByText(/NOT AFFILIATED OR ENDORSED BY/)).toBeVisible();
  });

  test('?rail=classic is the old rail, minus the removed controls', async ({ page }) => {
    await page.goto('/settings.html?lowPower=1&rail=classic');
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog.locator('.settings-nav__label')).toHaveText(['Status', 'Screens', 'Check-ins', 'Slides', 'Screen & corner', 'Celebrations', 'Pickup board', 'Look & season', 'Laptop', 'History', 'Setup']);
    await expect(dialog.getByRole('tab', { name: 'Setup' })).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.getByText(/Display key|Publish token|Display login/)).toHaveCount(0);
    // it is remembered for this viewer, and ?rail=new forgets it
    await page.goto('/settings.html?lowPower=1');
    await expect(page.getByRole('dialog', { name: 'Settings' }).getByRole('tab', { name: 'Status' })).toBeVisible();
    await page.goto('/settings.html?lowPower=1&rail=new');
    await expect(page.getByRole('dialog', { name: 'Settings' }).getByRole('tab', { name: 'Tonight' })).toBeVisible();
  });
});

test.describe('signed in', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(/open-meteo|twotimtwo|kvbchurch\.org/, (route) => route.abort());
    page.w = makeWorld();
    await installWorker(page, page.w);
  });

  test('opens on Tonight, and every Worker call says which device made it', async ({ page }) => {
    await page.goto('/settings.html?lowPower=1');
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog.getByRole('tab', { name: 'Tonight' })).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.getByText('Signed in: changes here reach every screen.')).toBeVisible();
    await expect(dialog.getByTestId('mission-total')).toHaveText('42');
    await expect.poll(() => page.w.headers.length).toBeGreaterThan(2);
    // a signed-in call; the public calendar read carries neither a session nor a device
    const withSession = page.w.headers.filter((h) => h.auth);
    for (const h of withSession) {
      expect(h.device, h.path).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
      expect(decodeURIComponent(h.name), h.path).toMatch(/ on /);
    }
    expect(new Set(withSession.map((h) => h.device)).size).toBe(1);
  });

  test('the device name is the owner\'s to set, and the next calls carry it', async ({ page }) => {
    await page.goto('/settings.html?lowPower=1');
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await dialog.getByRole('tab', { name: 'Account & app' }).click();
    await dialog.getByLabel('What the change log calls this device').fill('Pastor Pat’s phone');
    await dialog.getByLabel('What the change log calls this device').press('Enter');
    await expect(dialog.getByText('Saved.').first()).toBeVisible();
    await dialog.getByRole('tab', { name: 'Tonight' }).click();
    await expect.poll(() => page.w.headers.some((h) => decodeURIComponent(h.name || '') === 'Pastor Pat’s phone')).toBe(true);
  });

  test('Account & app: the change log, the security line, no TV tools', async ({ page }) => {
    await page.goto('/settings.html?lowPower=1');
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await dialog.getByRole('tab', { name: 'Account & app' }).click();
    await expect(dialog.getByRole('heading', { name: 'Change log' })).toBeVisible();
    await expect(dialog.getByText(/Chrome on Android/)).toBeVisible();
    await expect(dialog.getByText(/New sign-in \(v2\) on; old sign-ins: off\./)).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'This device' })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: "This screen's tools" })).toHaveCount(0);
  });

  test('a wide page has the TV preview column beside Tonight, What screens show and Slides & look', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/settings.html?lowPower=1');
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    const col = dialog.locator('.settings-preview-col');
    await expect(col).toBeVisible();
    await expect(col.getByRole('img', { name: /preview of/i })).toBeVisible();
    const box = await col.locator('.tv-preview__frame').boundingBox();
    expect(box.width).toBeGreaterThan(300);
    await dialog.getByRole('tab', { name: 'Printing' }).click();
    await expect(col).toHaveCount(0);
    await dialog.getByRole('tab', { name: 'What screens show' }).click();
    await dialog.getByRole('heading', { name: 'Welcome banners' }).hover();
    await expect(col.getByRole('img', { name: /welcome banner/i })).toBeVisible();
    await expect(col.locator('.tv-preview__stage .checkin')).toBeVisible();
    // sample names only
    await expect(col).toContainText(/Test Kid/i);
  });

  test('a narrow page has a Preview toggle on show and look, off by default; ?preview=0 removes it', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/settings.html?lowPower=1');
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await dialog.getByRole('tab', { name: 'What screens show' }).click();
    await expect(dialog.locator('.settings-preview-col')).toHaveCount(0);
    await expect(dialog.getByTestId('tv-preview')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(dialog.getByTestId('tv-preview')).toBeVisible();
    await page.goto('/settings.html?lowPower=1&preview=0');
    const killed = page.getByRole('dialog', { name: 'Settings' });
    await killed.getByRole('tab', { name: 'What screens show' }).click();
    await expect(killed.getByRole('button', { name: 'Preview', exact: true })).toHaveCount(0);
  });

  test('on a phone it is the list, then one section, and nothing runs off the side', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/settings.html?lowPower=1');
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog.locator('.settings-pane')).toBeHidden();
    await expect(dialog.getByRole('tab')).toHaveCount(7);
    for (const name of RAIL) {
      await dialog.getByRole('tab', { name, exact: true }).click();
      const overflow = await dialog.locator('.panel-body').evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(overflow, name).toBeLessThanOrEqual(1);
      await dialog.getByRole('button', { name: 'Back to all settings' }).click();
    }
  });

  test('Season is ONE control and writes both halves', async ({ page }) => {
    await page.goto('/settings.html?lowPower=1');
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await dialog.getByRole('tab', { name: 'Slides & look' }).click();
    await expect(dialog.getByLabel('Season', { exact: true })).toHaveCount(1);
    await dialog.getByLabel('Season', { exact: true }).selectOption('easter');
    await expect(dialog.getByText('Saved for the screens and for the labels’ season.')).toBeVisible();
    const put = page.w.calls.find((c) => c.method === 'PUT' && c.path === '/v1/church/settings');
    expect(put.body.settings).toEqual({ seasonTheme: 'easter' });
    await expect(dialog.getByTestId('season-line')).toHaveText('Tonight: Easter (you picked it)');
  });
});

test('the page reaches no sync host it was not given', async ({ page }) => {
  const hosts = new Set();
  page.on('request', (r) => { try { hosts.add(new URL(r.url()).host); } catch { /* ignore */ } });
  await page.route(/open-meteo|twotimtwo|kvbchurch\.org/, (route) => route.abort());
  await installWorker(page, makeWorld());
  await page.goto('/settings.html?lowPower=1');
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await expect.poll(() => hosts.has(new URL(SYNC_BASE).host)).toBe(true);
  // the page itself, the Worker, and the weather it asks for on its own (blocked here)
  for (const h of hosts) expect(['127.0.0.1:4173', new URL(SYNC_BASE).host, 'api.open-meteo.com', 'geocoding-api.open-meteo.com']).toContain(h);
});
