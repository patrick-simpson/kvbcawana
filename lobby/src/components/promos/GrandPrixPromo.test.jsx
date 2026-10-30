import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import GrandPrixPromo, { DETAILS, GRAND_PRIX, GRAND_PRIX_SRC, GRAND_PRIX_STILL } from './GrandPrixPromo.jsx';
import PromoSlide, { detailsFor } from '../PromoSlide.jsx';
import { ZeroAnimationContext } from '../../lib/motion.jsx';
import { previewPromo } from '../../lib/promos.js';

// The Awana Grand Prix: a 33.68 s video that starts and ends on the lobby's own screen at
// rest. jsdom plays no media: the <video>'s state is this object, driven by hand.
let media;
const props = ['currentTime', 'paused', 'ended', 'duration', 'readyState'];

beforeEach(() => {
  vi.useFakeTimers();
  media = { currentTime: 0, paused: true, ended: false, duration: 2021 / 60, readyState: 4, canPlay: 'probably' };
  const proto = window.HTMLMediaElement.prototype;
  for (const p of props) {
    Object.defineProperty(proto, p, { configurable: true, get: () => media[p], set: (v) => { media[p] = v; } });
  }
  proto.canPlayType = vi.fn(() => media.canPlay);
  proto.play = vi.fn(() => { media.paused = false; return Promise.resolve(); });
  proto.pause = vi.fn(() => { media.paused = true; });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  const proto = window.HTMLMediaElement.prototype;
  for (const p of props) delete proto[p];
});

const at = (sec) => act(() => { vi.advanceTimersByTime(sec * 1000); });
const video = () => document.querySelector('video.grand-prix-promo__video');
const still = () => document.querySelector('img.grand-prix-promo__still');
const descriptor = () => previewPromo('grandPrix', null, '2027-01-05');

function mount(extra = {}, zero = false) {
  const calls = { scene: [], finished: 0 };
  const el = (
    <GrandPrixPromo
      onScene={(s) => calls.scene.push(s)}
      onFinished={() => { calls.finished += 1; }}
      {...extra}
    />
  );
  render(zero ? <ZeroAnimationContext.Provider value>{el}</ZeroAnimationContext.Provider> : el);
  return calls;
}

/** Plays the video's clock forward to `to` seconds, a tenth at a time. */
function playTo(to) {
  while (media.currentTime < to - 1e-9) {
    media.currentTime = Math.min(to, +(media.currentTime + 0.1).toFixed(3));
    at(0.1);
  }
}

