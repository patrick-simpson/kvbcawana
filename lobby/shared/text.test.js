import { describe, it, expect } from 'vitest';
import { cleanText, isControlCharCode, plainText, stripControlChars } from './text.js';

// The four cleaners this module replaced, written out as they were, so the
// shared one is held to producing exactly what each of them did.
const lobbyCleanString = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const printerCleanName = (s, max) => String(s == null ? '' : s).trim().slice(0, max);
const printerStored = (value, max) => stripControlChars(value, ' ').trim().slice(0, Number.isFinite(max) ? max : 80);
const printerFriend = (raw) => {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
};
const oldPlain = (s, max) => String(s == null ? '' : s).replace(/<[^>]*>/g, ' ').replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

const SAMPLES = [
  '', '   ', 'Ana', '  Ana  ', 'Ana\tMaria', 'Ana\nMaria', 'A\u0000B', 'del\u007fete', 'café É', '<b>Ana</b>', 'a < b > c',
  'x'.repeat(200), `${'y'.repeat(30)}\n${'z'.repeat(30)}`, '\u0085next-line', 'a b', '   nbsp   ',
  null, undefined, 0, 42, true, {}, [], ['a', 'b'], { toString: () => ' obj ' },
];

describe('isControlCharCode', () => {
  it('is the C0 range and DEL, nothing else', () => {
    for (let c = 0; c < 0x20; c++) expect(isControlCharCode(c), String(c)).toBe(true);
    expect(isControlCharCode(0x7f)).toBe(true);
    for (const c of [0x20, 0x41, 0x7e, 0x80, 0x9f, 0xa0, 0x2028]) expect(isControlCharCode(c), String(c)).toBe(false);
  });
});

describe('stripControlChars', () => {
  it('replaces each control character with a space unless told otherwise', () => {
    expect(stripControlChars('a\tb\nc\u0000d\u007fe')).toBe('a b c d e');
    expect(stripControlChars('a\tb\nc', '')).toBe('abc');
    expect(stripControlChars(null)).toBe('');
    expect(stripControlChars(undefined, '-')).toBe('');
    expect(stripControlChars(12)).toBe('12');
  });
});

describe('cleanText', () => {
  it('with no options is the lobby\'s cleanString, for every sample', () => {
    for (const v of SAMPLES) for (const max of [0, 5, 40, 64]) expect(cleanText(v, max), `${String(v)}/${max}`).toBe(lobbyCleanString(v, max));
  });

  it('with coerce is the printer\'s cleanName, for every sample', () => {
    for (const v of SAMPLES) for (const max of [0, 5, 40]) expect(cleanText(v, max, { coerce: true }), `${String(v)}/${max}`).toBe(printerCleanName(v, max));
  });

  it('with coerce and control " " is the printer\'s sanitizeStoredText, for every sample', () => {
    for (const v of SAMPLES) for (const max of [5, 40, 80, 160]) {
      expect(cleanText(v, max, { coerce: true, control: ' ' }), `${String(v)}/${max}`).toBe(printerStored(v, max));
    }
  });

  it('with control "", angle and collapse is the printer\'s cleanFriendName, for every sample', () => {
    for (const v of SAMPLES) expect(cleanText(v, 24, { control: '', angle: true, collapse: true }), String(v)).toBe(printerFriend(v));
  });

  it('refuses what is not a string, unless asked to coerce', () => {
    expect(cleanText(5, 10)).toBe('');
    expect(cleanText(null, 10, { coerce: true })).toBe('');
    expect(cleanText(5, 10, { coerce: true })).toBe('5');
  });

  it('does the steps in order: control characters first, then trim, then the limit', () => {
    expect(cleanText('\n\nAna', 3, { coerce: true, control: ' ' })).toBe('Ana');
    expect(cleanText('Ana\tMaria', 8, { control: ' ' })).toBe('Ana Mari');
    // The limit counts what is left, so a control character cannot spend a name's room.
    expect(cleanText('A\u0000\u0000B', 2, { control: '' })).toBe('AB');
  });

  it('does not strip angle brackets unless asked (a child\'s name is never silently corrupted)', () => {
    expect(cleanText('Z<ee>', 10)).toBe('Z<ee>');
    expect(cleanText('Z<ee>', 10, { angle: true })).toBe('Zee');
  });
});

describe('plainText', () => {
  it('strips markup and collapses whitespace, like the copy it replaced', () => {
    for (const v of SAMPLES) for (const max of [10, 60, 200]) {
      expect(plainText(v, max, { coerce: true }), `${String(v)}/${max}`).toBe(oldPlain(v, max));
      expect(plainText(v, max), `${String(v)}/${max}`).toBe(typeof v === 'string' ? oldPlain(v, max) : '');
    }
    expect(plainText('CLUB <b>CANCELLED</b>\n\ntonight', 200)).toBe('CLUB CANCELLED tonight');
    expect(plainText('1 < 2', 200)).toBe('1 2');
  });
});
