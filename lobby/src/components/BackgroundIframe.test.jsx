import { describe, it, expect } from 'vitest';
import { normalizeEmbedUrl } from './BackgroundIframe.jsx';

describe('normalizeEmbedUrl', () => {
  it('decodes &amp; separators copied from iframe HTML snippets', () => {
    const url = 'https://onedrive.live.com/embed?resid=ABC&amp;authkey=xyz&amp;em=2&amp;wdSlideShowDelay=0';
    expect(normalizeEmbedUrl(url)).toBe(
      'https://onedrive.live.com/embed?resid=ABC&authkey=xyz&em=2&wdSlideShowDelay=0',
    );
  });

  it('adds em=2 and wdSlideShowDelay to OneDrive embed URLs', () => {
    const out = normalizeEmbedUrl('https://onedrive.live.com/embed?resid=ABC', 5);
    expect(out).toContain('em=2');
    expect(out).toContain('wdSlideShowDelay=5000');
  });

  it('converts the delay from seconds to milliseconds', () => {
    expect(normalizeEmbedUrl('https://onedrive.live.com/embed?resid=A', 10)).toContain('wdSlideShowDelay=10000');
    // 0 = let the presentation's own timings drive the show.
    expect(normalizeEmbedUrl('https://onedrive.live.com/embed?resid=A', 0)).toContain('wdSlideShowDelay=0');
  });

  it('falls back to 5s when the delay is invalid', () => {
    expect(normalizeEmbedUrl('https://onedrive.live.com/embed?resid=A', NaN)).toContain('wdSlideShowDelay=5000');
    expect(normalizeEmbedUrl('https://onedrive.live.com/embed?resid=A', -3)).toContain('wdSlideShowDelay=5000');
  });

  it('does not duplicate an existing wdSlideShowDelay', () => {
    const url = 'https://onedrive.live.com/embed?resid=A&em=2&wdSlideShowDelay=3000';
    expect(normalizeEmbedUrl(url, 5)).toBe(url);
  });

  it('upgrades SharePoint Doc.aspx links to embed view', () => {
    const out = normalizeEmbedUrl('https://contoso.sharepoint.com/:p:/Doc.aspx?sourcedoc=x');
    expect(out).toContain('action=embedview');
  });

  it('leaves non-Office URLs untouched', () => {
    const url = 'https://example.com/some-page?foo=1';
    expect(normalizeEmbedUrl(url, 5)).toBe(url);
  });

  it('passes through empty values', () => {
    expect(normalizeEmbedUrl('')).toBe('');
    expect(normalizeEmbedUrl(null)).toBeNull();
  });
});

