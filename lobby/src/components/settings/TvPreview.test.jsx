import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import defaults from '../../config.js';
import { SAMPLE_NAMES } from '../../lib/demoNames.js';
import { seedForm } from '../SettingsPanel.jsx';

// framer-motion's presence animations need a real clock: here only the
// finished frame matters.
vi.mock('framer-motion', async (importOriginal) => {
  const mod = await importOriginal();
  return { ...mod, AnimatePresence: ({ children }) => children };
});

const boom = vi.hoisted(() => ({ on: false }));
vi.mock('../CheckoutBoard.jsx', async (importOriginal) => {
  const mod = await importOriginal();
  const Real = mod.default;
  return { ...mod, default: (props) => { if (boom.on) throw new Error('boom'); return <Real {...props} />; } };
});

const { default: TvPreview, PREVIEW_MAX_THROWS, cornerItemsFor, previewEnabled, previewLabel } = await import('./TvPreview.jsx');

const form = () => seedForm({ ...defaults, showClock: true, showTally: true, showWeatherChip: true });

beforeEach(() => { boom.on = false; vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('TvPreview (docs/SETTINGS-OVERHAUL.md section 6)', () => {
  it('draws the real slide copy in a fixed 1600x900 stage under zero animation, with one img label', () => {
    const { container } = render(<TvPreview form={form()} focus="slide" today="2026-10-14" />);
    const frame = screen.getByRole('img', { name: /preview of a slide/i });
    expect(frame).toBeTruthy();
    const scaler = container.querySelector('.tv-preview__scaler');
    expect(scaler.style.width).toBe('1600px');
    expect(scaler.style.height).toBe('900px');
    expect(scaler.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('.tv-preview__stage .catalog-scene')).not.toBeNull();
    expect(container.textContent).toMatch(/Welcome to Awana/);
    // never interactive
    expect(container.querySelectorAll('button, a, input').length).toBe(0);
  });

  it('a welcome shows a made-up name from demoNames, never a real one', () => {
    const { container } = render(<TvPreview form={form()} focus="welcome" today="2026-10-14" />);
    expect(container.querySelector('.checkin')).not.toBeNull();
    expect(container.textContent.toUpperCase()).toContain(SAMPLE_NAMES[0].toUpperCase());
  });

  it('the pickup focus draws the board on sample names, following the naming guard', () => {
    const f = form();
    const { container, rerender } = render(<TvPreview form={{ ...f, checkoutBoardNamesAbove: 0 }} focus="pickup" today="2026-10-14" />);
    expect(container.querySelector('.checkout-region')).not.toBeNull();
    expect(container.textContent).toMatch(/Sample|Demo|Test|Pretend|Practice|Example/);
    rerender(<TvPreview form={{ ...f, checkoutBoardNamesAbove: 200 }} focus="pickup" today="2026-10-14" />);
    expect(container.textContent).not.toMatch(/Sample Sam/);
  });

  it('the corner focus shows the chips the form turns on', () => {
    expect(cornerItemsFor(form()).map((i) => i.id)).toEqual(['clock', 'tally', 'weather']);
    expect(cornerItemsFor({ ...form(), showClock: false, showTally: false, showWeatherChip: false })).toEqual([]);
    const { container } = render(<TvPreview form={form()} focus="corner" today="2026-10-14" />);
    expect(container.querySelector('.corner-chip')).not.toBeNull();
  });

  it('the notice focus shows the composer\'s draft, and nothing while it is empty', () => {
    const { container, rerender } = render(
      <TvPreview form={form()} focus="notice" today="2026-10-14" noticeDraft={{ level: 'warn', message: '' }} />,
    );
    expect(container.querySelector('.notice-banner')).toBeNull();
    rerender(<TvPreview form={form()} focus="notice" today="2026-10-14" noticeDraft={{ level: 'warn', message: 'Doors close at 6:15 tonight.' }} />);
    expect(container.querySelector('.notice-banner--warn')?.textContent).toMatch(/Doors close/);
  });

  it('is fed the draft form: the season changes the scene', () => {
    const a = render(<TvPreview form={{ ...form(), nightTheme: 'christmas' }} focus="slide" today="2026-10-14" />);
    expect(a.container.querySelector('.catalog-scene--night')).not.toBeNull();
    a.unmount();
    const b = render(<TvPreview form={{ ...form(), nightTheme: 'easter' }} focus="slide" today="2026-10-14" />);
    expect(b.container.querySelector('.catalog-scene--lavender')).not.toBeNull();
  });

  it('falls back to a static miniature on a throw, and hides itself after two', () => {
    boom.on = true;
    const onHide = vi.fn();
    const { container, rerender } = render(<TvPreview form={form()} focus="pickup" today="2026-10-14" onHide={onHide} />);
    expect(container.querySelector('.tv-mini')).not.toBeNull();
    expect(container.querySelector('.tv-preview__stage')).toBeNull();
    // one more try (a change of focus) that throws again: hidden for good
    rerender(<TvPreview form={form()} focus="pickup" today="2026-10-14" onHide={onHide} noticeDraft={{ level: 'info', message: 'x' }} />);
    expect(PREVIEW_MAX_THROWS).toBe(2);
    expect(onHide).toHaveBeenCalled();
    expect(container.querySelector('[data-testid="tv-preview"]')).toBeNull();
  });

  it('?preview=0 turns it off; the label describes each focus', () => {
    expect(previewEnabled('?preview=0')).toBe(false);
    expect(previewEnabled('')).toBe(true);
    for (const f of ['slide', 'welcome', 'pickup', 'corner', 'notice']) expect(previewLabel(f)).toMatch(/preview/i);
  });
});
