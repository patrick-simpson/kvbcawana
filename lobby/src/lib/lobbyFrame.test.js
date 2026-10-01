import { describe, it, expect } from 'vitest';
import {
  CHIP, KICKER, LAYOUT, LOBBY_THEMES, READ, SHOUT, SUB,
  balancedBreaks, bidiIsolates, bidiRuns, edgeNeutrals, fitFrame, joinTokens, lobbyTheme, measureInk, measureText, paragraphs,
  shoutBox, slideFrame, splitRun, tokenDirection, tokenize,
} from './lobbyFrame.js';
import { SHOUT_BOX, markExtents } from './brand.js';
import { SLIDE_THEMES, MAX_TEXT } from './slides.js';
import { buildCalendarSlides, deriveClubInfo } from './calendarLogic.js';

// A deterministic stand-in for the canvas, close to the real faces: Paytone
// One's caps run ~0.63em a letter (Galindo's ran about 12% wider), Figtree
// ~0.55em, Londrina ~0.42em; an ideograph is a full em in any face. Ink (how
// far marks reach) is the fit's own estimate from the marks, markExtents,
// which is what measureInk falls back to here.
const PER = { shout: 0.63, read: 0.55, label: 0.42, body: 0.52 };
const IDEO = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303F\uFF01-\uFF60]/u;
const measure = (text, face) => [...text].reduce((w, ch) => w + (ch === ' ' ? 0.28 : IDEO.test(ch) ? 1 : PER[face]), 0);

const frame = (over = {}) => ({ kicker: '', headline: '', sub: '', chip: null, textSize: 'auto', ...over });

/** The width of one fitted row, in u, as the fit measured it. */
function rowWidth(fit, text) {
  const shout = fit.headline.mode === 'shout';
  return measure(shout ? text.toUpperCase() : text, shout ? 'shout' : 'read') * fit.headline.size;
}

function kickerWidth(fit, line) {
  return (measure(line.toUpperCase(), 'label') + KICKER.tracking * [...line].length) * fit.kicker.size;
}

function blockBottom(fit) {
  return fit.top + fit.height;
}

/** Every row of the block, top down: [top, width]. */
function rowsOf(fit) {
  const out = [];
  let y = fit.top;
  if (fit.kicker) {
    fit.kicker.lines.forEach((line) => {
      out.push([y, kickerWidth(fit, line)]);
      y += fit.kicker.size * fit.kicker.lineHeight;
    });
    y += KICKER.gap;
  }
  // Each row starts at the top of the room its marks rise into.
  fit.headline.lines.forEach((line, i) => {
    out.push([y, rowWidth(fit, line)]);
    y += fit.headline.size * (fit.headline.lineHeight + fit.headline.rise[i]);
  });
  return out;
}

const URL130 = 'https://kvbc.example.org/awana/registration/2026-27/fall-family-sign-up-form?ref=lobby-tv&utm_source=signage&utm_campaign=fall-welcome-26';

describe('slideFrame', () => {
  it('reads a typed slide as kicker + headline', () => {
    const f = slideFrame({ eyebrow: '  This   week ', text: 'Bring your handbook\n', textSize: 'lg' });
    expect(f).toEqual({ kicker: 'This week', headline: 'Bring your handbook', sub: '', chip: null, textSize: 'lg' });
  });

  it('keeps a calendar slide\'s own frame: the date moves to the chip, sized afresh', () => {
    const f = slideFrame({
      eyebrow: 'Next club night', text: 'Making Bookmarks — Wed, Sep 30', textSize: 'lg',
      frame: { headline: 'Making Bookmarks', chip: { label: 'WED', value: 'SEP 30' } },
    });
    expect(f).toEqual({ kicker: 'Next club night', headline: 'Making Bookmarks', sub: '', chip: { label: 'WED', value: 'SEP 30' }, textSize: 'auto' });
  });

  it('carries the old subtext as the supporting line', () => {
    expect(slideFrame({ text: 'Welcome to Water Night!', subtext: 'Poster Contest kicks off' }).sub).toBe('Poster Contest kicks off');
  });

  it('never throws on a half-empty slide', () => {
    expect(slideFrame(undefined)).toEqual({ kicker: '', headline: '', sub: '', chip: null, textSize: 'auto' });
    expect(slideFrame({ frame: { headline: 'Hi', chip: { label: 'WED' } } }).chip).toBeNull();
  });
});

