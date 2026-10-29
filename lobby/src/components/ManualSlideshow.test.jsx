import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useLayoutEffect } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import ManualSlideshow, { MISSING_VIDEO_SKIP_MS, nextStep } from './ManualSlideshow.jsx';
import { ZeroAnimationContext } from '../lib/motion.jsx';
import { getVideo } from '../lib/videoStore.js';
import { SEAMLESS_GRACE_SEC, previewPromo } from '../lib/promos.js';
import { GRAND_PRIX } from './promos/GrandPrixPromo.jsx';

vi.mock('../lib/videoStore.js', () => ({
  getVideo: vi.fn(),
}));

const deck = [
  { id: 's_1', eyebrow: '', text: 'First slide', theme: 'sky', durationSec: 0 },
  { id: 's_2', eyebrow: 'Awana', text: 'Second slide', theme: 'night', durationSec: 4 },
  { id: 's_3', eyebrow: '', text: 'Third slide', theme: 'auto', durationSec: 0 },
];

// The lobby splits a headline into words so each can land on its own beat,
// so a slide's text is the headline's textContent, not one text node.
const headlines = () => [...document.querySelectorAll('.manual-slide-text')].map((el) => el.textContent);
const shows = (text) => headlines().includes(text);

const videoSlide = { id: 's_v', type: 'video', videoId: 'v_1', videoName: 'promo.mp4', videoSize: 100, durationSec: 0 };

describe('ManualSlideshow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom implements neither media playback nor object URLs.
    window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
    getVideo.mockReset();
    getVideo.mockResolvedValue(new Blob(['x'], { type: 'video/webm' }));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders the first slide text and eyebrow-less layout', () => {
    render(<ManualSlideshow slides={deck} slideshowDelaySec={5} />);
    expect(shows('First slide')).toBe(true);
  });

  it('advances to the next slide after the global delay', () => {
    render(<ManualSlideshow slides={deck} slideshowDelaySec={5} />);
    act(() => vi.advanceTimersByTime(5000));
    expect(shows('Second slide')).toBe(true);
    expect(screen.getByText('Awana')).toBeTruthy();
  });

  it('honors a per-slide duration over the global delay', () => {
    render(<ManualSlideshow slides={deck} slideshowDelaySec={10} />);
    act(() => vi.advanceTimersByTime(10000)); // → slide 2 (4s own duration)
    act(() => vi.advanceTimersByTime(4000)); // slide 2's 4s, not the global 10s
    expect(shows('Third slide')).toBe(true);
  });

  it('wraps from the last slide back to the first', () => {
    render(<ManualSlideshow slides={deck} slideshowDelaySec={5} />);
    act(() => vi.advanceTimersByTime(5000)); // → 2
    act(() => vi.advanceTimersByTime(4000)); // → 3
    act(() => vi.advanceTimersByTime(5000)); // → back to 1
    expect(shows('First slide')).toBe(true);
  });

  it('idles on a single slide forever', () => {
    render(<ManualSlideshow slides={[deck[0]]} slideshowDelaySec={5} />);
    act(() => vi.advanceTimersByTime(60000));
    expect(shows('First slide')).toBe(true);
  });

  it('renders nothing (not a crash) with an empty deck', () => {
    const { container } = render(<ManualSlideshow slides={[]} slideshowDelaySec={5} />);
    expect(container.innerHTML).toBe('');
  });

  it('keeps its hold timer when re-rendered with an equal-but-new deck', () => {
    // App re-renders on every event and can hand down a fresh array of the
    // same slides; that must not restart the hold (the show used to stall on
    // one slide through a whole check-in rush).
    const { rerender } = render(<ManualSlideshow slides={deck} slideshowDelaySec={5} />);
    act(() => vi.advanceTimersByTime(3000));
    rerender(<ManualSlideshow slides={[...deck]} slideshowDelaySec={5} />);
    act(() => vi.advanceTimersByTime(1999));
    expect(shows('First slide')).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(shows('Second slide')).toBe(true);
  });

  it('survives the deck shrinking below the current index', () => {
    const { rerender } = render(<ManualSlideshow slides={deck} slideshowDelaySec={5} />);
    act(() => vi.advanceTimersByTime(5000)); // → 2
    act(() => vi.advanceTimersByTime(4000)); // → 3 (index 2)
    rerender(<ManualSlideshow slides={deck.slice(0, 1)} slideshowDelaySec={5} />);
    expect(shows('First slide')).toBe(true);
  });

  it('honors an explicit per-slide text size over the auto bucket, all the way to the fitted headline', () => {
    const headline = (textSize) => {
      const { container, unmount } = render(<ManualSlideshow slides={[{ ...deck[0], textSize }]} slideshowDelaySec={5} />);
      const el = container.querySelector('.manual-slide-text');
      const out = { cls: el.className, size: el.style.fontSize };
      unmount();
      return out;
    };
    const auto = headline('auto');
    expect(auto.cls).toContain('lobby-headline--shout');
    expect(auto.size).toBe('calc(7.6 * var(--u))');
    const lg = headline('lg');
    expect(lg.cls).toContain('lobby-headline--shout');
    expect(lg.size).toBe('calc(6.1 * var(--u))');
    const md = headline('md');
    expect(md.cls).toContain('lobby-headline--read');
    expect(md.size).toBe('calc(4.2 * var(--u))');
  });
});

