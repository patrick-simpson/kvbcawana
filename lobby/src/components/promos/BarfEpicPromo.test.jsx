import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import BarfEpicPromo, {
  DETAILS, EPIC_SHAKE, EPIC_FRIEND_LINE, EPIC_SHARES_LINE, EPIC_TONIGHT_LINE, flashFrames,
} from './BarfEpicPromo.jsx';
import { detailsFor } from '../PromoSlide.jsx';

// No global test setup in this repo, so RTL's cleanup has to be explicit.
afterEach(cleanup);

const promo = (extra = {}) => ({
  id: 'promo_barfEpic',
  kind: 'barfEpic',
  eventDate: '2026-10-14',
  tonight: false,
  countdown: '3 club nights left',
  afterContest: false,
  durationSec: 15,
  ...extra,
});

const mount = (p) => render(<BarfEpicPromo promo={p} lines={detailsFor(p)} />);

// What a reader actually sees: the chromatic ghosts and the light sweep
// are aria-hidden duplicates of the type, so they are left out.
function visibleText(container) {
  const clone = container.cloneNode(true);
  clone.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
  return clone.textContent.replace(/\s+/g, ' ');
}

describe('BarfEpicPromo (the slime cut)', () => {
  it('keeps its one closer line, exactly', () => {
    expect(DETAILS.default).toEqual(['Who will you bring?']);
    expect(DETAILS.tonight).toEqual(['Welcome!']);
    expect(Object.isFrozen(DETAILS)).toBe(true);
    expect(Object.isFrozen(DETAILS.default)).toBe(true);
    expect(Object.isFrozen(DETAILS.tonight)).toBe(true);
    expect(detailsFor(promo())).toBe(DETAILS.default);
    expect(detailsFor(promo({ tonight: true }))).toBe(DETAILS.tonight);
  });

  it('puts every fact on the default poster', () => {
    const { container } = mount(promo());
    const root = container.querySelector('.promo-slide.promo-slide--barf-epic');
    expect(root).not.toBeNull();
    const text = visibleText(container);
    expect(text).toContain('The');
    expect(text).toContain('Biggest');
    expect(text).toContain('Ever');
    expect(text).toContain(EPIC_FRIEND_LINE);
    expect(EPIC_FRIEND_LINE).toBe('Bring A Real Friend');
    expect(text).toContain('WEDNESDAY, OCTOBER 14');
    expect(text).toContain(EPIC_SHARES_LINE);
    expect(EPIC_SHARES_LINE).toBe('10 Awana Shares per friend + a BARF bag!');
    expect(text).toContain('Who will you bring?');
    expect(text).not.toContain(EPIC_TONIGHT_LINE);
    expect(container.querySelector('.promo-chip').textContent).toBe('3 club nights left');
  });

  it('spells BARF one letter per element', () => {
    const { container } = mount(promo());
    const letters = [...container.querySelectorAll('.promo-epic-hero-letter')]
      .map((el) => el.firstChild.textContent);
    expect(letters).toEqual(['B', 'A', 'R', 'F']);
  });

  it('sends friends to the check-in desk on the night instead of a date', () => {
    const { container } = mount(promo({ tonight: true, countdown: 'Tonight!' }));
    const text = visibleText(container);
    expect(text).toContain('Bring them to the check-in desk');
    expect(text).not.toContain('OCTOBER 14');
    expect(text).toContain(EPIC_SHARES_LINE);
    expect(text).toContain(EPIC_FRIEND_LINE);
    expect(text).toContain('Welcome!');
    expect(text).not.toContain('Who will you bring?');
    expect(container.querySelector('.promo-chip').textContent).toBe('Tonight!');
  });

  it('carries the shared frame: depth, one detail slot, one chip, the wordmark', () => {
    const { container } = mount(promo());
    expect(container.querySelector('.promo-texture')).not.toBeNull();
    expect(container.querySelector('.promo-vignette')).not.toBeNull();
    expect(container.querySelectorAll('.promo-detail-slot')).toHaveLength(1);
    expect(container.querySelectorAll('.promo-chip')).toHaveLength(1);
    expect(container.querySelector('.promo-wordmark')).not.toBeNull();
  });

  it('drops the chip when there is nothing to count', () => {
    const { container } = mount(promo({ countdown: null }));
    expect(container.querySelector('.promo-chip')).toBeNull();
  });

  it('uses no em dash in any variant, ghosts and cards included', () => {
    for (const extra of [{}, { tonight: true }, { afterContest: true }, { tonight: true, afterContest: true }]) {
      const { container } = mount(promo(extra));
      expect(container.textContent).not.toContain('—');
      cleanup();
    }
    for (const lines of Object.values(DETAILS)) expect(lines.join(' ')).not.toContain('—');
  });

  it('opens on a month card taken from the event date', () => {
    const { container } = mount(promo());
    expect(container.querySelector('.promo-epic-card-title').textContent).toBe('THIS OCTOBER');
    cleanup();
    const { container: c2 } = mount(promo({ tonight: true }));
    expect(c2.querySelector('.promo-epic-card-title').textContent).toBe('TONIGHT');
  });

  // The two one-clock lists the whole piece hangs off: both must be
  // ordered and must END at rest, because ?lowPower=1 freezes on the end.
  it('ends the screen shake and the flashes at rest, in order', () => {
    const ordered = (ts) => ts.every((t, i) => i === 0 || t >= ts[i - 1]);
    expect(ordered(EPIC_SHAKE.times)).toBe(true);
    expect(EPIC_SHAKE.times.at(-1)).toBe(1);
    expect(EPIC_SHAKE.x.at(-1)).toBe(0);
    expect(EPIC_SHAKE.y.at(-1)).toBe(0);

    const frames = flashFrames([[1, 0.8], [1.2, 0.3], [5, 0.5]]);
    expect(ordered(frames.map(([t]) => t))).toBe(true);
    expect(frames.at(-1)[1].opacity).toBe(0);
    expect(frames[0]).toEqual([0, { opacity: 0 }]);
  });
});
