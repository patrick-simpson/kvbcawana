import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ZeroAnimationContext } from '../lib/motion.jsx';
import defaults from '../config.js';
import { applyPanicMode } from '../lib/panic.js';
import { getAllClubs } from '../lib/clubs.js';
import { saveDisplayKey } from '../lib/displayKey.js';

// The display-login store is exercised in its own suite; here it is a
// settable snapshot so every UI branch can be reached synchronously.
const loginState = vi.hoisted(() => ({
  frameStatus: 'waiting',
  loginStatus: 'logged-out',
  kid: null,
  pendingLogin: false,
  hasLoginKey: false,
  login: vi.fn(async () => 'no-frame'),
  logout: vi.fn(),
}));
vi.mock('../hooks/useDisplayLogin.js', () => ({
  useDisplayLogin: () => ({ ...loginState }),
}));

// IndexedDB is absent in jsdom; the upload fields only need a stored file.
const video = vi.hoisted(() => ({
  BACKGROUND_VIDEO_ID: 'background',
  getVideo: vi.fn(async () => new File(['x'], 'clip.mp4', { type: 'video/mp4' })),
  putVideo: vi.fn(async () => {}),
  deleteVideo: vi.fn(async () => {}),
}));
vi.mock('../lib/videoStore.js', () => video);

const SettingsPanel = (await import('./SettingsPanel.jsx')).default;

// A plausible-looking display key (44 chars, base64, ends in '=') for the
// "key pasted by hand" branches. Never a real one.
const FAKE_KEY = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU=';

// No global test setup file in this repo, so RTL's automatic cleanup
// (which needs a global afterEach) doesn't run — do it explicitly.
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => {
  localStorage.clear();
  Object.assign(loginState, {
    frameStatus: 'waiting', loginStatus: 'logged-out', kid: null, pendingLogin: false, hasLoginKey: false,
  });
  loginState.login.mockReset().mockImplementation(async () => 'no-frame');
  loginState.logout.mockReset();
});

// Done is a <jelly-button> web component (vendored script, loaded via
// index.html — not in jsdom). Its accessible button role lives in its shadow
// DOM, so tests target the host element by tag; React's onClick is attached
// to the host and fires the same way.
const clickDone = () => fireEvent.click(screen.getByText('Done', { selector: 'jelly-button' }));
const section = (name) => fireEvent.click(screen.getByRole('tab', { name }));
/** Type into a field, then leave it: typed fields apply on blur. */
const typeAndLeave = (el, value) => {
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
};

const baseProps = () => ({
  config: { ...defaults, audioMuted: true },
  status: 'off',
  nameStatus: 'ok',
  demoActive: false,
  lastEventAt: null,
  calendar: { events: [], source: 'none', generatedAt: null, refresh: vi.fn() },
  onChange: vi.fn(),
  onReplace: vi.fn(),
  onReset: vi.fn(),
  onClose: vi.fn(),
  onTest: vi.fn(),
  onResetTally: vi.fn(),
  onOpenSlideEditor: vi.fn(),
  onOpenDebug: vi.fn(),
});
/** A screen that works: connected and keyed, so it opens on Check-ins. */
const happyProps = () => {
  saveDisplayKey(FAKE_KEY);
  return { ...baseProps(), status: 'connected' };
};

const SECTION_NAMES = [
  'Status', 'Check-ins', 'Slides', 'Screen & corner', 'Celebrations', 'Pickup board', 'Look & season', 'Setup',
];

