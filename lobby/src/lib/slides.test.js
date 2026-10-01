import { describe, it, expect } from 'vitest';
import {
  MAX_EYEBROW,
  MAX_SLIDES,
  MAX_TEXT,
  MAX_VIDEO_NAME,
  SLIDE_THEMES,
  isVideoSlide,
  makeSlide,
  makeSlideId,
  makeVideoSlide,
  mergeSyncedDeck,
  resolveSizeClass,
  resolveTheme,
  sanitizeSlides,
  showDate,
  slideDurationMs,
  slideExpired,
  slideInWindow,
  slideScheduled,
  slideSizeClass,
  videoSlideTimerMs,
  visibleSlides,
  holdsCheckIns,
} from './slides.js';
import { isPromoSlide } from './promos.js';
import { localDateStr } from './calendarLogic.js';

describe('sanitizeSlides', () => {
  it('tolerates garbage roots from corrupt localStorage or bad imports', () => {
    expect(sanitizeSlides(null)).toEqual([]);
    expect(sanitizeSlides(undefined)).toEqual([]);
    expect(sanitizeSlides('[]')).toEqual([]);
    expect(sanitizeSlides({ text: 'not an array' })).toEqual([]);
    expect(sanitizeSlides(42)).toEqual([]);
  });

  it('keeps valid slides unchanged', () => {
    const slide = { id: 's_1', eyebrow: 'Awana', text: 'Welcome!', theme: 'night', durationSec: 10, textSize: 'auto' };
    expect(sanitizeSlides([slide])).toEqual([slide]);
  });

  it('normalizes legacy slides (no textSize) without dropping them', () => {
    const legacy = { id: 's_1', eyebrow: 'Awana', text: 'Welcome!', theme: 'night', durationSec: 10 };
    expect(sanitizeSlides([legacy])).toEqual([{ ...legacy, textSize: 'auto' }]);
  });

  it('drops entries that are not slides or have no usable text', () => {
    const good = makeSlide({ text: 'keep me' });
    expect(sanitizeSlides([
      null,
      'a string',
      ['nested'],
      { eyebrow: 'no text at all' },
      { text: 42 },
      { text: '   ' },
      good,
    ])).toEqual([good]);
  });

  it('truncates over-long text and eyebrow', () => {
    const [slide] = sanitizeSlides([{ text: 'x'.repeat(MAX_TEXT + 100), eyebrow: 'y'.repeat(MAX_EYEBROW + 5) }]);
    expect(slide.text).toHaveLength(MAX_TEXT);
    expect(slide.eyebrow).toHaveLength(MAX_EYEBROW);
  });

  it('caps the deck at the max slide count', () => {
    const many = Array.from({ length: MAX_SLIDES + 10 }, (_, i) => ({ text: `slide ${i}` }));
    expect(sanitizeSlides(many)).toHaveLength(MAX_SLIDES);
  });

  it('fills missing ids and de-duplicates repeated ones', () => {
    const out = sanitizeSlides([
      { text: 'a' },
      { id: 'dup', text: 'b' },
      { id: 'dup', text: 'c' },
    ]);
    const ids = out.map((s) => s.id);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(3);
  });

  it('falls back to the auto theme for unknown themes', () => {
    expect(sanitizeSlides([{ text: 'a', theme: 'disco' }])[0].theme).toBe('auto');
    expect(sanitizeSlides([{ text: 'a' }])[0].theme).toBe('auto');
  });

  it('coerces and clamps durations so timers can never go NaN', () => {
    const durations = sanitizeSlides([
      { text: 'a', durationSec: NaN },
      { text: 'b', durationSec: -5 },
      { text: 'c', durationSec: '7' },
      { text: 'd', durationSec: 1 },
      { text: 'e', durationSec: 9999 },
      { text: 'f', durationSec: 0 },
    ]).map((s) => s.durationSec);
    expect(durations).toEqual([0, 0, 0, 3, 600, 0]);
  });

  it('keeps a per-slide text size and falls back to auto for garbage', () => {
    expect(sanitizeSlides([{ text: 'a', textSize: 'xl' }])[0].textSize).toBe('xl');
    expect(sanitizeSlides([{ text: 'a', textSize: 'gigantic' }])[0].textSize).toBe('auto');
    expect(sanitizeSlides([{ text: 'a', textSize: 42 }])[0].textSize).toBe('auto');
  });

  it('accepts video slides without text but requires a videoId', () => {
    const video = { id: 's_v', type: 'video', videoId: 'v_1', videoName: 'promo.mp4', videoSize: 1000, durationSec: 0 };
    expect(sanitizeSlides([video])).toEqual([video]);
    expect(sanitizeSlides([{ type: 'video' }])).toEqual([]);
    expect(sanitizeSlides([{ type: 'video', videoId: '' }])).toEqual([]);
    expect(sanitizeSlides([{ type: 'video', videoId: '   ' }])).toEqual([]);
    expect(sanitizeSlides([{ type: 'video', videoId: 42 }])).toEqual([]);
  });

  it('repairs video slide metadata', () => {
    const [slide] = sanitizeSlides([{
      type: 'video',
      videoId: 'v_1',
      videoName: 'x'.repeat(MAX_VIDEO_NAME + 40),
      videoSize: 'huge',
      durationSec: 9999,
    }]);
    expect(slide.videoName).toHaveLength(MAX_VIDEO_NAME);
    expect(slide.videoSize).toBe(0);
    expect(slide.durationSec).toBe(600);
    // Video slides never carry text fields
    expect(slide.text).toBeUndefined();
    expect(slide.theme).toBeUndefined();
  });

  it('treats unknown types as text slides (dropped without text, normalized with it)', () => {
    expect(sanitizeSlides([{ type: 'gif', videoId: 'v_1' }])).toEqual([]);
    const [slide] = sanitizeSlides([{ type: 'gif', text: 'hi' }]);
    expect(slide.text).toBe('hi');
    expect(slide.type).toBeUndefined();
  });
});