describe('ManualSlideshow video slides', () => {
  const videoDeck = [deck[0], videoSlide, deck[2]];

  beforeEach(() => {
    vi.useFakeTimers();
    window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
    getVideo.mockReset();
    getVideo.mockResolvedValue(new Blob(['x'], { type: 'video/webm' }));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  async function advanceToVideo(container) {
    act(() => vi.advanceTimersByTime(5000)); // text slide 1 → video
    await act(async () => {}); // flush the getVideo microtask
    return container.querySelector('video.manual-slide-video');
  }

  it('plays a stored video muted with no loop and no parent timer (ended-driven)', async () => {
    const { container } = render(<ManualSlideshow slides={videoDeck} slideshowDelaySec={5} />);
    const video = await advanceToVideo(container);
    expect(video).toBeTruthy();
    expect(video.muted).toBe(true);
    expect(video.hasAttribute('loop')).toBe(false);
    // No timer in ended mode: far-future timers must not leave the video
    act(() => vi.advanceTimersByTime(120000));
    expect(container.querySelector('video.manual-slide-video')).toBeTruthy();
  });

  it('advances when the video ends', async () => {
    const { container } = render(<ManualSlideshow slides={videoDeck} slideshowDelaySec={5} />);
    const video = await advanceToVideo(container);
    act(() => { fireEvent(video, new Event('ended')); });
    expect(shows('Third slide')).toBe(true);
  });

  it('does not call play() again when the parent re-renders', async () => {
    const { container, rerender } = render(<ManualSlideshow slides={videoDeck} slideshowDelaySec={5} />);
    await advanceToVideo(container);
    const plays = window.HTMLMediaElement.prototype.play.mock.calls.length;
    rerender(<ManualSlideshow slides={videoDeck} slideshowDelaySec={5} paused />);
    rerender(<ManualSlideshow slides={videoDeck} slideshowDelaySec={5} />);
    expect(window.HTMLMediaElement.prototype.play.mock.calls.length).toBe(plays);
  });

  it('revokes the object URL when the video slide unmounts', async () => {
    const { container, unmount } = render(<ManualSlideshow slides={videoDeck} slideshowDelaySec={5} />);
    await advanceToVideo(container);
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock');
  });

  it('loops a video with an explicit duration and advances on the timer', async () => {
    const timed = [deck[0], { ...videoSlide, durationSec: 4 }, deck[2]];
    const { container } = render(<ManualSlideshow slides={timed} slideshowDelaySec={5} />);
    const video = await advanceToVideo(container);
    expect(video.hasAttribute('loop')).toBe(true);
    act(() => vi.advanceTimersByTime(4000));
    expect(shows('Third slide')).toBe(true);
  });

  it('skips ahead when the video is missing from this device', async () => {
    getVideo.mockResolvedValue(null);
    const { container } = render(<ManualSlideshow slides={videoDeck} slideshowDelaySec={5} />);
    await advanceToVideo(container);
    expect(container.querySelector('video')).toBeNull();
    expect(screen.getByText('Video not available on this device')).toBeTruthy();
    act(() => vi.advanceTimersByTime(MISSING_VIDEO_SKIP_MS));
    expect(shows('Third slide')).toBe(true);
  });

  it('skips ahead when the video errors mid-decode', async () => {
    const { container } = render(<ManualSlideshow slides={videoDeck} slideshowDelaySec={5} />);
    const video = await advanceToVideo(container);
    act(() => { fireEvent(video, new Event('error')); });
    act(() => vi.advanceTimersByTime(MISSING_VIDEO_SKIP_MS));
    expect(shows('Third slide')).toBe(true);
  });

  it('loops a lone video forever instead of freezing on the last frame', async () => {
    const { container } = render(<ManualSlideshow slides={[videoSlide]} slideshowDelaySec={5} />);
    await act(async () => {});
    const video = container.querySelector('video.manual-slide-video');
    expect(video.hasAttribute('loop')).toBe(true);
    act(() => vi.advanceTimersByTime(120000));
    expect(container.querySelector('video.manual-slide-video')).toBeTruthy();
  });

  // ── The season promo slot (#promos) ───────────────────────────────────
  // ONE slide in the deck, a different promo on each lap through it — see
  // src/lib/promos.js for why the four posters share a slot.
  describe('the promo slot', () => {
    const promoSlot = {
      id: 'season_promo',
      type: 'promo',
      durationSec: 12,
      promos: [
        { id: 'promo_contest', kind: 'contest', eventDate: '2026-10-14', tonight: false, countdown: '3 club nights left', afterContest: false },
        { id: 'promo_friend', kind: 'friend', eventDate: '2026-10-14', tonight: false, countdown: '3 club nights left', afterContest: false },
      ],
    };
    const withPromo = [deck[0], promoSlot];

    it('shows promo A on the first lap and promo B on the next', () => {
      const { container } = render(<ManualSlideshow slides={withPromo} slideshowDelaySec={5} />);
      act(() => vi.advanceTimersByTime(5000)); // text slide → the promo slot
      expect(container.querySelector('.promo-slide--contest')).not.toBeNull();

      act(() => vi.advanceTimersByTime(12000)); // the slot's own 12s → lap 2
      expect(shows('First slide')).toBe(true);
      act(() => vi.advanceTimersByTime(5000));
      expect(container.querySelector('.promo-slide--friend')).not.toBeNull();

      // …and round again to the first promo, not off the end of the list.
      act(() => vi.advanceTimersByTime(12000));
      act(() => vi.advanceTimersByTime(5000));
      expect(container.querySelector('.promo-slide--contest')).not.toBeNull();
    });

    it('honours the slot\'s own hold rather than the global delay', () => {
      const { container } = render(<ManualSlideshow slides={withPromo} slideshowDelaySec={5} />);
      act(() => vi.advanceTimersByTime(5000));
      expect(container.querySelector('.promo-slide')).not.toBeNull();
      act(() => vi.advanceTimersByTime(5000)); // the global delay is NOT the promo's
      expect(container.querySelector('.promo-slide')).not.toBeNull();
      act(() => vi.advanceTimersByTime(7000)); // 12s total
      expect(shows('First slide')).toBe(true);
    });

    it('a promo-only deck renders the first promo and never throws', () => {
      const { container } = render(<ManualSlideshow slides={[promoSlot]} slideshowDelaySec={5} />);
      expect(container.querySelector('.promo-slide--contest')).not.toBeNull();
      act(() => vi.advanceTimersByTime(600000));
      expect(container.querySelector('.promo-slide--contest')).not.toBeNull();
    });

    // The posters are not the same length of read: the slime cut of BARF
    // Night runs a 15 second beat sheet and the others say their piece in 8.
    // The slot holds for the ONE it is showing.
    describe('a per-promo hold', () => {
      const mixed = {
        ...promoSlot,
        promos: [
          { ...promoSlot.promos[0], durationSec: 8 },
          { ...promoSlot.promos[1], kind: 'barfEpic', id: 'promo_barf_epic', durationSec: 15 },
        ],
      };
      const deckWith = [deck[0], mixed];

      it('holds lap 0 for its promo\'s 8 seconds, not the slot\'s 12', () => {
        const { container } = render(<ManualSlideshow slides={deckWith} slideshowDelaySec={5} />);
        act(() => vi.advanceTimersByTime(5000)); // text slide → the slot
        expect(container.querySelector('.promo-slide--contest')).not.toBeNull();
        act(() => vi.advanceTimersByTime(7999));
        expect(container.querySelector('.promo-slide--contest')).not.toBeNull();
        act(() => vi.advanceTimersByTime(1));
        expect(shows('First slide')).toBe(true);
      });

      it('holds the slime cut\'s lap for its own 15 seconds', () => {
        const { container } = render(<ManualSlideshow slides={deckWith} slideshowDelaySec={5} />);
        act(() => vi.advanceTimersByTime(5000)); // → the slot, lap 0
        act(() => vi.advanceTimersByTime(8000)); // → text slide
        act(() => vi.advanceTimersByTime(5000)); // → the slot, lap 1
        expect(container.querySelector('.promo-slide--barf-epic')).not.toBeNull();
        act(() => vi.advanceTimersByTime(14999));
        expect(container.querySelector('.promo-slide--barf-epic')).not.toBeNull();
        act(() => vi.advanceTimersByTime(1));
        expect(shows('First slide')).toBe(true);
      });

      it('falls back to the slot\'s own hold for a promo that names none', () => {
        const noOwn = {
          ...promoSlot,
          promos: [{ ...promoSlot.promos[0] }],
        };
        const { container } = render(<ManualSlideshow slides={[deck[0], noOwn]} slideshowDelaySec={5} />);
        act(() => vi.advanceTimersByTime(5000));
        expect(container.querySelector('.promo-slide--contest')).not.toBeNull();
        act(() => vi.advanceTimersByTime(11999));
        expect(container.querySelector('.promo-slide--contest')).not.toBeNull();
        act(() => vi.advanceTimersByTime(1));
        expect(shows('First slide')).toBe(true);
      });
    });
  });
});

describe('ManualSlideshow as the lobby director sees it (rebrand stage 4)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const held = { id: 's_h', eyebrow: 'Important', text: 'Pick-up is at the gym doors', theme: 'sky', durationSec: 6, holdCheckIns: true };

  it('names on screen stop the clock without resetting it', () => {
    const { rerender } = render(<ManualSlideshow slides={deck} slideshowDelaySec={5} />);
    act(() => vi.advanceTimersByTime(3000));
    rerender(<ManualSlideshow slides={deck} slideshowDelaySec={5} paused />);
    act(() => vi.advanceTimersByTime(20000));
    expect(shows('First slide')).toBe(true);
    rerender(<ManualSlideshow slides={deck} slideshowDelaySec={5} paused={false} />);
    // Two seconds were left on the first slide when the names came up.
    act(() => vi.advanceTimersByTime(1999));
    expect(shows('Second slide')).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(shows('Second slide')).toBe(true);
  });

  it('reports every slide, and whether it holds check-ins', () => {
    const onSlide = vi.fn();
    render(<ManualSlideshow slides={[deck[0], held]} slideshowDelaySec={5} onSlide={onSlide} />);
    expect(onSlide).toHaveBeenLastCalledWith({ key: '0:s_1', special: false, poster: false });
    act(() => vi.advanceTimersByTime(5000));
    expect(onSlide).toHaveBeenLastCalledWith({ key: '1:s_h', special: true, poster: false });
    act(() => vi.advanceTimersByTime(6000));
    expect(onSlide).toHaveBeenLastCalledWith({ key: '2:s_1', special: false, poster: false });
  });

  it('never holds when the deck could not move on to an ordinary slide', () => {
    const onSlide = vi.fn();
    const { unmount } = render(<ManualSlideshow slides={[held]} slideshowDelaySec={5} onSlide={onSlide} />);
    expect(onSlide).toHaveBeenLastCalledWith({ key: '0:s_h', special: false, poster: false });
    unmount();
    const onOnly = vi.fn();
    render(<ManualSlideshow slides={[held, { ...held, id: 's_h2' }]} slideshowDelaySec={5} onSlide={onOnly} />);
    expect(onOnly).toHaveBeenLastCalledWith({ key: '0:s_h', special: false, poster: false });
  });

  it('stops holding when the slideshow goes away', () => {
    const onSlide = vi.fn();
    const { unmount } = render(<ManualSlideshow slides={[held, deck[0]]} slideshowDelaySec={5} onSlide={onSlide} />);
    expect(onSlide).toHaveBeenLastCalledWith({ key: '0:s_h', special: true, poster: false });
    unmount();
    expect(onSlide).toHaveBeenLastCalledWith({ key: 'none', special: false, poster: false });
  });

  it('sweeps the stinger over any change that involves a held slide, and only then', () => {
    const { container } = render(<ManualSlideshow slides={[deck[0], deck[2], held]} slideshowDelaySec={5} />);
    expect(container.querySelector('.slide-stinger')).toBeNull();
    act(() => vi.advanceTimersByTime(5000)); // ordinary → ordinary: a hand-off
    expect(container.querySelector('.slide-stinger')).toBeNull();
    act(() => vi.advanceTimersByTime(5000)); // → the held slide: the wipe
    expect(container.querySelectorAll('.slide-stinger')).toHaveLength(1);
  });
});

// Rebrand stage 4b: the lobby is one persistent studio and only the copy
// changes. These pin the contract the hand-off is built on.
describe('ManualSlideshow on the lobby scene (rebrand stage 4b)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const sky = [
    { id: 's_1', eyebrow: 'This week', text: 'Bring your handbook', theme: 'sky', durationSec: 0 },
    { id: 's_2', eyebrow: 'Next club night', text: 'Making bookmarks', theme: 'sky', durationSec: 0 },
  ];
  const held = { id: 's_h', eyebrow: 'Important', text: 'Pick-up is at the gym doors', theme: 'sky', durationSec: 5, holdCheckIns: true };
  const promo = { id: 'season_promo', type: 'promo', durationSec: 8, promos: [{ id: 'promo_contest', kind: 'contest', eventDate: '2026-10-14', tonight: false, countdown: '3 club nights left', afterContest: false }] };

  it('says when the slide up is the promo poster, which the band notice steps aside for', () => {
    const onSlide = vi.fn();
    render(<ManualSlideshow slides={[sky[0], promo]} slideshowDelaySec={5} onSlide={onSlide} />);
    expect(onSlide).toHaveBeenLastCalledWith({ key: '0:s_1', special: false, poster: false });
    act(() => vi.advanceTimersByTime(5000));
    expect(onSlide).toHaveBeenLastCalledWith({ key: '1:season_promo', special: true, poster: true });
  });

  it('keeps the studio across an ordinary change: same scene, same field, same corner tab', () => {
    const { container } = render(<ManualSlideshow slides={sky} slideshowDelaySec={5} />);
    const scene = container.querySelector('.catalog-scene');
    const field = container.querySelector('.lobby-field');
    const tab = container.querySelector('.lobby-tab');
    act(() => vi.advanceTimersByTime(5000));
    expect(container.querySelector('.catalog-scene')).toBe(scene);
    expect(container.querySelector('.lobby-field')).toBe(field);
    expect(container.querySelector('.lobby-tab')).toBe(tab);
    expect(shows('Making bookmarks')).toBe(true);
  });

  it('the incoming words wait, invisible, while the outgoing ones lift away', () => {
    const { container } = render(<ManualSlideshow slides={sky} slideshowDelaySec={5} />);
    act(() => vi.advanceTimersByTime(5000));
    const all = [...container.querySelectorAll('.lobby-copy')];
    // The outgoing copy is still on screen, leaving (AnimatePresence keeps it
    // until its exit ends); the wiring of both halves is pinned in
    // lobbyWiring.test.jsx.
    expect(all).toHaveLength(2);
    expect(all.some((c) => c.textContent.includes('Bring your handbook'))).toBe(true);
    const incoming = all.find((c) => c.textContent.includes('Making'));
    for (const w of incoming.querySelectorAll('.lobby-word, .lobby-kicker')) expect(w.style.opacity).toBe('0');
  });

  it('swells the house wave once per hand-off, and never under the stinger', () => {
    const { container } = render(<ManualSlideshow slides={[sky[0], sky[1], held]} slideshowDelaySec={5} />);
    const first = container.querySelector('.lobby-wave--house');
    act(() => vi.advanceTimersByTime(5000)); // ordinary → ordinary
    const swelled = container.querySelector('.lobby-wave--house');
    expect(swelled).not.toBe(first);
    act(() => vi.advanceTimersByTime(5000)); // → the held slide: a wipe
    expect(container.querySelector('.lobby-wave--house')).toBe(swelled);
    expect(container.querySelectorAll('.slide-stinger')).toHaveLength(1);
  });

  it('crossfades the field when the next slide wants another theme', () => {
    const { container } = render(<ManualSlideshow slides={[sky[0], { ...sky[1], theme: 'night' }]} slideshowDelaySec={5} />);
    expect(container.querySelector('.lobby-field--night')).toBeNull();
    act(() => vi.advanceTimersByTime(5000));
    expect(container.querySelector('.lobby-field--night')).not.toBeNull();
    expect(container.querySelector('.catalog-scene--night')).not.toBeNull();
  });

  it('keeps the orange tab and house waves at home under the flagship, and sends them aside for a poster', () => {
    const flagship = { id: 'flagship_welcome', type: 'flagship', durationSec: 5 };
    const { container } = render(<ManualSlideshow slides={[flagship, sky[0], promo]} slideshowDelaySec={5} />);
    const chrome = () => container.querySelector('.lobby-chrome');
    expect(container.querySelector('.flagship')).not.toBeNull();
    expect(chrome().className).toContain('lobby-chrome--home');
    expect(chrome().className).not.toContain('lobby-chrome--away');
    act(() => vi.advanceTimersByTime(5000)); // → an ordinary slide
    expect(chrome().className).toContain('lobby-chrome--home');
    act(() => vi.advanceTimersByTime(5000)); // → the poster
    expect(chrome().className).toContain('lobby-chrome--away');
  });

  it('steps the tab\'s small logo aside while the flagship\'s big one is up, and brings it back after', () => {
    // One logo on screen at a time (owner 2026-10-13: the same mark twice
    // reads as a doubling); the tab itself stays home.
    const flagship = { id: 'flagship_welcome', type: 'flagship', durationSec: 5 };
    const { container } = render(<ManualSlideshow slides={[flagship, sky[0]]} slideshowDelaySec={5} />);
    const chrome = () => container.querySelector('.lobby-chrome');
    expect(chrome().className).toContain('lobby-chrome--logo-away');
    expect(chrome().className).toContain('lobby-chrome--home');
    act(() => vi.advanceTimersByTime(5000));
    expect(chrome().className).not.toContain('lobby-chrome--logo-away');
    const appCss = readFileSync(resolve(__dirname, '../styles/app.css'), 'utf8');
    expect(appCss).toMatch(/\.lobby-chrome--logo-away \.lobby-tab__logo \{\s*opacity: 0;\s*\}/);
  });

  // Where the chrome goes for a poster and for a video, and when, is pinned
  // at the wiring (lobbyWiring.test.jsx) and in the styles it ends at
  // (CatalogScene.test.jsx).

  it('under zero animation a change is a cut: one copy on screen, never two', () => {
    const { container } = render(
      <ZeroAnimationContext.Provider value>
        <ManualSlideshow slides={sky} slideshowDelaySec={5} />
      </ZeroAnimationContext.Provider>,
    );
    act(() => vi.advanceTimersByTime(5000));
    expect(container.querySelectorAll('.lobby-copy')).toHaveLength(1);
    expect(headlines()).toEqual(['Making bookmarks']);
  });
});

