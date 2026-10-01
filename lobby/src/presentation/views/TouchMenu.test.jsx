import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React, { useState } from 'react';

// The operator menu on a phone or tablet: a visible button, a full-screen
// sheet with the hover menu's items, sized for a finger. The hover menu
// itself is App's choice (TouchMenu replaces it on touch; e2e/touch.spec.js
// proves the hover panel is gone from a touch page).

const drift = vi.hoisted(() => ({ skewMs: null }));
vi.mock('../hooks/useClockDrift.js', () => ({ useClockDrift: () => drift.skewMs }));
vi.mock('../hooks/useBirthdays.js', () => ({ useBirthdays: () => [], clearBirthdays: vi.fn() }));
const stingers = vi.hoisted(() => ({ on: false }));
vi.mock('../lib/stingers.js', () => ({
  stingersEnabled: () => stingers.on,
  setStingersEnabled: vi.fn((on) => { stingers.on = on; }),
  subscribeStingers: () => () => {},
  unlockStingers: vi.fn(),
}));

const { TouchMenu } = await import('./TouchMenu.jsx');
const { setStingersEnabled, unlockStingers } = await import('../lib/stingers.js');

const NOW = new Date('2026-09-30T18:07:15');
const STATE = { mode: 'COUNTDOWN', target: new Date('2026-10-07T18:00:00') };

/** TouchMenu with App's open state around it, and spies for every pick. */
function Harness({ onSelect, onResume, isOverride = false, displayOpen = false }) {
  const [open, setOpen] = useState(false);
  return (
    <TouchMenu
      now={NOW}
      state={STATE}
      isOverride={isOverride}
      onSelect={onSelect}
      onResume={onResume}
      socketStatus="off"
      open={open}
      displayOpen={displayOpen}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
    />
  );
}

const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Open the menu' }));
const sheet = () => screen.queryByRole('dialog', { name: 'Projector menu' });