describe('makeVideoSlide / isVideoSlide / videoSlideTimerMs', () => {
  it('makes a video slide that survives sanitizing', () => {
    const slide = makeVideoSlide({ videoId: 'v_1', videoName: 'promo.mp4', videoSize: 12345 });
    expect(isVideoSlide(slide)).toBe(true);
    expect(sanitizeSlides([slide])).toEqual([slide]);
  });

  it('is not fooled by text slides or junk', () => {
    expect(isVideoSlide(makeSlide({ text: 'hi' }))).toBe(false);
    expect(isVideoSlide(null)).toBe(false);
    expect(isVideoSlide({ type: 'gif' })).toBe(false);
  });

  it('returns null (ended-event mode) for duration 0, clamped ms otherwise', () => {
    expect(videoSlideTimerMs({ durationSec: 0 })).toBeNull();
    expect(videoSlideTimerMs(undefined)).toBeNull();
    expect(videoSlideTimerMs({ durationSec: 5 })).toBe(5000);
    expect(videoSlideTimerMs({ durationSec: 1 })).toBe(3000);
    expect(videoSlideTimerMs({ durationSec: 9999 })).toBe(600000);
  });
});

describe('resolveSizeClass', () => {
  it('honors an explicit per-slide size', () => {
    expect(resolveSizeClass({ text: 'x'.repeat(400), textSize: 'xl' })).toBe('slide-size-xl');
    expect(resolveSizeClass({ text: 'hi', textSize: 'md' })).toBe('slide-size-md');
  });

  it('falls back to the length buckets on auto or garbage', () => {
    expect(resolveSizeClass({ text: 'Welcome!', textSize: 'auto' })).toBe('slide-size-xl');
    expect(resolveSizeClass({ text: 'x'.repeat(400), textSize: 'huge' })).toBe('slide-size-sm');
    expect(resolveSizeClass(undefined)).toBe('slide-size-xl');
  });
});

describe('makeSlide / makeSlideId', () => {
  it('makes a valid slide that survives sanitizing once it has text', () => {
    const slide = makeSlide({ text: 'hello' });
    expect(sanitizeSlides([slide])).toEqual([slide]);
  });

  it('makes unique ids', () => {
    const ids = new Set(Array.from({ length: 100 }, makeSlideId));
    expect(ids.size).toBe(100);
  });
});

