import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({ pusherAppKey: '', loginStatus: 'logged-out', vr: false }));
vi.mock('../../hooks/useConfig.js', () => ({ useConfig: () => ({ config: { pusherAppKey: state.pusherAppKey } }) }));
vi.mock('../../hooks/useDisplayLogin.js', () => ({ useDisplayLogin: () => ({ loginStatus: state.loginStatus }) }));
vi.mock('../lib/flags.js', () => ({ FLAGS: { get vr() { return state.vr; } } }));

const { SETUP_NOTE, SetupChecklist } = await import('./SetupChecklist.jsx');
const { COMING_UP } = await import('../views/Slide.jsx');

const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');

beforeEach(() => {
  localStorage.clear();
  Object.assign(state, { pusherAppKey: '', loginStatus: 'logged-out', vr: false });
});
afterEach(cleanup);

describe('the projector\'s first-run setup note', () => {
  it('names two steps on a screen with neither the key nor the login', () => {
    render(<SetupChecklist />);
    expect(screen.getByText(/two quick setup steps/)).toBeTruthy();
    expect(screen.getByText(/Live data key/)).toBeTruthy();
    expect(screen.getByText(/Log in with the display passphrase/)).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Display setup' }).textContent).toMatch(/Display Settings/);
    expect(screen.getByRole('region', { name: 'Display setup' }).textContent).toMatch(/Settings → Display login/);
  });

  it('drops the key step once the build carries one, and ticks the login when it is done', () => {
    state.pusherAppKey = 'k';
    const { rerender } = render(<SetupChecklist />);
    expect(screen.getByText(/one quick setup step/)).toBeTruthy();
    expect(screen.queryByText(/Live data key/)).toBeNull();
    expect(screen.getByText(/Log in with the display passphrase/).textContent.startsWith('⬜')).toBe(true);
    // Logged in but with no key yet: the login is ticked, the key still asked for.
    state.pusherAppKey = '';
    state.loginStatus = 'logged-in';
    rerender(<SetupChecklist />);
    expect(screen.getByText(/Log in with the display passphrase/).textContent.startsWith('✅')).toBe(true);
    expect(screen.getByText(/Live data key/)).toBeTruthy();
  });

  it('is gone once the screen is keyed and logged in, and never shows in screenshot mode', () => {
    state.pusherAppKey = 'k';
    state.loginStatus = 'logged-in';
    expect(render(<SetupChecklist />).container.innerHTML).toBe('');
    cleanup();
    state.pusherAppKey = '';
    state.loginStatus = 'logged-out';
    state.vr = true;
    expect(render(<SetupChecklist />).container.innerHTML).toBe('');
  });

  it("Don't show again persists per device", () => {
    const { container, unmount } = render(<SetupChecklist />);
    fireEvent.click(screen.getByRole('button', { name: /show again/i }));
    expect(container.innerHTML).toBe('');
    expect(localStorage.getItem('awanaSetupChecklistDismissed.v1')).toBe('1');
    unmount();
    expect(render(<SetupChecklist />).container.innerHTML).toBe('');
  });

  it('is one region with the heading and steps first and the button last (reading and tab order)', () => {
    render(<SetupChecklist />);
    const region = screen.getByRole('region', { name: 'Display setup' });
    expect([...region.querySelectorAll('p, ul, button')].map((el) => el.tagName)).toEqual(['P', 'UL', 'P', 'BUTTON']);
  });
});

describe('where the note stands', () => {
  it('starts below the Upcoming Awana Nights list, the lowest thing any view draws', () => {
    expect(SETUP_NOTE.top).toBeGreaterThanOrEqual(COMING_UP.bottom);
    expect(SETUP_NOTE.top).toBeLessThan(COMING_UP.frame);
  });

  it('starts on the slides\' own left margin and is no wider than their text block', () => {
    const rule = /\.pj-setup-note \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(new RegExp(`left: calc\\(50% - ${SETUP_NOTE.width / 2} \\* var\\(--u\\)\\)`));
    // As wide as its own words, up to the block: a full-width strip ran under
    // the slideshow's Prev / Next pill, at the window's bottom-right.
    expect(rule).toMatch(/width: max-content/);
    expect(rule).toMatch(new RegExp(`max-width: min\\(calc\\(${SETUP_NOTE.width} \\* var\\(--u\\)\\)`));
    // .pj-slide runs from 8u to 92u.
    const slide = /\.pj-slide \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(slide).toMatch(new RegExp(`left: calc\\(${(100 - SETUP_NOTE.width) / 2} \\* var\\(--u\\)\\)`));
  });

  it('stops short of the window\'s right edge by the hover Prev / Next pill\'s reach, in the pill\'s own rem', () => {
    const rule = /\.pj-setup-note \{([^}]*)\}/.exec(css)?.[1] ?? '';
    const reserve = Number(/calc\(50% \+ 42 \* var\(--u\) - ([\d.]+)rem\)/.exec(rule)?.[1]);
    // right-8 (2rem) plus the pill: two 4.4rem-ish buttons, about 11.75rem in all.
    expect(reserve).toBeGreaterThanOrEqual(2 + 11.75);
    const nav = readFileSync(resolve(__dirname, '../views/SlideshowView.jsx'), 'utf8');
    expect(nav).toMatch(/fixed bottom-8 right-8/);
  });

  it('is anchored to the window\'s bottom, so a 4:3 window has the black band under the frame too', () => {
    const rule = /\.pj-setup-note \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/bottom: max\(calc\(0\.5 \* var\(--u\)\), 6px\)/);
    expect(rule).toMatch(/position: absolute/);
  });
});

describe('the note gives way to the wall\'s own bottom overlays', () => {
  // The ESC toast and the watchdog's "back to schedule" pill stand on the same
  // band, over its middle. CSS does the yielding (an overlay in the DOM hides
  // the note, exit animation included), so the coupling is two things: the
  // marker on each overlay, and the rule that reads it.
  const read = (rel) => readFileSync(resolve(__dirname, rel), 'utf8');

  it('hides the note (visibility, so nothing moves) while any marked overlay is in the DOM', () => {
    expect(css).toMatch(/:root:has\(\[data-pj-bottom-overlay\]\) \.pj-setup-note \{\s*visibility: hidden;\s*\}/);
  });

  it('is marked on the ESC toast and on the resume pill, and on nothing that stays up', () => {
    expect(read('../views/SlideshowView.jsx')).toMatch(/className="absolute left-1\/2 z-50"\s+data-pj-bottom-overlay/);
    expect(read('../components/ResumePill.jsx')).toMatch(/data-resume-pill[\s\S]{0,200}data-pj-bottom-overlay/);
    // A marker on an always-mounted element would hide the note for good.
    const attribute = /\sdata-pj-bottom-overlay(?=[\s=>/])/;   // as a JSX attribute, not as a word in a comment
    const marked = ['../App.jsx', '../components/AwanaMark.jsx', '../components/SetupChecklist.jsx', '../views/QuickNav.jsx']
      .filter((rel) => attribute.test(read(rel)));
    expect(marked).toEqual([]);
  });
});
