import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import FlagshipIntro from './FlagshipIntro.jsx';
import FlagshipSlide, { beatSheet } from './FlagshipSlide.jsx';
import { FLAGSHIP_DURATION_SEC, FLAGSHIP_INTRO, FLAGSHIP_TURN_KEY } from '../lib/flagship.js';

// jsdom plays no media: the <video>'s state is this object, driven by hand.
let media;
const props = ['readyState', 'currentTime', 'paused', 'ended', 'duration'];

beforeEach(() => {
  vi.useFakeTimers();
  media = { readyState: 0, currentTime: 0, paused: true, ended: false, duration: 15, canPlay: 'probably' };
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
const video = () => document.querySelector('video.flagship-intro');
const shown = () => video()?.classList.contains('is-shown') ?? false;

function mount(extra = {}) {
  const calls = { hand: [], finished: 0 };
  const onHandOver = (s) => calls.hand.push(s);
  const onFinished = () => { calls.finished += 1; };
  const view = render(<FlagshipIntro onHandOver={onHandOver} onFinished={onFinished} {...extra} />);
  const away = () => calls.hand.at(-1)?.away ?? false;
  return { calls, away, rerender: (p) => view.rerender(<FlagshipIntro onHandOver={onHandOver} onFinished={onFinished} {...p} />) };
}

describe('the flagship\'s 3D intro', () => {
  it('starts only once the slide under it is at rest (the bounce + glad showing)', () => {
    const sheet = beatSheet('bounce', 'glad');
    expect(sheet.still).toBeLessThan(FLAGSHIP_INTRO.lead);
  });

  it('hands over seamlessly: video in on its first frame, then the scene\'s tab and waves out; back the same way', () => {
    const { calls, away } = mount();
    expect(video().getAttribute('src')).toBe('./intro/awana-intro.mp4');
    expect(video().muted).toBe(true);
    // Loading unseen; the rolling wave asked to come to rest.
    expect(shown()).toBe(false);
    expect(calls.hand.at(-1)).toEqual({ away: false, rest: true });
    media.readyState = 4;
    at(FLAGSHIP_INTRO.lead - 0.1);
    expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    at(0.15);
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    // Not shown until a frame has actually played.
    at(0.1);
    expect(shown()).toBe(false);
    media.currentTime = 0.05;
    at(0.05);
    expect(shown()).toBe(true);
    expect(away()).toBe(false); // the video fades in OVER the scene first...
    at(FLAGSHIP_INTRO.fade);
    expect(away()).toBe(true); // ...then the scene's tab and waves step aside
    // Its world flattens back: the tab and waves come home over it.
    media.currentTime = FLAGSHIP_INTRO.homeAt;
    at(0.05);
    expect(away()).toBe(false);
    expect(shown()).toBe(true);
    // It ends on the slide: fades out, the slide holds, the showing ends.
    media.ended = true;
    at(0.05);
    expect(shown()).toBe(false);
    expect(calls.finished).toBe(0);
    at(FLAGSHIP_INTRO.tail);
    expect(calls.finished).toBe(1);
    expect(calls.hand.at(-1)).toEqual({ away: false, rest: false });
    at(30);
    expect(calls.finished).toBe(1);
  });

  it('steps aside for names, pausing, and carries on from where it was after them', () => {
    const { away, rerender } = mount();
    media.readyState = 4;
    at(FLAGSHIP_INTRO.lead + 0.1);
    media.currentTime = 3;
    at(FLAGSHIP_INTRO.fade + 0.1);
    expect(away()).toBe(true);
    rerender({ paused: true });
    at(0.1);
    expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(shown()).toBe(false);
    expect(away()).toBe(false); // a calm field (and the scene's own tab and waves) for the name
    at(20); // a long run of names never lets it go
    expect(video()).not.toBeNull();
    rerender({ paused: false });
    at(0.1);
    expect(media.paused).toBe(false);
    expect(shown()).toBe(true);
    at(FLAGSHIP_INTRO.fade);
    expect(away()).toBe(true);
  });

  it('waits for names before it starts', () => {
    const { rerender } = mount({ paused: true });
    media.readyState = 4;
    at(FLAGSHIP_INTRO.lead + 3);
    expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    rerender({ paused: false });
    at(0.1);
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  });

  it('a video that never gets ready is let go; the showing ends like a plain one', () => {
    const { calls } = mount();
    const giveUp = FLAGSHIP_INTRO.lead + FLAGSHIP_INTRO.waitMax;
    // Never before a plain showing would have ended...
    at(Math.max(giveUp, FLAGSHIP_DURATION_SEC) - 0.1);
    expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(calls.finished).toBe(0);
    // ...and right after it is let go.
    at(FLAGSHIP_INTRO.fade + 0.3);
    expect(calls.finished).toBe(1);
    expect(video()).toBeNull();
  });

  it('a stall mid-play is let go: the slide and its tab and waves come back, and the deck moves on', () => {
    const { calls, away } = mount();
    media.readyState = 4;
    at(FLAGSHIP_INTRO.lead + 0.1);
    media.currentTime = 4;
    at(FLAGSHIP_INTRO.fade + 0.1);
    expect(away()).toBe(true);
    at(FLAGSHIP_INTRO.stall + 0.2); // the clock never moves again
    expect(shown()).toBe(false);
    expect(away()).toBe(false);
    at(1);
    expect(calls.finished).toBe(1);
  });

  it('a decode error is let go the same way', () => {
    const { calls } = mount();
    media.readyState = 4;
    at(FLAGSHIP_INTRO.lead + 0.1);
    act(() => { video().dispatchEvent(new Event('error')); });
    expect(shown()).toBe(false);
    at(FLAGSHIP_DURATION_SEC);
    expect(calls.finished).toBe(1);
  });

  it('a browser that cannot play it shows the plain slide for the usual hold', () => {
    media.canPlay = '';
    const { calls } = mount();
    expect(calls.hand).toEqual([]);
    at(FLAGSHIP_DURATION_SEC - 0.1);
    expect(calls.finished).toBe(0);
    at(0.2);
    expect(calls.finished).toBe(1);
  });

  it('the slide plays the bounce + glad showing under it, without taking this screen\'s turn', () => {
    localStorage.setItem(FLAGSHIP_TURN_KEY, '1'); // the next plain showing would be pop + welcome
    const { container } = render(<FlagshipSlide intro />);
    expect(container.querySelector('.flagship').dataset.style).toBe('bounce');
    expect(container.querySelector('.flagship').dataset.version).toBe('glad');
    expect(container.querySelector('video.flagship-intro')).not.toBeNull();
    // It draws the logo as the video does (the full one, 72u), even in a
    // phone's narrow 16:9 frame where a plain showing takes the two-line one.
    expect(container.querySelector('.flagship').classList.contains('flagship--intro')).toBe(true);
    const css = readFileSync(resolve(__dirname, '../styles/flagship.css'), 'utf8');
    expect(css).toMatch(/\.flagship--intro \.flagship-mark \{\s*--logo-w: calc\(72 \* var\(--u\)\);/);
    expect(css).toMatch(/\.flagship--intro \.flagship-logo--full \{\s*display: block;/);
    expect(css).toMatch(/\.flagship--intro \.flagship-logo--two-line \{\s*display: none;/);
    expect(localStorage.getItem(FLAGSHIP_TURN_KEY)).toBe('1');
    cleanup();
    const plain = render(<FlagshipSlide />);
    expect(plain.container.querySelector('video')).toBeNull();
    expect(plain.container.querySelector('.flagship').classList.contains('flagship--intro')).toBe(false);
    expect(plain.container.querySelector('.flagship').dataset.style).toBe('pop');
  });
});
