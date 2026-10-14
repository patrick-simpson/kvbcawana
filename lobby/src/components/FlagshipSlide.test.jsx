import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, cleanup, waitFor, act } from '@testing-library/react';

vi.mock('../lib/confetti.js', () => ({ fireWelcome: vi.fn() }));

const { ZeroAnimationContext } = await import('../lib/motion.jsx');
const { fireWelcome } = await import('../lib/confetti.js');
const {
  FLAGSHIP_DURATION_SEC, FLAGSHIP_LINES, FLAGSHIP_STYLES, FLAGSHIP_VERSIONS, flagshipLabel, flagshipPick,
} = await import('../lib/flagship.js');
const { default: FlagshipSlide, beatSheet, PARADE } = await import('./FlagshipSlide.jsx');

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.mocked(fireWelcome).mockClear();
});

const PICKS = FLAGSHIP_STYLES.flatMap((style) => FLAGSHIP_VERSIONS.map((version) => ({ style, version })));
const CLUB_ORDER = ['puggles', 'cubbies', 'sparks', 'tnt', 'trek', 'journey'];
const css = () => readFileSync(resolve(__dirname, '../styles/flagship.css'), 'utf8');

function still(ui) {
  return render(<ZeroAnimationContext.Provider value>{ui}</ZeroAnimationContext.Provider>);
}

