// The scoreboard's sounds (owner 2026-11-15: "Yes, bigger sounds"; then "are they as epic
// as possible?"): a hit under each point with a bright top note, a rising sting and a
// cymbal swell for a lead, brass calls for a streak, a drumroll into the winner's
// fanfare, ticks for a timer's last ten seconds, and a whoosh for every colour burst. All
// drawn by Web Audio (stingers.js playTones, noise included), so there are no files. They
// play when the projector's Countdown sounds are on OR the phone's sound switch is
// (`force`), as the chimes always have; never on the lobby's mirror.
import { playTones } from './stingers.js';

/** A cymbal: bright noise that rings out (`len` s), starting `at` s in. */
const crash = (at, len = 1.4, vol = 1) => [
  { freq: 7000, at, len, type: 'noise', q: 0.6, vol },
  { freq: 3200, at, len: len * 0.6, type: 'noise', q: 0.8, vol: vol * 0.6 },
];

/** One point: the team's two-note chime (`notes`, Hz) over a low thump, a bright top note; a streak adds steps. */
export function pointSound([a, b], { at = 0, lead = false, streak = 1, force = false } = {}) {
  const notes = [
    { freq: 70, at, len: 0.22, type: 'sine' },
    { freq: a, at, len: 0.18 },
    { freq: b, at: at + 0.08, len: 0.32 },
    // the bright top: cuts through a gym full of kids
    { freq: b * 2, at: at + 0.08, len: 0.4, type: 'sine', vol: 0.6 },
  ];
  // The lead: a rising sting of three more steps over a cymbal swell into a crash.
  if (lead) {
    [1.25, 1.5, 2].forEach((m, i) => notes.push({ freq: b * m, at: at + 0.2 + i * 0.07, len: i === 2 ? 0.7 : 0.35, type: 'square' }));
    notes.push({ freq: 6000, at, len: 0.4, type: 'noise', q: 0.5, swell: true, vol: 0.7 }, ...crash(at + 0.42, 1.2, 0.8));
  }
  // A streak: one higher step for each point in the run.
  for (let i = 1; i < Math.min(streak, 5); i += 1) notes.push({ freq: b * (1 + i * 0.25), at: at + 0.2 + i * 0.06, len: 0.22 });
  playTones(notes, 0.16, { force });
}

/**
 * A streak's call (HAT TRICK! from the third point in a row, ON FIRE! from the fourth): a
 * brass stab, bigger for ON FIRE (a crash and a climb), under the point's own chime.
 */
export function streakCall(run, force = false) {
  if (run < 3) return;
  const fire = run >= 4;
  const tune = fire ? [[523, 0.3, 0.12], [659, 0.42, 0.12], [784, 0.54, 0.12], [1047, 0.66, 0.6]] : [[466, 0.3, 0.14], [587, 0.44, 0.14], [698, 0.58, 0.5]];
  const notes = [{ freq: 55, at: 0.3, len: 0.45, type: 'sine' }];
  for (const [freq, at, len] of tune) notes.push({ freq, at, len, type: 'square' }, { freq: freq / 2, at, len, type: 'sawtooth' });
  if (fire) notes.push(...crash(0.66, 1.6), { freq: 400, at: 0.3, len: 0.9, type: 'noise', q: 0.7, to: 4000, vol: 0.6 });
  playTones(notes, 0.08, { force });
}

/** The drumroll before the winner (`len` s): snare hits closing up and building, under a low rumble. */
export function drumroll(force = false, len = 1.6) {
  const notes = [{ freq: 60, at: 0, len, type: 'sine', swell: true, vol: 0.9 }];
  let t = 0;
  let gap = 0.075;
  while (t < len) {
    notes.push({ freq: 1800, at: t, len: 0.09, type: 'noise', q: 0.9, vol: 0.35 + 0.65 * (t / len) });
    t += gap;
    gap = Math.max(0.04, gap * 0.97);
  }
  playTones(notes, 0.14, { force });
}

/** The winner: a brass-like fanfare (square and sawtooth together), with a low hit and a cymbal crash. */
export function fanfare(force = false) {
  const tune = [[392, 0, 0.16], [392, 0.17, 0.12], [392, 0.3, 0.12], [523, 0.44, 0.55], [466, 1.02, 0.18], [523, 1.22, 0.18], [659, 1.42, 0.25], [784, 1.7, 1.1]];
  const notes = [{ freq: 55, at: 0, len: 0.5, type: 'sine' }, { freq: 55, at: 1.7, len: 0.8, type: 'sine' }, ...crash(0, 1.8), ...crash(1.7, 2.2)];
  for (const [freq, at, len] of tune) {
    notes.push({ freq, at, len, type: 'square' });
    notes.push({ freq: freq / 2, at, len, type: 'sawtooth' });
  }
  playTones(notes, 0.08, { force });
}

/** A second hit for the winner, as the colour bursts again over the hold: a boom and a crash. */
export function boom(force = false) {
  playTones([{ freq: 50, at: 0, len: 0.7, type: 'sine' }, { freq: 90, at: 0, len: 0.25, type: 'triangle' }, ...crash(0.02, 1.5, 0.9)], 0.13, { force });
}

/** The board arriving: a fast rising sweep, a whoosh under it, and a hit with a crash. */
export function gameOnSound(force = false) {
  const notes = [262, 330, 392, 523, 659, 784].map((freq, i) => ({ freq, at: i * 0.055, len: 0.16, type: 'square' }));
  notes.push(
    { freq: 1047, at: 0.36, len: 0.5, type: 'triangle' }, { freq: 60, at: 0.36, len: 0.35, type: 'sine' },
    { freq: 500, at: 0, len: 0.36, type: 'noise', q: 0.8, to: 5000, vol: 0.7 },
    ...crash(0.36, 1.2, 0.8),
  );
  playTones(notes, 0.09, { force });
}

/** A colour burst across the wall (the winner film's way in and out, a takeover, TIME! lifting): a falling whoosh and a low hit. */
export function whooshSound(force = false) {
  const notes = [1568, 1175, 880, 659, 494, 370].map((freq, i) => ({ freq, at: i * 0.035, len: 0.12, type: 'triangle' }));
  notes.push({ freq: 48, at: 0.2, len: 0.45, type: 'sine' }, { freq: 4500, at: 0, len: 0.32, type: 'noise', q: 0.7, to: 300, vol: 1.2 });
  playTones(notes, 0.07, { force });
}

/** A timer's last ten seconds: a tick each second, a higher, harder one for the last three. */
export function tick(secondsLeft, force = false) {
  const last = secondsLeft <= 3;
  playTones([
    { freq: last ? 1760 : 1320, at: 0, len: last ? 0.12 : 0.07, type: 'square', vol: last ? 1 : 0.7 },
    { freq: 2500, at: 0, len: 0.04, type: 'noise', q: 2, vol: 0.6 },
  ], 0.08, { force });
}
