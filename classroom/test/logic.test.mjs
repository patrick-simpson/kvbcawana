// The downstairs classroom's rules (classroom/public/src/logic.js).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as L from '../public/src/logic.js';

const at = (h, m) => h * 60 + m;

describe('phaseAt: the club night by the church clock (owner 2026-10-17)', () => {
  const cases = [
    [at(18, 29), 'off'], [at(18, 30), 'cubbies'], [at(18, 56), 'cubbies'],
    [at(18, 57), 'black'], [at(18, 59), 'black'], [at(19, 2), 'black'],
    [at(19, 3), 'sparks'], [at(19, 29), 'sparks'],
    [at(19, 30), 'lobby'], [at(19, 59), 'lobby'],
    [at(20, 0), 'off'], [at(23, 0), 'off'], [at(12, 0), 'off'],
  ];
  for (const [min, want] of cases) {
    it(`${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} is ${want}`, () => assert.equal(L.phaseAt(min, true), want));
  }
  it('is always off on a night that is not a club night, or with no clock', () => {
    for (const [min] of cases) assert.equal(L.phaseAt(min, false), 'off');
    assert.equal(L.phaseAt(NaN, true), 'off');
  });
  it('only the two cards have a club', () => {
    assert.equal(L.cardClub('cubbies'), 'cubbies');
    assert.equal(L.cardClub('sparks'), 'sparks');
    for (const p of ['off', 'black', 'lobby']) assert.equal(L.cardClub(p), null);
  });
});

describe('the easter eggs', () => {
  it('the honey runs from 6:54 and is done before the 6:57 fade', () => {
    assert.equal(L.honeyProgress(at(18, 53) * 60 + 59), null);
    assert.equal(L.honeyProgress(at(18, 54) * 60), 0);
    assert.ok(L.honeyProgress(at(18, 55) * 60) > 0.3);
    assert.equal(L.honeyProgress(at(18, 57) * 60), null);
    assert.ok(L.HONEY_AT_S + L.HONEY_MS / 1000 <= at(18, 57) * 60);
  });
  it('the bear comes once a night, at a minute the date picks, inside the Cubbies half hour', () => {
    const seen = new Set();
    for (let d = 1; d <= 28; d += 1) {
      const key = `2026-11-${String(d).padStart(2, '0')}`;
      const m = L.bearMinute(key);
      assert.equal(m, L.bearMinute(key));
      assert.ok(m >= L.BEAR_FROM && m < L.BEAR_UNTIL);
      assert.equal(L.phaseAt(m, true), 'cubbies');
      seen.add(m);
    }
    assert.ok(seen.size > 5, 'different nights, different moments');
  });
});

describe('clubCountFrom: the embedded lobby\'s stored counts (numbers only)', () => {
  const now = Date.parse('2026-10-14T23:40:00Z');
  const entry = (byClub, at = now - 60_000) => JSON.stringify({ v: 1, at, byClub });
  it('reads tonight\'s count for the club', () => {
    assert.equal(L.clubCountFrom(entry({ cubbies: 12, sparks: 18 }), now, 'cubbies'), 12);
    assert.equal(L.clubCountFrom(entry({ cubbies: 12, sparks: 18 }), now, 'sparks'), 18);
    assert.equal(L.clubCountFrom(entry({ cubbies: 0 }), now, 'cubbies'), 0);
  });
  it('shows nothing for junk, another day or a missing club', () => {
    assert.equal(L.clubCountFrom(null, now, 'cubbies'), null);
    assert.equal(L.clubCountFrom('{', now, 'cubbies'), null);
    assert.equal(L.clubCountFrom(entry({ sparks: 4 }), now, 'cubbies'), null);
    assert.equal(L.clubCountFrom(entry({ cubbies: 'Ava' }), now, 'cubbies'), null);
    assert.equal(L.clubCountFrom(entry({ cubbies: 3 }, now - 2 * 86_400_000), now, 'cubbies'), null);
    assert.equal(L.clubCountFrom(JSON.stringify({ v: 2, at: now, byClub: { cubbies: 1 } }), now, 'cubbies'), null);
  });
});