describe('resolveTheme', () => {
  it('rotates auto slides through the themes by position', () => {
    const auto = { theme: 'auto' };
    const first = resolveTheme(auto, 0);
    expect(resolveTheme(auto, SLIDE_THEMES.length)).toBe(first); // full cycle → wraps
    expect(resolveTheme(auto, 1)).not.toBe(first);
  });

  it('honors an explicit theme', () => {
    expect(resolveTheme({ theme: 'night' }, 2)).toBe('night');
  });
});

describe('slideSizeClass', () => {
  it('gives short punchy text the giant headline size', () => {
    expect(slideSizeClass('Welcome!')).toBe('slide-size-xl');
  });

  it('steps down as text grows', () => {
    expect(slideSizeClass('x'.repeat(100))).toBe('slide-size-lg');
    expect(slideSizeClass('x'.repeat(200))).toBe('slide-size-md');
    expect(slideSizeClass('x'.repeat(400))).toBe('slide-size-sm');
  });
});

describe('slideDurationMs', () => {
  it('prefers the per-slide duration', () => {
    expect(slideDurationMs({ durationSec: 12 }, 5)).toBe(12000);
  });

  it('falls back to the global delay, then the default', () => {
    expect(slideDurationMs({ durationSec: 0 }, 5)).toBe(5000);
    expect(slideDurationMs({ durationSec: 0 }, 0)).toBe(8000);
    expect(slideDurationMs(undefined, undefined)).toBe(8000);
  });

  it('clamps so a slide can never flash by or stick forever', () => {
    expect(slideDurationMs({ durationSec: 0 }, 1)).toBe(3000);
    expect(slideDurationMs({ durationSec: 0 }, 99999)).toBe(600000);
  });
});

describe('mergeSyncedDeck', () => {
  const text = (id, body) => ({ id, eyebrow: '', text: body, theme: 'auto', durationSec: 0, textSize: 'auto' });
  const video = (id, videoId) => ({ id, type: 'video', videoId, videoName: 'clip.mp4', videoSize: 1000, durationSec: 0 });

  it('returns the published deck untouched when this device has no video slides', () => {
    const synced = [text('s_a', 'Hello'), text('s_b', 'World')];
    expect(mergeSyncedDeck(synced, [text('s_local', 'Old local')])).toEqual(synced);
    expect(mergeSyncedDeck(synced, [])).toEqual(synced);
    expect(mergeSyncedDeck(synced, null)).toEqual(synced);
  });

  it('keeps this device\'s video slides in the rotation — the "saved a video and it vanished" fix', () => {
    const synced = [text('s_a', 'Hello')];
    const local = [video('s_v', 'vid_1')];
    const merged = mergeSyncedDeck(synced, local);
    expect(merged.map((s) => s.id)).toEqual(['s_a', 's_v']);
    expect(merged.filter(isVideoSlide)).toHaveLength(1);
  });

  it('honors the local interleave when local text matches the published text', () => {
    const synced = [text('s_a', 'Hello'), text('s_b', 'World')];
    const local = [text('s_a', 'Hello'), video('s_v', 'vid_1'), text('s_b', 'World')];
    expect(mergeSyncedDeck(synced, local).map((s) => s.id)).toEqual(['s_a', 's_v', 's_b']);
  });

  it('falls back to published-text-first + videos appended when the fleet has newer text', () => {
    const synced = [text('s_new', 'Fresh publish')];
    const local = [text('s_a', 'Stale'), video('s_v', 'vid_1'), text('s_b', 'Old')];
    const merged = mergeSyncedDeck(synced, local);
    expect(merged.map((s) => s.text ?? 'VIDEO')).toEqual(['Fresh publish', 'VIDEO']);
    expect(merged[0].id).toBe('s_new');
    expect(merged[1].videoId).toBe('vid_1');
  });

  it('an explicitly published EMPTY deck still plays this device\'s videos', () => {
    const local = [video('s_v', 'vid_1')];
    const merged = mergeSyncedDeck([], local);
    expect(merged).toHaveLength(1);
    expect(merged[0].videoId).toBe('vid_1');
  });

  it('dedupes an id shared between the published deck and a local video', () => {
    const synced = [text('s_dup', 'Hello')];
    const local = [text('s_x', 'Different'), video('s_dup', 'vid_1')];
    const merged = mergeSyncedDeck(synced, local);
    const ids = merged.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(merged.filter(isVideoSlide)).toHaveLength(1);
  });
});

