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
  loginStatus: 'logged-out',
  kid: null,
  hasLoginKey: false,
  login: vi.fn(async () => 'wrong'),
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
    loginStatus: 'logged-out', kid: null, hasLoginKey: false,
  });
  loginState.login.mockReset().mockImplementation(async () => 'wrong');
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
/** A screen that works: connected and keyed, so it opens on What screens show. */
const happyProps = () => {
  saveDisplayKey(FAKE_KEY);
  return { ...baseProps(), status: 'connected' };
};

// A TV's own panel (the settings page lists all eight: SettingsPanel.rail.test.jsx).
const SECTION_NAMES = ['Tonight', 'What screens show', 'Slides & look', 'Account & app'];

describe('SettingsPanel: the two-pane shell', () => {
  it('lists the four TV sections in order, as a vertical tab list', () => {
    render(<SettingsPanel {...happyProps()} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.querySelector('.settings-nav__label').textContent)).toEqual(SECTION_NAMES);
    expect(screen.getByRole('tablist').getAttribute('aria-orientation')).toBe('vertical');
    // Each name is the label alone; the blurb describes it.
    for (const name of SECTION_NAMES) expect(screen.getByRole('tab', { name })).toBeTruthy();
  });

  it('a working screen opens on What screens show, with focus on its rail item', () => {
    render(<SettingsPanel {...happyProps()} />);
    const tab = screen.getByRole('tab', { name: 'What screens show' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab);
    expect(screen.getByLabelText('How long each name stays up (seconds)')).toBeTruthy();
  });

  it('an unconfigured screen opens on Account & app, with the passphrase to type and no key or token to paste', () => {
    const { container } = render(<SettingsPanel {...baseProps()} />);
    expect(screen.getByRole('tab', { name: 'Account & app' }).getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('details.advanced-fields summary')?.textContent).not.toMatch(/paste keys by hand/);
    // Pusher is gone, and so are the display login, the display key and the publish token.
    expect(screen.queryByLabelText('Pusher App Key')).toBeNull();
    expect(screen.queryByLabelText('Display key')).toBeNull();
    expect(screen.queryByLabelText('Display login')).toBeNull();
    expect(screen.queryByText(/Publish token/i)).toBeNull();
    expect(screen.getByLabelText('Passphrase')).toBeTruthy();
  });

  it('a working screen with a problem opens on Tonight and counts it on the rail', () => {
    render(<SettingsPanel {...{ ...happyProps(), opsFailures: [{ club: 'Sparks', at: Date.now() }] }} />);
    const tab = screen.getByRole('tab', { name: 'Tonight' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(tab.querySelector('.settings-nav__badge').textContent).toBe('1');
    expect(screen.getByText(/The printer reported 1 problem tonight/)).toBeTruthy();
  });

  it('opens on a requested section, old tab ids included', () => {
    const { unmount } = render(<SettingsPanel {...{ ...happyProps(), initialTab: 'background' }} />);
    expect(screen.getByRole('tab', { name: 'Slides & look' }).getAttribute('aria-selected')).toBe('true');
    unmount();
    render(<SettingsPanel {...{ ...happyProps(), initialTab: 'pickup', onTabChange: vi.fn() }} />);
    expect(screen.getByRole('tab', { name: 'What screens show' }).getAttribute('aria-selected')).toBe('true');
  });

  it('switches sections on click and reports the change', () => {
    const props = { ...happyProps(), onTabChange: vi.fn() };
    render(<SettingsPanel {...props} />);
    section('Slides & look');
    expect(screen.getByLabelText('Calendar page URL')).toBeTruthy();
    expect(screen.queryByLabelText('How long each name stays up (seconds)')).toBeNull();
    expect(props.onTabChange).toHaveBeenCalledWith('look');
  });

  it('moves along the rail with Up/Down (and Left/Right), Home and End', () => {
    render(<SettingsPanel {...happyProps()} />);
    const selected = () => screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true')
      .querySelector('.settings-nav__label').textContent;
    fireEvent.keyDown(screen.getByRole('tab', { name: 'What screens show' }), { key: 'ArrowDown' });
    expect(selected()).toBe('Slides & look');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Slides & look' }));
    fireEvent.keyDown(document.activeElement, { key: 'ArrowUp' });
    fireEvent.keyDown(document.activeElement, { key: 'ArrowLeft' });
    expect(selected()).toBe('Tonight');
    fireEvent.keyDown(document.activeElement, { key: 'End' });
    expect(selected()).toBe('Account & app');
    fireEvent.keyDown(document.activeElement, { key: 'ArrowRight' });
    expect(selected()).toBe('Tonight');
    fireEvent.keyDown(document.activeElement, { key: 'Home' });
    expect(selected()).toBe('Tonight');
  });

  it('a phone sees the list first, and a tap opens the section with a way back', () => {
    const { container } = render(<SettingsPanel {...happyProps()} />);
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog.dataset.view).toBe('list');
    section('Slides & look');
    expect(dialog.dataset.view).toBe('section');
    fireEvent.click(screen.getByRole('button', { name: 'Back to all settings' }));
    expect(dialog.dataset.view).toBe('list');
  });

  it('a requested section opens straight on it on a phone too', () => {
    const { container } = render(<SettingsPanel {...{ ...baseProps(), initialTab: 'account' }} />);
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
    section('Slides & look');
    const url = screen.getByLabelText('Calendar page URL');
    fireEvent.change(url, { target: { value: 'https://example.org/calendar' } });
    expect(props.onChange).not.toHaveBeenCalled();
    fireEvent.blur(url);
    expect(props.onChange).toHaveBeenCalledWith({ calendarUrl: 'https://example.org/calendar' });
  });

  it('Enter in a typed field applies it too', () => {
    const props = baseProps();
    render(<SettingsPanel {...props} />);
    section('What screens show');
    const std = screen.getByLabelText('How long each name stays up (seconds)');
    fireEvent.change(std, { target: { value: '7' } });
    fireEvent.keyDown(std, { key: 'Enter' });
    expect(props.onChange).toHaveBeenCalledWith({ standardDisplayMs: 7000 });
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
    section('What screens show');
    fireEvent.change(screen.getByLabelText('How long each name stays up (seconds)'), { target: { value: '7' } });
    clickDone();
    expect(props.onChange).toHaveBeenCalledWith({ standardDisplayMs: 7000 });
    expect(props.onClose).toHaveBeenCalled();
  });

  it('an untouched panel writes nothing — a baked key or fleet value is never pinned', () => {
    const props = baseProps();
    props.config = { ...defaults, standardDisplayMs: 9000, audioMuted: true };
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
    section('What screens show');
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
    for (const [label, cb, where] of [['Preview a check-in', 'onTest', 'What screens show'], ['Debug panel', 'onOpenDebug', 'Account & app'], [/Edit slides/, 'onOpenSlideEditor', 'Slides & look']]) {
      const props = happyProps();
      render(<SettingsPanel {...props} />);
      section('What screens show');
      fireEvent.change(screen.getByLabelText('Room milestone (every N check-ins)'), { target: { value: '40' } });
      section(where);
      // Leaving What screens show unmounts the field without a blur: the pending
      // value is still applied before the action runs.
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(props.onChange).toHaveBeenCalledWith({ milestoneEvery: 40 });
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
  it('names the church sign-in and what the screen can read', () => {
    render(<SettingsPanel {...{ ...happyProps(), initialTab: 'status' }} />);
    expect(screen.getByText('Connected — check-ins will appear instantly')).toBeTruthy();
    expect(screen.getByText(/Church sign-in:/)).toBeTruthy();
    expect(screen.queryByText(/Display login|display key pasted by hand/)).toBeNull();
    expect(screen.getByText(/this screen can read encrypted names/)).toBeTruthy();
  });

  it('a connected but unkeyed screen is told to sign in, with a jump to Account & app', () => {
    render(<SettingsPanel {...{ ...baseProps(), status: 'connected', nameStatus: 'no-key', initialTab: 'status' }} />);
    expect(screen.getByText('Connected — not signed in yet (Account & app → Sign in)')).toBeTruthy();
    expect(screen.getByText(/encrypted names are arriving but this screen has no key/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Set up this screen/ }));
    expect(screen.getByRole('tab', { name: 'Account & app' }).getAttribute('aria-selected')).toBe('true');
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
    expect(screen.getByRole('tab', { name: 'Tonight' }).querySelector('.settings-nav__badge').textContent).toBe('3');
  });

  it('keeps the trademark line', () => {
    render(<SettingsPanel {...{ ...happyProps(), initialTab: 'account' }} />);
    expect(screen.getByText(/NOT AFFILIATED OR ENDORSED BY/)).toBeTruthy();
  });
});

describe('Account & app: connecting this screen', () => {
  it('a screen that is not connected is told to sign in with the passphrase', () => {
    render(<SettingsPanel {...baseProps()} />);
    expect(screen.getByText(/Type the church.s passphrase/)).toBeTruthy();
  });

  it('the passphrase box is typeable before any frame arrives and Sign in enables on text', () => {
    const props = { ...baseProps(), status: 'connected' };
    render(<SettingsPanel {...props} />);
    const input = screen.getByLabelText('Passphrase');
    expect(input.disabled).toBe(false);
    const button = screen.getByRole('button', { name: 'Sign in' });
    expect(button.disabled).toBe(true);
    fireEvent.change(input, { target: { value: 'abcd-efgh-ijkm-npqr' } });
    expect(button.disabled).toBe(false);
    // The passphrase is never config.
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it('Show reveals the passphrase', () => {
    render(<SettingsPanel {...{ ...baseProps(), status: 'connected' }} />);
    const input = screen.getByLabelText('Passphrase');
    expect(input.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Show passphrase' }));
    expect(input.type).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: 'Hide passphrase' }));
    expect(input.type).toBe('password');
  });

  it('without secure crypto nothing pretends a pasted key would help', () => {
    vi.stubGlobal('crypto', {});
    render(<SettingsPanel {...{ ...baseProps(), status: 'connected' }} />);
    expect(screen.getByRole('tab', { name: 'Account & app' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByText(/not in a secure context/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Paste key' })).toBeNull();
    expect(screen.getByLabelText('Passphrase').disabled).toBe(true);
    vi.unstubAllGlobals();
  });

  it('the removed controls are gone: no display login, key fold, publish token, cloud card or Club Label Printer', () => {
    render(<SettingsPanel {...{ ...baseProps(), status: 'connected', initialTab: 'account' }} />);
    for (const gone of [/Display login/, /Display key/, /Publish token/, /Paste key/, /Club Label Printer/, /Being built to replace the check-in laptop/]) {
      expect(screen.queryByText(gone)).toBeNull();
      expect(screen.queryByLabelText(gone)).toBeNull();
    }
    expect(screen.queryByRole('heading', { name: /Publishing slides|Cloud check-in/ })).toBeNull();
    expect(screen.getByRole('heading', { name: 'KVBC Awana release notes' })).toBeTruthy();
  });
});

describe('Slides & look', () => {
  const open = (props = happyProps()) => { render(<SettingsPanel {...{ ...props, initialTab: 'look' }} />); return props; };

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
    const promos = screen.getByLabelText('Season promos');
    expect(promos.checked).toBe(true);
    fireEvent.click(promos);
    expect(props.onChange).toHaveBeenCalledWith({ seasonPromos: false });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Calendar-aware slides' }));
    expect(screen.queryByLabelText('Welcome slide')).toBeNull();
    vi.useRealTimers();
  });

  it('the promos toggle stays through the snow season and names what it switches', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-01T12:00:00'));
    open();
    expect(screen.getByLabelText('Season promos')).toBeTruthy();
    expect(screen.getByText(/snow-alerts sign-up/)).toBeTruthy();
    expect(screen.queryByText(/Poster Contest/)).toBeNull();
    vi.useRealTimers();
  });

  it('after both seasons the promos toggle leaves the page', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-06-01T12:00:00'));
    open();
    expect(screen.queryByLabelText('Season promos')).toBeNull();
    vi.useRealTimers();
  });

  it('published-slide hints on Tonight lead with signing in', () => {
    render(<SettingsPanel {...{ ...baseProps(), status: 'connected', initialTab: 'status' }} />);
    expect(screen.getByText(/type the church passphrase under Account & app/)).toBeTruthy();
    expect(screen.queryByText(/Advanced|display key by hand/)).toBeNull();
  });
});

describe('What screens show, Slides & look', () => {
  it('confetti and reduce motion sit together on What screens show', () => {
    const props = happyProps();
    render(<SettingsPanel {...props} />);
    section('What screens show');
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

  it('the pickup board is its own section, with no switch or times, and keeps its guard copy', () => {
    render(<SettingsPanel {...{ ...happyProps(), initialTab: 'pickup' }} />);
    // It comes on by itself at 7:30 pm (owner, 2026-10-08).
    expect(screen.queryByLabelText("Who's still here board")).toBeNull();
    expect(screen.queryByLabelText('Show from')).toBeNull();
    expect(screen.queryByLabelText('Hide after')).toBeNull();
    expect(screen.getByText(/Shows by itself from 7:30 pm on club nights\. Which clubs are on the list is set under Printing → Pickup list\./)).toBeTruthy();
    expect(screen.queryByText(/dashboard/i)).toBeNull();
    expect(screen.getByLabelText('Stop showing names at or below')).toBeTruthy();
    expect(screen.getByText(/This is the setting that matters/)).toBeTruthy();
  });
});

describe('Account & app: tools', () => {
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
    props.config = { ...props.savedConfig, reduceMotion: true };   // what a URL flag (?lowPower=1) layers on
    render(<SettingsPanel {...props} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'First arrival of the night' }));
    section('Account & app');
    fireEvent.click(screen.getByRole('button', { name: 'Export settings' }));
    const text = await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.readAsText(captured);
    });
    expect(JSON.parse(text)).toEqual({ nightTheme: 'christmas', weatherLat: 10, firstArrivalMoment: false });
    expect(text).not.toContain(FAKE_KEY);
    expect(text).not.toContain('reduceMotion');
  });

  it('both resets ask first and say what they do', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const props = happyProps();
    render(<SettingsPanel {...{ ...props, initialTab: 'setup' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reset tonight’s counter' }));
    expect(confirm).toHaveBeenLastCalledWith(expect.stringMatching(/Doors are open/));
    expect(props.onResetTally).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reset this screen' }));
    expect(confirm).toHaveBeenLastCalledWith(expect.stringMatching(/typed slides.*sign-in, keys/s));
    expect(props.onReset).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Reset this screen' }));
    expect(props.onReset).toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalled();
  });

  it('links the KVBC Awana installer (the one app, v9), never the sound room app\'s', () => {
    render(<SettingsPanel {...{ ...happyProps(), initialTab: 'setup' }} />);
    expect(screen.getByRole('heading', { name: 'KVBC Awana for Windows' })).toBeTruthy();
    const download = screen.getByRole('link', { name: 'Download for Windows' });
    expect(download.getAttribute('href')).toBe('https://awana.kvbchurch.org/download/kvbc-awana');
    expect(screen.queryByRole('link', { name: 'Setup guide' })).toBeNull();
    // Out to a new tab: the lobby page itself never navigates away.
    expect(download.getAttribute('target')).toBe('_blank');
    expect(download.getAttribute('rel')).toContain('noopener');
  });
});

describe('Status: the Other screens links are gone', () => {
  it('shows no projector or Journey links (the Screens section and the website own them)', () => {
    render(<SettingsPanel {...{ ...happyProps(), initialTab: 'status' }} />);
    expect(screen.queryByRole('link', { name: 'Projector: game time' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Journey' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Other screens' })).toBeNull();
  });
});

describe('Screen & corner: the club count', () => {
  it('This TV offers None or one club, and a pick is this screen\'s own', () => {
    const props = { ...happyProps(), initialTab: 'display', onChange: vi.fn() };
    render(<SettingsPanel {...props} />);
    const select = screen.getByLabelText('Club count (upper right)');
    expect(select.value).toBe('');
    expect([...select.options].map((o) => o.value)).toEqual(['', 'puggles', 'cubbies', 'sparks', 'tnt', 'trek', 'journey']);
    expect([...select.options].map((o) => o.textContent)).toContain('T&T');
    fireEvent.change(select, { target: { value: 'tnt' } });
    expect(props.onChange).toHaveBeenLastCalledWith({ cornerClub: 'tnt' });
  });
});

describe('Pickup board', () => {
  const open = (extra = {}) => {
    const props = { ...happyProps(), initialTab: 'pickup', onBoardDemo: vi.fn(), ...extra };
    // An old screen's saved mode and window ride along, and are ignored.
    props.config = { ...defaults, audioMuted: true, checkoutBoardMode: 'pickup', checkoutBoardFrom: '19:35' };
    render(<SettingsPanel {...props} />);
    return props;
  };

  it('an old saved mode or window is never written back', () => {
    const props = open();
    typeAndLeave(screen.getByLabelText('Stop showing names at or below'), '5');
    expect(props.onChange).toHaveBeenLastCalledWith({ checkoutBoardNamesAbove: 5 });
    for (const call of props.onChange.mock.calls) {
      for (const key of ['checkoutBoardMode', 'checkoutBoardFrom', 'checkoutBoardUntil']) expect(call[0]).not.toHaveProperty(key);
    }
  });

  it('the corner countdown is on by default and a switch away', () => {
    const props = open();
    const box = screen.getByRole('checkbox', { name: 'Count down in the corner during pickup' });
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(props.onChange).toHaveBeenCalledWith({ cornerStillHere: false });
  });

  it('previews the board in the foot on sample names, and follows the naming guard as it changes', () => {
    open();
    const preview = screen.getByRole('img', { name: /preview of the pickup board/ });
    expect(preview.querySelectorAll('.checkout-board--list .checkout-club').length).toBe(6);
    expect(preview.querySelector('.checkout-demo')).toBeTruthy();
    expect(preview.textContent).toMatch(/Sample Sam/);
    fireEvent.change(screen.getByLabelText('Stop showing names at or below'), { target: { value: '50' } });
    expect(preview.querySelector('.checkout-club')).toBeNull();
    expect(preview.textContent).toMatch(/Almost everyone has been picked up/);
  });

  it('Show a demo on this TV hands over to the screen', () => {
    const props = open();
    fireEvent.click(screen.getByRole('button', { name: /Show a demo on this TV/ }));
    expect(props.onBoardDemo).toHaveBeenCalled();
  });

  it('the preview is always there, on sample names', () => {
    const props = { ...happyProps(), initialTab: 'pickup' };
    render(<SettingsPanel {...props} />);
    expect(screen.getByRole('img', { name: /preview of the pickup board/ })).toBeTruthy();
  });
});

describe('Preview the promos', () => {
  it('lists every promo, and a click hands that one to the screen', () => {
    const props = { ...happyProps(), initialTab: 'slides', onPreviewPromo: vi.fn() };
    render(<SettingsPanel {...props} />);
    const names = ['Poster contest', 'BARF Night', 'BARF Night: slime cut', 'Parents’ Night', 'Poster finalists: vote', 'Snow alerts', 'Snow alerts: snow week'];
    for (const n of names) expect(screen.getByRole('button', { name: n })).toBeTruthy();
    // It is the first card in Slides, the fall posters grouped apart from the snow slide.
    expect(document.querySelector('.panel-body .panel-card .section').textContent).toBe('Preview the promos');
    const fall = screen.getByRole('group', { name: 'Fall posters' });
    expect([...fall.querySelectorAll('button')].map((b) => b.textContent)).toEqual(names.slice(0, 5));
    fireEvent.click(screen.getByRole('button', { name: 'Snow alerts: snow week' }));
    expect(props.onPreviewPromo).toHaveBeenCalledWith('snowAlertsStorm');
    fireEvent.click(screen.getByRole('button', { name: 'Poster contest' }));
    expect(props.onPreviewPromo).toHaveBeenLastCalledWith('contest');
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
    section('What screens show');
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
    open({ initialTab: 'show' });
    const tags = [...document.querySelectorAll('.panel-card__head')].map((h) => [h.textContent.replace(/(Every screen|This screen)$/, ''), h.querySelector('.scope-tag')?.textContent]);
    expect(tags).toEqual([
      ['Simplified mode', 'This screen'],
      ['Welcome banners', 'Every screen'],
      ['Welcome extras', 'Every screen'],
      ['Club lines', 'Every screen'],
      ['Celebrations', 'Every screen'],
      ['Pickup board', 'Every screen'],
      ['Preview', undefined],
      ['Corner', 'Every screen'],
      ['This TV', 'This screen'],
    ]);
  });

  it('Setup shows what the screen follows, and can send its own set now', () => {
    const props = open({
      initialTab: 'account',
      shared: { rev: 4, publishedAt: '2026-10-01T23:35:00.000Z', settings: {} },
      shareStatus: { state: 'failed', message: 'Could not reach the check-in laptop from this screen' },
    });
    expect(screen.getByText(/Following update 4/)).toBeTruthy();
    expect(screen.getAllByText(/Could not reach the check-in laptop from this screen/).length).toBeGreaterThan(0);
    expect(screen.getByText(/This screen only \(see Account & app → Church-wide settings\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Send this screen’s church-wide settings to every screen/ }));
    expect(props.onShare).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Follow the church-wide settings' }));
    expect(props.onChange).toHaveBeenCalledWith({ followSharedSettings: false });
  });

  it('the footer says when a change has gone to every screen', () => {
    open({ shareStatus: { state: 'sent', rev: 5 } });
    expect(screen.getByText('Sent to every screen.')).toBeTruthy();
  });
});