describe('welcomes (owner 2026-10-17)', () => {
  const t0 = 1_000_000;
  const ci = (id, firstName, club) => ({ id, firstName, club });
  it('a child of the card\'s club gets a welcome and a ding; other clubs, the black and the lobby nothing', () => {
    const r = L.welcomeFor(L.emptyWelcome(), ci('a', 'Ava', 'Cubbies'), 'cubbies', t0);
    assert.equal(r.ding, true);
    assert.deepEqual(r.state.names, ['Ava']);
    assert.ok(L.welcomeUp(r.state, 'cubbies', t0 + 1));
    for (const [club, phase] of [['Sparks', 'cubbies'], ['T&T', 'cubbies'], ['Cubbies', 'sparks'], ['Cubbies', 'black'], ['Sparks', 'black'], ['Sparks', 'lobby'], ['Cubbies', 'off']]) {
      assert.equal(L.welcomeFor(L.emptyWelcome(), ci('b', 'Ben', club), phase, t0).ding, false, `${club} on ${phase}`);
    }
    assert.equal(L.welcomeFor(L.emptyWelcome(), ci('s', 'Sam', 'Sparks'), 'sparks', t0).ding, true);
  });
  it('arrivals close together share one card, which stays 20 s after the LATEST', () => {
    let s = L.emptyWelcome();
    s = L.welcomeFor(s, ci('a', 'Ava', 'Cubbies'), 'cubbies', t0).state;
    s = L.welcomeFor(s, ci('b', 'Ben', 'Cubbies'), 'cubbies', t0 + 15_000).state;
    const r = L.welcomeFor(s, ci('c', 'Cara', 'Cubbies'), 'cubbies', t0 + 30_000);
    assert.equal(r.ding, true);
    assert.deepEqual(r.state.names, ['Ava', 'Ben', 'Cara']);
    assert.ok(L.welcomeUp(r.state, 'cubbies', t0 + 30_000 + L.WELCOME_MS - 1));
    assert.ok(!L.welcomeUp(r.state, 'cubbies', t0 + 30_000 + L.WELCOME_MS));
    // After it is gone, a new arrival starts a new card.
    const later = L.welcomeFor(r.state, ci('d', 'Dan', 'Cubbies'), 'cubbies', t0 + 30_000 + L.WELCOME_MS + 1);
    assert.deepEqual(later.state.names, ['Dan']);
  });
  it('the same check-in twice is welcomed once', () => {
    const a = L.welcomeFor(L.emptyWelcome(), ci('a', 'Ava', 'Cubbies'), 'cubbies', t0);
    const again = L.welcomeFor(a.state, ci('a', 'Ava', 'Cubbies'), 'cubbies', t0 + 1);
    assert.equal(again.ding, false);
    assert.deepEqual(again.state.names, ['Ava']);
  });
  it('a card belongs to its club: the Sparks card never shows a Cubbies welcome', () => {
    const s = L.welcomeFor(L.emptyWelcome(), ci('a', 'Ava', 'Cubbies'), 'cubbies', t0).state;
    assert.ok(!L.welcomeUp(s, 'sparks', t0 + 1));
    assert.ok(!L.welcomeUp(s, 'black', t0 + 1));
  });
  it('the words', () => {
    assert.equal(L.welcomeWords(['Ava']), 'Ava!');
    assert.equal(L.welcomeWords(['Ava', 'Ben']), 'Ava & Ben!');
    assert.equal(L.welcomeWords(['Ava', 'Ben', 'Cara']), 'Ava, Ben & Cara!');
    assert.equal(L.welcomeWords(['A', 'B', 'C', 'D', 'E']), 'A, B, C, D & E!');
    assert.equal(L.welcomeWords(['A', 'B', 'C', 'D', 'E', 'F', 'G']), 'A, B, C, D & 3 more!');
    assert.equal(L.welcomeWords([]), '');
  });
});

describe('the count chip is the kit\'s stepped chip', () => {
  it('uses shared/chipGeometry.js\'s own numbers', () => {
    const src = readFileSync(new URL('../../shared/chipGeometry.js', import.meta.url), 'utf8');
    const block = src.slice(src.indexOf('export const CHIP = {'), src.indexOf('};', src.indexOf('export const CHIP = {')));
    for (const [key, value] of Object.entries(L.CHIP)) {
      const m = block.match(new RegExp(`\\b${key}: ([0-9.]+)`));
      assert.ok(m, `${key} is in shared/chipGeometry.js`);
      assert.equal(Number(m[1]), value, key);
    }
  });
  it('steps the value block out past the label pill', () => {
    const g = L.chipGeometry(5, 1.2);
    assert.ok(g.width > 0 && g.height > 0);
    assert.match(g.d, /^M[\d.]+,0 /);
    assert.ok(g.value.x > g.label.x);
  });
});
