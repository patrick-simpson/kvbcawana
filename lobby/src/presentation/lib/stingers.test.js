import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The countdown chimes on a phone: WebKit (and Chrome on Android) plays a
// page's audio only when its AudioContext was made or resumed inside a tap,
// and the chimes play from a clock tick. unlockStingers() is called from taps
// on a touch page (App.jsx, the touch menu's switch).

/** A stand-in AudioContext that records what was done to it. */
function fakeAudio() {
  const made = [];
  class FakeContext {
    constructor() {
      this.state = 'suspended';
      this.destination = {};
      this.currentTime = 0;
      this.started = 0;
      this.resumed = 0;
      made.push(this);
    }
    resume() { this.resumed += 1; this.state = 'running'; return Promise.resolve(); }
    createBuffer() { return {}; }
    createBufferSource() {
      return { connect: () => {}, start: () => { this.started += 1; } };
    }
  }
  return { made, FakeContext };
}

let audio;
beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  audio = fakeAudio();
  window.AudioContext = audio.FakeContext;
});
afterEach(() => {
  delete window.AudioContext;
});

describe('unlockStingers', () => {
  it('makes no audio at all while the chimes are off', async () => {
    const { unlockStingers } = await import('./stingers.js');
    unlockStingers();
    expect(audio.made).toHaveLength(0);
  });

  it('wakes the chimes\' context inside the tap once they are on, and primes it with a silent sample', async () => {
    const { setStingersEnabled, unlockStingers } = await import('./stingers.js');
    setStingersEnabled(true);
    unlockStingers();
    expect(audio.made).toHaveLength(1);
    expect(audio.made[0].resumed).toBe(1);
    expect(audio.made[0].started).toBe(1);
    // One context for the page, however many taps.
    unlockStingers();
    expect(audio.made).toHaveLength(1);
  });

  it('never throws where there is no Web Audio', async () => {
    delete window.AudioContext;
    const { setStingersEnabled, unlockStingers } = await import('./stingers.js');
    setStingersEnabled(true);
    expect(() => unlockStingers()).not.toThrow();
  });
});