describe('FlagshipSlide: the church logo, huge (owner 2026-10-13)', () => {
  for (const pick of PICKS) {
    it(`${pick.style} / ${pick.version}: reads as ONE image with the logo's words and the wording's line`, () => {
      const { container } = still(<FlagshipSlide pick={pick} />);
      const root = container.querySelector('.flagship');
      expect(root.getAttribute('role')).toBe('img');
      expect(root.getAttribute('aria-label')).toBe(flagshipLabel(pick.version));
      expect(root.dataset.style).toBe(pick.style);
      expect(root.dataset.version).toBe(pick.version);
      // Nothing inside speaks on its own: only the label does.
      for (const el of root.children) expect(el.getAttribute('aria-hidden')).toBe('true');
    });
  }

  it('glad: the full logo, tagline and all, then the owner\'s line under it; nothing over it', () => {
    const { container } = still(<FlagshipSlide pick={{ style: 'pop', version: 'glad' }} />);
    const ink = container.querySelector('.flagship-ink');
    expect([...ink.children].map((e) => e.className.split(' ')[0])).toEqual(['flagship-mark', 'flagship-line']);
    expect(container.querySelector('.flagship-line--glad').textContent).toBe(FLAGSHIP_LINES.glad);
    expect(container.querySelector('.flagship-line--welcome')).toBeNull();
    const full = container.querySelector('.flagship-logo--full');
    expect([...full.querySelectorAll('path')].map((p) => p.getAttribute('class'))).toEqual(['kvbc-church', 'kvbc-awana', 'kvbc-tagline']);
  });

  it('welcome: "Welcome to" over the full logo, and nothing under it', () => {
    const { container } = still(<FlagshipSlide pick={{ style: 'parade', version: 'welcome' }} />);
    const ink = container.querySelector('.flagship-ink');
    expect([...ink.children].map((e) => e.className.split(' ')[0])).toEqual(['flagship-line', 'flagship-mark']);
    expect(container.querySelector('.flagship-line--welcome').textContent).toBe('Welcome to');
    expect(container.querySelector('.flagship-line--glad')).toBeNull();
    expect(container.querySelector('.flagship-logo--full .kvbc-tagline')).not.toBeNull();
  });

  it('draws the logo in ONE colour: currentColor fill, no stroke, outline, shadow, gradient or blend', () => {
    const { container } = still(<FlagshipSlide pick={{ style: 'bounce', version: 'glad' }} />);
    for (const svg of container.querySelectorAll('.flagship-logo')) {
      expect(svg.querySelector('g').getAttribute('fill')).toBe('currentColor');
      for (const p of svg.querySelectorAll('path')) {
        expect(p.getAttribute('fill')).toBeNull();
        expect(p.getAttribute('stroke')).toBeNull();
      }
    }
    expect(css()).not.toMatch(/gradient\(|mix-blend-mode|text-shadow|drop-shadow|filter:|-webkit-text-stroke/);
    // Ink on the sky, the logo sheet's colour for a light field.
    expect(css()).toMatch(/\.flagship-ink \{[^}]*color: #231f20;/);
  });

  it('draws the full logo, tagline and all, on every screen: squeezed where the box is small (owner 2026-10-13)', () => {
    const sheet = css();
    // 72u (75u under "Welcome to"); a 4:3 screen takes up to 520px, at most 84u.
    expect(sheet).toMatch(/--logo-w: max\(calc\(72 \* var\(--u\)\), min\(520px, calc\(84 \* var\(--u\)\)\)\)/);
    // No size swaps the full logo for the two-line one.
    expect(sheet).not.toMatch(/\.flagship-logo--full \{ display: none; \}/);
    expect(sheet).not.toMatch(/\.flagship-logo--two-line \{ display: block; \}/);
  });

  it('bounce: Awana Clubs comes apart into its ten letters, and six doodles, one per club colour, pop round it', () => {
    const { container } = render(<FlagshipSlide pick={{ style: 'bounce', version: 'glad' }} />);
    for (const variant of ['full', 'two-line']) {
      expect(container.querySelectorAll(`.flagship-logo--${variant} .flagship-logo__letter`)).toHaveLength(10);
    }
    const doodles = [...container.querySelectorAll('.flagship-doodle')];
    expect(doodles.map((d) => d.style.color)).toEqual(['puggles', 'sparks', 'tnt', 'cubbies', 'journey', 'trek'].map((c) => `var(--brand-${c})`));
    expect(container.querySelector('.flagship-parade')).toBeNull();
  });

  it('parade: the six club colours march up behind it, youngest first, and only in the parade', () => {
    const { container } = render(<FlagshipSlide pick={{ style: 'parade', version: 'glad' }} />);
    expect([...container.querySelectorAll('.flagship-band')].map((b) => b.className.replace('flagship-band flagship-band--', ''))).toEqual(CLUB_ORDER);
    expect(container.querySelector('.flagship-doodle')).toBeNull();
    for (const style of ['bounce', 'pop']) {
      cleanup();
      const other = render(<FlagshipSlide pick={{ style, version: 'glad' }} />);
      expect(other.container.querySelector('.flagship-parade')).toBeNull();
    }
  });

  it('every style is one moment, then still: the tagline lands last, everything well inside the 10 s hold', () => {
    for (const { style, version } of PICKS) {
      const s = beatSheet(style, version);
      expect(s.still, `${style}/${version}`).toBeLessThan(FLAGSHIP_DURATION_SEC - 3);
      if (style === 'bounce') {
        expect(s.taglineAt).toBeGreaterThan(s.churchAt);
        expect(s.taglineAt).toBeGreaterThan(s.letterAt(5));
      } else if (style === 'pop') {
        expect(s.taglineAt).toBeGreaterThan(s.popAt);
      } else {
        expect(s.taglineAt).toBeGreaterThan(s.arriveAt);
      }
      // "Welcome to" comes before the logo; the glad line after it.
      if (version === 'welcome') expect(s.welcomeAt).toBeLessThan(s.lead);
      else expect(s.gladAt).toBeGreaterThan(s.taglineAt);
    }
  });

  it('parade: the logo turns white as the first club wave crosses its middle and ink as the last one leaves', () => {
    for (const version of FLAGSHIP_VERSIONS) {
      const { parade } = beatSheet('parade', version);
      expect(parade.flipIn).toBeGreaterThan(parade.start);
      expect(parade.flipIn).toBeLessThan(parade.start + PARADE.move);
      expect(parade.flipOut).toBeGreaterThan(parade.start + 6 * parade.step);
      expect(parade.flipOut).toBeLessThan(parade.end);
    }
  });

  it('pop: one burst of club confetti at the pop, from the logo\'s middle, never under zero animation', async () => {
    vi.useFakeTimers();
    // jsdom lays nothing out; give the logo the box it has on a 1920x1080 screen.
    const box = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
      return this.classList?.contains('flagship-mark')
        ? /** @type {DOMRect} */ ({ left: 269, top: 384, width: 1382, height: 352, right: 1651, bottom: 736, x: 269, y: 384, toJSON() {} })
        : /** @type {DOMRect} */ ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} });
    });
    render(<FlagshipSlide pick={{ style: 'pop', version: 'glad' }} />);
    const at = beatSheet('pop', 'glad').confettiAt * 1000;
    await act(async () => { vi.advanceTimersByTime(at - 20); });
    expect(fireWelcome).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(40); });
    expect(fireWelcome).toHaveBeenCalledTimes(1);
    const [origin] = vi.mocked(fireWelcome).mock.calls[0];
    expect(origin.x).toBeCloseTo((269 + 1382 / 2) / window.innerWidth, 5);
    expect(origin.y).toBeCloseTo((384 + 352 / 2) / window.innerHeight, 5);
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(fireWelcome).toHaveBeenCalledTimes(1);
    cleanup();
    vi.mocked(fireWelcome).mockClear();
    still(<FlagshipSlide pick={{ style: 'pop', version: 'glad' }} />);
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(fireWelcome).not.toHaveBeenCalled();
    for (const style of ['bounce', 'parade']) {
      render(<FlagshipSlide pick={{ style, version: 'glad' }} />);
      await act(async () => { vi.advanceTimersByTime(10_000); });
    }
    expect(fireWelcome).not.toHaveBeenCalled();
    // A logo with no box (a hidden page) throws nothing at all.
    box.mockRestore();
    render(<FlagshipSlide pick={{ style: 'pop', version: 'welcome' }} />);
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(fireWelcome).not.toHaveBeenCalled();
  });

  it('takes this screen\'s next turn when nobody picks for it', () => {
    localStorage.setItem('awanaFlagshipTurn.v1', '2');
    const { container } = still(<FlagshipSlide />);
    const expected = flagshipPick(2);
    expect(container.querySelector('.flagship').dataset.style).toBe(expected.style);
    expect(container.querySelector('.flagship').dataset.version).toBe(expected.version);
    expect(localStorage.getItem('awanaFlagshipTurn.v1')).toBe('3');
    localStorage.removeItem('awanaFlagshipTurn.v1');
  });

  it('under ?lowPower=1 shows the finished frame: everything at rest, the parade off the frame', async () => {
    for (const pick of PICKS) {
      const { container } = still(<FlagshipSlide pick={pick} />);
      await waitFor(() => {
        for (const el of container.querySelectorAll('.flagship-line, .flagship-pop, .flagship-doodle')) {
          expect(el.style.opacity === '' || el.style.opacity === '1', `${pick.style}/${pick.version}`).toBe(true);
          // A doodle rests at its own tilt; nothing rests scaled or moved.
          const t = el.classList.contains('flagship-doodle') ? el.style.transform.replace(/rotate\(-?[\d.]+deg\)/, '').trim() : el.style.transform;
          expect(['', 'none']).toContain(t);
        }
        const strip = container.querySelector('.flagship-parade__strip');
        // Its last keyframe is the whole strip above the frame.
        if (strip) expect(strip.style.transform).toBe('translateY(-100%)');
        const ink = container.querySelector('.flagship-ink');
        if (pick.style === 'parade') expect(ink.style.color).toMatch(/^(#231f20|rgb\(35, 31, 32\))$/i);
      }, { timeout: 300 });
      // Still, the logo is plain paths: nothing for a frame loop to move.
      expect(container.querySelector('.flagship-logo--full .kvbc-awana').tagName.toLowerCase()).toBe('path');
      cleanup();
    }
  });

  it('has no club plates, no TONIGHT kicker, no sheen and no shouted WELCOME TO AWANA headline', () => {
    const { container } = still(<FlagshipSlide pick={{ style: 'bounce', version: 'welcome' }} />);
    expect(container.querySelector('.flagship-plate, .flagship-kicker, .flagship-sheen, .flagship-row')).toBeNull();
    expect(container.textContent).not.toMatch(/tonight|welcome to awana/i);
  });
});
