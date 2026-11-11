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
