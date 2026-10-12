import { describe, it, expect } from 'vitest';
import { sanitizeOverrides } from './hooks/useConfig.js';
import config from './config.js';

// Pusher is retired (2026-10-11): a screen saved before that may still carry
// the old key and cluster in its overrides, and they are dropped on load.
describe('retired Pusher settings', () => {
  it('are no longer a config default', () => {
    expect('pusherAppKey' in config).toBe(false);
    expect('pusherCluster' in config).toBe(false);
  });

  it('a saved override that still carries them is dropped, the rest kept', () => {
    expect(sanitizeOverrides({ pusherAppKey: 'device-key', pusherCluster: 'ap1', showClock: true }))
      .toEqual({ showClock: true });
  });
});
