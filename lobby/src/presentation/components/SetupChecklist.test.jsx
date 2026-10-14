import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({ loginStatus: 'logged-out', vr: false }));
vi.mock('../../hooks/useDisplayLogin.js', () => ({ useDisplayLogin: () => ({ loginStatus: state.loginStatus }) }));
vi.mock('../lib/flags.js', () => ({ FLAGS: { get vr() { return state.vr; } } }));

const { SETUP_NOTE, SetupChecklist } = await import('./SetupChecklist.jsx');
const { COMING_UP } = await import('../views/Slide.jsx');

const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');

beforeEach(() => {
  localStorage.clear();
  Object.assign(state, { loginStatus: 'logged-out', vr: false });
});
afterEach(cleanup);

describe('the projector\'s first-run setup note', () => {
  it('names the one step on a screen that is not logged in', () => {
    render(<SetupChecklist />);
    expect(screen.getByText(/one quick setup step/i)).toBeTruthy();
    expect(screen.queryByText(/Live data key/)).toBeNull();
    expect(screen.getByText(/Sign in with the church passphrase/).textContent.startsWith('⬜')).toBe(true);
    const words = screen.getByRole('region', { name: 'Display setup' }).textContent;
    expect(words).toMatch(/Hover top-right, then Display Settings/);
    // The print server's display login is gone: the passphrase is the one the
    // settings page signs in with (design review 2026-10-13).
    expect(words).toMatch(/Same passphrase as awana\.kvbchurch\.org\/settings/);
    expect(words).not.toMatch(/print-server|Display login|display passphrase|→|—/);
  });

  it('is gone once the screen is logged in, and never shows in screenshot mode', () => {
    state.loginStatus = 'logged-in';
    expect(render(<SetupChecklist />).container.innerHTML).toBe('');
    cleanup();
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

  it('sets every word at one TV-legible size that two lines of still fit the band', () => {
    // 1.15u (22px at 1080p) with a 12px floor; it was 1.05u with its second
    // line at 0.85 of that, ~11px at 720p (design review 2026-10-13).
    const rule = /\.pj-setup-note \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/font-size: max\(12px, calc\(1\.15 \* var\(--u\)\)\)/);
    for (const part of ['kicker', 'steps', 'where']) {
      const body = new RegExp(`\\.pj-setup-note__${part} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';
      expect(body).toMatch(/font-size: 1em;/);
      expect(body).toMatch(/line-height: 1\.2;/);
    }
    // Two lines and the padding inside the band under 51.75u (bottom 0.5u off the edge).
    const lines = 2 * 1.2 + 0.32 + 0.36;
    expect(lines * 1.15).toBeLessThanOrEqual(56.25 - SETUP_NOTE.top - 0.5);
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
    const marked = ['../App.jsx', '../components/ChurchMark.jsx', '../components/SetupChecklist.jsx', '../views/QuickNav.jsx']
      .filter((rel) => attribute.test(read(rel)));
    expect(marked).toEqual([]);
  });
});
