// Synthesizes a short, joyful two-tone chime at runtime via the WebAudio
// API. Avoiding a bundled .mp3 keeps the repo text-only and removes any
// licensing question — it's just 6th → octave notes on a sine wave.
//
// Browsers block audio until the page sees a user gesture, so the first
// call may silently fail. Once the user toggles "Sound on" in settings
// (which is a user gesture), subsequent plays work normally.

let audioCtx = null;

function getContext() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

function tone(ctx, freq, startAt, durationSec, peak = 0.18) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;

  const end = startAt + durationSec;
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(peak, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(end + 0.05);
}

// Every chime takes a volume multiplier (0..1). Late arrivals during
// the program play at a fraction of normal so a straggler's check-in
// doesn't blast over the ceremony — see isLatePhase in lib/schedule.js.

// Standard check-in chime: C5 → E5 → G5, rising.
export function playChime(volume = 1) {
  const ctx = getContext();
  if (!ctx) return;
  const t = ctx.currentTime;
  tone(ctx, 523.25, t,        0.25, 0.18 * volume); // C5
  tone(ctx, 659.25, t + 0.12, 0.3,  0.18 * volume); // E5
  tone(ctx, 783.99, t + 0.24, 0.5,  0.18 * volume); // G5
}

// Birthday chime: a slightly longer, brighter fanfare.
export function playBirthdayChime(volume = 1) {
  const ctx = getContext();
  if (!ctx) return;
  const t = ctx.currentTime;
  tone(ctx, 523.25, t,        0.25, 0.18 * volume); // C5
  tone(ctx, 659.25, t + 0.15, 0.25, 0.18 * volume); // E5
  tone(ctx, 783.99, t + 0.3,  0.25, 0.18 * volume); // G5
  tone(ctx, 1046.5, t + 0.45, 0.6,  0.18 * volume); // C6
}

// First-timer chime: softer, ascending perfect fifth.
export function playFirstTimerChime(volume = 1) {
  const ctx = getContext();
  if (!ctx) return;
  const t = ctx.currentTime;
  tone(ctx, 440,    t,        0.3, 0.15 * volume); // A4
  tone(ctx, 659.25, t + 0.18, 0.6, 0.15 * volume); // E5
}