describe('paragraphs, tokens and balanced breaks', () => {
  it('keeps the operator\'s own line breaks and drops blank lines', () => {
    expect(paragraphs('Welcome to\n\nAwana!')).toEqual([['Welcome', 'to'], ['Awana!']]);
    expect(paragraphs('  ')).toEqual([]);
  });

  it('never breaks inside a Latin word, hyphen, apostrophe or URL', () => {
    expect(paragraphs('Pick-up is at the gym doors tonight! Don\'t forget')).toEqual([['Pick-up', 'is', 'at', 'the', 'gym', 'doors', 'tonight!', 'Don\'t', 'forget']]);
    expect(paragraphs(URL130)).toEqual([[URL130]]);
  });

  it('finds the words of a sentence with no spaces (Chinese, Japanese, Thai), and joins them with nothing', () => {
    for (const text of ['欢迎来到今晚的俱乐部活动，请带上你的手册！', '今夜のクラブへようこそ。ハンドブックを持ってきてね', 'ยินดีต้อนรับสู่ชมรมคืนนี้']) {
      const [tokens] = tokenize(text);
      expect(tokens.length).toBeGreaterThan(2);
      expect(tokens.slice(1).every((t) => t.space === false)).toBe(true);
      expect(joinTokens(tokens)).toBe(text);
    }
  });

  it('punctuation rides with its word: no row starts with a comma or ends with an opening bracket', () => {
    const parts = splitRun('你好，世界。「俱乐部」见');
    expect(parts.join('')).toBe('你好，世界。「俱乐部」见');
    for (const part of parts) {
      expect(part).not.toMatch(/^[，。」]/u);
      expect(part).not.toMatch(/「$/u);
    }
  });

  it('a mixed run breaks only where it touches an unspaced script', () => {
    expect(splitRun('Awana俱乐部')).toEqual(expect.arrayContaining(['Awana']));
    expect(splitRun('Pick-up')).toEqual(['Pick-up']);
  });

  it('without Intl.Segmenter, Han still breaks between characters and Thai stays whole', () => {
    expect(splitRun('你好世界', null)).toEqual(['你', '好', '世', '界']);
    expect(splitRun('ยินดีต้อนรับ', null)).toEqual(['ยินดีต้อนรับ']);
  });

  it('splits the way the mockup sets its headlines', () => {
    const split = (text, k) => {
      const words = text.split(' ');
      const { breaks } = balancedBreaks(words.map((w) => measure(w, 'shout')), 0.28, k);
      return breaks.map((b, i) => words.slice(b, breaks[i + 1]).join(' '));
    };
    expect(split('MAKING BOOKMARKS', 2)).toEqual(['MAKING', 'BOOKMARKS']);
    expect(split('BRING YOUR HANDBOOK', 2)).toEqual(['BRING YOUR', 'HANDBOOK']);
    expect(split('PICK-UP IS AT THE GYM DOORS', 2)).toEqual(['PICK-UP IS AT', 'THE GYM DOORS']);
  });

  it('never asks for more lines than there are words, and counts no gap where tokens join', () => {
    expect(balancedBreaks([1, 2], 0.3, 5).breaks).toEqual([0, 1]);
    expect(balancedBreaks([1, 1, 1], [0, 0, 0], 1).max).toBe(3);
    expect(balancedBreaks([1, 1, 1], [0, 0.5, 0.5], 1).max).toBe(4);
  });
});

describe('fitFrame: the shouted headline', () => {
  it('sets the mockup\'s calendar slide exactly: two lines at its cap height (7.6u), chip under, all above the waves', () => {
    const fit = fitFrame(frame({ kicker: 'Next club night', headline: 'Making Bookmarks', chip: { label: 'WED', value: 'SEP 30' } }), measure);
    expect(fit.headline).toMatchObject({ mode: 'shout', size: SHOUT.max, lines: ['Making', 'Bookmarks'], starts: [0, 1] });
    expect(fit.top).toBe(LAYOUT.top);
    expect(fit.kicker).toEqual({ text: 'Next club night', size: KICKER.size, lines: ['Next club night'], lineHeight: KICKER.lineHeight });
    expect(fit.chip).toMatchObject({ label: 'WED', value: 'SEP 30', size: CHIP.size });
    expect(blockBottom(fit)).toBeLessThanOrEqual(LAYOUT.safeBottom);
  });

  it('a short line stays one line at full size', () => {
    const fit = fitFrame(frame({ headline: 'Hi!' }), measure);
    expect(fit.headline).toMatchObject({ mode: 'shout', size: SHOUT.max, lines: ['Hi!'] });
  });

  it('prefers the mockup\'s measure, stepping down a little before running edge to edge', () => {
    const fit = fitFrame(frame({ kicker: 'Mark your calendar', headline: 'Next week: Making Bookmarks', chip: { label: 'WED', value: 'SEP 30' } }), measure);
    expect(fit.headline.mode).toBe('shout');
    for (const line of fit.headline.lines) expect(rowWidth(fit, line)).toBeLessThanOrEqual(LAYOUT.measure);
    expect(fit.headline.size).toBeGreaterThanOrEqual(SHOUT.measured);
  });

  it('a single long word shrinks rather than breaking, and still shouts', () => {
    const fit = fitFrame(frame({ headline: 'Supercalifragilistic' }), measure);
    expect(fit.headline).toMatchObject({ mode: 'shout', lines: ['Supercalifragilistic'] });
    expect(rowWidth(fit, fit.headline.lines[0])).toBeLessThanOrEqual(LAYOUT.width);
  });

  it('a headline that only fits the full width still shouts, between SHOUT.min and SHOUT.measured', () => {
    const fit = fitFrame(frame({ headline: 'Supercalifragilisticexp' }), measure);
    expect(fit.headline.mode).toBe('shout');
    expect(fit.headline.size).toBeLessThan(SHOUT.measured);
    expect(fit.headline.size).toBeGreaterThanOrEqual(SHOUT.min);
  });

  it('keeps the operator\'s line breaks', () => {
    expect(fitFrame(frame({ headline: 'Welcome to\nAwana!' }), measure).headline.lines).toEqual(['Welcome to', 'Awana!']);
  });

  it('honours an explicit size: lg shouts smaller than auto, xl as big, md reads', () => {
    const auto = fitFrame(frame({ headline: 'Hi!' }), measure).headline;
    const lg = fitFrame(frame({ headline: 'Hi!', textSize: 'lg' }), measure).headline;
    const xl = fitFrame(frame({ headline: 'Hi!', textSize: 'xl' }), measure).headline;
    expect(lg.mode).toBe('shout');
    expect(lg.size).toBeLessThan(auto.size);
    expect(lg.size).toBe(6.1);
    expect(xl.size).toBe(auto.size);
    expect(fitFrame(frame({ headline: 'Hi!', textSize: 'md' }), measure).headline).toMatchObject({ mode: 'read', size: READ.max });
  });
});

