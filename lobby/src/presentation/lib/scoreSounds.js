// The scoreboard's sounds (owner 2026-11-15: "Yes, bigger sounds"): a hit under each
// point, a rising sting for a lead, a call for a streak, a fanfare for the winner and a
// sweep for the board arriving. All drawn by Web Audio (stingers.js playTones), so there
// are no files. They play when the projector's Countdown sounds are on OR the phone's
// sound switch is (`force`), as the chimes always have; never on the lobby's mirror.
import { playTones } from './stingers.js';

/** One point: the team's two-note chime (`notes`, Hz) over a low thump; a streak adds steps. */
export function pointSound([a, b], { at = 0, lead = false, streak = 1, force = false } = {}) {
  const notes = [
    { freq: 70, at, len: 0.22, type: 'sine' },
    { freq: a, at, len: 0.18 },
    { freq: b, at: at + 0.08, len: 0.32 },
  ];
  // The lead: a rising sting of three more steps.
  if (lead) [1.25, 1.5, 2].forEach((m, i) => notes.push({ freq: b * m, at: at + 0.2 + i * 0.07, len: 0.35, type: 'square' }));
  // A streak: one higher step for each point in the run.
  for (let i = 1; i < Math.min(streak, 5); i += 1) notes.push({ freq: b * (1 + i * 0.25), at: at + 0.2 + i * 0.06, len: 0.22 });
  playTones(notes, 0.14, { force });
}

/** The winner: a brass-like fanfare (square and sawtooth together), with a low hit. */
export function fanfare(force = false) {
  const tune = [[392, 0, 0.16], [392, 0.17, 0.12], [392, 0.3, 0.12], [523, 0.44, 0.55], [466, 1.02, 0.18], [523, 1.22, 0.18], [659, 1.42, 0.25], [784, 1.7, 1.1]];
  const notes = [{ freq: 55, at: 0, len: 0.5, type: 'sine' }, { freq: 55, at: 1.7, len: 0.8, type: 'sine' }];
  for (const [freq, at, len] of tune) {
    notes.push({ freq, at, len, type: 'square' });
    notes.push({ freq: freq / 2, at, len, type: 'sawtooth' });
  }
  playTones(notes, 0.08, { force });
}

/** The board arriving: a fast rising sweep and a hit. */
export function gameOnSound(force = false) {
  const notes = [262, 330, 392, 523, 659, 784].map((freq, i) => ({ freq, at: i * 0.055, len: 0.16, type: 'square' }));
  notes.push({ freq: 1047, at: 0.36, len: 0.5, type: 'triangle' }, { freq: 60, at: 0.36, len: 0.35, type: 'sine' });
  playTones(notes, 0.09, { force });
}
