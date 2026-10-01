import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';

// The first-run note on a phone or tablet: the same steps, a "Set up" button
// that opens the touch menu on Display Settings, no "hover" in its words, and
// one dismissal shared by the note on the wall and its copy in the menu.
// (SetupChecklist.test.jsx is the PC's note, and stays as it was.)

const state = vi.hoisted(() => ({ pusherAppKey: '', loginStatus: 'logged-out' }));
vi.mock('../../hooks/useConfig.js', () => ({ useConfig: () => ({ config: { pusherAppKey: state.pusherAppKey } }) }));
vi.mock('../../hooks/useDisplayLogin.js', () => ({ useDisplayLogin: () => ({ loginStatus: state.loginStatus }) }));
vi.mock('../lib/flags.js', () => ({ FLAGS: { vr: false } }));

const { SetupChecklist } = await import('./SetupChecklist.jsx');

beforeEach(() => {
  localStorage.clear();
  Object.assign(state, { pusherAppKey: '', loginStatus: 'logged-out' });
});
afterEach(cleanup);

describe('the setup note on touch', () => {
  it('names the steps, offers Set up, and never says hover', () => {
    const onSetUp = vi.fn();
    const { container } = render(<SetupChecklist touch onSetUp={onSetUp} />);
    const note = screen.getByRole('region', { name: 'Display setup' });
    expect(note.hasAttribute('data-setup-checklist')).toBe(true);
    expect(note.textContent).toMatch(/two quick setup steps/);
    expect(note.textContent).toMatch(/Live data key/);
    expect(container.textContent).not.toMatch(/[Hh]over/);
    fireEvent.click(within(note).getByRole('button', { name: 'Set up' }));
    expect(onSetUp).toHaveBeenCalledTimes(1);
  });

  it('in the menu it says where the steps are, with no Set up of its own', () => {
    render(<SetupChecklist touch inSheet />);
    const note = screen.getByRole('region', { name: 'Display setup' });
    expect(note.hasAttribute('data-setup-checklist')).toBe(false);
    expect(note.textContent).toMatch(/Display Settings, below/);
    expect(note.textContent).toMatch(/Settings → Display login/);
    expect(within(note).queryByRole('button', { name: 'Set up' })).toBeNull();
  });

  it('one "Don\'t show again" hides it everywhere, and for good on this device', () => {
    render(
      <>
        <SetupChecklist touch onSetUp={() => {}} />
        <SetupChecklist touch inSheet />
      </>,
    );
    expect(screen.getAllByRole('region', { name: 'Display setup' })).toHaveLength(2);
    act(() => { fireEvent.click(screen.getAllByRole('button', { name: /show again/i })[1]); });
    expect(screen.queryAllByRole('region', { name: 'Display setup' })).toHaveLength(0);
    expect(localStorage.getItem('awanaSetupChecklistDismissed.v1')).toBe('1');
    cleanup();
    render(<SetupChecklist touch onSetUp={() => {}} />);
    expect(screen.queryByRole('region', { name: 'Display setup' })).toBeNull();
  });

  it('is gone once the screen is keyed and logged in', () => {
    state.pusherAppKey = 'k';
    state.loginStatus = 'logged-in';
    expect(render(<SetupChecklist touch onSetUp={() => {}} />).container.innerHTML).toBe('');
  });
});
