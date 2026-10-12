import { describe, expect, it } from 'vitest';
import { cleanRule, cleanSpec, matchesRule, plainText } from './settingRules.js';

describe('cleanRule (the wire)', () => {
  it('clamps and rounds an int, clamps a number, never coerces', () => {
    expect(cleanRule({ type: 'int', min: 0, max: 10 }, 4.6)).toBe(5);
    expect(cleanRule({ type: 'int', min: 0, max: 10 }, 99)).toBe(10);
    expect(cleanRule({ type: 'number', min: -1, max: 1 }, 0.25)).toBe(0.25);
    expect(cleanRule({ type: 'int', min: 0, max: 10 }, '4')).toBeUndefined();
    expect(cleanRule({ type: 'bool' }, 1)).toBeUndefined();
    expect(cleanRule({ type: 'int', min: 0, max: 10 }, NaN)).toBeUndefined();
  });

  it('keeps the string, url, time, slug, list and phrase rules', () => {
    expect(cleanRule({ type: 'string', max: 5 }, ' <b>hello world</b> ')).toBe('hello');
    expect(cleanRule({ type: 'url', max: 40 }, ' https://a.b/c ')).toBe('https://a.b/c');
    expect(cleanRule({ type: 'url', max: 40 }, '   ')).toBe('');
    expect(cleanRule({ type: 'url', max: 40 }, 'http://a.b')).toBeUndefined();
    expect(cleanRule({ type: 'time' }, '19:30')).toBe('19:30');
    expect(cleanRule({ type: 'time' }, '24:00')).toBeUndefined();
    expect(cleanRule({ type: 'slug', max: 8 }, 'harvest')).toBe('harvest');
    expect(cleanRule({ type: 'slug', max: 8 }, 'Harvest')).toBeUndefined();
    expect(cleanRule({ type: 'intList', maxItems: 2, min: 1, max: 9 }, [5, 3, 3, 0, 7.2])).toEqual([3, 5]);
    expect(cleanRule({ type: 'phrases', maxKeys: 5, maxKey: 3, maxValue: 4 }, { ' ABCD ': 'hi there', x: '' })).toEqual({ abc: 'hi t' });
  });

  it('drops a rule type it does not know', () => {
    expect(cleanRule(/** @type {any} */ ({ type: 'array' }), [])).toBeUndefined();
  });
});

describe('cleanSpec', () => {
  const spec = { b: { type: 'bool' }, n: { type: 'int', min: 0, max: 5 } };
  it('keeps exactly the spec keys, in the spec order', () => {
    expect(Object.keys(cleanSpec(spec, { n: 9, x: 1, b: true }))).toEqual(['b', 'n']);
    expect(cleanSpec(spec, { n: 9, b: 'no' })).toEqual({ n: 5 });
  });
  it('is {} for junk', () => {
    for (const junk of [null, undefined, 3, 'x', []]) expect(cleanSpec(spec, junk)).toEqual({});
  });
  it('ignores inherited names', () => {
    expect(cleanSpec(spec, Object.create({ b: true }))).toEqual({});
  });
});

describe('matchesRule (the device layer)', () => {
  it('passes a value as it stands, never repairing it', () => {
    expect(matchesRule({ type: 'number', min: 1, max: 3 }, 1.5)).toBe(true);
    expect(matchesRule({ type: 'number', min: 1, max: 3 }, 4)).toBe(false);
    expect(matchesRule({ type: 'number', min: 1, max: 3 }, Infinity)).toBe(false);
    expect(matchesRule({ type: 'string' }, '')).toBe(true);
    expect(matchesRule({ type: 'enum', values: ['a'] }, 'b')).toBe(false);
    expect(matchesRule({ type: 'array' }, [])).toBe(true);
    expect(matchesRule({ type: 'record' }, [])).toBe(false);
    expect(matchesRule({ type: 'record' }, null)).toBe(false);
    expect(matchesRule({ type: 'record' }, {})).toBe(true);
    expect(matchesRule({ type: 'bool' }, 0)).toBe(false);
  });
  it('rejects a rule type it does not know', () => {
    expect(matchesRule(/** @type {any} */ ({ type: 'url' }), 'https://a.b')).toBe(false);
  });
});

describe('plainText', () => {
  it('strips markup and caps one line', () => {
    expect(plainText('<i>a</i>\n b', 10)).toBe('a b');
    expect(plainText(null, 5)).toBe('');
  });
});
