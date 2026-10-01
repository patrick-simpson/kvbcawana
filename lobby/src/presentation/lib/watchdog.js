/**
 * QuickNav override watchdog — pure logic deciding when a manual
 * override should hand the screen back to the schedule. Three rules:
 *
 * 1. SELF-HEAL: the schedule caught up to what the operator picked
 *    (override state === natural state) → resume silently. This is what
 *    makes the pre-6pm "skip to opening ceremony" flow safe: at 18:00
 *    the natural state becomes the ceremony and the override dissolves.
 * 2. BOUNDARY: the natural state changed since the override was set
 *    (a real schedule boundary passed underneath) → resume, so an
 *    override can never strand the wrong screen across game-time slots.
 * 3. TIMEOUT: `timeoutMin` after the override was set (or last extended
 *    via "Stay") → resume, so an off-night operator poke can't leave a
 *    game screen up all week.
 *
 * `resumeAt` is when rule 3 will fire — the UI shows a warning pill in
 * the final `warningSec` seconds with a "Stay" action that re-arms it.
 */

export function evaluateOverride(ctx) {
  const armedAt = ctx.lastStayAt && ctx.lastStayAt > ctx.setAt ? ctx.lastStayAt : ctx.setAt;
  const resumeAt = new Date(armedAt.getTime() + ctx.timeoutMin * 60_000);

  if (ctx.overrideKey === ctx.naturalKey) return { action: 'resume', resumeAt };
  if (ctx.naturalKey !== ctx.naturalKeyAtSet) return { action: 'resume', resumeAt };
  if (ctx.now.getTime() >= resumeAt.getTime()) return { action: 'resume', resumeAt };
  return { action: 'none', resumeAt };
}
