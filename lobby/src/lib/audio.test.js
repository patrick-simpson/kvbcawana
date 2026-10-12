import { afterEach, describe, expect, it, vi } from 'vitest';

function fakeContext(state) {
  return class {
    constructor() {
      this.state = state;
      this.currentTime = 0;
      this.destination = {};
      this.resume = vi.fn(() => Promise.resolve());
      this.createOscillator = vi.fn(() => ({ frequency: {}, connect() {}, start() {}, stop() {} }));
      this.createGain = vi.fn(() => ({
        gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {},
      }));
      fakeContext.last = this;
    }
  };
}

afterEach(() => {
  delete window.AudioContext;
  vi.resetModules();
});

describe('chimes', () => {
  it('play when the audio clock is running', async () => {
    window.AudioContext = fakeContext('running');
    const { playChime } = await import('./audio.js');
    playChime();
    expect(fakeContext.last.createOscillator).toHaveBeenCalledTimes(3);
  });

  it('are skipped, not queued, while the context is suspended', async () => {
    window.AudioContext = fakeContext('suspended');
    const { playChime, playBirthdayChime } = await import('./audio.js');
    playChime();
    playBirthdayChime();
    expect(fakeContext.last.createOscillator).not.toHaveBeenCalled();
    expect(fakeContext.last.resume).toHaveBeenCalled();
  });
});
