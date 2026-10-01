import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBuildReload } from './useBuildReload.js';
import { reloadPage } from '../lib/buildReload.js';
import {
  BUILD_BUSY_RECHECK_MS, BUILD_CHECK_MS, BUILD_ONLINE_MIN_MS,
} from '../lib/constants.js';

// The one impure thing in the poller, stubbed so a test can assert that the
// page WOULD have reloaded without jsdom navigating anywhere.
vi.mock('../lib/buildReload.js', async (importOriginal) => ({
  ...(await importOriginal()),
  reloadPage: vi.fn(),
}));

const OWN = 'aaaaaaaaaaaa';
const NEXT = 'bbbbbbbbbbbb';

const htmlFor = (build) => `<html><head><meta name="awana-build" content="${build}" /></head><body></body></html>`;

function Harness({ isBusy }) {
  useBuildReload(isBusy);
  return null;
}

/** version.json answers `version`; the page's own HTML answers `html`. */
function serve({ version, html }) {
  return vi.fn((url) => {
    const body = String(url).startsWith('version.json') ? version : html;
    if (body === null) return Promise.resolve({ ok: false, text: () => Promise.resolve('') });
    return Promise.resolve({ ok: true, text: () => Promise.resolve(body) });
  });
}

const versionBody = (build) => JSON.stringify({ build, builtAt: '2026-09-16T20:00:00.000Z' });

describe('useBuildReload', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.head.innerHTML = `<meta name="awana-build" content="${OWN}">`;
    vi.mocked(reloadPage).mockClear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.head.innerHTML = '';
  });

  // THE E2E GUARANTEE. The hermetic smoke run boots a page with no stamp and
  // no version.json; nothing may poll, and nothing may reload.
  it('never starts a timer on a page with no build stamp', async () => {
    document.head.innerHTML = '';
    const fetchImpl = serve({ version: versionBody(NEXT), html: htmlFor(NEXT) });
    vi.stubGlobal('fetch', fetchImpl);

    render(<Harness isBusy={() => false} />);
    await vi.advanceTimersByTimeAsync(BUILD_CHECK_MS * 5);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(reloadPage).not.toHaveBeenCalled();
  });

  it('does nothing while version.json names the build this page is already on', async () => {
    const fetchImpl = serve({ version: versionBody(OWN), html: htmlFor(OWN) });
    vi.stubGlobal('fetch', fetchImpl);

    render(<Harness isBusy={() => false} />);
    await vi.advanceTimersByTimeAsync(BUILD_CHECK_MS * 3 + 1000);

    // Polled, but never even asked for the HTML, and never reloaded.
    expect(fetchImpl).toHaveBeenCalled();
    expect(fetchImpl.mock.calls.every(([url]) => String(url).startsWith('version.json'))).toBe(true);
    expect(reloadPage).not.toHaveBeenCalled();
  });

  it('treats a missing version.json as no news', async () => {
    const fetchImpl = serve({ version: null, html: htmlFor(NEXT) });
    vi.stubGlobal('fetch', fetchImpl);

    render(<Harness isBusy={() => false} />);
    await vi.advanceTimersByTimeAsync(BUILD_CHECK_MS * 3 + 1000);

    expect(reloadPage).not.toHaveBeenCalled();
  });

  it('reloads once when a new build is live, its HTML is deployed, and the screen is free', async () => {
    const fetchImpl = serve({ version: versionBody(NEXT), html: htmlFor(NEXT) });
    vi.stubGlobal('fetch', fetchImpl);

    render(<Harness isBusy={() => false} />);
    await vi.advanceTimersByTimeAsync(BUILD_CHECK_MS + 1000);

    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  // GitHub Pages serves everything with max-age=600, so its CDN can still be
  // handing out the previous index.html after version.json has moved on.
  // Reloading onto that would land on the old build and loop.
  it('waits while the CDN is still serving the old HTML, then reloads when it catches up', async () => {
    let html = htmlFor(OWN);
    const fetchImpl = vi.fn((url) => Promise.resolve({
      ok: true,
      text: () => Promise.resolve(String(url).startsWith('version.json') ? versionBody(NEXT) : html),
    }));
    vi.stubGlobal('fetch', fetchImpl);

    render(<Harness isBusy={() => false} />);
    await vi.advanceTimersByTimeAsync(BUILD_CHECK_MS + BUILD_BUSY_RECHECK_MS * 4);
    expect(reloadPage).not.toHaveBeenCalled();

    html = htmlFor(NEXT);
    await vi.advanceTimersByTimeAsync(BUILD_BUSY_RECHECK_MS + 100);
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it('holds the reload while the screen is busy and takes it when the room is free', async () => {
    const fetchImpl = serve({ version: versionBody(NEXT), html: htmlFor(NEXT) });
    vi.stubGlobal('fetch', fetchImpl);
    let busy = true;

    render(<Harness isBusy={() => busy} />);
    await vi.advanceTimersByTimeAsync(BUILD_CHECK_MS + BUILD_BUSY_RECHECK_MS * 6);
    expect(reloadPage).not.toHaveBeenCalled();

    busy = false;
    await vi.advanceTimersByTimeAsync(BUILD_BUSY_RECHECK_MS + 100);
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it('reads a throwing isBusy as busy, which is the safe direction', async () => {
    const fetchImpl = serve({ version: versionBody(NEXT), html: htmlFor(NEXT) });
    vi.stubGlobal('fetch', fetchImpl);

    render(<Harness isBusy={() => { throw new Error('render in progress'); }} />);
    await vi.advanceTimersByTimeAsync(BUILD_CHECK_MS + BUILD_BUSY_RECHECK_MS * 4);

    expect(reloadPage).not.toHaveBeenCalled();
  });

  it('never reloads out from under someone typing', async () => {
    const fetchImpl = serve({ version: versionBody(NEXT), html: htmlFor(NEXT) });
    vi.stubGlobal('fetch', fetchImpl);
    document.body.innerHTML = '<input id="f">';
    document.getElementById('f').focus();

    render(<Harness isBusy={() => false} />);
    await vi.advanceTimersByTimeAsync(BUILD_CHECK_MS + BUILD_BUSY_RECHECK_MS * 4);

    expect(reloadPage).not.toHaveBeenCalled();
    document.body.innerHTML = '';
  });

  // `online` fires in bursts when church WiFi comes back; one check answers
  // the whole burst.
  it('checks on the online event, but no more than once per rate-limit window', async () => {
    const fetchImpl = serve({ version: versionBody(OWN), html: htmlFor(OWN) });
    vi.stubGlobal('fetch', fetchImpl);

    render(<Harness isBusy={() => false} />);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(10);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(10);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(BUILD_ONLINE_MIN_MS);
    const afterWait = fetchImpl.mock.calls.length;
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(10);
    expect(fetchImpl.mock.calls.length).toBe(afterWait + 1);
  });

  it('stops polling once the page unmounts', async () => {
    const fetchImpl = serve({ version: versionBody(OWN), html: htmlFor(OWN) });
    vi.stubGlobal('fetch', fetchImpl);

    const { unmount } = render(<Harness isBusy={() => false} />);
    await vi.advanceTimersByTimeAsync(BUILD_CHECK_MS + 100);
    const calls = fetchImpl.mock.calls.length;
    unmount();
    await vi.advanceTimersByTimeAsync(BUILD_CHECK_MS * 3);

    expect(fetchImpl.mock.calls.length).toBe(calls);
  });
});
