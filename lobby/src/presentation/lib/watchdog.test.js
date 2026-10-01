import { describe, it, expect } from 'vitest';
import { evaluateOverride } from './watchdog.js';

const T0 = new Date(2026, 8, 2, 17, 40, 0); // a Wednesday 5:40 PM
const min = (n) => new Date(T0.getTime() + n * 60_000);

function ctx(partial) {
  return {
    overrideKey: 'slideshow:opening',
    naturalKey: 'countdown',
    naturalKeyAtSet: 'countdown',
    setAt: T0,
    lastStayAt: null,
    now: T0,
    timeoutMin: 15,
    ...partial,
  };
}

describe('evaluateOverride', () => {
  it('self-heals when the schedule catches up to the override', () => {
    // 17:55 "skip to opening" → at 18:00 the natural state IS the opening.
    const v = evaluateOverride(ctx({ naturalKey: 'slideshow:opening', now: min(20) }));
    expect(v.action).toBe('resume');
  });

  it('resumes when a schedule boundary passes underneath', () => {
    // Operator pinned Sparks game time; the clock rolled into Puggles & Cubbies.
    const v = evaluateOverride(
      ctx({
        overrideKey: 'game:Sparks Game Time',
        naturalKeyAtSet: 'game:Sparks Game Time',
        naturalKey: 'game:Puggles & Cubbies Game Time',
        now: min(5),
      }),
    );
    expect(v.action).toBe('resume');
  });

  it('holds inside the timeout when nothing changed', () => {
    const v = evaluateOverride(ctx({ now: min(14) }));
    expect(v.action).toBe('none');
    expect(v.resumeAt.getTime()).toBe(min(15).getTime());
  });

  it('times out after timeoutMin', () => {
    expect(evaluateOverride(ctx({ now: min(15) })).action).toBe('resume');
  });

  it('"Stay" re-arms the timeout for a full period', () => {
    const stayed = ctx({ lastStayAt: min(14), now: min(20) });
    const v = evaluateOverride(stayed);
    expect(v.action).toBe('none');
    expect(v.resumeAt.getTime()).toBe(min(29).getTime());
    expect(evaluateOverride({ ...stayed, now: min(29) }).action).toBe('resume');
  });

  it('ignores a lastStayAt older than setAt (stale from a previous override)', () => {
    const v = evaluateOverride(ctx({ lastStayAt: min(-30), now: min(14) }));
    expect(v.action).toBe('none');
    expect(v.resumeAt.getTime()).toBe(min(15).getTime());
  });
});
