import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ZeroAnimationContext } from '../lib/motion.jsx';
import defaults from '../config.js';
import { saveDisplayKey } from '../lib/displayKey.js';

// The new seven-section rail (docs/SETTINGS-OVERHAUL.md sections 1-3), on the
// settings page (signed in and not), a TV's own panel and a screen opened
// from the page. The sync store and the Worker are stand-ins.

const sync = vi.hoisted(() => ({ state: { url: 'https://w.test', signedIn: true, phase: 'ok', lastSyncAt: Date.now(), template: null, kid: 'k1' } }));
const calls = vi.hoisted(() => []);
const answers = vi.hoisted(() => ({ fn: () => ({ ok: false, status: 404, body: null }) }));
vi.mock('../hooks/useSync.js', () => ({
  useSync: () => sync.state,
  syncAuthed: async (path, opts = {}) => { calls.push(`${opts.method || 'GET'} ${path}`); return answers.fn(path, opts); },
  signIn: vi.fn(), signOut: vi.fn(), changePassphrase: vi.fn(), saveTemplate: vi.fn(),
  testCloudCheckin: vi.fn(async () => ({ ok: true, text: 'ok' })),
  printBarfBags: vi.fn(async () => ({ ok: true, text: 'ok' })),
  loadFriendsReport: vi.fn(async () => ({ ok: false, text: 'no' })),
  publishViaSync: vi.fn(), syncNow: vi.fn(), useSyncDriver: vi.fn(),
}));
vi.mock('../hooks/useDisplayLogin.js', () => ({ useDisplayLogin: () => ({ loginStatus: 'logged-out', kid: null, hasLoginKey: false, login: vi.fn(), logout: vi.fn() }) }));
vi.mock('../lib/videoStore.js', () => ({
  BACKGROUND_VIDEO_ID: 'background', getVideo: vi.fn(async () => null), putVideo: vi.fn(), deleteVideo: vi.fn(),
}));
vi.mock('../hooks/useScreenSync.js', () => ({
  useThisScreen: () => ({ registered: false, name: '' }), renameThisScreen: vi.fn(),
  listScreens: vi.fn(async () => ({ ok: true, screens: [] })), loadScreen: vi.fn(), saveScreenSettings: vi.fn(), renameScreen: vi.fn(),
  forgetScreen: vi.fn(), sendScreenAction: vi.fn(),
}));

const SettingsPanel = (await import('./SettingsPanel.jsx')).default;

const FAKE_KEY = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU=';
const baseProps = (extra = {}) => ({
  config: { ...defaults, audioMuted: true },
  status: 'connected',
  nameStatus: 'ok',
  demoActive: false,
  lastEventAt: null,
  calendar: { events: [], source: 'none', generatedAt: null, refresh: vi.fn() },
  onChange: vi.fn(), onReplace: vi.fn(), onReset: vi.fn(), onClose: vi.fn(), onTest: vi.fn(), onResetTally: vi.fn(),
  onOpenSlideEditor: vi.fn(), onOpenDebug: vi.fn(), rail: 'new',
  ...extra,
});
const page = (extra) => baseProps({ page: true, configure: true, onOpenScreen: vi.fn(), onTest: undefined, onResetTally: undefined, ...extra });

const ZERO = ({ children }) => <ZeroAnimationContext.Provider value>{children}</ZeroAnimationContext.Provider>;
const open = (props) => render(<ZERO><SettingsPanel {...props} /></ZERO>);
const labels = () => screen.getAllByRole('tab').map((t) => t.querySelector('.settings-nav__label').textContent);
const tab = (name) => fireEvent.click(screen.getByRole('tab', { name }));