// ── Source selection ─────────────────────────────────────────────────────────
// The typed/published deck is the DEFAULT source now, so a screen with nothing
// else set plays it; and panic mode's placeholder path (powerpoint + no URL)
// must keep showing the placeholder, never a deck.
import { afterEach, beforeEach, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { FLAGSHIP_DURATION_SEC } from '../lib/flagship.js';

vi.mock('../lib/videoStore.js', () => ({
  BACKGROUND_VIDEO_ID: 'background',
  getVideo: vi.fn(async () => null),
}));

const BackgroundIframe = (await import('./BackgroundIframe.jsx')).default;

// The permanent flagship slide leads every typed deck (src/lib/flagship.js) and
// holds FLAGSHIP_DURATION_SEC; these tests look at what comes after it.
const pastFlagship = () => act(() => { vi.advanceTimersByTime(FLAGSHIP_DURATION_SEC * 1000 + 50); });

// The flagship is off the air Wednesday 6:30-8:30 pm (flagshipOnAir), so every
// test runs on a Tuesday noon rather than whenever the suite happens to run.
const TUESDAY = new Date(2026, 8, 29, 12, 0);
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'], now: TUESDAY }); });
afterEach(() => { vi.useRealTimers(); });

const DECK = [{ id: 's_1', eyebrow: '', text: 'Synced deck', theme: 'sky', durationSec: 0, textSize: 'auto' }];

describe('source selection', () => {
  afterEach(cleanup);

  it('renders the typed/published deck under the manual source, after the flagship welcome', () => {
    vi.useFakeTimers({ now: TUESDAY });
    try {
      const { container } = render(
        <BackgroundIframe backgroundSource="manual" manualSlides={DECK} calendarSlides={[]} url="" slideshowDelaySec={5} />
      );
      expect(container.querySelector('.flagship')).toBeTruthy();
      expect(container.querySelector('.manual-slide-text')).toBeNull();
      pastFlagship();
      expect(container.querySelector('.manual-slide-text').textContent).toBe('Synced deck');
    } finally {
      vi.useRealTimers();
    }
  });

  it('never plays the flagship for a source that is not the typed deck', () => {
    const { container } = render(
      <BackgroundIframe backgroundSource="powerpoint" manualSlides={DECK} calendarSlides={[]} url="" slideshowDelaySec={5} />
    );
    expect(container.querySelector('.flagship')).toBeNull();
  });

  it('powerpoint with no URL shows the placeholder, never a deck (panic mode relies on this)', () => {
    const { container } = render(
      <BackgroundIframe backgroundSource="powerpoint" manualSlides={DECK} calendarSlides={[]} url="" slideshowDelaySec={5} />
    );
    expect(container.querySelector('.manual-slide-text')).toBeNull();
    expect(container.querySelector('.placeholder-copy')).toBeTruthy();
  });
});

describe('the flagship is off the air during Wednesday club', () => {
  afterEach(cleanup);

  it('leaves the deck to its own slides from 6:30 pm, and comes back at 8:30 pm', () => {
    vi.useFakeTimers({ now: new Date(2026, 8, 30, 19, 0) }); // a Wednesday
    const { container } = render(
      <BackgroundIframe backgroundSource="manual" manualSlides={DECK} calendarSlides={[]} url="" slideshowDelaySec={5} />
    );
    expect(container.querySelector('.flagship')).toBeNull();
    expect(container.querySelector('.manual-slide-text').textContent).toBe('Synced deck');
    act(() => { vi.setSystemTime(new Date(2026, 8, 30, 20, 30)); vi.advanceTimersByTime(31_000); });
    expect(container.querySelector('.flagship')).toBeTruthy();
  });
});

describe('an all-expired typed deck (#345) is never a blank screen', () => {
  afterEach(cleanup);

  // App.jsx filters the MANUAL deck through visibleSlides() and hands the
  // calendar slides down separately, so an expired deck leaves the calendar
  // rotation on the wall — and with the calendar off, the welcome placeholder.
  const CAL = [{ id: 'cal_1', eyebrow: 'Tonight', text: 'Welcome to Awana!', theme: 'sky', durationSec: 0, textSize: 'auto' }];

  it('falls back to the calendar slides, behind the flagship', () => {
    vi.useFakeTimers({ now: TUESDAY });
    try {
      const { container } = render(
        <BackgroundIframe backgroundSource="manual" manualSlides={[]} calendarSlides={CAL} url="" slideshowDelaySec={5} />
      );
      expect(container.querySelector('.flagship')).toBeTruthy();
      pastFlagship();
      expect(container.querySelector('.manual-slide-text').textContent).toBe('Welcome to Awana!');
    } finally {
      vi.useRealTimers();
    }
  });

  it('with no slides at all, the flagship IS the welcome (it replaced the typed-deck placeholder)', () => {
    const { container } = render(
      <BackgroundIframe backgroundSource="manual" manualSlides={[]} calendarSlides={[]} url="" slideshowDelaySec={5} />
    );
    expect(container.querySelector('.flagship')).toBeTruthy();
    expect(container.querySelector('.placeholder-copy')).toBeNull();
  });
});
