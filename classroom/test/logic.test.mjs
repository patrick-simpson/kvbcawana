// The downstairs classroom's rules (classroom/public/src/logic.js).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as L from '../public/src/logic.js';

const at = (h, m) => h * 60 + m;

describe('the night by the church clock, gaps from shared/transitionGap.js (owner 2026-10-17)', () => {
  it('the gap is the shared one', () => assert.equal(L.TRANSITION_GAP_MIN, 2));
  const cases = [
    [at(18, 29), 'off'], [at(18, 30), 'cubbies'], [at(18, 57), 'cubbies'],
    [at(18, 58), 'black'], [at(19, 1), 'black'],
    [at(19, 2), 'sparks'], [at(19, 27), 'sparks'],
    [at(19, 28), 'black'], [at(19, 31), 'black'],
    [at(19, 32), 'lobby'], [at(19, 59), 'lobby'],
    [at(20, 0), 'off'], [at(23, 0), 'off'], [at(12, 0), 'off'],
  ];
  for (const [min, want] of cases) {
    it(`${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} is ${want}`, () => assert.equal(L.phaseAt(min, true), want));
  }
  it('is always off on a night that is not a club night, or with no clock', () => {
    for (const [min] of cases) assert.equal(L.phaseAt(min, false), 'off');
    assert.equal(L.phaseAt(NaN, true), 'off');
  });
  it('welcomes a card\'s club, both neighbours in a gap, nobody in the lobby or off', () => {
    assert.deepEqual(L.welcomeClubsAt(at(18, 40), true), ['cubbies']);
    assert.deepEqual(L.welcomeClubsAt(at(18, 59), true), ['cubbies', 'sparks']);
    assert.deepEqual(L.welcomeClubsAt(at(19, 10), true), ['sparks']);
    assert.deepEqual(L.welcomeClubsAt(at(19, 29), true), ['sparks']);
    assert.deepEqual(L.welcomeClubsAt(at(19, 40), true), []);
    assert.deepEqual(L.welcomeClubsAt(at(18, 40), false), []);
  });
  it('only the two cards have a club (and a count chip)', () => {
    assert.equal(L.cardClub('cubbies'), 'cubbies');
    assert.equal(L.cardClub('sparks'), 'sparks');
    for (const p of ['off', 'black', 'lobby']) assert.equal(L.cardClub(p), null);
  });
});

