import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BUILD_META_NAME,
  BUILD_PROBE_PARAM,
  COUNTDOWN_IDLE_MS,
  buildFromHtml,
  fetchProbe,
  isTyping,
  pageBuild,
  parseVersion,
  probeUrl,
  projectorIdle,
} from './buildReload.js';

const htmlWith = (build) => `<!DOCTYPE html><html><head>
  <meta charset="UTF-8" />
  <meta name="${BUILD_META_NAME}" content="${build}" />
  </head><body></body></html>`;

const textResponse = (body, ok = true) => ({ ok, text: () => Promise.resolve(body) });

afterEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('pageBuild', () => {
  it('reads the hash this page was stamped with', () => {
    document.head.innerHTML = `<meta name="${BUILD_META_NAME}" content="abc123def456">`;
    expect(pageBuild()).toBe('abc123def456');
  });

  // The dev server never stamps one, and neither does the hermetic e2e run.
  // Null is what keeps the poller from ever starting there.
  it('is null with no meta tag, an empty one, or whitespace', () => {
    expect(pageBuild()).toBeNull();
    document.head.innerHTML = `<meta name="${BUILD_META_NAME}" content="">`;
    expect(pageBuild()).toBeNull();
    document.head.innerHTML = `<meta name="${BUILD_META_NAME}" content="   ">`;
    expect(pageBuild()).toBeNull();
  });
});

describe('buildFromHtml', () => {
  it('finds the stamp in freshly fetched HTML', () => {
    expect(buildFromHtml(htmlWith('feedfacefeed'))).toBe('feedfacefeed');
  });

  it('tolerates single quotes and extra attributes', () => {
    expect(buildFromHtml(`<meta data-x='1' name='${BUILD_META_NAME}' content='aaa111'>`)).toBe('aaa111');
  });

  it('is null for HTML with no stamp, and for anything that is not a string', () => {
    expect(buildFromHtml('<html><head></head></html>')).toBeNull();
    expect(buildFromHtml(null)).toBeNull();
    expect(buildFromHtml(undefined)).toBeNull();
  });

  // A captive portal answers every URL with its own login page. That page has
  // no stamp, so it can never be mistaken for the new build.
  it('is null for an unrelated page', () => {
    expect(buildFromHtml('<html><head><title>Sign in to WiFi</title></head></html>')).toBeNull();
  });
});

describe('parseVersion', () => {
  it('reads the build out of a well-formed version.json', () => {
    expect(parseVersion('{"build":"1959baed6c46","builtAt":"2026-09-16T20:00:00.000Z"}')).toBe('1959baed6c46');
  });

  it('treats anything unexpected as no news', () => {
    expect(parseVersion('')).toBeNull();
    expect(parseVersion('not json')).toBeNull();
    expect(parseVersion('null')).toBeNull();
    expect(parseVersion('[1,2,3]')).toBeNull();
    expect(parseVersion('{"builtAt":"2026-09-16"}')).toBeNull();
    expect(parseVersion('{"build":""}')).toBeNull();
    expect(parseVersion('{"build":42}')).toBeNull();
    expect(parseVersion(null)).toBeNull();
  });
});

describe('probeUrl', () => {
  it('marks the request so every cache stands aside', () => {
    expect(probeUrl('version.json', 1000)).toBe(`version.json?${BUILD_PROBE_PARAM}=1000`);
  });

  it('appends to a path that already carries a query', () => {
    expect(probeUrl('/index.html?lowPower=1', 7)).toBe(`/index.html?lowPower=1&${BUILD_PROBE_PARAM}=7`);
  });
});

describe('fetchProbe', () => {
  it('returns the body of a clean answer', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(textResponse('{"build":"a"}'));
    await expect(fetchProbe('version.json', { fetchImpl })).resolves.toBe('{"build":"a"}');
    expect(fetchImpl.mock.calls[0][1].cache).toBe('no-store');
  });

  it('returns null for a 404, which is what the hermetic e2e run serves', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(textResponse('Not found', false));
    await expect(fetchProbe('version.json', { fetchImpl })).resolves.toBeNull();
  });

  it('returns null when the network throws', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(fetchProbe('version.json', { fetchImpl })).resolves.toBeNull();
  });

  it('gives up after the timeout instead of hanging forever', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const probe = fetchProbe('version.json', { fetchImpl, timeoutMs: 5000 });
    await vi.advanceTimersByTimeAsync(5001);
    await expect(probe).resolves.toBeNull();
    vi.useRealTimers();
  });
});

describe('projectorIdle', () => {
  const now = Date.UTC(2026, 8, 16, 12, 0, 0);
  const inMinutes = (m) => new Date(now + m * 60_000);

  it('is idle through the shutdown window, four hours to an empty room', () => {
    expect(projectorIdle({ mode: 'SHUTDOWN' }, now)).toBe(true);
  });

  it('is never idle during a game or a slideshow', () => {
    expect(projectorIdle({ mode: 'GAME_TIME' }, now)).toBe(false);
    expect(projectorIdle({ mode: 'SLIDESHOW' }, now)).toBe(false);
  });

  it('is idle while the next meeting is still far out', () => {
    expect(projectorIdle({ mode: 'COUNTDOWN', target: inMinutes(60) }, now)).toBe(true);
  });

  // The last half hour is the show: a room is filling up and watching the
  // clock. 17:30 on a club night is exactly this boundary.
  it('is never idle inside the last half hour of the countdown', () => {
    expect(projectorIdle({ mode: 'COUNTDOWN', target: inMinutes(29) }, now)).toBe(false);
    expect(projectorIdle({ mode: 'COUNTDOWN', target: new Date(now + COUNTDOWN_IDLE_MS) }, now)).toBe(false);
    expect(projectorIdle({ mode: 'COUNTDOWN', target: inMinutes(-5) }, now)).toBe(false);
  });

  it('is not idle when it cannot tell: a missing or unusable target', () => {
    expect(projectorIdle(null, now)).toBe(false);
    expect(projectorIdle({ mode: 'COUNTDOWN' }, now)).toBe(false);
    expect(projectorIdle({ mode: 'COUNTDOWN', target: new Date(NaN) }, now)).toBe(false);
  });
});

describe('isTyping', () => {
  it('is false with nothing focused', () => {
    expect(isTyping()).toBe(false);
  });

  it('is true while a text field has focus', () => {
    document.body.innerHTML = '<input id="f">';
    document.getElementById('f').focus();
    expect(isTyping()).toBe(true);
  });

  it('is true inside a contenteditable region', () => {
    document.body.innerHTML = '<div id="f" contenteditable="true" tabindex="0"></div>';
    document.getElementById('f').focus();
    expect(isTyping()).toBe(true);
  });
});