describe('SettingsPanel: the two-pane shell', () => {
  it('lists the eight sections in order, as a vertical tab list', () => {
    render(<SettingsPanel {...happyProps()} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.querySelector('.settings-nav__label').textContent)).toEqual(SECTION_NAMES);
    expect(screen.getByRole('tablist').getAttribute('aria-orientation')).toBe('vertical');
    // Each name is the label alone; the blurb describes it.
    for (const name of SECTION_NAMES) expect(screen.getByRole('tab', { name })).toBeTruthy();
  });

  it('a working screen opens on Check-ins, with focus on its rail item', () => {
    render(<SettingsPanel {...happyProps()} />);
    const tab = screen.getByRole('tab', { name: 'Check-ins' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab);
    expect(screen.getByLabelText('How long each name stays up (seconds)')).toBeTruthy();
  });

  it('an unconfigured screen opens on Setup, with the by-hand fold open', () => {
    const { container } = render(<SettingsPanel {...baseProps()} />);
    expect(screen.getByRole('tab', { name: 'Setup' }).getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('details.advanced-fields').open).toBe(true);
    expect(screen.getByLabelText('Pusher App Key')).toBeTruthy();
  });

  it('a working screen with a problem opens on Status and counts it on the rail', () => {
    render(<SettingsPanel {...{ ...happyProps(), opsFailures: [{ club: 'Sparks', at: Date.now() }] }} />);
    const tab = screen.getByRole('tab', { name: 'Status' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(tab.querySelector('.settings-nav__badge').textContent).toBe('1');
    expect(screen.getByText(/The printer reported 1 problem tonight/)).toBeTruthy();
  });

  it('opens on a requested section, old tab ids included', () => {
    const { unmount } = render(<SettingsPanel {...{ ...happyProps(), initialTab: 'background' }} />);
    expect(screen.getByRole('tab', { name: 'Slides' }).getAttribute('aria-selected')).toBe('true');
    unmount();
    render(<SettingsPanel {...{ ...happyProps(), initialTab: 'pickup', onTabChange: vi.fn() }} />);
    expect(screen.getByRole('tab', { name: 'Pickup board' }).getAttribute('aria-selected')).toBe('true');
  });

  it('switches sections on click and reports the change', () => {
    const props = { ...happyProps(), onTabChange: vi.fn() };
    render(<SettingsPanel {...props} />);
    section('Slides');
    expect(screen.getByLabelText('Calendar page URL')).toBeTruthy();
    expect(screen.queryByLabelText('How long each name stays up (seconds)')).toBeNull();
    expect(props.onTabChange).toHaveBeenCalledWith('slides');
  });

  it('moves along the rail with Up/Down (and Left/Right), Home and End', () => {
    render(<SettingsPanel {...happyProps()} />);
    const selected = () => screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true')
      .querySelector('.settings-nav__label').textContent;
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Check-ins' }), { key: 'ArrowDown' });
    expect(selected()).toBe('Slides');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Slides' }));
    fireEvent.keyDown(document.activeElement, { key: 'ArrowUp' });
    fireEvent.keyDown(document.activeElement, { key: 'ArrowLeft' });
    expect(selected()).toBe('Status');
    fireEvent.keyDown(document.activeElement, { key: 'End' });
    expect(selected()).toBe('Setup');
    fireEvent.keyDown(document.activeElement, { key: 'ArrowRight' });
    expect(selected()).toBe('Status');
    fireEvent.keyDown(document.activeElement, { key: 'Home' });
    expect(selected()).toBe('Status');
  });

  it('a phone sees the list first, and a tap opens the section with a way back', () => {
    const { container } = render(<SettingsPanel {...happyProps()} />);
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog.dataset.view).toBe('list');
    section('Celebrations');
    expect(dialog.dataset.view).toBe('section');
    fireEvent.click(screen.getByRole('button', { name: 'Back to all settings' }));
    expect(dialog.dataset.view).toBe('list');
  });

  it('a requested section opens straight on it on a phone too', () => {
    const { container } = render(<SettingsPanel {...{ ...baseProps(), initialTab: 'setup' }} />);
    expect(container.querySelector('[role="dialog"]').dataset.view).toBe('section');
  });
});

describe('SettingsPanel: live apply, Undo and Done', () => {
  it('a toggle applies the moment it is flipped, and only that key', () => {
    const props = happyProps();
    render(<SettingsPanel {...props} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'First arrival of the night' }));
    expect(props.onChange).toHaveBeenCalledTimes(1);
    expect(props.onChange).toHaveBeenCalledWith({ firstArrivalMoment: false });
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('a typed field applies when it loses focus, not on every keystroke', () => {
    const props = happyProps();
    render(<SettingsPanel {...props} />);
    section('Slides');
    const welcome = screen.getByLabelText('Calendar welcome wording (regular nights)');
    fireEvent.change(welcome, { target: { value: 'Welcome to KVB Awana!' } });
    expect(props.onChange).not.toHaveBeenCalled();
    fireEvent.blur(welcome);
    expect(props.onChange).toHaveBeenCalledWith({ calendarWelcomeText: 'Welcome to KVB Awana!' });
  });

  it('Enter in a typed field applies it too', () => {
    const props = baseProps();
    render(<SettingsPanel {...props} />);
    const key = screen.getByLabelText('Pusher App Key');
    fireEvent.change(key, { target: { value: 'key123' } });
    fireEvent.keyDown(key, { key: 'Enter' });
    expect(props.onChange).toHaveBeenCalledWith({ pusherAppKey: 'key123' });
  });

  it('durations are typed in seconds and stored in milliseconds, clamped', () => {
    const props = happyProps();
    render(<SettingsPanel {...props} />);
    const std = screen.getByLabelText('How long each name stays up (seconds)');
    expect(std.value).toBe('6');
    typeAndLeave(std, '7.5');
    expect(props.onChange).toHaveBeenLastCalledWith({ standardDisplayMs: 7500 });
    typeAndLeave(std, '999');
    expect(props.onChange).toHaveBeenLastCalledWith({ standardDisplayMs: 20000 });
  });

  it('Done applies a field still being typed in, then closes', () => {
    const props = baseProps();
    render(<SettingsPanel {...props} />);
    fireEvent.change(screen.getByLabelText('Pusher App Key'), { target: { value: 'key123' } });
    clickDone();
    expect(props.onChange).toHaveBeenCalledWith({ pusherAppKey: 'key123' });
    expect(props.onClose).toHaveBeenCalled();
  });

  it('an untouched panel writes nothing — a baked key or fleet value is never pinned', () => {
    const props = baseProps();
    props.config = { ...defaults, pusherAppKey: 'baked-from-build', audioMuted: true };
    render(<SettingsPanel {...props} />);
    for (const name of SECTION_NAMES) section(name);
    clickDone();
    expect(props.onChange).not.toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalled();
  });

  it('Escape and the backdrop close at once (nothing is left unsaved)', () => {
    const props = happyProps();
    const confirm = vi.spyOn(window, 'confirm');
    const { container } = render(<SettingsPanel {...props} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(container.querySelector('.panel-backdrop'));
    expect(props.onClose).toHaveBeenCalledTimes(2);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('Undo puts back exactly the layer the panel opened on, and the form with it', () => {
    const props = happyProps();
    props.overrides = { nightTheme: 'christmas' };
    props.savedConfig = { ...defaults, audioMuted: true, nightTheme: 'christmas' };
    render(<SettingsPanel {...props} />);
    const undo = screen.getByRole('button', { name: 'Undo changes' });
    expect(undo.disabled).toBe(true);
    const box = screen.getByRole('checkbox', { name: 'First arrival of the night' });
    fireEvent.click(box);
    expect(box.checked).toBe(false);
    expect(undo.disabled).toBe(false);
    fireEvent.click(undo);
    expect(props.onReplace).toHaveBeenCalledWith({ nightTheme: 'christmas' });
    expect(screen.getByRole('checkbox', { name: 'First arrival of the night' }).checked).toBe(true);
    expect(screen.getByRole('button', { name: 'Undo changes' }).disabled).toBe(true);
    // After an Undo the next change is a change again.
    fireEvent.click(screen.getByRole('checkbox', { name: 'First arrival of the night' }));
    expect(props.onChange).toHaveBeenLastCalledWith({ firstArrivalMoment: false });
  });

  it('seeds from savedConfig, never from the panic-masked config, and simplified mode is a live switch', () => {
    const props = happyProps();
    const saved = {
      ...defaults, audioMuted: true, panicMode: true, backgroundSource: 'powerpoint',
      powerpointEmbedUrl: 'https://onedrive.live.com/embed?x', calendarEnabled: true,
    };
    props.savedConfig = saved;
    props.config = applyPanicMode(saved);
    render(<SettingsPanel {...props} />);
    section('Screen & corner');
    const box = screen.getByRole('checkbox', { name: 'Strip the screen to the basics' });
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    // Only the switch — the mask's placeholder values (background source,
    // empty URL, calendar off) never reach storage.
    expect(props.onChange).toHaveBeenCalledWith({ panicMode: false });
    clickDone();
    expect(props.onChange).toHaveBeenCalledTimes(1);
  });

  it('Preview a check-in, Debug panel and Edit slides… apply a field still being typed in first', () => {
    for (const [label, cb, where] of [['Preview a check-in', 'onTest', 'Check-ins'], ['Debug panel', 'onOpenDebug', 'Setup'], [/Edit slides/, 'onOpenSlideEditor', 'Slides']]) {
      const props = happyProps();
      render(<SettingsPanel {...props} />);
      section('Setup');
      fireEvent.change(screen.getByLabelText('Pusher App Key'), { target: { value: 'key123' } });
      section(where);
      // Leaving Setup unmounts the field without a blur: the pending value
      // is still applied before the action runs.
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(props.onChange).toHaveBeenCalledWith({ pusherAppKey: 'key123' });
      expect(props[cb]).toHaveBeenCalled();
      expect(props.onChange.mock.invocationCallOrder[0]).toBeLessThan(props[cb].mock.invocationCallOrder[0]);
      cleanup();
      localStorage.clear();
    }
  });

  it('under zero animation Done is a plain primary button', () => {
    const props = happyProps();
    const { container } = render(
      <ZeroAnimationContext.Provider value>
        <SettingsPanel {...props} />
      </ZeroAnimationContext.Provider>,
    );
    expect(container.querySelector('jelly-button')).toBeNull();
    const done = screen.getByRole('button', { name: 'Done' });
    expect(done.classList.contains('primary')).toBe(true);
    fireEvent.click(done);
    expect(props.onClose).toHaveBeenCalled();
  });

  it('with motion Done is the Jelly UI button', () => {
    const { container } = render(<SettingsPanel {...happyProps()} />);
    expect(container.querySelector('.actions jelly-button')?.textContent).toBe('Done');
  });
});

describe('Status', () => {
  it('names the login state (key pasted by hand) and what the screen can read', () => {
    render(<SettingsPanel {...{ ...happyProps(), initialTab: 'status' }} />);
    expect(screen.getByText('Connected — check-ins will appear instantly')).toBeTruthy();
    expect(screen.getByText(/display key pasted by hand/)).toBeTruthy();
    expect(screen.getByText(/this screen can read encrypted names/)).toBeTruthy();
  });

  it('a connected but unkeyed screen is told to log in, with a jump to Setup', () => {
    render(<SettingsPanel {...{ ...baseProps(), status: 'connected', nameStatus: 'no-key', initialTab: 'status' }} />);
    expect(screen.getByText('Connected — not logged in yet (Setup → Connect this screen)')).toBeTruthy();
    expect(screen.getByText(/encrypted names are arriving but this screen has no key/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Set up this screen/ }));
    expect(screen.getByRole('tab', { name: 'Setup' }).getAttribute('aria-selected')).toBe('true');
  });

  it('shows tonight in plain words and the live calendar line', () => {
    const props = { ...happyProps(), initialTab: 'status', phase: 'game-time' };
    props.calendar = {
      events: [
        { date: '2099-01-06', kind: 'club', title: 'Awana meeting', isCancelled: false, isSpecial: false },
        { date: '2099-01-13', kind: 'club', title: 'Water Night', isCancelled: false, isSpecial: true },
      ],
      source: 'feed',
      generatedAt: new Date().toISOString(),
      refresh: vi.fn(),
    };
    render(<SettingsPanel {...props} />);
    expect(screen.getByText(/Game time/)).toBeTruthy();
    expect(screen.getByText(/2 events loaded/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh calendar now' }));
    expect(props.calendar.refresh).toHaveBeenCalled();
  });

  it('demo mode is disclosed with a reload exit', () => {
    render(<SettingsPanel {...{ ...happyProps(), demoActive: true }} />);
    expect(screen.getByText(/a sample or simulated check-in was fired/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload display' })).toBeTruthy();
  });

  it('lists every problem, worded by fix', () => {
    render(<SettingsPanel {...{
      ...happyProps(), layerFaults: ['weather'], remoteConfigError: 'HTTP 404', wakeLockStatus: 'unsupported',
    }} />);
    expect(screen.getByText(/A screen layer crashed/)).toBeTruthy();
    expect(screen.getByText(/central config for this screen could not be applied/)).toBeTruthy();
    expect(screen.getByText(/no Screen Wake Lock/)).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Status' }).querySelector('.settings-nav__badge').textContent).toBe('3');
  });

  it('keeps the trademark line', () => {
    render(<SettingsPanel {...{ ...happyProps(), initialTab: 'status' }} />);
    expect(screen.getByText(/NOT AFFILIATED OR ENDORSED BY/)).toBeTruthy();
  });
});

describe('Setup: connecting this screen', () => {
  it('with no Pusher key the login field points at Advanced', () => {
    render(<SettingsPanel {...baseProps()} />);
    expect(screen.getByText(/not connected to Pusher yet/)).toBeTruthy();
  });

  it('the passphrase box is typeable before any frame arrives and Log in enables on text', async () => {
    const props = { ...baseProps(), status: 'connected' };
    const { container } = render(<SettingsPanel {...props} />);
    // Connected: the by-hand fold stays closed — login leads.
    expect(container.querySelector('details.advanced-fields').open).toBe(false);
    const input = screen.getByLabelText('Display login');
    expect(input.disabled).toBe(false);
    const button = screen.getByRole('button', { name: 'Log in' });
    expect(button.disabled).toBe(true);
    fireEvent.change(input, { target: { value: 'abcd-efgh-ijkm-npqr' } });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(loginState.login).toHaveBeenCalledWith('abcd-efgh-ijkm-npqr'));
    // The passphrase is never config.
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it('Show reveals the passphrase', () => {
    render(<SettingsPanel {...{ ...baseProps(), status: 'connected' }} />);
    const input = screen.getByLabelText('Display login');
    expect(input.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Show passphrase' }));
    expect(input.type).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: 'Hide passphrase' }));
    expect(input.type).toBe('password');
  });

  it('a parked passphrase says it will be tried automatically', () => {
    Object.assign(loginState, { pendingLogin: true });
    render(<SettingsPanel {...{ ...baseProps(), status: 'connected' }} />);
    expect(screen.getByText(/tried automatically the moment it arrives/)).toBeTruthy();
  });

  it('a wrong passphrase is called out and the box stays usable', () => {
    Object.assign(loginState, { frameStatus: 'received', loginStatus: 'wrong' });
    render(<SettingsPanel {...{ ...baseProps(), status: 'connected' }} />);
    expect(screen.getByText(/does not match the print server/)).toBeTruthy();
    expect(screen.getByLabelText('Display login').disabled).toBe(false);
  });

  it('a logged-in screen shows its kid and offers Log out behind a confirm', () => {
    Object.assign(loginState, { frameStatus: 'received', loginStatus: 'logged-in', kid: '2c366156' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<SettingsPanel {...{ ...baseProps(), status: 'connected', initialTab: 'setup' }} />);
    expect(screen.getByText('logged in · key 2c366156')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(loginState.logout).toHaveBeenCalled();
  });

  it('without secure crypto nothing pretends a pasted key would help', () => {
    vi.stubGlobal('crypto', {});
    const { container } = render(<SettingsPanel {...{ ...baseProps(), status: 'connected' }} />);
    expect(screen.getByRole('tab', { name: 'Setup' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByText(/not in a secure context/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Paste key' })).toBeNull();
    expect(screen.getByLabelText('Display login').disabled).toBe(true);
    expect(container.querySelector('details.advanced-fields').open).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe('Slides', () => {
  const open = (props = happyProps()) => { render(<SettingsPanel {...{ ...props, initialTab: 'slides' }} />); return props; };

  it('lists the typed & published deck first and defaults to it', () => {
    open();
    const radios = screen.getAllByRole('radio');
    expect(radios[0]).toBe(screen.getByLabelText('Typed & published slides'));
    expect(radios[0].checked).toBe(true);
  });

  it('a published deck on another source shows the notice; its button switches at once', () => {
    const props = happyProps();
    props.config = { ...defaults, audioMuted: true, backgroundSource: 'powerpoint' };
    props.syncedDeck = { deckRev: 3, publishedAt: Date.now(), slides: [{ id: 's1', text: 'Hi', eyebrow: '', theme: 'auto', durationSec: 0, textSize: 'auto' }] };
    open(props);
    expect(screen.getByText(/but this screen is set to OneDrive PowerPoint/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show the published slides' }));
    expect(screen.getByLabelText('Typed & published slides').checked).toBe(true);
    expect(screen.queryByText(/but this screen is set to/)).toBeNull();
    expect(props.onChange).toHaveBeenCalledWith({ backgroundSource: 'manual' });
  });

  it('a source change applies at once; the URL and timing fields follow it', () => {
    const props = open();
    expect(screen.queryByLabelText(/OneDrive PowerPoint embed URL/)).toBeNull();
    expect(screen.getByLabelText('Seconds per slide')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('OneDrive PowerPoint'));
    expect(props.onChange).toHaveBeenLastCalledWith({ backgroundSource: 'powerpoint' });
    expect(screen.getByLabelText('OneDrive PowerPoint embed URL')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Uploaded PowerPoint'));
    expect(screen.getByLabelText('OneDrive PowerPoint embed URL (fallback if the uploaded deck cannot render)')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Looping video'));
    expect(screen.queryByLabelText(/OneDrive PowerPoint embed URL/)).toBeNull();
    expect(screen.queryByLabelText('Seconds per slide')).toBeNull();
    expect(screen.getByRole('button', { name: /Edit slides/ })).toBeTruthy();
    expect(screen.getByText('Follow published slides')).toBeTruthy();
  });

  it('Remove video asks first', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const props = happyProps();
    props.config = { ...defaults, audioMuted: true, backgroundSource: 'video' };
    open(props);
    const remove = await screen.findByRole('button', { name: 'Remove video' });
    fireEvent.click(remove);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('clip.mp4'));
    expect(video.deleteVideo).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(remove);
    await waitFor(() => expect(video.deleteVideo).toHaveBeenCalled());
  });

  it('the calendar slide options fold away with the calendar, the promos toggle applies at once', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T12:00:00'));
    const props = open();
    const promos = screen.getByLabelText('Fall event promos');
    expect(promos.checked).toBe(true);
    fireEvent.click(promos);
    expect(props.onChange).toHaveBeenCalledWith({ seasonPromos: false });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Calendar-aware slides' }));
    expect(screen.queryByLabelText('Welcome slide')).toBeNull();
    vi.useRealTimers();
  });

  it('after the season the promos toggle leaves the page', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-01T12:00:00'));
    open();
    expect(screen.queryByLabelText('Fall event promos')).toBeNull();
    vi.useRealTimers();
  });

  it('published-slide hints on Status lead with logging in', () => {
    render(<SettingsPanel {...{ ...baseProps(), status: 'connected', initialTab: 'status' }} />);
    expect(screen.getByText(/type the church’s display passphrase under Setup → Connect this screen/)).toBeTruthy();
  });
});

describe('Check-ins, Screen & corner, Celebrations, Pickup board, Look & season', () => {
  it('confetti and reduce motion sit together on Screen & corner', () => {
    const props = happyProps();
    render(<SettingsPanel {...props} />);
    section('Screen & corner');
    expect(screen.getByLabelText('Confetti')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Reduce motion on this screen' }));
    expect(props.onChange).toHaveBeenCalledWith({ reduceMotion: true });
    expect(defaults.reduceMotion).toBe(false);
    expect(defaults.confettiLevel).toBe('full');
  });

  it('says when ?lowPower=1 is overriding the motion settings', () => {
    const props = happyProps();
    props.savedConfig = { ...defaults, audioMuted: true };
    props.config = { ...props.savedConfig, reduceMotion: true, confettiLevel: 'off' };
    render(<SettingsPanel {...{ ...props, initialTab: 'screen' }} />);
    expect(screen.getByText(/lowPower=1/)).toBeTruthy();
  });

  it('the corner is one item at a time, and the counter note only shows with the counter', () => {
    render(<SettingsPanel {...{ ...happyProps(), initialTab: 'screen' }} />);
    expect(screen.getByText(/One item at a time/)).toBeTruthy();
    expect(screen.queryByLabelText('Seconds per item')).toBeNull();
    expect(screen.getByText('Explain corrections to the counter')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: "Tonight's check-in counter" }));
    expect(screen.queryByText('Explain corrections to the counter')).toBeNull();
  });

  it('the milestone hint stops advertising a toast when milestones are off', () => {
    render(<SettingsPanel {...{ ...happyProps(), initialTab: 'celebrations' }} />);
    expect(screen.getByText(/Every 25 check-ins/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Room milestone (every N check-ins)'), { target: { value: '0' } });
    expect(screen.getByText(/Milestone celebrations are off/)).toBeTruthy();
  });

  it('club phrases apply through the same sanitizer as an import', () => {
    const props = happyProps();
    render(<SettingsPanel {...props} />);
    const club = getAllClubs()[0];
    typeAndLeave(screen.getByLabelText(`${club} phrase`), '  Bring it!  ');
    const patch = props.onChange.mock.calls[0][0];
    expect(Object.keys(patch)).toEqual(['clubPhrases']);
    expect(patch.clubPhrases[club.toLowerCase()]).toBe('  Bring it!  '); // trimmed by sanitizeClubPhrases in useConfig
  });

  it('toggle titles are clickable labels with an accessible name', () => {
    render(<SettingsPanel {...{ ...happyProps(), initialTab: 'screen' }} />);
    const box = screen.getByRole('checkbox', { name: 'Play a chime with each welcome' });
    expect(box.checked).toBe(false);
    fireEvent.click(screen.getByText('Play a chime with each welcome'));
    expect(box.checked).toBe(true);
  });

  it('the pickup board is its own section and keeps its guard copy', () => {
    render(<SettingsPanel {...{ ...happyProps(), initialTab: 'pickup' }} />);
    expect(screen.getByLabelText("Who's still here board").value).toBe('off');
    expect(screen.queryByLabelText('Stop showing names at or below')).toBeNull();
    fireEvent.change(screen.getByLabelText("Who's still here board"), { target: { value: 'pickup' } });
    expect(screen.getByText(/This is the setting that matters/)).toBeTruthy();
  });

  it("follow-the-printer's-season only shows while the skin is Auto", () => {
    render(<SettingsPanel {...{ ...happyProps(), initialTab: 'look' }} />);
    expect(screen.queryByText("Follow the printer's season")).toBeNull();
    fireEvent.change(screen.getByLabelText('Themed night skin'), { target: { value: 'auto' } });
    expect(screen.getByText("Follow the printer's season")).toBeTruthy();
  });
});

describe('Setup: tools', () => {
  it('Import refuses a file with no display settings', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const props = happyProps();
    render(<SettingsPanel {...{ ...props, initialTab: 'setup' }} />);
    expect(screen.getByRole('button', { name: 'Import settings' })).toBeTruthy();
    const file = new File(['[{"text":"a slide"}]'], 'awana-slides.json', { type: 'application/json' });
    fireEvent.change(screen.getByTestId('import-settings-file'), { target: { files: [file] } });
    await waitFor(() => expect(alert).toHaveBeenCalledWith(expect.stringMatching(/no display settings/)));
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it('Import merges the recognised keys and reports the real count', async () => {
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const props = happyProps();
    render(<SettingsPanel {...props} />);
    const file = new File(['{"nightTheme":"christmas","bogus":1}'], 'settings.json', { type: 'application/json' });
    fireEvent.change(screen.getByTestId('import-settings-file'), { target: { files: [file] } });
    await waitFor(() => expect(props.onChange).toHaveBeenCalledWith({ nightTheme: 'christmas' }));
    expect(window.alert).toHaveBeenCalledWith(expect.stringMatching(/^Imported 1 setting\./));
    expect(props.onReset).not.toHaveBeenCalled();
  });

  it('Export writes what differs from the baked defaults, changes made in the panel included', async () => {
    let captured = null;
    URL.createObjectURL = vi.fn((blob) => { captured = blob; return 'blob:x'; });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const props = happyProps();
    props.savedConfig = { ...defaults, audioMuted: true, nightTheme: 'christmas', weatherLat: 10 };
    props.config = { ...props.savedConfig, pusherAppKey: 'from-url-flag' };
    render(<SettingsPanel {...props} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'First arrival of the night' }));
    section('Setup');
    fireEvent.click(screen.getByRole('button', { name: 'Export settings' }));
    const text = await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.readAsText(captured);
    });
    expect(JSON.parse(text)).toEqual({ nightTheme: 'christmas', weatherLat: 10, firstArrivalMoment: false });
    expect(text).not.toContain(FAKE_KEY);
    expect(text).not.toContain('from-url-flag');
  });

  it('both resets ask first and say what they do', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const props = happyProps();
    render(<SettingsPanel {...{ ...props, initialTab: 'setup' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reset tonight’s counter' }));
    expect(confirm).toHaveBeenLastCalledWith(expect.stringMatching(/Doors are open/));
    expect(props.onResetTally).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reset this screen' }));
    expect(confirm).toHaveBeenLastCalledWith(expect.stringMatching(/typed slides.*login, keys/s));
    expect(props.onReset).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Reset this screen' }));
    expect(props.onReset).toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalled();
  });

  it('links the Windows installer and its guide', () => {
    render(<SettingsPanel {...{ ...happyProps(), initialTab: 'setup' }} />);
    const download = screen.getByRole('link', { name: 'Download for Windows' });
    expect(download.getAttribute('href')).toBe('https://awana.kvbchurch.org/download/lobby-display');
    const guide = screen.getByRole('link', { name: 'Setup guide' });
    expect(guide.getAttribute('href')).toBe('https://github.com/patrick-simpson/kvbcawana/blob/main/lobby/desktop/README.md');
    // Out to a new tab: the lobby page itself never navigates away.
    for (const a of [download, guide]) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toContain('noopener');
    }
  });
});

describe('Status: other screens', () => {
  it('links the projector on game time and Journey, each in a new tab', () => {
    render(<SettingsPanel {...{ ...happyProps(), initialTab: 'status' }} />);
    const projector = screen.getByRole('link', { name: 'Projector: game time' });
    expect(projector.getAttribute('href')).toBe('https://awana.kvbchurch.org/lobby/countdown?view=game');
    const journey = screen.getByRole('link', { name: 'Journey' });
    expect(journey.getAttribute('href')).toBe('https://awana.kvbchurch.org/journey/');
    for (const a of [projector, journey]) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toContain('noopener');
    }
  });
});

describe('Pickup board', () => {
  const open = (extra = {}) => {
    const props = { ...happyProps(), initialTab: 'pickup', onBoardDemo: vi.fn(), ...extra };
    props.config = { ...defaults, audioMuted: true, checkoutBoardMode: 'pickup' };
    render(<SettingsPanel {...props} />);
    return props;
  };

  it('shows the pickup window, 7:35 to 8:30 pm unless changed, and applies a new time when the field is left', () => {
    const props = open();
    const from = screen.getByLabelText('Show from');
    expect(from.value).toBe('19:35');
    expect(screen.getByLabelText('Hide after').value).toBe('20:30');
    typeAndLeave(from, '19:45');
    expect(props.onChange).toHaveBeenLastCalledWith({ checkoutBoardFrom: '19:45' });
    // A cleared time falls back to the default rather than writing junk.
    typeAndLeave(from, '');
    expect(props.onChange).toHaveBeenLastCalledWith({ checkoutBoardFrom: '19:35' });
  });

  it('the corner countdown is on by default and a switch away', () => {
    const props = open();
    const box = screen.getByRole('checkbox', { name: 'Count down in the corner during pickup' });
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(props.onChange).toHaveBeenCalledWith({ cornerStillHere: false });
  });

  it('previews the columns on sample names, and follows the naming guard as it changes', () => {
    open();
    const preview = screen.getByRole('img', { name: /preview of the pickup board/ });
    expect(preview.querySelectorAll('.checkout-column').length).toBe(6);
    expect(preview.querySelector('.checkout-demo')).toBeTruthy();
    expect(preview.textContent).toMatch(/Sample Sam/);
    fireEvent.change(screen.getByLabelText('Stop showing names at or below'), { target: { value: '50' } });
    expect(preview.querySelector('.checkout-column')).toBeNull();
    expect(preview.textContent).toMatch(/Almost everyone has been picked up/);
  });

  it('Show a demo on this TV hands over to the screen', () => {
    const props = open();
    fireEvent.click(screen.getByRole('button', { name: /Show a demo on this TV/ }));
    expect(props.onBoardDemo).toHaveBeenCalled();
  });

  it('with the board off only the mode is asked, but the preview still shows what it would look like', () => {
    const props = { ...happyProps(), initialTab: 'pickup' };
    render(<SettingsPanel {...props} />);
    expect(screen.queryByLabelText('Show from')).toBeNull();
    expect(screen.getByRole('img', { name: /preview of the pickup board/ })).toBeTruthy();
  });
});

describe('shared settings (contract v6)', () => {
  const open = (extra = {}) => {
    const props = { ...happyProps(), onShare: vi.fn(), ...extra };
    render(<SettingsPanel {...props} />);
    return props;
  };

  it('a shared change goes to every screen with this screen’s whole shared set; a per-screen one never does', () => {
    const props = open();
    fireEvent.click(screen.getByRole('checkbox', { name: 'First arrival of the night' }));
    expect(props.onShare).toHaveBeenCalledTimes(1);
    const sent = props.onShare.mock.calls[0][0];
    expect(sent.firstArrivalMoment).toBe(false);
    expect(sent.milestoneEvery).toBe(25);
    expect('backgroundSource' in sent).toBe(false);
    section('Screen & corner');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Reduce motion on this screen' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Play a chime with each welcome' }));
    expect(props.onShare).toHaveBeenCalledTimes(1);
  });

  it('a screen that does not follow keeps its changes to itself', () => {
    const props = { ...happyProps(), onShare: vi.fn() };
    props.config = { ...defaults, audioMuted: true, followSharedSettings: false };
    render(<SettingsPanel {...props} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'First arrival of the night' }));
    expect(props.onChange).toHaveBeenCalled();
    expect(props.onShare).not.toHaveBeenCalled();
    // And its tags say so.
    expect(screen.queryByText('Every screen')).toBeNull();
  });

  it('Undo sends the opening shared values back out', () => {
    const props = open();
    fireEvent.click(screen.getByRole('checkbox', { name: 'First arrival of the night' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo changes' }));
    expect(props.onShare).toHaveBeenCalledTimes(2);
    expect(props.onShare.mock.calls[1][0].firstArrivalMoment).toBe(true);
  });

  it('every card says where its settings apply', () => {
    open({ initialTab: 'screen' });
    const tags = [...document.querySelectorAll('.panel-card__head')].map((h) => [h.textContent.replace(/(Every screen|This screen)$/, ''), h.querySelector('.scope-tag')?.textContent]);
    expect(tags).toEqual([
      ['Simplified mode', 'This screen'],
      ['Corner', 'Every screen'],
      ['Weather', 'Every screen'],
      ['This TV', 'This screen'],
    ]);
  });

  it('Setup shows what the screen follows, and can send its own set now', () => {
    const props = open({
      initialTab: 'setup',
      shared: { rev: 4, publishedAt: '2026-10-01T23:35:00.000Z', settings: {} },
      shareStatus: { state: 'failed', message: 'Could not reach the print server from this screen' },
    });
    expect(screen.getByText(/Following update 4/)).toBeTruthy();
    expect(screen.getAllByText(/Could not reach the print server from this screen/).length).toBeGreaterThan(0);
    expect(screen.getByText(/This screen only \(see Setup → Shared settings\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Send this screen’s shared settings to every screen/ }));
    expect(props.onShare).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Follow the shared settings' }));
    expect(props.onChange).toHaveBeenCalledWith({ followSharedSettings: false });
  });

  it('the footer says when a change has gone to every screen', () => {
    open({ shareStatus: { state: 'sent', rev: 5 } });
    expect(screen.getByText('Sent to every screen.')).toBeTruthy();
  });
});