describe('the Grand Prix promo (a video that ends on the lobby)', () => {
  it('plays the committed video, muted, inline, preloaded, from the page\'s own folder', () => {
    mount();
    expect(video().getAttribute('src')).toBe(GRAND_PRIX_SRC);
    expect(GRAND_PRIX_SRC).toBe('./promos/grand-prix.mp4');
    expect(video().muted).toBe(true);
    expect(video().hasAttribute('playsinline')).toBe(true);
    expect(video().getAttribute('preload')).toBe('auto');
    expect(still()).toBeNull();
    // The two files are committed beside the page.
    const pub = resolve(__dirname, '../../../public');
    expect(readFileSync(resolve(pub, 'promos/grand-prix.mp4')).length).toBeGreaterThan(1_000_000);
    expect(readFileSync(resolve(pub, 'promos/grand-prix-end.jpg')).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  });

  it('rests the scene once playing, brings the chrome home once the lobby plate is drawn, and ends its own showing', () => {
    const calls = mount();
    expect(calls.scene).toEqual([]);
    at(0.1);
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    media.currentTime = 0.05;
    at(0.1);
    // Playing: the scene behind it (hidden under it) comes to rest.
    expect(calls.scene.at(-1)).toEqual({ rest: true, home: false, shown: true });
    playTo(GRAND_PRIX.homeAt - 0.2);
    expect(calls.scene.at(-1)).toEqual({ rest: true, home: false, shown: true });
    playTo(GRAND_PRIX.homeAt + 0.1);
    // The closing plate is fully drawn from 32.75 s (the tear heals at
    // 32.3): only then does the chrome come home over it.
    expect(calls.scene.at(-1)).toEqual({ rest: true, home: true, shown: true });
    expect(GRAND_PRIX.homeAt).toBeGreaterThan(32.75);
    expect(GRAND_PRIX.homeAt).toBeLessThan(33);
    playTo(33.6);
    expect(calls.finished).toBe(0);
    media.ended = true;
    at(0.1);
    expect(calls.finished).toBe(1);
    at(5);
    expect(calls.finished).toBe(1);
  });

  it('waits out its lead (the stinger\'s swap) before it plays', () => {
    mount({ lead: 0.6 });
    expect(video().autoplay).toBe(false);
    at(0.5);
    expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    at(0.2);
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  });

  it('under zero animation shows the red end card at rest, no video, the chrome kept away (it is not the lobby)', () => {
    const calls = mount({}, true);
    expect(video()).toBeNull();
    expect(still().getAttribute('src')).toBe(GRAND_PRIX_STILL);
    expect(GRAND_PRIX_STILL).toBe('./promos/grand-prix-end.jpg');
    expect(calls.scene).toEqual([{ rest: true, home: false, shown: true }]);
    at(60);
    expect(calls.finished).toBe(0); // the slideshow's own hold ends it
  });

  it('`still` (the Settings preview of a deck) is the end card too', () => {
    mount({ still: true });
    expect(video()).toBeNull();
    expect(still()).not.toBeNull();
  });

  it('falls back to the end card on an error, and never wedges the deck', () => {
    const calls = mount();
    at(0.1);
    media.currentTime = 0.05;
    at(0.1);
    act(() => { video().dispatchEvent(new Event('error')); });
    expect(video()).toBeNull();
    expect(still()).not.toBeNull();
    expect(calls.scene.at(-1)).toEqual({ rest: true, home: false, shown: true });
    expect(calls.finished).toBe(0);
  });

  it('falls back to the end card when it cannot play here, never starts, or stalls', () => {
    media.canPlay = '';
    mount();
    expect(still()).not.toBeNull();
    cleanup();

    media.canPlay = 'probably';
    window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve()); // its clock never moves
    mount();
    at(GRAND_PRIX.waitMax + 0.5);
    expect(still()).not.toBeNull();
    cleanup();

    window.HTMLMediaElement.prototype.play = vi.fn(() => { media.paused = false; return Promise.resolve(); });
    media.currentTime = 0;
    mount();
    at(0.1);
    media.currentTime = 3;
    at(0.1);
    expect(video()).not.toBeNull();
    at(GRAND_PRIX.stall + 0.5); // a stalled download: its clock stands still
    expect(still()).not.toBeNull();
  });

  // Coming in over the lobby itself (`enter: 'seamless'`): its first second is
  // the lobby plate, so it waits, paused and unseen, for the scene to be that
  // plate at rest, then fades in, takes the tab and waves over, and plays.
  describe('coming in over the lobby (`enter`)', () => {
    const shownNow = () => video()?.classList.contains('is-shown') ?? false;

    it('waits unseen for the scene to rest, fades in, hands the chrome over, then plays inside its opening plate', () => {
      let ready = false;
      const calls = mount({ enter: true, sceneReady: () => ready });
      // The scene starts coming to rest at once; the video is not seen.
      expect(calls.scene).toEqual([{ rest: true, home: false, shown: false }]);
      expect(video().autoplay).toBe(false);
      expect(document.querySelector('.grand-prix-promo--enter')).not.toBeNull();
      at(2);
      expect(shownNow()).toBe(false);
      expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
      ready = true;
      at(0.05);
      // Over the identical picture: shown, still paused on its first frame, the chrome still home.
      expect(shownNow()).toBe(true);
      expect(calls.scene.at(-1)).toEqual({ rest: true, home: false, shown: false });
      expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
      at(GRAND_PRIX.fade);
      // Fully in: the scene's tab and waves step away under it.
      expect(calls.scene.at(-1)).toEqual({ rest: true, home: false, shown: true });
      expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
      at(GRAND_PRIX.fade);
      expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
      // All of it well inside the opening plate, before the tear.
      expect(GRAND_PRIX.fade * 2 + 0.1).toBeLessThan(GRAND_PRIX.openPlate);
      media.currentTime = 0.05;
      at(0.1);
      playTo(GRAND_PRIX.homeAt + 0.1);
      expect(calls.scene.at(-1)).toEqual({ rest: true, home: true, shown: true });
      media.ended = true;
      at(0.1);
      expect(calls.finished).toBe(1);
    });

    it('waits for the video to be able to play, too', () => {
      media.readyState = 1;
      mount({ enter: true, sceneReady: () => true });
      at(1);
      expect(shownNow()).toBe(false);
      media.readyState = 4;
      at(0.1);
      expect(shownNow()).toBe(true);
    });

    it('not ready by waitMax: the lobby kept its own plate until then, and the end card comes up over it', () => {
      const calls = mount({ enter: true, sceneReady: () => false });
      at(GRAND_PRIX.waitMax - 0.2);
      expect(still()).toBeNull();
      expect(calls.scene).toEqual([{ rest: true, home: false, shown: false }]);
      at(0.4);
      expect(video()).toBeNull();
      expect(still().classList.contains('grand-prix-promo__still--fade')).toBe(true);
      expect(calls.scene.at(-1)).toEqual({ rest: true, home: false, shown: true });
      expect(calls.finished).toBe(0);
    });

    it('an error once it was seen is a cut to the end card, as before', () => {
      mount({ enter: true, sceneReady: () => true });
      at(0.5);
      media.currentTime = 0.2;
      at(0.1);
      act(() => { video().dispatchEvent(new Event('error')); });
      expect(still().classList.contains('grand-prix-promo__still--fade')).toBe(false);
    });

    it('under zero animation `enter` changes nothing: the end card, the chrome away', () => {
      const calls = mount({ enter: true, sceneReady: () => true }, true);
      expect(video()).toBeNull();
      expect(still().classList.contains('grand-prix-promo__still--fade')).toBe(false);
      expect(calls.scene).toEqual([{ rest: true, home: false, shown: true }]);
    });
  });

  it('says the end card\'s facts, no em dashes, and PromoSlide plays it for its kind', () => {
    expect(DETAILS.default.join(' ')).not.toContain('—');
    expect(DETAILS.default).toContain('Race day: Saturday, March 20 · 2:00 pm');
    expect(detailsFor(descriptor())).toBe(DETAILS.default);
    render(
      <ZeroAnimationContext.Provider value>
        <PromoSlide promo={descriptor()} />
      </ZeroAnimationContext.Provider>,
    );
    const root = document.querySelector('.promo-slide--grand-prix');
    expect(root.getAttribute('role')).toBe('img');
    expect(root.getAttribute('aria-label')).toMatch(/Awana Grand Prix.*Register by Sunday, Feb 28.*March 6.*March 20/);
    expect(still()).not.toBeNull();
  });
});