beforeEach(() => {
  drift.skewMs = null;
  stingers.on = false;
  localStorage.clear();
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('the touch menu', () => {
  it('is a visible button until tapped, then a full-screen sheet with the hover menu\'s items', () => {
    render(<Harness onSelect={vi.fn()} onResume={vi.fn()} />);
    expect(sheet()).toBeNull();
    openMenu();
    const s = within(sheet());
    for (const name of ['Main Countdown', 'Opening Ceremony', 'T&T Game Time', 'Sparks Game Time', 'Puggles & Cubbies Game Time', 'Closing', 'Shutdown']) {
      expect(s.getByRole('button', { name })).toBeTruthy();
    }
    expect(s.getByRole('button', { name: /Skip Weeks/ })).toBeTruthy();
    expect(s.getByText(/Birthdays sync from check-in/)).toBeTruthy();
    expect(s.getByRole('switch', { name: /Low power mode/ })).toBeTruthy();
    expect(s.getByRole('switch', { name: /Countdown sounds/ })).toBeTruthy();
    expect(s.getByRole('button', { name: /Display Settings/ })).toBeTruthy();
    // The one it is on is marked, as the hover menu marks it.
    expect(s.getByRole('button', { name: 'Main Countdown' }).getAttribute('aria-current')).toBe('true');
  });

  it('a pick changes the wall and closes the sheet, so the phone shows what it picked', () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} onResume={vi.fn()} />);
    openMenu();
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Opening Ceremony' }));
    expect(onSelect).toHaveBeenCalledWith({ type: 'window', index: 0 });
    expect(sheet()).toBeNull();
    openMenu();
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Main Countdown' }));
    expect(onSelect).toHaveBeenLastCalledWith({ type: 'countdown' });
    expect(sheet()).toBeNull();
  });

  it('offers Resume Schedule only while a pick is holding the wall', () => {
    const onResume = vi.fn();
    const { unmount } = render(<Harness onSelect={vi.fn()} onResume={onResume} />);
    openMenu();
    expect(within(sheet()).queryByRole('button', { name: 'Resume Schedule' })).toBeNull();
    unmount();
    render(<Harness onSelect={vi.fn()} onResume={onResume} isOverride />);
    openMenu();
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Resume Schedule' }));
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(sheet()).toBeNull();
  });

  it('writes the hover menu\'s tooltips out, since a finger cannot hover', () => {
    render(<Harness onSelect={vi.fn()} onResume={vi.fn()} />);
    openMenu();
    const s = within(sheet());
    expect(s.getByText('Hides particle / weather layers for weak hardware')).toBeTruthy();
    expect(s.getByText('Chimes at 1hr/30/10/5/1min — off by default')).toBeTruthy();
    expect(sheet().querySelector('[title]')).toBeNull();
  });

  it('wakes the chimes\' audio inside the tap that arms them', () => {
    render(<Harness onSelect={vi.fn()} onResume={vi.fn()} />);
    openMenu();
    const sounds = within(sheet()).getByRole('switch', { name: /Countdown sounds/ });
    expect(sounds.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sounds);
    expect(setStingersEnabled).toHaveBeenCalledWith(true);
    expect(unlockStingers).toHaveBeenCalledTimes(1);
  });

  it('opens straight onto Display Settings for the setup note, with phone-safe fields in real forms', () => {
    render(<Harness onSelect={vi.fn()} onResume={vi.fn()} displayOpen />);
    openMenu();
    const pass = within(sheet()).getByLabelText('Display passphrase');
    expect(pass.getAttribute('enterkeyhint')).toBe('go');
    expect(pass.getAttribute('autocapitalize')).toBe('none');
    expect(pass.closest('form')).not.toBeNull();
    expect(pass.className).toMatch(/pj-sheet__input/);
    // With no live-data key yet the by-hand fold is open, as on the PC.
    expect(within(sheet()).getByLabelText('Pusher app key').closest('form')).not.toBeNull();
    expect(within(sheet()).getByLabelText('Display key').closest('form')).not.toBeNull();
    // Every control in a form that is not its submit says so, or a tap on "Show" would submit.
    for (const b of sheet().querySelectorAll('form button')) expect(['button', 'submit']).toContain(b.getAttribute('type'));
  });

  it('owns the keyboard while open: no key reaches the wall, typing still works, Escape closes it', () => {
    const wall = vi.fn();
    window.addEventListener('keydown', wall);
    try {
      render(<Harness onSelect={vi.fn()} onResume={vi.fn()} displayOpen />);
      fireEvent.keyDown(document.body, { key: ' ', code: 'Space' });
      expect(wall).toHaveBeenCalledTimes(1);
      openMenu();
      fireEvent.keyDown(document.body, { key: ' ', code: 'Space' });
      fireEvent.keyDown(document.body, { key: 'b', code: 'KeyB' });
      const pass = within(sheet()).getByLabelText('Display passphrase');
      fireEvent.keyDown(pass, { key: ' ', code: 'Space' });
      fireEvent.change(pass, { target: { value: 'a b' } });
      expect(pass.value).toBe('a b');
      expect(wall).toHaveBeenCalledTimes(1);
      fireEvent.keyDown(pass, { key: 'Escape', code: 'Escape' });
      expect(sheet()).toBeNull();
      fireEvent.keyDown(document.body, { key: ' ', code: 'Space' });
      expect(wall).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener('keydown', wall);
    }
  });

  it('closes on its ✕', () => {
    render(<Harness onSelect={vi.fn()} onResume={vi.fn()} />);
    openMenu();
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Close the menu' }));
    expect(sheet()).toBeNull();
  });

  it('reads the clock-drift warning\'s fix out on a tap', async () => {
    drift.skewMs = 5 * 60_000;
    render(<Harness onSelect={vi.fn()} onResume={vi.fn()} />);
    const pill = screen.getByRole('button', { name: /clock off by ~5 min/ });
    expect(screen.queryByText(/Fix the system clock/)).toBeNull();
    await act(async () => { fireEvent.click(pill); });
    expect(screen.getByText(/Fix the system clock/)).toBeTruthy();
  });
});

describe('the touch menu\'s full-screen switch', () => {
  const restore = [];
  const stub = (obj, key, value) => {
    const had = Object.getOwnPropertyDescriptor(obj, key);
    Object.defineProperty(obj, key, { configurable: true, value, writable: true });
    restore.push(() => (had ? Object.defineProperty(obj, key, had) : delete obj[key]));
  };
  afterEach(() => { while (restore.length) restore.pop()(); });

  it('is offered only where the browser can put a page in full screen', () => {
    stub(document, 'fullscreenEnabled', false);
    render(<Harness onSelect={vi.fn()} onResume={vi.fn()} />);
    openMenu();
    expect(within(sheet()).queryByRole('switch', { name: /Full screen/ })).toBeNull();
  });

  it('asks for full screen inside the tap, and leaves it again', async () => {
    const request = vi.fn(() => Promise.resolve());
    const exit = vi.fn(() => Promise.resolve());
    stub(document, 'fullscreenEnabled', true);
    stub(document.documentElement, 'requestFullscreen', request);
    stub(document, 'exitFullscreen', exit);
    stub(document, 'fullscreenElement', null);
    render(<Harness onSelect={vi.fn()} onResume={vi.fn()} />);
    openMenu();
    const full = within(sheet()).getByRole('switch', { name: /Full screen/ });
    expect(full.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(full);
    expect(request).toHaveBeenCalledTimes(1);
    document.fullscreenElement = document.documentElement;
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });
    expect(full.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(full);
    expect(exit).toHaveBeenCalledTimes(1);
  });
});