describe('ManualSlideshow: the slide report reaches App before the frame is painted', () => {
  // App turns what stands over the lobby (the first-run card) off from this
  // report, so a passive effect left a frame or more with the card drawn over
  // a poster that zero animation had already put on screen. A layout effect
  // runs inside the commit that mounts the slide; a passive one only after
  // every layout effect of that commit, the parent's included. So a parent's
  // own layout effect sees whether the report has been made yet.
  it('has told App a held slide is up by the time the parent\'s layout effects run', () => {
    const onSlide = vi.fn();
    let toldAtParentLayout = null;
    function Parent({ slides }) {
      useLayoutEffect(() => { toldAtParentLayout = onSlide.mock.calls.map(([info]) => info); }, []);
      return <ManualSlideshow slides={slides} slideshowDelaySec={5} onSlide={onSlide} />;
    }
    const held = { id: 's_h', eyebrow: '', text: 'Held', theme: 'sky', durationSec: 0, holdCheckIns: true };
    render(<Parent slides={[held, deck[0]]} />);
    expect(toldAtParentLayout).toEqual([expect.objectContaining({ special: true })]);
  });
});

// The snow-alerts slide airs one lap in six (src/lib/snowAlerts.js), so its
// slot carries null entries for the laps it sits out, and the slideshow must
// step straight past the slot on those laps rather than show a blank frame.
describe('ManualSlideshow: a promo slot that sits out a lap', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const snow = { id: 'promo_snow_alerts', kind: 'snowAlerts', eventDate: '', tonight: false, countdown: null, afterContest: true, durationSec: 20, snow: null };
  const slot = { id: 'season_promo', type: 'promo', durationSec: 15, promos: [snow, null, null] };
  const two = [deck[0], deck[1], slot];
  // Zero animation: exits are instant, so the DOM holds only what is on
  // screen (fake timers cannot run framer-motion's exit animations).
  const still = (ui) => render(<ZeroAnimationContext.Provider value>{ui}</ZeroAnimationContext.Provider>);

  it('shows the snow slide on its lap and skips the slot on the laps it sits out', () => {
    const { container } = still(<ManualSlideshow slides={two} slideshowDelaySec={5} />);
    expect(shows('First slide')).toBe(true);
    act(() => vi.advanceTimersByTime(5000)); // → Second slide (4 s)
    act(() => vi.advanceTimersByTime(4000)); // → the slot, lap 0: snow
    expect(container.querySelector('.promo-slide--snow')).not.toBeNull();
    act(() => vi.advanceTimersByTime(19999));
    expect(container.querySelector('.promo-slide--snow')).not.toBeNull();
    act(() => vi.advanceTimersByTime(1)); // its own 20 s → lap 1
    expect(shows('First slide')).toBe(true);
    act(() => vi.advanceTimersByTime(5000));
    expect(shows('Second slide')).toBe(true);
    // Lap 1's slot entry is null: straight on to lap 2's first slide, at
    // once, not after the slot's 15 s hold.
    act(() => vi.advanceTimersByTime(4000));
    expect(shows('First slide')).toBe(true);
    expect(shows('Second slide')).toBe(false);
  });

  it('never strands a lone slot on an empty lap', () => {
    const { container } = still(<ManualSlideshow slides={[slot]} slideshowDelaySec={5} />);
    expect(container.querySelector('.promo-slide--snow')).not.toBeNull();
  });

  it('moves on before painting when it lands on an empty lap without advancing into it', () => {
    // A deck whose first position is a slot sitting out lap 0.
    const sitsOut = { ...slot, promos: [null, snow] };
    const { container } = still(<ManualSlideshow slides={[sitsOut, deck[0]]} slideshowDelaySec={5} />);
    expect(container.querySelector('.promo-slide')).toBeNull();
    expect(shows('First slide')).toBe(true);
  });

  it('counts the next step past every empty lap, and always moves', () => {
    expect(nextStep(1, two)).toBe(2); // the slot, lap 0: snow
    expect(nextStep(4, two)).toBe(6); // the slot, lap 1: null, skipped
    expect(nextStep(7, two)).toBe(9); // lap 2: null too, skipped
    expect(nextStep(10, two)).toBe(11); // lap 3: snow again (3 % 3 === 0)
    expect(nextStep(0, [deck[0]])).toBe(1);
    // Past the empty slot to the next lap's first slide.
    expect(nextStep(0, [deck[0], { ...slot, promos: [null] }])).toBe(2);
  });
});

