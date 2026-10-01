import { useEffect, useRef } from 'react';

/**
 * How loudly a banner celebrates, by presentation variant:
 *   'live'   — full confetti + chime (the default moment)
 *   'late'   — mid-program arrival: no confetti cannon, chime ducked
 *              to a quarter so it doesn't blast over the ceremony
 *   'replay' — recap after a reconnect: silent, banner only
 * `chime` receives a volume multiplier (see lib/audio.js).
 */
export function celebrationProfile(presentation, { confetti, chime }) {
  if (presentation === 'replay') return { confetti: () => {}, chime: () => {} };
  if (presentation === 'late') return { confetti: () => {}, chime: () => chime(0.25) };
  return { confetti, chime: () => chime(1) };
}

/**
 * Fire a banner's celebration (confetti burst + chime) exactly once per
 * check-in event. The callbacks and the audio flag are read through refs
 * — synced in their own effects — so toggling sound mid-banner, or a
 * parent re-render swapping callback identities, never re-fires the
 * confetti; only a new event id does.
 */
export function useCelebration(eventId, audioEnabled, { confetti, chime }) {
  const audioRef = useRef(audioEnabled);
  const fireRef = useRef({ confetti, chime });

  useEffect(() => {
    audioRef.current = audioEnabled;
  }, [audioEnabled]);
  useEffect(() => {
    fireRef.current = { confetti, chime };
  }, [confetti, chime]);

  useEffect(() => {
    fireRef.current.confetti();
    if (audioRef.current) fireRef.current.chime();
  }, [eventId]);
}
