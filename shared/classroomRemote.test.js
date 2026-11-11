import { describe, expect, it } from 'vitest';
import * as R from './classroomRemote.js';

// The shared press and stage rules (the Sparks remote's, reused by Cast). The Worker's
// own suites (worker/test/classroom.test.js, cast.test.js) and the pages' suites
// (classroom/test/, site/test/cast.test.mjs) hold the rest; this file holds what Cast
// added on 2026-11-11 (owner: "All of those sound fantastic. Let's build them").

describe('Black (Cast): the press and the stage', () => {
  it('the press says on or off outright; anything else is not a press', () => {
    expect(R.CLASSROOM_ACTIONS).toContain('black');
    expect(R.sanitizeClassroomPress('black', { on: true, extra: 'x' })).toEqual({ action: 'black', data: { on: true } });
    expect(R.sanitizeClassroomPress('black', { on: false })).toEqual({ action: 'black', data: { on: false } });
    expect(R.sanitizeClassroomPress('black', {})).toBeNull();
    expect(R.sanitizeClassroomPress('black', { on: 'yes' })).toBeNull();
    expect(R.sanitizeClassroomPress('black')).toBeNull();
  });

  it('the stage carries black only while it is on, so an older stage reads exactly as before', () => {
    expect(R.sanitizeStage(null)).toEqual({ rev: 0, show: null, preview: null, cmds: [] });
    expect(R.sanitizeStage({ rev: 3, black: false })).toEqual({ rev: 3, show: null, preview: null, cmds: [] });
    expect(R.sanitizeStage({ rev: 3, black: 'yes' }).black).toBeUndefined();
    expect(R.sanitizeStage({ rev: 3, black: true })).toEqual({ rev: 3, show: null, preview: null, cmds: [], black: true });
    // What is up stays as it is under the black.
    const up = R.sanitizeStage({ rev: 4, black: true, show: { button: { id: 'babcdefgh', kind: 'text', text: 'Welcome' }, at: 5, page: 1 } });
    expect(up.black).toBe(true);
    expect(up.show.button.text).toBe('Welcome');
  });
});

describe('the house slide (Cast): one optional line', () => {
  it('is one cleaned line of at most 60 characters; anything else is the logo alone', () => {
    expect(R.CAST_HOUSE_LINE_MAX).toBe(60);
    expect(R.sanitizeHouse({ line: '  Welcome\n to   church ' })).toEqual({ line: 'Welcome to church' });
    expect(R.sanitizeHouse({ line: 'x'.repeat(200) }).line).toHaveLength(60);
    expect(R.sanitizeHouse({ line: 'Hi', savedAt: 'x', html: '<b>' })).toEqual({ line: 'Hi' });
    for (const bad of [null, undefined, 'Welcome', 7, [], { line: 7 }, { line: null }, {}]) expect(R.sanitizeHouse(bad)).toEqual({ line: '' });
  });
});

describe('a countdown and the clock (Cast): two more items', () => {
  const timer = (over = {}) => ({ id: 'babcdefgh', kind: 'timer', seconds: 300, ...over });

  it('a countdown is 15 s to 60 min in steps of 15 s, with an optional one-line title', () => {
    expect([R.CAST_TIMER_MIN_S, R.CAST_TIMER_MAX_S, R.CAST_TIMER_STEP_S]).toEqual([15, 3600, 15]);
    expect(R.sanitizeItem(timer())).toEqual({ id: 'babcdefgh', kind: 'timer', title: '', seconds: 300 });
    expect(R.sanitizeItem(timer({ title: '  Starting\n in ', seconds: 15 }))).toEqual({ id: 'babcdefgh', kind: 'timer', title: 'Starting in', seconds: 15 });
    expect(R.sanitizeItem(timer({ seconds: 3600 })).seconds).toBe(3600);
    expect(R.sanitizeItem(timer({ title: 'x'.repeat(90) })).title).toHaveLength(60);
    for (const seconds of [0, 14, 20, 3615, 300.5, '300', null, -15, Infinity]) expect(R.sanitizeItem(timer({ seconds }))).toBeNull();
  });

  it('endsAt (the Worker\'s) is kept when it is a real time, so a stored stage reads back whole', () => {
    expect(R.sanitizeItem(timer({ endsAt: 1794000000000.4 })).endsAt).toBe(1794000000000);
    for (const endsAt of [0, -5, 'soon', NaN, Infinity, null]) expect('endsAt' in R.sanitizeItem(timer({ endsAt }))).toBe(false);
    const stage = R.sanitizeStage({ rev: 2, show: { button: timer({ endsAt: 1794000000000, title: 'Starting in' }), at: 9, page: 1 } });
    expect(stage.show.button).toEqual({ id: 'babcdefgh', kind: 'timer', title: 'Starting in', seconds: 300, endsAt: 1794000000000 });
  });

  it('the clock carries nothing but its kind', () => {
    expect(R.sanitizeItem({ id: 'babcdefgh', kind: 'clock', title: 'x', text: 'y', endsAt: 5 })).toEqual({ id: 'babcdefgh', kind: 'clock', title: '' });
  });

  it('both go up as item presses and are views the TV may report; neither is ever a Sparks button', () => {
    expect(R.sanitizeClassroomPress('item', { item: timer() }).data.item.kind).toBe('timer');
    expect(R.sanitizeClassroomPress('item', { item: { id: 'babcdefgh', kind: 'clock' } }).data.item.kind).toBe('clock');
    expect(R.sanitizeClassroomNow({ view: 'timer' })).toEqual({ view: 'timer' });
    expect(R.sanitizeClassroomNow({ view: 'clock' })).toEqual({ view: 'clock' });
    expect(R.CAST_ONLY_KINDS).toEqual(['timer', 'clock']);
    expect(R.CLASSROOM_PLAYABLE_KINDS).not.toContain('timer');
    const list = R.sanitizeButtons({ videos: [], items: [timer(), { id: 'bclock0001', kind: 'clock' }, { id: 'btext00001', kind: 'text', text: 'Hi' }] });
    expect(list.items.map((i) => i.kind)).toEqual(['text']);
  });
});
