import { describe, it, expect, afterEach, vi } from 'vitest';
import { sanitizeOverrides } from './hooks/useConfig.js';

// The Pusher subscribe key can be baked into the build from repository
// variables (deploy.yml → VITE_PUSHER_*). Blank when unset, so a fork that has
// not set them starts exactly where it always did; per-device overrides still
// win, so a screen can point elsewhere without a redeploy.

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('baked Pusher defaults', () => {
  it('reads VITE_PUSHER_APP_KEY / VITE_PUSHER_CLUSTER when set', async () => {
    vi.stubEnv('VITE_PUSHER_APP_KEY', 'baked-key');
    vi.stubEnv('VITE_PUSHER_CLUSTER', 'eu');
    vi.resetModules();
    const { default: config } = await import('./config.js');
    expect(config.pusherAppKey).toBe('baked-key');
    expect(config.pusherCluster).toBe('eu');
  });

  it('is blank / us2 when the variables are unset', async () => {
    vi.stubEnv('VITE_PUSHER_APP_KEY', '');
    vi.stubEnv('VITE_PUSHER_CLUSTER', '');
    vi.resetModules();
    const { default: config } = await import('./config.js');
    expect(config.pusherAppKey).toBe('');
    expect(config.pusherCluster).toBe('us2');
  });

  it('a per-device override still passes the validator (device beats baked)', () => {
    expect(sanitizeOverrides({ pusherAppKey: 'device-key', pusherCluster: 'ap1' }))
      .toEqual({ pusherAppKey: 'device-key', pusherCluster: 'ap1' });
  });
});