describe('fitFrame: text too long to shout', () => {
  it('reads instead of building a wall of caps', () => {
    const fit = fitFrame(frame({ headline: 'Don\'t forget: bring your Bible and your handbook every single week!' }), measure);
    expect(fit.headline.mode).toBe('read');
    expect(fit.headline.size).toBeLessThanOrEqual(READ.max);
  });

  it('a max-length slide still fits the box', () => {
    const text = 'Parents, please remember that pick-up is at the gym doors this week. '.repeat(10).slice(0, MAX_TEXT);
    const fit = fitFrame(frame({ kicker: 'Important', headline: text }), measure);
    expect(fit.headline.mode).toBe('read');
    expect(fit.headline.wide).toEqual([]);
    for (const line of fit.headline.lines) expect(rowWidth(fit, line)).toBeLessThanOrEqual(READ.width + 1e-6);
    expect(blockBottom(fit)).toBeLessThanOrEqual(LAYOUT.safeBottom + 1e-6);
    expect(fit.top).toBeGreaterThanOrEqual(LAYOUT.safeTop);
  });

  it('a word wider than any line keeps a readable size and is cut across rows of its own, inside the line\'s width', () => {
    for (const headline of [URL130, 'x'.repeat(400), `Register at ${URL130} tonight`]) {
      const fit = fitFrame(frame({ headline }), measure);
      expect(fit.headline.mode).toBe('read');
      expect(fit.headline.wide.length).toBe(1);
      expect(fit.headline.size).toBeGreaterThanOrEqual(2.4);
      for (const line of fit.headline.lines) expect(rowWidth(fit, line)).toBeLessThanOrEqual(READ.width + 1e-6);
      // The cut word's rows hold nothing else.
      const w = fit.headline.wide[0];
      fit.headline.starts.forEach((start, r) => {
        if (start === w) expect(URL130 + 'x'.repeat(400)).toContain(fit.headline.lines[r]);
      });
      expect(blockBottom(fit)).toBeLessThanOrEqual(LAYOUT.safeBottom + 1e-6);
    }
  });

  it('a URL that would fit whole only below 2.4u is cut at a readable size instead', () => {
    // 90 characters: whole on one line only at about 1.5u, a hairline from
    // across the lobby. It keeps the largest size its cut rows fit at.
    const url = 'https://kvbc.example.org/awana/fall-2026/registration-form-for-families?ref=lobby-signage';
    expect(url.length).toBeGreaterThanOrEqual(88);
    expect(measure(url, 'read') * 1.5).toBeLessThanOrEqual(READ.width);
    const fit = fitFrame(frame({ headline: url }), measure);
    expect(fit.headline).toMatchObject({ mode: 'read', wide: [0] });
    expect(fit.headline.size).toBeGreaterThanOrEqual(2.4);
    expect(fit.headline.lines.join('')).toBe(url);
    expect(fit.headline.lines.length).toBeGreaterThan(1);
  });

  it('a word that would fit whole at 2.3u is still cut, at 2.4u or more', () => {
    // 59 characters: whole on one line at 2.3u, but not at 2.4u. The floor is
    // 2.4u, so it is cut at the largest size its rows fit at instead.
    const url = 'https://kvbc.example.org/awana/fall-2026/register?ref=lobby';
    expect(measure(url, 'read') * 2.3).toBeLessThanOrEqual(READ.width);
    expect(measure(url, 'read') * 2.4).toBeGreaterThan(READ.width);
    const fit = fitFrame(frame({ headline: url }), measure);
    expect(fit.headline).toMatchObject({ mode: 'read', wide: [0] });
    expect(fit.headline.size).toBeGreaterThanOrEqual(2.4);
    expect(fit.headline.lines.join('')).toBe(url);
  });

  it('a long word that fits whole at a readable size is never cut', () => {
    const fit = fitFrame(frame({ headline: 'x'.repeat(45) }), measure);
    expect(fit.headline).toMatchObject({ mode: 'read', wide: [] });
    expect(fit.headline.lines).toEqual(['x'.repeat(45)]);
  });

  it('many typed line breaks never run past the box: the lines run on, a dot between each', () => {
    const names = ['Ava', 'Ben', 'Cal', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kit', 'Lu', 'Max', 'Ned', 'Oli', 'Pia', 'Quin', 'Ruth', 'Sam', 'Tess'];
    for (const kicker of ['', 'Congratulations']) {
      for (const n of [20, 30]) {
        const list = Array.from({ length: n }, (_, i) => names[i % names.length]);
        const text = ['Book finishers!', ...list].join('\n');
        const fit = fitFrame(frame({ kicker, headline: text }), measure);
        expect(fit.top + fit.height).toBeLessThanOrEqual(LAYOUT.safeBottom + 1e-6);
        expect(fit.headline).toMatchObject({ mode: 'read', joined: true });
        expect(fit.headline.size).toBeGreaterThanOrEqual(READ.floor);
        expect(fit.headline.tokens.map((t) => t.text.replace(READ.joiner, ''))).toEqual(['Book', 'finishers!', ...list]);
        expect(fit.headline.lines.join(' ')).toContain('finishers! · Ava · Ben');
      }
    }
  });

  it('a list that still fits at the floor keeps its breaks, inside the box', () => {
    const text = ['Book finishers!', ...Array.from({ length: 16 }, (_, i) => `Name ${i + 1}`)].join('\n');
    const fit = fitFrame(frame({ headline: text }), measure);
    expect(fit.headline).toMatchObject({ mode: 'read', joined: false });
    expect(fit.headline.lines).toHaveLength(17);
    expect(fit.headline.size).toBeGreaterThanOrEqual(READ.floor);
    expect(blockBottom(fit)).toBeLessThanOrEqual(LAYOUT.safeBottom + 1e-6);
  });

  it('a short list keeps its breaks', () => {
    const fit = fitFrame(frame({ kicker: 'Tonight', headline: '6:30 Opening\n6:45 Small groups\n7:15 Game time\n7:45 Pick-up' }), measure);
    expect(fit.headline.joined).toBe(false);
    expect(fit.headline.lines).toEqual(['6:30 Opening', '6:45 Small groups', '7:15 Game time', '7:45 Pick-up']);
  });

  it('a sentence with no spaces wraps between its words at a readable size', () => {
    const text = '欢迎来到今晚的俱乐部活动请带上你的手册和圣经我们一起学习一起玩游戏欢迎你';
    const fit = fitFrame(frame({ headline: text }), measure);
    expect(fit.headline.lines.length).toBeGreaterThan(1);
    expect(fit.headline.size).toBeGreaterThanOrEqual(4);
    expect(fit.headline.lines.join('')).toBe(text);
    for (const line of fit.headline.lines) expect(rowWidth(fit, line)).toBeLessThanOrEqual(READ.width + 1e-6);
  });
});

describe('fitFrame: scripts that stack their marks', () => {
  // At the shout's .98 line height the marks above and below these letters
  // touch across rows (Thai in the fallback face, Devanagari in Baloo 2,
  // measured); at the read layout's 1.22 they clear. One sample per script
  // the fit names, so dropping any of them from the rule fails here.
  const STACKED = {
    thai: 'ยินดีต้อนรับ คืนนี้',
    lao: 'ສະບາຍດີ ທຸກຄົນ',
    khmer: 'សូមស្វាគមន៍មកកាន់ក្លឹប យប់នេះ',
    myanmar: 'ယနေ့ညကလပ်သို့ ကြိုဆိုပါသည်',
    tibetan: 'བཀྲ་ཤིས་བདེ་ལེགས།',
    // The u-matra under the bha of the first row runs through the i-matra's
    // loop over the ti of the second: 0.17em deep at .98, in Baloo 2.
    devanagari: 'प्रभु की\nस्तुति करो',
    bengali: 'আজ রাতে ক্লাবে স্বাগতম',
    gurmukhi: 'ਅੱਜ ਰਾਤ ਕਲੱਬ ਵਿੱਚ ਜੀ ਆਇਆਂ ਨੂੰ',
    gujarati: 'આજે રાત્રે ક્લબમાં સ્વાગત છે',
    oriya: 'ଆଜି ରାତିରେ କ୍ଲବକୁ ସ୍ୱାଗତ',
    tamil: 'இன்றிரவு கிளப்புக்கு வரவேற்கிறோம்',
    telugu: 'ఈ రాత్రి క్లబ్‌కు స్వాగతం',
    kannada: 'ಇಂದು ರಾತ್ರಿ ಕ್ಲಬ್‌ಗೆ ಸ್ವಾಗತ',
    malayalam: 'ഇന്ന് രാത്രി ക്ലബ്ബിലേക്ക് സ്വാഗതം',
    sinhala: 'අද රාත්‍රී සමාජයට සාදරයෙන් පිළිගනිමු',
  };

  it('read instead of shouting, whatever size the slide asks for', () => {
    for (const [script, headline] of Object.entries(STACKED)) {
      // Short enough to shout, were it in a script that could: the same
      // number of letters in Latin shouts.
      expect(fitFrame(frame({ headline: headline.replace(/\S/gu, 'x') }), measure).headline.mode, script).toBe('shout');
      for (const textSize of ['auto', 'xl', 'lg']) {
        const fit = fitFrame(frame({ headline, textSize }), measure);
        expect(fit.headline.mode, `${script} at ${textSize}`).toBe('read');
        expect(fit.headline.lineHeight).toBe(READ.lineHeight);
      }
    }
    // Even one word of them in an English headline.
    expect(fitFrame(frame({ headline: 'Welcome ยินดีต้อนรับ' }), measure).headline.mode).toBe('read');
    expect(fitFrame(frame({ headline: 'Sparks कृपया\nकिताबें Truth' }), measure).headline.mode).toBe('read');
  });

  it('the scripts that keep their marks clear of the next row still shout: Latin, Vietnamese, Hebrew, Arabic, Chinese', () => {
    for (const headline of ['Making bookmarks', 'Chào mừng các em', 'ברוכים הבאים', 'مرحبا بكم', '欢迎来到俱乐部']) {
      expect(fitFrame(frame({ headline }), measure).headline.mode, headline).toBe('shout');
    }
  });
});

describe('fitFrame: the marks over and under the shout\'s capitals', () => {
  // Paytone One draws them tall: É to 1.045em, Ễ to 1.161em, Ș's comma to
  // -0.351em, against plain caps rows .93em apart. Each check below is in em
  // of the headline, with the fit's own ink (markExtents, measureInk's
  // canvas-less estimate).
  const above = (lh) => (SHOUT_BOX.ascent - SHOUT_BOX.descent + lh) / 2;
  const inkOf = (line) => markExtents(line.toUpperCase());

  /** Every mark clears the row it faces, the kicker and the headline's bottom edge. */
  function clearsEverything(fit, kicker) {
    const h = fit.headline;
    const inks = h.lines.map(inkOf);
    inks.forEach((ink, i) => {
      if (i === 0) {
        const room = kicker ? KICKER.gap / h.size - SHOUT.markGap : 0;
        expect(above(h.lineHeight) + h.rise[0] + room + 1e-6, h.lines[0]).toBeGreaterThanOrEqual(ink.ascent);
      } else {
        expect(h.lineHeight + h.rise[i] + 1e-6, h.lines[i])
          .toBeGreaterThanOrEqual(inks[i - 1].descent + SHOUT.shadow + SHOUT.markGap + ink.ascent);
      }
    });
    const last = inks[inks.length - 1];
    expect(h.lineHeight - above(h.lineHeight) + h.padBottom + 1e-6).toBeGreaterThanOrEqual(last.descent + SHOUT.shadow);
  }

  it('plain caps take the plain pitch and the shadow\'s room, nothing more', () => {
    for (const headline of ['Bring your handbook', 'Making Bookmarks', 'The gym doors open at 6:15', 'Quiz night!']) {
      const h = fitFrame(frame({ kicker: 'This week', headline }), measure).headline;
      expect(h.mode).toBe('shout');
      expect(h.lineHeight).toBe(SHOUT.lineHeight);
      expect(h.rise).toEqual(h.lines.map(() => 0));
      expect(h.padBottom).toBe(SHOUT.shadow);
    }
  });

  it('an accented row gets room above it, and only that row', () => {
    const fit = fitFrame(frame({ kicker: 'Esta semana', headline: 'Bienvenidos\nInscripción abierta' }), measure);
    const h = fit.headline;
    expect(h.mode).toBe('shout');
    expect(h.lines).toEqual(['Bienvenidos', 'Inscripción', 'abierta']);
    expect(h.rise[0]).toBe(0);
    expect(h.rise[1]).toBeGreaterThan(0.2);
    expect(h.rise[2]).toBe(0);
    expect(h.lineHeight).toBe(SHOUT.lineHeight);
    clearsEverything(fit, true);
  });

  it('a first-row accent may rise into the kicker\'s gap, never onto the kicker; with no kicker it stays in the box', () => {
    const withKicker = fitFrame(frame({ kicker: 'Welcome', headline: 'José' }), measure);
    const alone = fitFrame(frame({ headline: 'José' }), measure);
    expect(withKicker.headline.rise[0]).toBeGreaterThan(0);
    expect(alone.headline.rise[0]).toBeGreaterThan(withKicker.headline.rise[0]);
    clearsEverything(withKicker, true);
    clearsEverything(alone, false);
  });

  it('a comma below the last row gets room over the chip; one above a stacked accent opens that gap alone', () => {
    const fit = fitFrame(frame({ kicker: 'Welcome', headline: 'Ștefan', chip: { label: 'WED', value: 'SEP 30' } }), measure);
    expect(fit.headline.padBottom).toBeGreaterThan(SHOUT.shadow);
    clearsEverything(fit, true);
    const both = fitFrame(frame({ kicker: 'Welcome', headline: 'Ștefan · José\nNguyễn' }), measure);
    expect(both.headline.rise[1]).toBeGreaterThan(0.5);
    clearsEverything(both, true);
    expect(blockBottom(both)).toBeLessThanOrEqual(LAYOUT.safeBottom + 1e-6);
  });

  it('shoutBox reads measured ink too: the real É and Ș', () => {
    const real = { 'JOSÉ': { ascent: 1.045, descent: 0 }, 'ȘTEFAN': { ascent: 0.703, descent: 0.351 } };
    const box = shoutBox(['ȘTEFAN', 'JOSÉ'], (l) => real[l], 7.6, false);
    expect(box.rise[1]).toBeCloseTo(0.351 + SHOUT.shadow + SHOUT.markGap + 1.045 - SHOUT.lineHeight, 3);
    expect(box.rise[0]).toBe(0);
    expect(box.padBottom).toBe(SHOUT.shadow);
  });

  it('measureInk estimates from the marks when there is no canvas', () => {
    expect(measureInk('MAYA', 'shout')).toEqual({ ascent: 0.7, descent: 0.02 });
    expect(measureInk('JOSÉ', 'shout').ascent).toBeCloseTo(1.05);
    expect(measureInk('NGUYỄN', 'shout').ascent).toBeCloseTo(1.17);
    expect(measureInk('ȘTEFAN', 'shout').descent).toBeCloseTo(0.36);
    // Decomposed (NFD) text reads the same as composed.
    expect(measureInk('JOSE\u0301', 'shout')).toEqual(measureInk('JOSÉ', 'shout'));
  });
});

describe('bidiRuns: words that read against the headline', () => {
  const runsOf = (text) => bidiRuns(tokenize(text).flat());
  const words = (text, run) => tokenize(text).flat().slice(run.from, run.to).map((t) => t.text);

  it('reads each token\'s direction from its first strong letter', () => {
    expect(['Awana', 'שבת', 'مرحبا', '2026', '7:30', '—', '(שלום)', 'ל-Awana', '\u200Fx'].map(tokenDirection))
      .toEqual(['ltr', 'rtl', 'rtl', 'num', 'num', null, 'rtl', 'rtl', 'rtl']);
  });

  it('isolates a Hebrew phrase in an English sentence, and English in a Hebrew one', () => {
    const en = 'We say שבת שלום טוב to all of you';
    expect(runsOf(en)).toEqual({ dir: 'ltr', runs: [{ from: 2, to: 5, dir: 'rtl' }] });
    expect(words(en, runsOf(en).runs[0])).toEqual(['שבת', 'שלום', 'טוב']);
    const he = 'ברוכים Awana Clubs Tonight הבאים';
    expect(runsOf(he)).toEqual({ dir: 'rtl', runs: [{ from: 1, to: 4, dir: 'ltr' }] });
    expect(words(he, runsOf(he).runs[0])).toEqual(['Awana', 'Clubs', 'Tonight']);
  });

  it('one direction throughout has no runs', () => {
    expect(runsOf('Bring your handbook')).toEqual({ dir: 'ltr', runs: [] });
    expect(runsOf('ברוכים הבאים לאוואנה')).toEqual({ dir: 'rtl', runs: [] });
    expect(runsOf('— 7:30 —')).toEqual({ dir: 'ltr', runs: [] });
    expect(runsOf('')).toEqual({ dir: 'ltr', runs: [] });
  });

  it('a number reads with the text before it; punctuation joins a run only inside it', () => {
    // 5 follows Hebrew: it is part of the Hebrew run.
    expect(runsOf('We say שבת 5 שלום to all').runs).toEqual([{ from: 2, to: 5, dir: 'rtl' }]);
    // 2026 follows English in a Hebrew headline: part of the English run.
    expect(runsOf('ברוכים Awana 2026 הערב').runs).toEqual([{ from: 1, to: 3, dir: 'ltr' }]);
    // A dash between two Hebrew words joins them; one at the run's edge stays outside.
    expect(runsOf('Say שבת — שלום tonight').runs).toEqual([{ from: 1, to: 4, dir: 'rtl' }]);
    expect(runsOf('Say שבת שלום — tonight').runs).toEqual([{ from: 1, to: 3, dir: 'rtl' }]);
    // A URL in a Hebrew slide is a left-to-right run of one.
    expect(runsOf('הירשמו באתר https://kvbc.example.org/ הערב').runs).toEqual([{ from: 2, to: 3, dir: 'ltr' }]);
  });

  it('depends on the words alone: a run-on list\'s separators move no token into or out of a run', () => {
    const text = ['Thank you', 'שבת שלום', 'See you next week'].join('\n');
    const plain = runsOf(text);
    const joined = tokenize(text).flatMap((p, i, all) => p.map((t, j) => (i < all.length - 1 && j === p.length - 1 ? { ...t, text: t.text + READ.joiner } : t)));
    expect(bidiRuns(joined)).toEqual(plain);
    expect(plain.runs).toEqual([{ from: 2, to: 4, dir: 'rtl' }]);
  });
});

describe('edgeNeutrals: the punctuation at a token\'s two ends', () => {
  it('splits off what the bidi algorithm places by the words around it', () => {
    expect(edgeNeutrals('שלום,')).toEqual(['', 'שלום', ',']);
    expect(edgeNeutrals('"שבת')).toEqual(['"', 'שבת', '']);
    expect(edgeNeutrals('(חברים)')).toEqual(['(', 'חברים', ')']);
    expect(edgeNeutrals('Awana!')).toEqual(['', 'Awana', '!']);
    expect(edgeNeutrals('«שלום»?!')).toEqual(['«', 'שלום', '»?!']);
    expect(edgeNeutrals(`כהן${READ.joiner}`)).toEqual(['', 'כהן', READ.joiner]);
    // Inside the word it stays: a hyphen, an apostrophe, a combining mark.
    expect(edgeNeutrals('ל-Awana')).toEqual(['', 'ל-Awana', '']);
    expect(edgeNeutrals('Don\'t')).toEqual(['', 'Don\'t', '']);
    expect(edgeNeutrals('कृपया।')).toEqual(['', 'कृपया', '।']);
  });

  it('a number keeps its own signs; a token of punctuation alone is all core', () => {
    expect(edgeNeutrals('50%')).toEqual(['', '50%', '']);
    expect(edgeNeutrals('$5,')).toEqual(['', '$5', ',']);
    expect(edgeNeutrals('2026.')).toEqual(['', '2026', '.']);
    expect(edgeNeutrals('7:30')).toEqual(['', '7:30', '']);
    expect(edgeNeutrals('—')).toEqual(['', '—', '']);
    expect(edgeNeutrals('')).toEqual(['', '', '']);
  });
});

describe('bidiIsolates: what the page wraps in a <bdi>, and what it leaves outside', () => {
  const isolatesOf = (text) => bidiIsolates(tokenize(text).flat());

  it('a run of one word is not isolated: its own box already reads as plain text would', () => {
    for (const text of ['Say שלום, friends!', 'We always say שלום.', 'Can you say مرحبا? Try it tonight', 'مرحبا بكم في Awana!',
      'ברוכים הבאים ל Awana!', 'Welcome ל-Awana tonight', 'Our friends (חברים) come tonight', 'הירשמו באתר https://kvbc.example.org/ הערב']) {
      expect(bidiRuns(tokenize(text).flat()).runs, text).toHaveLength(1);
      expect(isolatesOf(text), text).toEqual([]);
    }
  });

  it('a longer run leaves the neutrals at its two edges outside, and keeps the ones between its words', () => {
    expect(isolatesOf('We say "שבת שלום" to all')).toEqual([{ from: 2, to: 4, dir: 'rtl', lead: '"', trail: '"' }]);
    expect(isolatesOf('We say שבת שלום, and see you next week')).toEqual([{ from: 2, to: 4, dir: 'rtl', lead: '', trail: ',' }]);
    expect(isolatesOf('ברוכים הבאים, Awana Clubs.')).toEqual([{ from: 2, to: 4, dir: 'ltr', lead: '', trail: '.' }]);
    expect(isolatesOf('Say שבת, שלום tonight')).toEqual([{ from: 1, to: 3, dir: 'rtl', lead: '', trail: '' }]);
    expect(isolatesOf('Say שבת שלום 2026. Tonight')).toEqual([{ from: 1, to: 4, dir: 'rtl', lead: '', trail: '.' }]);
  });

  it('a run-on list\'s separator after a name that reads against the headline is left outside its run', () => {
    const text = ['Thank you', 'שרה כהן', 'See you next week'].join('\n');
    const joined = tokenize(text).flatMap((p, i, all) => p.map((t, j) => (i < all.length - 1 && j === p.length - 1 ? { ...t, text: t.text + READ.joiner } : t)));
    expect(bidiIsolates(joined)).toEqual([{ from: 2, to: 4, dir: 'rtl', lead: '', trail: READ.joiner }]);
    expect(bidiIsolates(tokenize(text).flat())).toEqual([{ from: 2, to: 4, dir: 'rtl', lead: '', trail: '' }]);
  });
});

describe('fitFrame: the kicker', () => {
  it('a long kicker wraps to two balanced lines rather than running off the screen', () => {
    for (const kicker of ['通'.repeat(60), '重要通知：今晚所有家长请在体育馆门口接孩子，谢谢大家的配合与支持！感谢各位家长和志愿者今晚的辛勤付出与热情帮助！', 'W'.repeat(60)]) {
      const fit = fitFrame(frame({ kicker, headline: 'Hi' }), measure);
      for (const line of fit.kicker.lines) expect(kickerWidth(fit, line)).toBeLessThanOrEqual(LAYOUT.width + 1e-6);
      expect(fit.kicker.lines.join('')).toBe(kicker);
      expect(blockBottom(fit)).toBeLessThanOrEqual(LAYOUT.safeBottom + 1e-6);
    }
    const cjk = fitFrame(frame({ kicker: '重要通知：今晚所有家长请在体育馆门口接孩子，谢谢大家的配合与支持！感谢各位家长和志愿者今晚的辛勤付出与热情帮助！', headline: 'Hi' }), measure);
    expect(cjk.kicker.lines).toHaveLength(2);
    expect(cjk.kicker.size).toBeGreaterThanOrEqual(KICKER.min);
  });
});

describe('fitFrame: the corners', () => {
  const long = 'Parents, please remember that pick-up is at the gym doors this week. '.repeat(10).slice(0, MAX_TEXT);

  it('a wide top row never rises into the corner tab or the top-right stack', () => {
    const fit = fitFrame(frame({ kicker: 'Important announcement for all parents and guardians tonight', headline: long }), measure);
    expect(kickerWidth(fit, fit.kicker.lines[0])).toBeGreaterThan(LAYOUT.clearWidth);
    expect(fit.top).toBeGreaterThanOrEqual(LAYOUT.clearTop);
    expect(blockBottom(fit)).toBeLessThanOrEqual(LAYOUT.safeBottom + 1e-6);
  });

  it('a narrow kicker may rise between them, so a long slide keeps its room', () => {
    const fit = fitFrame(frame({ kicker: 'Important', headline: long }), measure);
    expect(fit.top).toBeLessThan(LAYOUT.clearTop);
    expect(kickerWidth(fit, fit.kicker.lines[0])).toBeLessThanOrEqual(LAYOUT.clearWidth);
    const wide = fitFrame(frame({ kicker: 'Important announcement for all parents and guardians tonight', headline: long }), measure);
    expect(fit.headline.size).toBeGreaterThan(wide.headline.size);
  });

  it('with no kicker, a wide first row stays below the corners too', () => {
    const fit = fitFrame(frame({ headline: long }), measure);
    expect(fit.top).toBeGreaterThanOrEqual(LAYOUT.clearTop);
  });
});

describe('fitFrame: the invariants, over many texts', () => {
  // A cheap deterministic generator: every length from a word to a full
  // slide, in several scripts, with and without the operator's line breaks.
  const LATIN = ['Awana', 'club', 'night', 'is', 'at', 'the', 'gym', 'doors', 'bring', 'a', 'friend', 'handbook', 'Pick-up', 'tonight!', 'Wednesday,', 'September', '30'];
  const HEBREW = ['ברוכים', 'הבאים', 'לאוואנה', 'הערב', 'הביאו', 'חבר'];
  const THAI = ['ยินดีต้อนรับ', 'สู่ชมรม', 'คืนนี้', 'นำเพื่อนมา'];
  const CJK = ['欢迎', '来到', '俱乐部', '今晚', '请带上', '手册', '，', '！'];
  let seed = 7;
  const rand = (n) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  const texts = [];
  for (let n = 1; n < 90; n += 1) {
    const script = n % 4;
    const words = [];
    for (let i = 0; i < n; i += 1) {
      if (script === 0 || script === 1) words.push(LATIN[rand(LATIN.length)]);
      else if (script === 2) words.push(n % 8 === 2 ? HEBREW[rand(HEBREW.length)] : THAI[rand(THAI.length)]);
      else words.push(CJK[rand(CJK.length)]);
    }
    // Every other Latin text gets line breaks, some of them a lot.
    const sep = () => (script === 1 && rand(n % 3 === 0 ? 2 : 6) === 0 ? '\n' : script === 3 ? '' : ' ');
    texts.push(words.reduce((acc, w, i) => (i === 0 ? w : acc + sep() + w), '').slice(0, MAX_TEXT));
  }
  texts.push(Array.from({ length: 30 }, (_, i) => `Leader ${i + 1}`).join('\n'));
  // Marks over and under the capitals, on every row and at every length.
  const MARKED = ['José', 'Ștefan', 'Nguyễn', 'inscripción', 'niños', 'Çağla', 'Zoë', 'Åsa', 'Émile', 'Ąžuolas'];
  for (let n = 1; n < 14; n += 1) {
    texts.push(Array.from({ length: n }, (_, i) => (i % 2 ? LATIN[rand(LATIN.length)] : MARKED[rand(MARKED.length)])).join(n % 3 ? ' ' : '\n'));
  }
  texts.push(`Register at ${URL130}`);
  texts.push('通'.repeat(MAX_TEXT));

  const KICKERS = [{}, { kicker: 'This week' }, { kicker: 'Heads up', chip: { label: 'BACK WED', value: 'DEC 2' }, sub: 'Christmas Break' },
    { kicker: 'Important announcement for all parents and guardians tonight' }, { kicker: '通'.repeat(60) }];

  // A sweep of about 525 fits: under coverage on a busy machine it has taken
  // over 7 s, past vitest's 5 s default, so it gets its own limit.
  it('never breaks inside a word, never leaves the box, never collides with the chrome', () => {
    for (const text of texts) {
      for (const extra of KICKERS) {
        const fit = fitFrame(frame({ headline: text, ...extra }), measure);
        const h = fit.headline;
        const wide = new Set(h.wide);
        // The tokens are the text, in order, whatever the layout.
        expect(h.tokens.map((t) => t.text.replace(READ.joiner, '')).join('')).toBe(text.replace(/\s+/g, ''));
        // Rows break only between tokens; only a token wider than any line spans rows.
        h.starts.forEach((start, r) => {
          const next = h.starts[r + 1] ?? h.tokens.length;
          if (wide.has(start)) expect(h.tokens[start].text).toContain(h.lines[r]);
          else expect(h.lines[r]).toBe(joinTokens(h.tokens, start, next));
        });
        const limit = h.mode === 'shout' ? LAYOUT.width : READ.width;
        for (const line of h.lines) expect(rowWidth(fit, line)).toBeLessThanOrEqual(limit + 1e-6);
        if (h.mode === 'shout') {
          expect(h.lines.length).toBeLessThanOrEqual(SHOUT.maxLines);
          if (h.lines.some((line) => rowWidth(fit, line) > LAYOUT.measure + 1e-6)) expect(h.lines.length).toBeLessThanOrEqual(SHOUT.wideLines);
        }
        if (fit.kicker) for (const line of fit.kicker.lines) expect(kickerWidth(fit, line)).toBeLessThanOrEqual(LAYOUT.width + 1e-6);
        expect(fit.top).toBeGreaterThanOrEqual(LAYOUT.safeTop);
        expect(blockBottom(fit)).toBeLessThanOrEqual(LAYOUT.safeBottom + 1e-6);
        for (const [top, width] of rowsOf(fit)) {
          if (top < LAYOUT.clearTop - 1e-6) expect(width).toBeLessThanOrEqual(LAYOUT.clearWidth + 1e-6);
        }
      }
    }
  }, 30_000);

  it('every calendar slide fits', () => {
    const club = (date, title = 'Awana', over = {}) => ({ date, kind: 'club', title, isCancelled: false, isSpecial: title !== 'Awana', ...over });
    const info = deriveClubInfo([club('2026-09-23'), club('2026-09-30', 'Making Bookmarks'), club('2026-10-07', 'Awana', { isCancelled: true }), club('2026-10-14')], '2026-09-28');
    for (const s of buildCalendarSlides(info, {})) {
      const fit = fitFrame(slideFrame(s), measure);
      expect(fit.headline.mode).toBe('shout');
      expect(blockBottom(fit)).toBeLessThanOrEqual(LAYOUT.safeBottom + 1e-6);
    }
  });
});

describe('fitFrame: the supporting line', () => {
  it('wraps a long note to a few lines and steps down if it must', () => {
    const fit = fitFrame(frame({ headline: 'Water night', sub: 'Poster contest kicks off tonight, so bring your best drawing and your markers and your friends' }), measure);
    expect(fit.sub.lines.length).toBeLessThanOrEqual(SUB.maxLines);
    expect(fit.sub.size).toBeLessThanOrEqual(SUB.size);
  });
});

describe('themes and measuring', () => {
  it('every operator theme is expressed in the kit', () => {
    expect(Object.keys(LOBBY_THEMES).sort()).toEqual([...SLIDE_THEMES].sort());
    for (const t of Object.values(LOBBY_THEMES)) {
      expect(Object.keys(t).sort()).toEqual(['cloud', 'doodle', 'face', 'field', 'kicker', 'shadow', 'sub']);
    }
    expect(lobbyTheme('nope')).toBe('sky');
    expect(lobbyTheme('night')).toBe('night');
  });

  it('the night sky gets its own shadow: Awana blue would vanish into it', () => {
    expect(LOBBY_THEMES.night.shadow).not.toBe(LOBBY_THEMES.sky.shadow);
  });

  it('estimates when there is no canvas, a little wide on purpose', () => {
    expect(measureText('MAKING', 'shout')).toBeGreaterThan(6 * 0.68);
    expect(measureText('a b', 'read')).toBeGreaterThan(0);
  });
});