describe('sanitizeSlides trims like the publisher', () => {
  it('trims text and eyebrow BEFORE slicing to the caps', () => {
    const [s] = sanitizeSlides([{ text: 'Hello\n', eyebrow: '  Awana  ' }]);
    expect(s.text).toBe('Hello');
    expect(s.eyebrow).toBe('Awana');
    const [long] = sanitizeSlides([{ text: ' '.repeat(5) + 'a'.repeat(MAX_TEXT) }]);
    expect(long.text).toBe('a'.repeat(MAX_TEXT));
  });
});

describe('mergeSyncedDeck compares content, not ids or whitespace', () => {
  const text = (id, body, eyebrow = '') => ({ id, eyebrow, text: body, theme: 'auto', durationSec: 0, textSize: 'auto' });
  const video = (id, videoId) => ({ id, type: 'video', videoId, videoName: 'clip.mp4', videoSize: 1000, durationSec: 0 });

  it('honors the local interleave when the publisher normalized whitespace', () => {
    const local = [text('s_a', 'Hello', 'Awana\nClubs'), video('s_v', 'vid_1'), text('s_b', 'World\n')];
    const synced = [text('s_a', 'Hello', 'Awana Clubs'), text('s_b', 'World')];
    expect(mergeSyncedDeck(synced, local).map((s) => s.id)).toEqual(['s_a', 's_v', 's_b']);
  });

  it('ignores ids when deciding whether the local text matches (the server may assign its own)', () => {
    const local = [text('s_a', 'Hello'), video('s_v', 'vid_1'), text('s_b', 'World')];
    const synced = [text('srv_1', 'Hello'), text('srv_2', 'World')];
    expect(mergeSyncedDeck(synced, local).map((s) => s.id)).toEqual(['s_a', 's_v', 's_b']);
  });
});

// ── The optional per-slide show window (#345) ───────────────────────────────
// A dated announcement retires itself. Everything here is a BARE LOCAL date:
// the whole point of the feature is that it never touches toISOString(),
// which in a US-Eastern evening has already rolled over to tomorrow — i.e.
// exactly club hours (the trap calendarLogic.js documents).

describe('showDate: strict YYYY-MM-DD, real calendar dates only', () => {
  it('accepts a real date and returns exactly what was typed', () => {
    expect(showDate('2026-09-09')).toBe('2026-09-09');
    expect(showDate('  2026-12-25  ')).toBe('2026-12-25');
    expect(showDate('2024-02-29')).toBe('2024-02-29');
  });

  it('drops anything that is not a real calendar date', () => {
    for (const bad of [
      '2026-02-29', '2026-13-01', '2026-00-10', '2026-09-31', '2026-09-00',
      '2026-9-1', '26-09-09', '2026/09/09', '2026-09-09T00:00:00Z',
      'next Wednesday', '', '   ', null, undefined, 20260909, {}, [],
    ]) {
      expect(showDate(bad)).toBeNull();
    }
  });
});