beforeEach(() => {
  localStorage.clear();
  calls.length = 0;
  sync.state = { url: 'https://w.test', signedIn: true, phase: 'ok', lastSyncAt: Date.now(), template: null, kid: 'k1' };
  answers.fn = () => ({ ok: false, status: 404, body: null });
  saveDisplayKey(FAKE_KEY);
  vi.stubGlobal('matchMedia', (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('the new rail on the settings page', () => {
  it('lists the seven sections in order and opens on Tonight when signed in', () => {
    open(page());
    expect(labels()).toEqual(['Tonight', 'Screens', 'What screens show', 'Slides & look', 'Printing', 'History', 'Account & app']);
    expect(screen.getByRole('tab', { name: 'Tonight' }).getAttribute('aria-selected')).toBe('true');
  });

  it('opens on Account & app until signed in, with the sign-in field and nothing else to do', () => {
    sync.state = { ...sync.state, signedIn: false };
    open(page());
    expect(screen.getByRole('tab', { name: 'Account & app' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByLabelText('Passphrase')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Account & app' }).querySelector('.settings-nav__badge')).not.toBeNull();
  });

  it('every old section id still resolves to where its controls went', () => {
    for (const [asked, label] of [['status', 'Tonight'], ['checkins', 'What screens show'], ['slides', 'Slides & look'], ['laptop', 'Printing'], ['setup', 'Account & app'], ['pickup', 'What screens show']]) {
      const { unmount } = open(page({ initialTab: asked }));
      expect(screen.getByRole('tab', { name: label }).getAttribute('aria-selected')).toBe('true');
      unmount();
    }
  });

  it('has none of the removed controls anywhere', () => {
    open(page());
    for (const name of ['Tonight', 'Screens', 'What screens show', 'Slides & look', 'Printing', 'History', 'Account & app']) {
      tab(name);
      expect(screen.queryByLabelText(/Display login|Display key|Publish token/i), name).toBeNull();
      expect(screen.queryByText(/paste keys by hand|Other screens|Allow driven check-ins from phones|Club Label Printer/i), name).toBeNull();
      expect(screen.queryByRole('heading', { name: /Other screens|Publishing slides|Cloud check-in/i }), name).toBeNull();
    }
  });

  it('Tonight: sign-in line, switches and the notice composer come from the Worker; the poll starts', async () => {
    answers.fn = (path) => {
      if (path === '/v1/tonight/overview') return { ok: true, status: 200, body: { at: new Date().toISOString(), count: { source: 'report', checkedIn: 12, byClub: { Sparks: 12 }, reportAgeMs: 3000 }, print: { stations: [], checkThePrinter: 0 }, window: { open: false }, switches: [], notice: null, church: { rev: 1 }, history: {}, changes: {} } };
      if (path === '/v1/switches') return { ok: true, status: 200, body: { rev: 1, stations: [], switches: [{ name: 'CLOUD_PRINT', value: 'off', default: 'off', source: 'default' }, { name: 'SINGLE_PUBLISHER', value: 'off', default: 'off', source: 'default' }, { name: 'YM_CHECKOUT', value: 'off', default: 'off', source: 'default' }] } };
      if (path === '/v1/notice') return { ok: true, status: 200, body: { notice: null } };
      if (path.startsWith('/v1/changes')) return { ok: true, status: 200, body: { entries: [], next: null, head: 0 } };
      return { ok: false, status: 404, body: null };
    };
    open(page());
    expect(screen.getByText(/Signed in: changes here reach every screen/)).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('mission-total').textContent).toBe('12'));
    expect(await screen.findByRole('checkbox', { name: 'Print TwoTimTwo-page check-ins' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'The service runs the screens’ count and pickup list' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Check out Trek and Journey automatically (7:15 pm)' })).toBeTruthy();
    expect(screen.getByLabelText('Message')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Recent changes' })).toBeTruthy();
    expect(calls).toContain('GET /v1/tonight/overview');
  });

  it('What screens show: the cards, and "Which clubs" points at Printing', () => {
    open(page());
    tab('What screens show');
    for (const h of ['Welcome banners', 'Welcome extras', 'Club lines', 'Celebrations', 'Pickup board', 'Corner']) expect(screen.getByRole('heading', { name: h })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'This TV' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Simplified mode' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Which clubs →' }));
    expect(screen.getByRole('tab', { name: 'Printing' }).getAttribute('aria-selected')).toBe('true');
  });

  it('Slides & look: ONE Season control with the "Tonight:" line', () => {
    open(page());
    tab('Slides & look');
    expect(screen.getAllByLabelText('Season')).toHaveLength(1);
    expect(screen.getByTestId('season-line').textContent).toMatch(/^Tonight: /);
    expect(screen.getByRole('button', { name: /Edit slides/ })).toBeTruthy();
  });

  it('Printing: before the seed the church cards are read-only with one way forward; nothing probes the laptop', async () => {
    answers.fn = (path) => (path === '/v1/church/settings'
      ? { ok: true, status: 200, body: { rev: 0, settings: null, paused: false, switches: {}, switchesRev: 0 } }
      : { ok: false, status: 404, body: null });
    const probe = vi.fn(() => Promise.reject(new Error('no')));
    vi.stubGlobal('fetch', probe);
    open(page());
    tab('Printing');
    expect(await screen.findByText(/Waiting for the check-in laptop to send its settings \(KVBC Awana 9\.3\.0\)/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start from defaults instead' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Label footer' }).disabled).toBe(true);
    expect(probe).not.toHaveBeenCalled();
    expect(screen.getByText('At the laptop')).toBeTruthy();
  });

  it('Account & app: sign-in, passphrase, device, change log, KVBC Awana, and no TV tools', () => {
    open(page());
    tab('Account & app');
    for (const h of ['Sign in', 'Passphrase', 'This device', 'Change log', 'KVBC Awana for Windows', 'KVBC Awana release notes', 'About']) {
      expect(screen.getByRole('heading', { name: h }), h).toBeTruthy();
    }
    expect(screen.queryByRole('heading', { name: "This screen's tools" })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Church-wide settings' })).toBeNull();
  });

  it('History keeps its cards and gains Import laptop history', () => {
    open(page());
    tab('History');
    expect(screen.getByRole('heading', { name: 'Import laptop history' })).toBeTruthy();
  });
});

describe('the new rail on a TV and on a screen opened from the page', () => {
  it('a TV lists four sections and opens on What screens show when all is well', () => {
    open(baseProps());
    expect(labels()).toEqual(['Tonight', 'What screens show', 'Slides & look', 'Account & app']);
    expect(screen.getByRole('tab', { name: 'What screens show' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('heading', { name: 'This TV' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Simplified mode' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Preview' })).toBeTruthy();   // the pickup preview stays on a TV
  });

  it('a TV that cannot work opens on Account & app, with the sign-in', () => {
    open(baseProps({ status: 'off' }));
    expect(screen.getByRole('tab', { name: 'Account & app' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Connect this screen' })).toBeTruthy();
    expect(screen.queryByLabelText('Display login')).toBeNull();
  });

  it('a TV with a problem opens on Tonight and counts it on the rail; no Worker calls', () => {
    open(baseProps({ opsFailures: [{ club: 'Sparks', at: Date.now() }] }));
    const t = screen.getByRole('tab', { name: 'Tonight' });
    expect(t.getAttribute('aria-selected')).toBe('true');
    expect(t.querySelector('.settings-nav__badge').textContent).toBe('1');
    expect(screen.getByText(/The printer reported 1 problem tonight/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Online check-in switches|Notice to every screen/ })).toBeNull();
    expect(calls).toEqual([]);
  });

  it('a TV\'s Account & app has its tools and the church-wide switch, not the change log', () => {
    open(baseProps({ initialTab: 'account' }));
    expect(screen.getByRole('heading', { name: "This screen's tools" })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Church-wide settings' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Change log' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'This device' })).toBeNull();
  });

  it('a screen opened from the page lists Tonight, What screens show and Slides & look', () => {
    open(page({ screen: { id: 'tv_aaaaaaaaaaaaaaaaaaaa', kind: 'lobby', name: 'Front door TV', online: true }, initialTab: 'tonight' }));
    expect(labels()).toEqual(['Tonight', 'What screens show', 'Slides & look']);
    expect(screen.getByText('On or off, its name, its buttons')).toBeTruthy();
  });
});

describe('the classic rail (?rail=classic)', () => {
  it('is still the eight sections', () => {
    open(baseProps({ rail: 'classic' }));
    expect(labels()).toEqual(['Status', 'Check-ins', 'Slides', 'Screen & corner', 'Celebrations', 'Pickup board', 'Look & season', 'Setup']);
  });

  it('keeps compiling, minus the removed controls', () => {
    open(baseProps({ rail: 'classic', status: 'off' }));
    expect(screen.queryByLabelText('Display key')).toBeNull();
    expect(screen.queryByLabelText('Display login')).toBeNull();
    expect(screen.queryByText(/Publish token/i)).toBeNull();
    tab('Status');
    expect(screen.queryByRole('heading', { name: 'Other screens' })).toBeNull();
  });
});

describe('the TV preview wiring', () => {
  it('a wide page gets the sticky column on Tonight / show / look only', () => {
    vi.stubGlobal('matchMedia', (q) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
    const { container } = open(page());
    expect(container.querySelector('.settings-preview-col')).not.toBeNull();
    expect(container.querySelector('.panel--settings').className).toContain('has-preview');
    tab('Printing');
    expect(container.querySelector('.settings-preview-col')).toBeNull();
    tab('What screens show');
    expect(within(container.querySelector('.settings-preview-col')).getByRole('img', { name: /preview/i })).toBeTruthy();
  });

  it('a narrow page gets a Preview toggle on show / look, off by default', () => {
    const { container } = open(page({ initialTab: 'show' }));
    expect(container.querySelector('.settings-preview-col')).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Preview' });
    expect(container.querySelector('[data-testid="tv-preview"]')).toBeNull();
    fireEvent.click(toggle);
    expect(container.querySelector('[data-testid="tv-preview"]')).not.toBeNull();
  });

  it('never on a TV\'s own panel, and ?preview=0 kills it', () => {
    vi.stubGlobal('matchMedia', (q) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
    const tv = open(baseProps());
    expect(tv.container.querySelector('.settings-preview-col')).toBeNull();
    tv.unmount();
    window.history.pushState({}, '', '/?preview=0');
    const killed = open(page());
    expect(killed.container.querySelector('.settings-preview-col')).toBeNull();
    window.history.pushState({}, '', '/');
  });
});
