import { expect, test } from '@playwright/test';

// The opening-ceremony remote (owner 2026-10-19; projector-remote.html): a
// phone page that sends the projector Next / Back and the three backups as
// screen actions, to every projector that is on.

const SYNC_BASE = 'https://sync.e2e.test/api';
const SESSION = 'v1.1.1790839331729.oWr6n92IJW5ldPGmtiyjPHAZpca-QGToNlKGXlKI6vc';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

async function stub(page, { signedIn = true, screens } = {}) {
  const calls = [];
  await page.route('**/shared/sync.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ url: SYNC_BASE }) }));
  await page.route(`${SYNC_BASE}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const path = new URL(req.url()).pathname.replace('/api', '');
    const body = req.postData() ? JSON.parse(req.postData()) : undefined;
    calls.push({ method: req.method(), path, body });
    const json = (b, status = 200) => route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(b) });
    if (path === '/v1/screens') {
      return json({ max: 40, screens: screens ?? [
        { id: 'tv_aaaaaaaaaaaaaaaaaaaa', kind: 'lobby', name: 'Lobby TV', online: true },
        { id: 'pj_bbbbbbbbbbbbbbbbbbbb', kind: 'projector', name: 'Gym projector', online: true },
      ] });
    }
    if (/^\/v1\/screens\/[^/]+\/action$/.test(path)) return json({ ok: true, delivered: true });
    return json({ error: 'not here' }, 404);
  });
  if (signedIn) await page.addInitScript((s) => { localStorage.setItem('awanaSyncSession.v1', s); }, SESSION);
  return calls;
}

test.describe('the opening-ceremony remote', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('finds the projector and sends Next, Back and a backup to it alone', async ({ page }) => {
    const calls = await stub(page);
    await page.goto('/projector-remote.html');
    await expect(page.locator('#target')).toHaveText('Gym projector · on');
    await page.locator('#btn-next').click();
    await expect(page.locator('#press-note')).toHaveText('Next: sent ✓');
    await page.locator('#btn-prev').click();
    await page.locator('[data-backup="us-flag"]').click();
    await expect(page.locator('#press-note')).toHaveText('The American flag: sent ✓');
    await page.locator('#btn-backup-end').click();
    await expect(page.locator('#press-note')).toHaveText('Backup down: sent ✓');
    const sent = calls.filter((c) => c.path.endsWith('/action'));
    expect(sent.map((c) => c.path)).toEqual(Array(4).fill('/v1/screens/pj_bbbbbbbbbbbbbbbbbbbb/action'));
    expect(sent.map((c) => c.body)).toEqual([
      { action: 'slide-next' }, { action: 'slide-prev' }, { action: 'backup', data: { what: 'us-flag' } }, { action: 'backup-end' },
    ]);
  });

  test('Back to the countdown takes two taps (owner 2026-10-22): the first only asks, the second sends it', async ({ page }) => {
    const calls = await stub(page);
    await page.clock.install();
    await page.goto('/projector-remote.html');
    await expect(page.locator('#target')).toHaveText('Gym projector · on');
    const btn = page.locator('#btn-countdown');
    await btn.click();
    await expect(btn).toHaveText('Tap again to go back to the countdown');
    expect(calls.filter((c) => c.path.endsWith('/action'))).toHaveLength(0);
    // Left alone, it disarms: the next tap only asks again.
    await page.clock.fastForward(4500);
    await expect(btn).toHaveText('Back to the countdown');
    await btn.click();
    await btn.click();
    await expect(page.locator('#press-note')).toHaveText('Back to the countdown: sent ✓');
    const sent = calls.filter((c) => c.path.endsWith('/action'));
    expect(sent.map((c) => c.body)).toEqual([{ action: 'to-countdown' }]);
    await expect(btn).toHaveText('Back to the countdown');
  });

  test('fits a 360 px phone: no sideways scroll, Back and Next big on the first screenful', async ({ page }, info) => {
    await stub(page);
    await page.goto('/projector-remote.html');
    await expect(page.locator('#target')).toHaveText('Gym projector · on');
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: info.outputPath('remote-360.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    for (const id of ['#btn-prev', '#btn-next']) {
      const box = await page.locator(id).boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(112);
      expect(box.y + box.height).toBeLessThanOrEqual(740);
    }
  });

  test('says so when the projector is off, and sends nothing', async ({ page }) => {
    const calls = await stub(page, { screens: [{ id: 'pj_bbbbbbbbbbbbbbbbbbbb', kind: 'projector', name: 'Gym projector', online: false }] });
    await page.goto('/projector-remote.html');
    await expect(page.locator('#target')).toHaveText('Gym projector is off. Turn the projector computer on.');
    await page.locator('#btn-next').click();
    await expect(page.locator('#press-note')).toHaveText('No projector is on right now, so nothing was sent.');
    expect(calls.some((c) => c.path.endsWith('/action'))).toBe(false);
  });

  test('asks for the passphrase when this phone is not signed in', async ({ page }) => {
    await stub(page, { signedIn: false });
    await page.goto('/projector-remote.html');
    await expect(page.locator('#signin')).toBeVisible();
    await expect(page.locator('#remote')).toBeHidden();
  });
});
