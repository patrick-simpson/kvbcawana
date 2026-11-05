// Synthesized countdown stingers — short WebAudio chimes for the final
// milestones (1hr / 30min / 10min / 5min / 1min). No audio files: two
// oscillators and a gain envelope, matching the signage app's "no
// bundled mp3" philosophy. OFF by default — a projector in a quiet
// room must never surprise anyone; the QuickNav toggle arms it.

const STORAGE_KEY = 'awanaCountdownStingers.v1';

let enabled = readStored();
const listeners = new Set();

// Another window of this profile (the configure page, ?configure=1) may flip
// the switch: take it live.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY && e.key !== null) return;
    enabled = readStored();
    for (const fn of listeners) fn();
  });
}

function readStored() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** The lobby's mirror of the projector (?mirror=1) never sounds: silent for this page alone, nothing stored. */
let silenced = false;
export function silenceStingers() {
  silenced = true;
}

export function stingersEnabled() {
  return enabled;
}

export function setStingersEnabled(on) {
  enabled = !!on;
  try {
    if (on) localStorage.setItem(STORAGE_KEY, '1');
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage blocked — in-memory value applies this session */
  }
  for (const fn of listeners) fn();
}

export function subscribeStingers(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let ctx = null;
function audioCtx() {
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/**
 * Wake the chimes' audio from inside a tap. A phone or tablet (WebKit, and
 * Chrome on Android) lets a page make sound only when its AudioContext was
 * created or resumed inside a user gesture, and the chimes play from a clock
 * tick, so without this they never sounded there. Called by the touch menu's
 * "Countdown sounds" switch and by every tap on a touch page (App.jsx); a
 * silent one-sample buffer primes Safari. Nothing happens while the chimes are
 * off: no context is made for a feature nobody armed.
 */
export function unlockStingers() {
  if (!enabled || typeof window === 'undefined') return;
  try {
    const ac = audioCtx();
    if (!ac) return;
    const src = ac.createBufferSource();
    src.buffer = ac.createBuffer(1, 1, 22050);
    src.connect(ac.destination);
    src.start(0);
  } catch {
    /* audio unavailable */
  }
}

/**
 * A bright two-note rising chime. `intensity` 0–1 scales loudness and
 * adds a third note for the final milestone.
 */
export function playStinger(intensity = 0.5) {
  if (!enabled || silenced) return;
  const ac = audioCtx();
  if (!ac) return;
  try {
    const t0 = ac.currentTime;
    const gainMax = 0.08 + 0.1 * intensity;
    const notes = intensity >= 0.9 ? [660, 880, 1320] : [660, 990];
    notes.forEach((freq, i) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const start = t0 + i * 0.13;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(gainMax, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.5);
      osc.connect(gain).connect(ac.destination);
      osc.start(start);
      osc.stop(start + 0.55);
    });
  } catch {
    /* audio blocked (no user gesture yet) — silently skip */
  }
}

/**
 * Short tones for the scoreboard (owner 2026-11-05: "Short chime per point";
 * the timer's buzzer at 0). Same switch as the countdown chimes: OFF until the
 * operator arms "Countdown sounds" (a projector in a quiet room must never
 * surprise anyone), silent on the lobby's mirror.
 * The scoreboard's own phone switch (`force`, owner 2026-11-05) turns them on
 * too; nothing ever sounds on the mirror.
 * @param {{freq: number, at: number, len: number, type?: OscillatorType}[]} notes  at/len in seconds
 * @param {number} [gainMax]
 * @param {{force?: boolean}} [opts]
 */
export function playTones(notes, gainMax = 0.14, opts = {}) {
  if ((!enabled && !opts.force) || silenced || typeof window === 'undefined') return;
  const ac = audioCtx();
  if (!ac) return;
  try {
    const t0 = ac.currentTime;
    for (const n of notes) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = n.type || 'triangle';
      osc.frequency.value = n.freq;
      const start = t0 + n.at;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(gainMax, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + n.len);
      osc.connect(gain).connect(ac.destination);
      osc.start(start);
      osc.stop(start + n.len + 0.05);
    }
  } catch {
    /* audio unavailable */
  }
}
