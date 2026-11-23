import { useEffect, useState } from 'react';

// Backwards Night's VHS rewind (owner 2026-11-23, easter egg): every
// REWIND_EVERY_MS the lobby "rewinds" for REWIND_MS: a ◀◀ REW tag top left,
// a few white tracking bars sliding up the picture, and the slide's words
// shuddering sideways (app.css "VHS rewind", html.vhs-rewind). Never while a
// child's name is up or a held slide/poster is on, never under zero
// animation (the whole thing is motion). Flat: hard white bars, no blur.

export const REWIND_EVERY_MS = 6 * 60 * 1000;
export const REWIND_MS = 3000;
/** The first one waits a little, so a screen just turned on does not rewind at once. */
export const REWIND_FIRST_MS = 90 * 1000;

/** @param {{ on: boolean, busy: boolean, every?: number, first?: number }} props */
export default function VhsRewind({ on, busy, every = REWIND_EVERY_MS, first = REWIND_FIRST_MS }) {
  const [due, setDue] = useState(false);
  const [up, setUp] = useState(false);

  useEffect(() => {
    if (!on) { setDue(false); return undefined; }
    let t = window.setTimeout(function tick() {
      setDue(true);
      t = window.setTimeout(tick, every);
    }, first);
    return () => window.clearTimeout(t);
  }, [on, every, first]);

  // A due rewind waits for a quiet moment (no name, nothing held), then plays once.
  useEffect(() => {
    if (!on || !due || busy || up) return;
    setDue(false);
    setUp(true);
  }, [on, due, busy, up]);
  // Its own clock, so the start's re-render never cancels the end.
  useEffect(() => {
    if (!up) return undefined;
    const t = window.setTimeout(() => setUp(false), REWIND_MS);
    return () => window.clearTimeout(t);
  }, [up]);
  // Backwards Night ending mid-rewind takes it down at once.
  useEffect(() => { if (!on) setUp(false); }, [on]);

  useEffect(() => {
    document.documentElement.classList.toggle('vhs-rewind', up);
    return () => document.documentElement.classList.remove('vhs-rewind');
  }, [up]);

  if (!up) return null;
  return (
    <div className="vhs" aria-hidden="true">
      <div className="vhs__tag">◀◀ REW</div>
      <div className="vhs__bar vhs__bar--a" />
      <div className="vhs__bar vhs__bar--b" />
      <div className="vhs__bar vhs__bar--c" />
    </div>
  );
}