describe('the easter eggs', () => {
  it('the honey finishes before the Cubbies card fades into the gap', () => {
    const fade = (L.SPARKS_AT - L.TRANSITION_GAP_MIN) * 60;
    assert.equal(L.honeyProgress(L.HONEY_AT_S - 1), null);
    assert.equal(L.honeyProgress(L.HONEY_AT_S), 0);
    assert.ok(L.HONEY_AT_S >= at(18, 54) * 60 && L.HONEY_AT_S <= at(18, 56) * 60, 'about 6:55');
    assert.ok(L.HONEY_AT_S + L.HONEY_MS / 1000 < fade);
    assert.equal(L.honeyProgress(fade), null);
    assert.equal(L.phaseAt(Math.floor(L.HONEY_AT_S / 60), true), 'cubbies');
  });
  it('the bear comes once a night, at a minute the date picks, inside the Cubbies card', () => {
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
  const CUB = at(18, 40); const GAP1 = at(18, 59); const SPK = at(19, 10); const GAP2 = at(19, 29); const LOBBY = at(19, 40);
  const clubsAt = (m) => L.welcomeClubsAt(m, true);
  it('a child of the card\'s club gets a welcome and a ding; other clubs, the lobby and off nothing', () => {
    const r = L.welcomeFor(L.emptyWelcomes(), ci('a', 'Ava', 'Cubbies'), clubsAt(CUB), t0);
    assert.equal(r.ding, true);
    assert.equal(r.club, 'cubbies');
    assert.deepEqual(L.welcomesUp(r.state, clubsAt(CUB), t0 + 1), ['cubbies']);
    for (const [club, m] of [['Sparks', CUB], ['T&T', CUB], ['Cubbies', SPK], ['Sparks', LOBBY], ['Cubbies', at(17, 0)]]) {
      assert.equal(L.welcomeFor(L.emptyWelcomes(), ci('b', 'Ben', club), clubsAt(m), t0).ding, false, `${club} at ${m}`);
    }
    assert.equal(L.welcomeFor(L.emptyWelcomes(), ci('s', 'Sam', 'Sparks'), clubsAt(SPK), t0).ding, true);
  });
  it('in the 6:58 gap both Cubbies and Sparks are welcomed, one card each, never mixed', () => {
    let s = L.emptyWelcomes();
    let r = L.welcomeFor(s, ci('a', 'Ava', 'Cubbies'), clubsAt(GAP1), t0);
    assert.equal(r.ding, true); s = r.state;
    r = L.welcomeFor(s, ci('m', 'Micah', 'Sparks'), clubsAt(GAP1), t0 + 1000);
    assert.equal(r.ding, true); s = r.state;
    assert.deepEqual(s.cards.cubbies.names, ['Ava']);
    assert.deepEqual(s.cards.sparks.names, ['Micah']);
    assert.deepEqual(L.welcomesUp(s, clubsAt(GAP1), t0 + 2000), ['cubbies', 'sparks']);
    // Once the Sparks card is up, only the Sparks welcome stays on it.
    assert.deepEqual(L.welcomesUp(s, clubsAt(SPK), t0 + 2000), ['sparks']);
    assert.equal(L.welcomeFor(s, ci('t', 'Tom', 'T&T'), clubsAt(GAP1), t0).ding, false);
  });
  it('in the 7:28 gap Sparks are welcomed, nobody else', () => {
    assert.equal(L.welcomeFor(L.emptyWelcomes(), ci('m', 'Micah', 'Sparks'), clubsAt(GAP2), t0).ding, true);
    assert.equal(L.welcomeFor(L.emptyWelcomes(), ci('a', 'Ava', 'Cubbies'), clubsAt(GAP2), t0).ding, false);
    assert.equal(L.welcomeFor(L.emptyWelcomes(), ci('j', 'Jo', 'Journey'), clubsAt(GAP2), t0).ding, false);
  });
  it('arrivals close together share their club\'s card, which stays 20 s after the LATEST', () => {
    let s = L.emptyWelcomes();
    s = L.welcomeFor(s, ci('a', 'Ava', 'Cubbies'), clubsAt(CUB), t0).state;
    s = L.welcomeFor(s, ci('b', 'Ben', 'Cubbies'), clubsAt(CUB), t0 + 15_000).state;
    const r = L.welcomeFor(s, ci('c', 'Cara', 'Cubbies'), clubsAt(CUB), t0 + 30_000);
    assert.deepEqual(r.state.cards.cubbies.names, ['Ava', 'Ben', 'Cara']);
    assert.deepEqual(L.welcomesUp(r.state, clubsAt(CUB), t0 + 30_000 + L.WELCOME_MS - 1), ['cubbies']);
    assert.deepEqual(L.welcomesUp(r.state, clubsAt(CUB), t0 + 30_000 + L.WELCOME_MS), []);
    const later = L.welcomeFor(r.state, ci('d', 'Dan', 'Cubbies'), clubsAt(CUB), t0 + 30_000 + L.WELCOME_MS + 1);
    assert.deepEqual(later.state.cards.cubbies.names, ['Dan']);
  });
  it('the same check-in twice is welcomed once', () => {
    const a = L.welcomeFor(L.emptyWelcomes(), ci('a', 'Ava', 'Cubbies'), clubsAt(CUB), t0);
    const again = L.welcomeFor(a.state, ci('a', 'Ava', 'Cubbies'), clubsAt(GAP1), t0 + 1);
    assert.equal(again.ding, false);
    assert.deepEqual(again.state.cards.cubbies.names, ['Ava']);
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