describe('sanitizeSlides keeps a valid window and drops a junk one', () => {
  it('round-trips both dates', () => {
    const [s] = sanitizeSlides([{ id: 's_1', text: 'Store night', showFrom: '2026-09-09', showUntil: '2026-09-16' }]);
    expect(s.showFrom).toBe('2026-09-09');
    expect(s.showUntil).toBe('2026-09-16');
  });

  it('omits the field entirely rather than storing null or an empty string', () => {
    const [s] = sanitizeSlides([{ text: 'x', showFrom: '', showUntil: 'whenever' }]);
    expect('showFrom' in s).toBe(false);
    expect('showUntil' in s).toBe(false);
  });

  it('a deck with no dates is byte-identical to what shipped before the field', () => {
    expect(sanitizeSlides([{ id: 's_1', eyebrow: '', text: 'Plain', theme: 'auto', durationSec: 0, textSize: 'auto' }]))
      .toEqual([{ id: 's_1', eyebrow: '', text: 'Plain', theme: 'auto', durationSec: 0, textSize: 'auto' }]);
  });

  it('an impossible date does not take the slide with it', () => {
    const out = sanitizeSlides([{ text: 'Bring a friend', showFrom: '2026-02-30' }]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('Bring a friend');
  });

  it('a video slide is unaffected — the window is a text-slide idea', () => {
    const [v] = sanitizeSlides([{ type: 'video', videoId: 'v_1', showUntil: '2026-09-16' }]);
    expect('showUntil' in v).toBe(false);
  });
});

describe('slideInWindow / visibleSlides: inclusive local boundaries', () => {
  const slide = (extra) => ({ text: 'x', ...extra });

  it('no window means always visible', () => {
    expect(slideInWindow(slide({}), '2026-09-09')).toBe(true);
  });

  it('both bounds are INCLUSIVE — the last day still shows', () => {
    const s = slide({ showFrom: '2026-09-09', showUntil: '2026-09-16' });
    expect(slideInWindow(s, '2026-09-08')).toBe(false);
    expect(slideInWindow(s, '2026-09-09')).toBe(true);
    expect(slideInWindow(s, '2026-09-16')).toBe(true);
    expect(slideInWindow(s, '2026-09-17')).toBe(false);
  });

  it('a one-day window shows on exactly that day', () => {
    const s = slide({ showFrom: '2026-09-16', showUntil: '2026-09-16' });
    expect(slideInWindow(s, '2026-09-15')).toBe(false);
    expect(slideInWindow(s, '2026-09-16')).toBe(true);
    expect(slideInWindow(s, '2026-09-17')).toBe(false);
  });

  it('crosses a year and a month boundary correctly', () => {
    const s = slide({ showFrom: '2026-12-30', showUntil: '2027-01-02' });
    expect(slideInWindow(s, '2026-12-29')).toBe(false);
    expect(slideInWindow(s, '2026-12-31')).toBe(true);
    expect(slideInWindow(s, '2027-01-02')).toBe(true);
    expect(slideInWindow(s, '2027-01-03')).toBe(false);
  });

  it('a junk window never hides a slide — always, never never', () => {
    expect(slideInWindow(slide({ showUntil: '2026-02-30' }), '2026-09-09')).toBe(true);
    expect(slideInWindow(slide({ showFrom: 'yesterday' }), '2026-09-09')).toBe(true);
  });

  it('an unusable "today" shows everything rather than blanking the screen', () => {
    expect(slideInWindow(slide({ showUntil: '2020-01-01' }), '')).toBe(true);
    expect(visibleSlides([slide({ showUntil: '2020-01-01' })], null)).toHaveLength(1);
  });

  it('filters a deck and tolerates a garbage root', () => {
    const deck = [
      slide({ text: 'always' }),
      slide({ text: 'expired', showUntil: '2026-09-08' }),
      slide({ text: 'future', showFrom: '2026-09-10' }),
      slide({ text: 'today', showFrom: '2026-09-09', showUntil: '2026-09-09' }),
    ];
    expect(visibleSlides(deck, '2026-09-09').map((s) => s.text)).toEqual(['always', 'today']);
    expect(visibleSlides(null, '2026-09-09')).toEqual([]);
  });

  it('an all-expired deck filters to nothing — App falls back to the calendar slides', () => {
    const deck = [slide({ showUntil: '2026-08-01' }), slide({ showUntil: '2026-09-08' })];
    expect(visibleSlides(deck, '2026-09-09')).toEqual([]);
  });

  it('is fed the LOCAL date key, and one day off is the whole bug', () => {
    // The trap this feature must not fall into: at 23:59 local on Sep 9 in a
    // US-Eastern evening (exactly club hours) toISOString() already reads
    // Sep 10, which would retire tonight's slide an evening early. localDateStr
    // is what App.jsx passes in, and it stays on Sep 9 — pinned in
    // calendarLogic.test.js. The consequence of the two keys differing:
    expect(slideInWindow(slide({ showUntil: '2026-09-09' }), '2026-09-09')).toBe(true);
    expect(slideInWindow(slide({ showUntil: '2026-09-09' }), '2026-09-10')).toBe(false);
    expect(localDateStr(new Date(2026, 8, 9, 23, 59))).toBe('2026-09-09');
  });
});

describe('slideExpired / slideScheduled drive the editor badges, not the filter', () => {
  it('expired is only about a window that has already closed', () => {
    expect(slideExpired({ showUntil: '2026-09-08' }, '2026-09-09')).toBe(true);
    expect(slideExpired({ showUntil: '2026-09-09' }, '2026-09-09')).toBe(false);
    expect(slideExpired({ showFrom: '2026-09-10' }, '2026-09-09')).toBe(false);
    expect(slideExpired({}, '2026-09-09')).toBe(false);
    expect(slideExpired({ showUntil: 'junk' }, '2026-09-09')).toBe(false);
  });

  it('scheduled is only about a window that has not opened yet', () => {
    expect(slideScheduled({ showFrom: '2026-09-10' }, '2026-09-09')).toBe(true);
    expect(slideScheduled({ showFrom: '2026-09-09' }, '2026-09-09')).toBe(false);
    expect(slideScheduled({ showUntil: '2026-09-01' }, '2026-09-09')).toBe(false);
  });
});

describe('mergeSyncedDeck notices a changed show window', () => {
  const dated = (id, body, extra) => ({ id, eyebrow: '', text: body, theme: 'auto', durationSec: 0, textSize: 'auto', ...extra });

  it('a locally re-dated slide is NOT treated as identical to the published one', () => {
    const local = [dated('s_a', 'Store night', { showUntil: '2026-10-01' }), { id: 's_v', type: 'video', videoId: 'v_1', videoName: '', videoSize: 0, durationSec: 0 }];
    const synced = [dated('srv_1', 'Store night', { showUntil: '2026-09-16' })];
    const out = mergeSyncedDeck(synced, local);
    // The published text wins; this device's video joins at the end.
    expect(out.map((s) => s.id)).toEqual(['srv_1', 's_v']);
    expect(out[0].showUntil).toBe('2026-09-16');
  });
});

describe('holdCheckIns / holdsCheckIns', () => {
  it('keeps the flag only when it is strictly true, on text and video slides', () => {
    const [marked, unmarked, junk, video] = sanitizeSlides([
      { text: 'Pick-up is at the gym doors', holdCheckIns: true },
      { text: 'Bring your handbook', holdCheckIns: false },
      { text: 'Junk flag', holdCheckIns: 'true' },
      { type: 'video', videoId: 'v1', holdCheckIns: true },
    ]);
    expect(marked.holdCheckIns).toBe(true);
    // Omitted, never false: an unmarked deck stays byte-identical.
    expect('holdCheckIns' in unmarked).toBe(false);
    expect('holdCheckIns' in junk).toBe(false);
    expect(video.holdCheckIns).toBe(true);
  });

  it('holds for the promo posters and marked slides only', () => {
    expect(holdsCheckIns({ type: 'promo' })).toBe(true);
    expect(holdsCheckIns({ text: 'x', holdCheckIns: true })).toBe(true);
    expect(holdsCheckIns({ text: 'x' })).toBe(false);
    expect(holdsCheckIns({ text: 'x', holdCheckIns: 1 })).toBe(false);
    expect(holdsCheckIns(null)).toBe(false);
  });

  it('agrees with isPromoSlide about what a poster is', () => {
    for (const s of [{ type: 'promo' }, { type: 'video' }, { text: 'x' }, {}]) {
      if (isPromoSlide(s)) expect(holdsCheckIns(s)).toBe(true);
    }
  });

  it('a mark counts as a content change when merging a synced deck', () => {
    const local = [{ id: 'a', text: 'One' }, { type: 'video', id: 'v', videoId: 'v1' }];
    const synced = [{ id: 'a', text: 'One', holdCheckIns: true }];
    // The fleet marked the slide: that is newer text, so the published deck
    // (carrying the mark) wins over this device's unmarked copy.
    const merged = mergeSyncedDeck(synced, local);
    expect(merged.find((s) => s.text === 'One').holdCheckIns).toBe(true);
  });
});
