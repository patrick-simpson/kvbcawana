import { afterEach, describe, expect, it, vi } from 'vitest';
import { isConfigureMode, isSettingsPage, listenForRelay, relayToScreen } from './configureRelay.js';

const settle = () => new Promise((r) => setTimeout(r, 30));

describe('configure relay', () => {
  let stop = () => {};
  afterEach(() => stop());

  it('reads ?configure=1 and nothing else', () => {
    expect(isConfigureMode('?configure=1')).toBe(true);
    expect(isConfigureMode('?lowPower=1&configure=1')).toBe(true);
    expect(isConfigureMode('?configure=true')).toBe(false);
    expect(isConfigureMode('')).toBe(false);
  });

  it('the settings page (settings.html, its awana-page meta) is configure mode with no query', () => {
    expect(isSettingsPage()).toBe(false);
    const meta = document.createElement('meta');
    meta.name = 'awana-page';
    meta.content = 'settings';
    document.head.append(meta);
    try {
      expect(isSettingsPage()).toBe(true);
      expect(isConfigureMode('')).toBe(true);
    } finally {
      meta.remove();
    }
    meta.content = 'lobby';
    expect(isSettingsPage(new DOMParser().parseFromString('<meta name="awana-page" content="lobby">', 'text/html'))).toBe(false);
  });

  it('delivers an allowed action for this screen', async () => {
    const seen = vi.fn();
    stop = listenForRelay('lobby', ['preview-checkin'], seen);
    relayToScreen('lobby', 'preview-checkin', { firstName: 'Ava', club: 'Sparks' });
    await settle();
    expect(seen).toHaveBeenCalledWith('preview-checkin', { firstName: 'Ava', club: 'Sparks' });
  });

  it("drops another screen's actions and anything not allowed", async () => {
    const seen = vi.fn();
    stop = listenForRelay('lobby', ['preview-checkin'], seen);
    relayToScreen('projector', 'preview-checkin');
    relayToScreen('lobby', 'reset-everything');
    const ch = new BroadcastChannel('awana-configure');
    ch.postMessage('preview-checkin');
    ch.postMessage(null);
    ch.close();
    await settle();
    expect(seen).not.toHaveBeenCalled();
  });
});
