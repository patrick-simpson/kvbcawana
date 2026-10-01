import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const loginState = vi.hoisted(() => ({ loginStatus: 'logged-out' }));
vi.mock('../hooks/useDisplayLogin.js', () => ({ useDisplayLogin: () => ({ ...loginState }) }));

const SetupCard = (await import('./SetupCard.jsx')).default;
const { SETUP_CARD_DISMISS_KEY, useSetupCard } = await import('./SetupCard.jsx');

beforeEach(() => { localStorage.clear(); loginState.loginStatus = 'logged-out'; });
afterEach(cleanup);

/**
 * The pair App wires up: the hook says whether the screen still wants the
 * card, the component draws it. (Whether the room has space for it is
 * setupUp's business, tested in src/lib/overlayFit.test.js.)
 */
function Screen({ status, hasDisplayKey, onOpenSettings = () => {} }) {
  const card = useSetupCard({ status, hasDisplayKey });
  return card.due ? <SetupCard card={card} onOpenSettings={onOpenSettings} /> : null;
}

describe('SetupCard (signage first-run)', () => {
  it('shows two steps on a fresh screen', () => {
    render(<Screen status="off" hasDisplayKey={false} />);
    expect(screen.getByText(/Two quick setup steps/)).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(document.querySelectorAll('li.done')).toHaveLength(0);
  });

  it('shows one step, with the connection ticked, once Pusher is set up', () => {
    render(<Screen status="connected" hasDisplayKey={false} />);
    expect(screen.getByText(/One quick setup step/)).toBeTruthy();
    expect(document.querySelectorAll('li.done')).toHaveLength(1);
  });

  it('hides when connected and keyed — by login or by a pasted key', () => {
    const { container, rerender } = render(<Screen status="connected" hasDisplayKey />);
    expect(container.innerHTML).toBe('');
    loginState.loginStatus = 'logged-in';
    rerender(<Screen status="connected" hasDisplayKey={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('never renders in overlay-less contexts where the screen is set up, but stays for a keyed yet disconnected screen', () => {
    render(<Screen status="off" hasDisplayKey />);
    expect(screen.getByText(/One quick setup step/)).toBeTruthy();
  });

  it('Open Settings calls back', () => {
    const open = vi.fn();
    render(<Screen status="off" hasDisplayKey={false} onOpenSettings={open} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(open).toHaveBeenCalled();
  });

  it("Don't show again persists per device", () => {
    const { container, unmount } = render(<Screen status="off" hasDisplayKey={false} />);
    fireEvent.click(screen.getByRole('button', { name: /show again/ }));
    expect(container.innerHTML).toBe('');
    expect(localStorage.getItem(SETUP_CARD_DISMISS_KEY)).toBe('1');
    unmount();
    const again = render(<Screen status="off" hasDisplayKey={false} />);
    expect(again.container.innerHTML).toBe('');
  });

  it('still offers both steps\' words and the keyboard way in, in the strip\'s shorter copy', () => {
    render(<Screen status="off" hasDisplayKey={false} />);
    const card = screen.getByRole('region', { name: 'Display setup' });
    // The two steps say where to go and where the secret is kept.
    expect(card.textContent).toMatch(/Settings → Setup → Advanced/);
    expect(card.textContent).toMatch(/App Key and Cluster/);
    expect(card.textContent).toMatch(/Settings → Pusher Integration/);
    expect(card.textContent).toMatch(/Settings → Setup → Display login/);
    expect(card.textContent).toMatch(/Settings → Display login/);
    expect(card.textContent).toMatch(/sync themselves/);
    // The gear stands beside the card now; the shortcut rides the button.
    expect(screen.getByRole('button', { name: 'Open Settings' }).title).toMatch(/Ctrl\+Shift\+S/);
  });

  it('is one region: the heading and the steps first, the way in last (reading and tab order)', () => {
    render(<Screen status="off" hasDisplayKey={false} />);
    const card = screen.getByRole('region', { name: 'Display setup' });
    const order = [...card.querySelectorAll('h3, ol, button')].map((el) => el.tagName);
    expect(order).toEqual(['H3', 'OL', 'BUTTON', 'BUTTON']);
  });
});
