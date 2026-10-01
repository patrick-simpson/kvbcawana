import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import FriendPromo, { DETAILS, FRIEND_WORDS } from './FriendPromo.jsx';

// framer-motion captures the real requestAnimationFrame at import, so fake
// timers cannot drive it; these tests pin the DOM facts and the copy.

afterEach(cleanup);

const base = {
  id: 'promo_friend',
  kind: 'friend',
  eventDate: '2026-10-14',
  tonight: false,
  countdown: '3 club nights left',
  afterContest: false,
  durationSec: 15,
};

function renderPromo(overrides = {}) {
  const promo = { ...base, ...overrides };
  const lines = promo.tonight ? DETAILS.tonight : DETAILS.default;
  return render(<FriendPromo promo={promo} lines={lines} />);
}

const text = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();

describe('FriendPromo', () => {
  it('keeps the detail copy exactly', () => {
    expect(DETAILS.default).toEqual(['Earn 10 Awana Shares per friend', '+ a BARF bag!', 'Bring A Real Friend']);
    expect(DETAILS.tonight).toEqual(['10 Awana Shares per friend', '+ a BARF bag!']);
    expect(Object.isFrozen(DETAILS)).toBe(true);
    expect(Object.isFrozen(DETAILS.default)).toBe(true);
    expect(Object.isFrozen(DETAILS.tonight)).toBe(true);
  });

  it('sets every fact of the printed poster on the default end card', () => {
    const { container } = renderPromo();
    const root = container.querySelector('.promo-slide.promo-slide--friend');
    expect(root).not.toBeNull();
    expect(text(root.querySelector('.promo-friend-headline'))).toBe('BARF Night!');
    const words = [...root.querySelectorAll('.promo-friend-word')].map(text);
    expect(words).toEqual(['BRING', 'A REAL', 'FRIEND']);
    expect(FRIEND_WORDS).toEqual(words);
    expect(text(root.querySelector('.promo-friend-date'))).toBe('WEDNESDAY, OCTOBER 14');
    expect(text(root.querySelector('.promo-friend-badge'))).toBe('10 Awana Shares per friend + a BARF bag!');
  });

  it('renders exactly one detail slot and one chip, carrying the live counter', () => {
    const { container } = renderPromo();
    expect(container.querySelectorAll('.promo-detail-slot')).toHaveLength(1);
    expect(container.querySelectorAll('.promo-chip')).toHaveLength(1);
    expect(text(container.querySelector('.promo-chip'))).toBe('3 club nights left');
    expect(text(container.querySelector('.promo-detail'))).toBe(DETAILS.default[0]);
    expect(container.querySelector('.promo-texture')).not.toBeNull();
    expect(container.querySelector('.promo-vignette')).not.toBeNull();
  });

  it('drops the chip when there is no counter', () => {
    const { container } = renderPromo({ countdown: null });
    expect(container.querySelectorAll('.promo-chip')).toHaveLength(0);
  });

  it('turns into the tonight poster', () => {
    const { container } = renderPromo({ tonight: true, countdown: 'Tonight!' });
    expect(text(container.querySelector('.promo-friend-headline'))).toBe('BARF Night is tonight!');
    expect(text(container.querySelector('.promo-friend-date'))).toBe('Bring your friend to the check-in desk');
    expect(container.textContent).not.toContain('WEDNESDAY, OCTOBER 14');
    expect([...container.querySelectorAll('.promo-friend-word')].map(text)).toEqual(['BRING', 'A REAL', 'FRIEND']);
    expect(text(container.querySelector('.promo-friend-badge'))).toBe('10 Awana Shares per friend + a BARF bag!');
    expect(text(container.querySelector('.promo-detail'))).toBe(DETAILS.tonight[0]);
  });

  it('never puts an em dash on screen', () => {
    for (const overrides of [{}, { tonight: true }, { afterContest: true }]) {
      const { container, unmount } = renderPromo(overrides);
      expect(container.textContent).not.toContain('—');
      unmount();
    }
    for (const line of [...DETAILS.default, ...DETAILS.tonight]) expect(line).not.toContain('—');
  });
});
