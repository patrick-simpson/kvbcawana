import { useLayoutEffect } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import ManualSlideshow, { MISSING_VIDEO_SKIP_MS } from './ManualSlideshow.jsx';
import { ZeroAnimationContext } from '../lib/motion.jsx';
import { getVideo } from '../lib/videoStore.js';

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