// The flagship's 3D intro (FlagshipIntro.jsx): which pass plays it, on which
// screens, and that the intro (not the slideshow's timer) ends that showing.
describe('ManualSlideshow: the flagship\'s 3D intro', () => {
  const flagship = { id: 'flagship_welcome', type: 'flagship', durationSec: 10 };
  const next = { id: 's_n', eyebrow: '', text: 'Next up', theme: 'sky', durationSec: 5 };
  const media = { currentTime: 0, ended: false, readyState: 4, paused: true };
  const props = ['currentTime', 'ended', 'readyState', 'paused'];
  let size;

  beforeEach(() => {
    vi.useFakeTimers();
    size = { w: window.innerWidth, h: window.innerHeight };
    Object.assign(media, { currentTime: 0, ended: false, readyState: 4, paused: true });
    const proto = window.HTMLMediaElement.prototype;
    for (const p of props) Object.defineProperty(proto, p, { configurable: true, get: () => media[p], set: (v) => { media[p] = v; } });
    proto.canPlayType = vi.fn(() => 'probably');
    proto.play = vi.fn(() => { media.paused = false; return Promise.resolve(); });
    proto.pause = vi.fn(() => { media.paused = true; });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    const proto = window.HTMLMediaElement.prototype;
    for (const p of props) delete proto[p];
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: size.w });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: size.h });
  });
  const screenOf = (w, h) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
  };
  const at = (ms) => act(() => vi.advanceTimersByTime(ms));
  const intro = () => document.querySelector('video.flagship-intro');
  const chrome = () => document.querySelector('.lobby-chrome');

  it('plays on the second pass on a 16:9 screen, owns that showing\'s end, and hands the tab and waves over', () => {
    screenOf(1920, 1080);
    const keys = [];
    const onSlide = ({ key }) => { if (keys.at(-1) !== key) keys.push(key); };
    render(<ManualSlideshow slides={[flagship, next]} slideshowDelaySec={5} onSlide={onSlide} />);
    expect(intro()).toBeNull(); // the first pass: the plain flagship
    at(10_000);
    expect(keys.at(-1)).toBe('1:s_n');
    at(5_000); // the second pass
    expect(keys.at(-1)).toBe('2:flagship_welcome');
    expect(intro()).not.toBeNull();
    // (A showing that left may still be fading out beside it: ask the one playing.)
    expect(intro().closest('.flagship').dataset.style).toBe('bounce');
    expect(intro().closest('.flagship').dataset.version).toBe('glad');
    // No 10 s timer: the showing outlives it while the video plays.
    at(4_100);
    media.currentTime = 0.1;
    at(400);
    expect(chrome().className).toContain('lobby-chrome--handed-over');
    for (let k = 0; k < 60; k += 1) { // six seconds of video playing
      media.currentTime += 0.1;
      at(100);
    }
    // 10.5 s in: a plain showing would have gone; this one is still up.
    expect(keys.at(-1)).toBe('2:flagship_welcome');
    media.currentTime = 14.5;
    at(100);
    expect(chrome().className).not.toContain('lobby-chrome--handed-over');
    media.ended = true;
    at(100);
    expect(keys.at(-1)).toBe('2:flagship_welcome');
    at(1_000); // the tail, then the deck moves on
    expect(keys.at(-1)).toBe('3:s_n');
    expect(chrome().className).not.toContain('lobby-chrome--handed-over');
  });

  it('keeps the plain flagship on a screen the video is not (4:3), and under zero animation', () => {
    screenOf(1024, 768);
    render(<ManualSlideshow slides={[flagship, next]} slideshowDelaySec={5} />);
    at(10_000);
    at(5_000);
    expect(document.querySelector('.flagship')).not.toBeNull();
    expect(intro()).toBeNull();
    cleanup();
    screenOf(1920, 1080);
    render(
      <ZeroAnimationContext.Provider value>
        <ManualSlideshow slides={[flagship, next]} slideshowDelaySec={5} />
      </ZeroAnimationContext.Provider>,
    );
    at(10_000);
    at(5_000);
    expect(document.querySelector('.flagship')).not.toBeNull();
    expect(intro()).toBeNull();
  });

  it('a flagship alone never plays it (there is no next pass)', () => {
    screenOf(1920, 1080);
    render(<ManualSlideshow slides={[flagship]} slideshowDelaySec={5} />);
    at(60_000);
    expect(intro()).toBeNull();
  });
});

