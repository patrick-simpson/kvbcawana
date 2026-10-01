import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { ZeroAnimationContext } from '../lib/motion.jsx';
import SlideCopy from './SlideCopy.jsx';
import { READ, SHOUT, bidiIsolates, fitFrame } from '../lib/lobbyFrame.js';

afterEach(cleanup);

const FRAME = { kicker: 'Next club night', headline: 'Making Bookmarks', sub: 'Bring a friend', chip: { label: 'WED', value: 'SEP 30' }, textSize: 'auto' };
const pieces = (c) => [...c.querySelectorAll('.lobby-kicker, .lobby-word, .lobby-sub, .lobby-chip')];
const atRest = (el) => (el.style.opacity === '' || el.style.opacity === '1') && (el.style.transform === '' || el.style.transform === 'none');

describe('SlideCopy', () => {
  it('sets the kicker, the headline word by word, the supporting line and the chip', () => {
    const { container } = render(<SlideCopy frame={FRAME} still />);
    expect(container.querySelector('.lobby-kicker').textContent).toBe('Next club night');
    expect([...container.querySelectorAll('.lobby-word')].map((w) => w.textContent)).toEqual(['Making', 'Bookmarks']);
    // The line break is a <br>, and the words still read as one sentence.
    expect(container.querySelector('.lobby-headline').textContent).toBe('Making Bookmarks');
    expect(container.querySelector('.lobby-headline br')).not.toBeNull();
    expect(container.querySelector('.lobby-sub').textContent).toBe('Bring a friend');
    expect(container.querySelector('.lobby-chip [role="img"]').getAttribute('aria-label')).toBe('WED SEP 30');
  });

  it('only a slide carries the typed-slide class names', () => {
    const { container, rerender } = render(<SlideCopy frame={FRAME} still />);
    expect(container.querySelector('.manual-slide-text')).toBeNull();
    rerender(<SlideCopy frame={FRAME} still slide sizeClass="slide-size-lg" />);
    expect(container.querySelector('.manual-slide-text.slide-size-lg')).not.toBeNull();
    expect(container.querySelector('.manual-slide-eyebrow')).not.toBeNull();
    expect(container.querySelector('.manual-slide-subtext')).not.toBeNull();
  });

  it('a still copy (the editor\'s thumbnails) is plain elements at rest', () => {
    const { container } = render(<SlideCopy frame={FRAME} still />);
    for (const el of pieces(container)) expect(atRest(el)).toBe(true);
  });

  it('carries its own theme\'s colours, so it never repaints mid-exit', () => {
    const { container } = render(<SlideCopy frame={FRAME} theme="night" still />);
    const copy = container.querySelector('.lobby-copy');
    expect(copy.style.getPropertyValue('--lobby-shadow')).toBe('#1B2D5C');
    expect(copy.style.getPropertyValue('--lobby-kicker')).toBe('var(--brand-sun)');
  });

  it('a live copy mounts with every piece hidden, waiting for its beat', () => {
    const { container } = render(<SlideCopy frame={FRAME} via="handoff" />);
    const all = pieces(container);
    expect(all).toHaveLength(5);
    for (const el of all) expect(el.style.opacity).toBe('0');
  });

  it('under zero animation every piece is already landed', async () => {
    const { container } = render(
      <ZeroAnimationContext.Provider value>
        <SlideCopy frame={FRAME} via="wipe" />
      </ZeroAnimationContext.Provider>,
    );
    await waitFor(() => { for (const el of pieces(container)) expect(atRest(el)).toBe(true); }, { timeout: 150 });
  });

  // Paytone One's marks reach far past its caps (shoutBox): the row a mark
  // would crowd gets exactly the room it needs, as a top margin on that
  // row's words, and a mark hanging below the last row pads the headline.
  it('a row whose marks need room carries it on its words, and a hanging mark pads the headline', () => {
    const rowOf = (h, i) => h.starts.reduce((r, start, k) => (start <= i ? k : r), 0);
    const frames = [
      { kicker: 'Welcome', headline: 'Ștefan\nÉmile Nguyễn', sub: '', chip: null, textSize: 'auto' },
      { kicker: 'Welcome', headline: 'Émile\nȘtefan', sub: '', chip: null, textSize: 'auto' },
    ];
    const fits = frames.map((f) => fitFrame(f).headline);
    // The two frames between them need every kind of room: a lower row's
    // marks (Ễ under Ș), a first row's under the kicker (É), and a hanging
    // comma under the last row (Ș).
    expect(fits.every((h) => h.mode === 'shout' && h.lines.length === 2)).toBe(true);
    expect(fits[0].rise[0]).toBe(0);
    expect(fits[0].rise[1]).toBeGreaterThan(0);
    expect(fits[1].rise[0]).toBeGreaterThan(0);
    expect(fits[0].padBottom).toBe(SHOUT.shadow);
    expect(fits[1].padBottom).toBeGreaterThan(SHOUT.shadow);
    frames.forEach((frame, n) => {
      const h = fits[n];
      const { container, unmount } = render(<SlideCopy frame={frame} still />);
      const words = [...container.querySelectorAll('.lobby-headline .lobby-word')];
      expect(words).toHaveLength(h.tokens.length);
      words.forEach((w, i) => {
        const rise = h.rise[rowOf(h, i)];
        expect(w.style.marginTop, w.textContent).toBe(rise ? `${rise}em` : '');
      });
      expect(container.querySelector('.lobby-headline').style.paddingBottom).toBe(`${h.padBottom}em`);
      unmount();
    });
  });

  it('a long announcement reads instead of shouting, one element per word, rows split by <br>', () => {
    const text = 'Parents, please remember that pick-up is at the gym doors this week while the lobby floor is refinished.';
    const { container } = render(<SlideCopy frame={{ ...FRAME, headline: text, chip: null, sub: '' }} still />);
    const headline = container.querySelector('.lobby-headline--read');
    expect(headline).not.toBeNull();
    expect(headline.textContent).toBe(text);
    expect(headline.querySelectorAll('.lobby-word')).toHaveLength(text.split(' ').length);
    expect(headline.querySelectorAll('br').length).toBeGreaterThan(0);
  });

  it('sets its own direction from its text, so a Hebrew headline\'s words run right to left', () => {
    const { container } = render(<SlideCopy frame={{ ...FRAME, kicker: 'השבוע', headline: 'ברוכים הבאים לאוואנה' }} still />);
    for (const sel of ['.lobby-kicker', '.lobby-headline', '.lobby-sub']) expect(container.querySelector(sel).getAttribute('dir')).toBe('auto');
  });

  it('isolates a run of words that reads against the headline, in its own direction, in both layouts', () => {
    for (const [headline, mode] of [['Say שבת שלום טוב tonight', 'shout'], ['We say שבת שלום טוב to all of you and your whole family this week, see you all at club again next Wednesday night', 'read']]) {
      const { container, unmount } = render(<SlideCopy frame={{ ...FRAME, headline, sub: '', chip: null }} still />);
      const h = container.querySelector('.lobby-headline');
      expect(h.classList.contains(`lobby-headline--${mode}`)).toBe(true);
      const runs = h.querySelectorAll('bdi.lobby-run');
      expect(runs).toHaveLength(1);
      expect(runs[0].getAttribute('dir')).toBe('rtl');
      expect([...runs[0].querySelectorAll('.lobby-word')].map((w) => w.textContent)).toEqual(['שבת', 'שלום', 'טוב']);
      // The space before the run sits outside it, between it and "say", and
      // so do the run's two edge slots, empty here (lobbyWiring.test.jsx has
      // why they are there at all).
      expect(runs[0].textContent).toBe('שבת שלום טוב');
      for (const slot of [runs[0].previousSibling, runs[0].nextSibling]) {
        expect(slot.className).toBe('lobby-punct');
        expect(slot.childNodes).toHaveLength(0);
      }
      expect(runs[0].previousSibling.previousSibling.textContent).toBe(' ');
      // Every other word is outside any run, and the headline still reads as typed.
      expect(h.querySelectorAll('.lobby-word:not(bdi .lobby-word)').length).toBe(h.querySelectorAll('.lobby-word').length - 3);
      expect(h.textContent).toBe(headline);
      unmount();
    }
    const { container } = render(<SlideCopy frame={{ ...FRAME, headline: 'ברוכים Awana Clubs Tonight הבאים לערב המיוחד שלנו', sub: '', chip: null }} still />);
    const run = container.querySelector('bdi.lobby-run');
    expect(run.getAttribute('dir')).toBe('ltr');
    expect([...run.querySelectorAll('.lobby-word')].map((w) => w.textContent)).toEqual(['Awana', 'Clubs', 'Tonight']);
  });

  it('draws a row break inside a run where the fit put it, and nowhere else', () => {
    for (const headline of ['Say שבת שלום טוב tonight', 'Please say שבת שלום to your friends at club', 'Say שבת שלום לכל החברים tonight at club']) {
      const { container, unmount } = render(<SlideCopy frame={{ ...FRAME, kicker: '', headline, sub: '', chip: null }} still />);
      const h = container.querySelector('.lobby-headline');
      const fit = fitFrame({ kicker: '', headline, sub: '', chip: null, textSize: 'auto' }).headline;
      const [run] = bidiIsolates(fit.tokens);
      const inRun = fit.starts.filter((t) => t > run.from && t < run.to).length;
      expect(inRun, headline).toBeGreaterThan(0);
      expect(h.querySelectorAll('br'), headline).toHaveLength(fit.starts.length - 1);
      expect(h.querySelectorAll('bdi br'), headline).toHaveLength(inRun);
      expect(h.dataset.rows).toBe(String(fit.lines.length));
      unmount();
    }
  });

  it('draws the punctuation at a run\'s edges outside its <bdi>, in the headline\'s own direction', () => {
    const headline = 'We say "שבת שלום" to all';
    const { container } = render(<SlideCopy frame={{ ...FRAME, headline, sub: '', chip: null }} still />);
    const h = container.querySelector('.lobby-headline');
    const run = h.querySelector('bdi.lobby-run');
    expect([...run.querySelectorAll('.lobby-word')].map((w) => w.textContent)).toEqual(['שבת', 'שלום']);
    expect(run.textContent.replace(/\s/g, '')).toBe('שבתשלום');
    expect(run.previousElementSibling?.className).toBe('lobby-punct');
    expect(run.previousElementSibling.textContent).toBe('"');
    expect(run.nextElementSibling?.className).toBe('lobby-punct');
    expect(run.nextElementSibling.textContent).toBe('"');
    expect(h.textContent).toBe(headline);
  });

  it('a lone word against the headline is not isolated: its own box keeps its punctuation', () => {
    for (const [headline, word] of [['Say שלום, friends!', 'שלום,'], ['مرحبا بكم في Awana!', 'Awana!'], ['Welcome ל-Awana tonight', 'ל-Awana']]) {
      const { container, unmount } = render(<SlideCopy frame={{ ...FRAME, headline, sub: '', chip: null }} still />);
      expect(container.querySelector('bdi'), headline).toBeNull();
      expect(container.querySelector('.lobby-punct'), headline).toBeNull();
      expect([...container.querySelectorAll('.lobby-word')].map((w) => w.textContent)).toContain(word);
      unmount();
    }
  });

  it('a run-on list keeps one separator on each side of a name that reads against it', () => {
    const names = 'Ava Ben Cal Dee Eli Fay Gus Hal Ivy Jo Kit Lu Max Ned Oli Pia Quin Rose Sam Tess Uma Vic Wes Xan Yui Zane'.split(' ');
    const headline = ['Book finishers!', ...names.slice(0, 12), 'שרה כהן', ...names.slice(12)].join('\n');
    const { container } = render(<SlideCopy frame={{ ...FRAME, kicker: 'Thank you', headline, sub: '', chip: null }} still />);
    const h = container.querySelector('.lobby-headline');
    const run = h.querySelector('bdi.lobby-run');
    expect(run.textContent).toBe('שרה כהן');
    // The separator after the name sits outside its run, after a space.
    expect(run.nextSibling.textContent).toBe(' ');
    expect(run.nextSibling.nextSibling.className).toBe('lobby-punct');
    expect(run.nextSibling.nextSibling.textContent).toBe(READ.joiner.trim());
    expect(h.textContent).toContain(`Lu${READ.joiner} שרה כהן${READ.joiner} Max`);
  });

  it('a headline in one direction has no runs', () => {
    for (const headline of ['Making Bookmarks', 'ברוכים הבאים לאוואנה']) {
      const { container, unmount } = render(<SlideCopy frame={{ ...FRAME, headline }} still />);
      expect(container.querySelector('bdi')).toBeNull();
      unmount();
    }
  });

  it('joins the words of a sentence with no spaces with nothing', () => {
    const text = '欢迎来到今晚的俱乐部活动请带上你的手册和圣经';
    const { container } = render(<SlideCopy frame={{ ...FRAME, headline: text, sub: '', chip: null }} still />);
    const headline = container.querySelector('.lobby-headline');
    expect(headline.textContent).toBe(text);
    expect(headline.querySelectorAll('.lobby-word').length).toBeGreaterThan(3);
  });

  it('a word too wide for any line is drawn as the fit\'s own pieces, on rows of its own, inside the read layout\'s width', () => {
    const url = 'https://kvbc.example.org/awana/registration/2026-27/fall-family-sign-up-form?ref=lobby-tv&utm_source=signage&utm_campaign=fall-welcome-26';
    const { container } = render(<SlideCopy frame={{ ...FRAME, kicker: '', headline: `Register at ${url} tonight`, sub: '', chip: null }} still />);
    const wide = container.querySelector('.lobby-word--wide');
    expect(wide.textContent).toBe(url);
    expect(wide.style.maxWidth).toBe('calc(76 * var(--u))');
    // Its rows are the fit's own pieces, split by <br>, never the browser's
    // own wrap (which breaks after every hyphen, and needs more rows).
    const fit = fitFrame({ kicker: '', headline: `Register at ${url} tonight`, sub: '', chip: null, textSize: 'auto' });
    const pieces = fit.headline.lines.filter((_, r) => fit.headline.starts[r] === fit.headline.wide[0]);
    expect(pieces.length).toBeGreaterThan(1);
    expect(wide.querySelectorAll('br')).toHaveLength(pieces.length - 1);
    expect([...wide.childNodes].filter((n) => n.nodeType === 3).map((n) => n.data)).toEqual(pieces);
    expect(container.querySelector('.lobby-headline').dataset.rows).toBe(String(fit.headline.lines.length));
    // It is a block of its own, so no <br> sits beside it to add an empty row.
    expect(wide.previousElementSibling?.tagName).not.toBe('BR');
    expect(wide.nextElementSibling?.tagName).not.toBe('BR');
    expect(container.querySelector('.lobby-headline').textContent).toBe(`Register at ${url} tonight`);
  });

  it('a long kicker wraps to two lines instead of running off the screen', () => {
    const { container } = render(<SlideCopy frame={{ ...FRAME, kicker: '通'.repeat(60) }} still />);
    const kicker = container.querySelector('.lobby-kicker');
    expect(kicker.querySelectorAll('br')).toHaveLength(1);
    expect(kicker.textContent).toBe('通'.repeat(60));
  });
});
