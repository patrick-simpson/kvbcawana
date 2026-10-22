import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScreensSection, easternStamp, isPenLine, logLineWords, seenWords } from './screens.jsx';
import { PanelCard, RemoteScreenContext, FollowingContext, SettingsPageContext } from './fields.jsx';
import { _resetSyncForTest } from '../../hooks/useSync.js';

// The settings page's Screens: the words, the signed-out state, and which
// cards a screen opened from the page shows (e2e/settings-screens.spec.js
// drives the whole flow against a stand-in Worker).

beforeEach(() => { localStorage.clear(); _resetSyncForTest(); });
afterEach(cleanup);

describe('seenWords', () => {
  const now = Date.parse('2026-10-11T22:00:00Z');
  it('says how long ago in plain words', () => {
    expect(seenWords('2026-10-11T21:59:40Z', now)).toBe('just now');
    expect(seenWords('2026-10-11T21:56:00Z', now)).toBe('4 min ago');
    expect(seenWords('nope', now)).toBe('never');
    expect(seenWords('2026-10-07T23:00:00Z', now)).toMatch(/\d/);
  });
});

describe("a computer's display log lines", () => {
  it('splits the stamp off and says it in Eastern Time', () => {
    expect(logLineWords('2026-10-22T22:42:10.123Z pen watch: SMART Ink {}')).toEqual({ time: 'Thu 6:42:10 PM', text: 'pen watch: SMART Ink {}' });
    expect(logLineWords('    at Object.<anonymous> (x.js:1)')).toEqual({ time: '', text: '    at Object.<anonymous> (x.js:1)' });
    expect(easternStamp(Date.parse('2026-12-02T23:00:00Z'))).toBe('Wed 6:00:00 PM');
  });
  it('knows the pen and SMART Ink lines', () => {
    expect(isPenLine('x pen watch: hushed while SMART Ink restarts')).toBe(true);
    expect(isPenLine('x SMART Ink clear half hour')).toBe(true);
    expect(isPenLine('x screen opened classroom')).toBe(false);
  });
});

describe('the list, signed out', () => {
  it('asks for the passphrase rather than showing an empty list', () => {
    render(<ScreensSection onOpen={() => {}} goTo={() => {}} />);
    expect(screen.getByText(/Sign in with the church passphrase/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in →' })).toBeTruthy();
  });
});

describe('cards on a screen opened from the page', () => {
  /** @param {{following?: boolean, remote?: any}} p */
  const show = ({ following = true, remote = { id: 'x', kind: 'lobby', name: 'Front door TV' } } = {}) => render(
    <SettingsPageContext.Provider value>
      <RemoteScreenContext.Provider value={remote}>
        <FollowingContext.Provider value={following}>
          <PanelCard title="Mine" scope="screen">a</PanelCard>
          <PanelCard title="Everyone's" scope="shared">b</PanelCard>
          <PanelCard title="This browser" scope="screen" keep local>c</PanelCard>
        </FollowingContext.Provider>
      </RemoteScreenContext.Provider>
    </SettingsPageContext.Provider>,
  );

  it('its own cards come back, tagged with its name; this browser\'s stay out', () => {
    show();
    expect(screen.getByRole('heading', { name: 'Mine' })).toBeTruthy();
    expect(screen.getByText('Front door TV only')).toBeTruthy();
    expect(screen.getByText('Every screen')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'This browser' })).toBeNull();
  });

  it('a screen that keeps its own values loses the shared cards (a change there would not reach it)', () => {
    show({ following: false });
    expect(screen.queryByRole('heading', { name: "Everyone's" })).toBeNull();
  });

  it('the page itself still hides "This screen" cards', () => {
    show({ remote: null });
    expect(screen.queryByRole('heading', { name: 'Mine' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'This browser' })).toBeTruthy();
  });
});
