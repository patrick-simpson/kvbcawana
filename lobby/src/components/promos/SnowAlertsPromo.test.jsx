import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ZeroAnimationContext } from '../../lib/motion.jsx';
import PromoSlide, { detailsFor } from '../PromoSlide.jsx';
import { DETAILS } from './SnowAlertsPromo.jsx';
import { alertsQrPath } from '../../lib/alertsQr.js';
import { LobbyLiveContext } from '../../lib/lobbyLive.jsx';

// No global test setup file in this repo, so RTL's automatic cleanup doesn't
// run: do it explicitly. Fake timers can't drive framer-motion, so these pin
// what is IN the DOM, not how it moves.
afterEach(cleanup);

const promo = (snow = null) => ({
  id: 'promo_snow_alerts', kind: 'snowAlerts', eventDate: snow ? snow.date : '',
  tonight: snow?.when === 'tonight', countdown: null, afterContest: true, durationSec: 20, snow,
});
const storm = (when = 'later') => promo({ date: '2026-12-02', when, weekday: 'Wednesday', inches: 3 });

const mount = (p, still = false) => render(
  <ZeroAnimationContext.Provider value={still}>
    <PromoSlide promo={p} />
  </ZeroAnimationContext.Provider>,
);
const text = (c, sel) => c.querySelector(sel)?.textContent;

describe('SnowAlertsPromo', () => {
  it('is the snow slide in the promo slot, in the lobby’s kit', () => {
    const { container } = mount(promo());
    const slide = container.querySelector('.promo-slide.promo-slide--snow.snow-alerts');
    expect(slide).not.toBeNull();
    expect(slide.classList.contains('snow-alerts--storm')).toBe(false);
  });

  it('says the ordinary-week pitch, with the address under the code', () => {
    const { container } = mount(promo());
    expect(text(container, '.snow-alerts__kicker')).toBe('Snow day?');
    expect(container.querySelector('.snow-alerts__headline').getAttribute('aria-label')).toBe('Sign up for cancellation texts');
    expect([...container.querySelectorAll('.snow-alerts__word')].map((w) => w.textContent)).toEqual(['Sign', 'up', 'for', 'cancellation', 'texts']);
    // No line between the headline and the code (owner, 2026-10-11).
    expect(container.querySelector('.snow-alerts__body')).toBeNull();
    expect(container.querySelector('.snow-alerts__scan-label')).toBeNull();
    expect(text(container, '.snow-alerts__url')).toBe('kvbchurch.org/alerts');
  });

  it('names the night, in the storm colours, when snow is coming', () => {
    const { container } = mount(storm());
    expect(container.querySelector('.snow-alerts--storm')).not.toBeNull();
    expect(text(container, '.snow-alerts__kicker')).toBe('Wednesday looks snowy');
    cleanup();
    expect(text(mount(storm('tonight')).container, '.snow-alerts__kicker')).toBe('Tonight looks snowy');
  });

  it('draws the real QR code for the sign-up', () => {
    const { container } = mount(promo());
    const qr = container.querySelector('svg.snow-alerts__qr');
    expect(qr.getAttribute('aria-label')).toBe('QR code for kvbchurch.org/alerts');
    expect(qr.querySelector('path').getAttribute('d')).toBe(alertsQrPath().d);
    // A quiet zone round the code, on white, so a phone can find its edges.
    expect(qr.getAttribute('viewBox')).toBe(`-2 -2 ${alertsQrPath().size + 4} ${alertsQrPath().size + 4}`);
  });

  it('shows the church’s real text on the Pixel’s lock screen, dated today', () => {
    for (const p of [promo(), storm('tonight')]) {
      const { container } = mount(p);
      const now = new Date();
      const date = `${now.getMonth() + 1}/${now.getDate()}/${String(now.getFullYear() % 100).padStart(2, '0')}`;
      expect(text(container, '.snow-alerts__note-body')).toBe(
        `Awana has been cancelled on ${date} at KVBC. Clubbers should come prepared with both weeks’ sections next week.`,
      );
      expect(container.querySelector('.snow-alerts__date').textContent).toContain(
        `${now.toLocaleDateString('en-US', { weekday: 'short' })}, ${now.toLocaleDateString('en-US', { month: 'short' })} ${now.getDate()}`,
      );
      expect(text(container, '.snow-alerts__sender')).toBe('KVBC');
      // No disclaimer on the phone (owner, 2026-10-11).
      expect(container.querySelector('.snow-alerts__tag')).toBeNull();
      cleanup();
    }
  });

  it('shows the lobby’s weather and tonight’s check-ins as the battery', () => {
    const live = (value) => render(
      <LobbyLiveContext.Provider value={value}>
        <PromoSlide promo={promo()} />
      </LobbyLiveContext.Provider>,
    ).container;
    let c = live({ weather: { temp: 27, code: 73, isDay: false, units: 'fahrenheit' }, checkedIn: 64 });
    expect(c.querySelector('.snow-alerts__weather').textContent).toBe('27°F');
    expect(c.querySelector('.snow-alerts__battery').textContent).toBe('64');
    expect(c.querySelector('.snow-alerts__battery').style.getPropertyValue('--level')).toBe('64%');
    cleanup();
    c = live({ weather: null, checkedIn: 140 });
    expect(c.querySelector('.snow-alerts__weather')).toBeNull();
    expect(c.querySelector('.snow-alerts__battery').textContent).toBe('100');
  });

  it('keeps the phone’s clock on the current time', () => {
    const fmt = (d) => `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`;
    const before = fmt(new Date());
    const { container } = mount(promo());
    // Either side of a minute's turn, never a fixed time.
    expect([before, fmt(new Date())]).toContain(text(container, '.snow-alerts__time'));
  });

  it('reads as one image to a screen reader, with every fact in its label', () => {
    const { container } = mount(storm());
    const label = container.querySelector('.snow-alerts').getAttribute('aria-label');
    expect(label).toContain('Wednesday looks snowy');
    expect(label).toContain('Sign up for cancellation texts');
    expect(label).toContain('kvbchurch.org/alerts');
  });

  it('renders the same finished card under zero animation', () => {
    const { container } = mount(promo(), true);
    expect(text(container, '.snow-alerts__kicker')).toBe('Snow day?');
    expect(container.querySelector('svg.snow-alerts__qr')).not.toBeNull();
    expect(text(container, '.snow-alerts__url')).toBe('kvbchurch.org/alerts');
    expect(container.querySelectorAll('.snow-alerts__snow')).toHaveLength(3);
  });

  it('gives PromoSlide its detail table', () => {
    expect(detailsFor(promo())).toBe(DETAILS.default);
    expect(DETAILS.default).toEqual(['Sign up for cancellation texts']);
  });

  it('never uses an em dash or a straight apostrophe on screen', () => {
    for (const p of [promo(), storm(), storm('tomorrow'), storm('tonight')]) {
      const { container } = mount(p);
      const all = `${container.textContent} ${container.querySelector('.snow-alerts').getAttribute('aria-label')}`;
      expect(all).not.toContain('—');
      expect(all).not.toContain("'");
      cleanup();
    }
  });
});