// A promo that ENDS on the lobby itself (src/lib/promos.js `exit: 'seamless'`):
// the Grand Prix video, whose last second is the lobby's sky screen at rest.
// It comes in under the stinger; the field behind it is the sky; once it plays,
// the scene's ambient loops (hidden under it) come to rest; inside its still
// end card the tab and waves come home over it; it ends its own showing, and
// the deck moves on with an ordinary change, no stinger.
describe('ManualSlideshow: a promo that ends on the lobby (the Grand Prix video)', () => {
  const gp = previewPromo('grandPrix', null, '2027-01-05');
  const slot = { id: 'season_promo', type: 'promo', durationSec: 15, promos: [gp] };
  const before = { id: 's_a', eyebrow: '', text: 'Before', theme: 'night', durationSec: 5 };
  const after = { id: 's_b', eyebrow: '', text: 'After', theme: 'sky', durationSec: 5 };
  const media = { currentTime: 0, ended: false, paused: true, duration: 30 };
  const props = ['currentTime', 'ended', 'paused', 'duration'];
  // The scene's CSS loops, as the Web Animations API would show them.
  let loops;
  const loopOf = (el) => {
    if (!loops.has(el)) {
      const anim = {
        animationName: el.classList.contains('lobby-ambient--roll') ? 'lobby-roll' : 'lobby-loop', playState: 'running', playbackRate: 1, currentTime: 900,
        effect: { getComputedTiming: () => ({ duration: 3000, progress: 0.3 }), getTiming: () => ({ delay: 0 }) },
        pause: vi.fn(() => { anim.playState = 'paused'; }),
        play: vi.fn(() => { anim.playState = 'running'; }),
      };
      loops.set(el, anim);
    }
    return loops.get(el);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(media, { currentTime: 0, ended: false, paused: true, duration: 30 });
    const proto = window.HTMLMediaElement.prototype;
    for (const p of props) Object.defineProperty(proto, p, { configurable: true, get: () => media[p], set: (v) => { media[p] = v; } });
    proto.canPlayType = vi.fn(() => 'probably');
    proto.play = vi.fn(() => { media.paused = false; return Promise.resolve(); });
    proto.pause = vi.fn(() => { media.paused = true; });
    loops = new Map();
    window.Element.prototype.getAnimations = function getAnimations() {
      return this.classList.contains('lobby-ambient') ? [loopOf(this)] : [];
    };
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    const proto = window.HTMLMediaElement.prototype;
    for (const p of props) delete proto[p];
    delete window.Element.prototype.getAnimations;
  });
  const at = (ms) => act(() => vi.advanceTimersByTime(ms));
  const playTo = (to) => {
    while (media.currentTime < to - 1e-9) {
      media.currentTime = Math.min(to, +(media.currentTime + 0.1).toFixed(3));
      at(100);
    }
  };
  const chrome = () => document.querySelector('.lobby-chrome').className;
  const stingers = () => document.querySelectorAll('.slide-stinger').length;
  const ambient = () => [...document.querySelectorAll('.lobby-field:not(.is-leaving) .lobby-ambient, .lobby-wave--sun')];

  it('wipes in on the sky, rests the scene, brings the chrome home under its end, and leaves with no stinger', () => {
    const keys = [];
    render(<ManualSlideshow slides={[before, slot, after]} slideshowDelaySec={5} onSlide={({ key }) => keys.push(key)} />);
    expect(document.querySelector('.catalog-scene--night')).not.toBeNull();
    at(5000); // → the promo, under the stinger
    expect(keys.at(-1)).toBe('1:season_promo');
    expect(stingers()).toBe(1);
    const wave = document.querySelector('.slide-stinger');
    // The field behind it is the one its last frame is drawn on.
    expect(document.querySelector('.catalog-scene--sky')).not.toBeNull();
    expect(chrome()).toContain('lobby-chrome--away');
    expect(document.querySelector('video.grand-prix-promo__video')).not.toBeNull();
    // It starts as the wave covers the screen.
    at(500);
    expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    at(200);
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    media.currentTime = 0.05;
    at(100);
    // Playing: the field's loops and the sunflower wave's roll come to rest.
    expect(ambient().length).toBeGreaterThan(6);
    for (const el of ambient()) expect(loops.get(el)?.playbackRate, el.className).toBeLessThan(0);
    playTo(GRAND_PRIX.homeAt - 0.2);
    expect(chrome()).toContain('lobby-chrome--away');
    playTo(GRAND_PRIX.homeAt + 0.1);
    // The tab and waves are home, over the identical picture.
    expect(chrome()).toContain('lobby-chrome--home');
    expect(chrome()).not.toContain('lobby-chrome--away');
    // The video owns the end: past its 30 s hold the showing is still up.
    playTo(29.9);
    at(1500);
    expect(keys.at(-1)).toBe('1:season_promo');
    media.ended = true;
    at(100);
    // ...and it leaves like an ordinary slide: no second stinger (the one
    // that brought it in is not swept again), chrome home.
    expect(keys.at(-1)).toBe('2:s_b');
    expect(stingers()).toBe(1);
    expect(document.querySelector('.slide-stinger')).toBe(wave);
    expect(chrome()).toContain('lobby-chrome--home');
    expect(document.querySelector('.catalog-scene--sky')).not.toBeNull();
    expect(shows('After')).toBe(true);
    // The loops are let go, from where they rest.
    for (const el of ambient()) expect(loops.get(el).playbackRate).toBe(1);
  });

  it('a video that never ends cannot hold the deck: its hold plus the grace is the cap', () => {
    const keys = [];
    render(<ManualSlideshow slides={[before, slot, after]} slideshowDelaySec={5} onSlide={({ key }) => keys.push(key)} />);
    at(5000);
    at(700);
    media.currentTime = 1;
    at(100);
    at((gp.durationSec + SEAMLESS_GRACE_SEC) * 1000 - 900);
    expect(keys.at(-1)).toBe('1:season_promo');
    at(200);
    expect(keys.at(-1)).toBe('2:s_b');
  });

  it('under zero animation it is the red end card for its own hold, the chrome away over it, then the ordinary change', () => {
    const keys = [];
    render(
      <ZeroAnimationContext.Provider value>
        <ManualSlideshow slides={[before, slot, after]} slideshowDelaySec={5} onSlide={({ key }) => keys.push(key)} />
      </ZeroAnimationContext.Provider>,
    );
    at(5000);
    expect(document.querySelector('video')).toBeNull();
    expect(document.querySelector('img.grand-prix-promo__still')).not.toBeNull();
    // The still is the red end card, not the lobby: the tab and waves stay away.
    expect(chrome()).toContain('lobby-chrome--away');
    at(gp.durationSec * 1000 - 100);
    expect(keys.at(-1)).toBe('1:season_promo');
    at(200);
    expect(keys.at(-1)).toBe('2:s_b');
    // The next slide brings them home.
    expect(chrome()).not.toContain('lobby-chrome--away');
  });

  it('an ordinary poster still wipes out, and keeps the field it came in on', () => {
    const poster = { id: 'season_promo', type: 'promo', durationSec: 8, promos: [{ id: 'promo_contest', kind: 'contest', eventDate: '2026-10-14', tonight: false, countdown: '3 club nights left', afterContest: false }] };
    render(<ManualSlideshow slides={[before, poster, after]} slideshowDelaySec={5} />);
    at(5000);
    expect(document.querySelector('.catalog-scene--night')).not.toBeNull();
    const wave = document.querySelector('.slide-stinger');
    at(8000);
    // Keyed per wipe: leaving swept a new one.
    expect(document.querySelector('.slide-stinger')).not.toBe(wave);
  });
});
