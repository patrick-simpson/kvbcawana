import { useCallback, useEffect, useState } from 'react';
import { PanelCard } from './fields.jsx';
import { agoWords } from '../../lib/missionControl.js';
import { getTheme, putTheme } from '../../lib/workerClient.js';

// Backwards Night (owner 2026-11-23): every screen spells its words backwards,
// runs its animations in reverse and counts the gym countdown UP, and the name
// tags print the name and handbook group backwards. Automatic follows the
// church calendar ("Backwards" in tonight's event title); On and Off override
// it (worker/src/theme.js, routes.md 10.22). Pledges, Scripture, the pickup
// board, game scores and notices stay the right way round.

export const BACKWARDS_MODES = [
  { mode: 'auto', label: 'Automatic', hint: 'On when tonight’s church calendar says “Backwards”.' },
  { mode: 'on', label: 'On', hint: 'On for tonight only. Backwards whatever the calendar says, then it goes back to Automatic.' },
  { mode: 'off', label: 'Off', hint: 'Never backwards.' },
];

/** The status line under the buttons. @param {any} v */
export function backwardsWords(v) {
  if (!v) return '';
  if (!v.backwards) return v.mode === 'off' ? 'Off: every screen and tag reads the right way round.' : 'Tonight is not Backwards Night.';
  const why = v.mode === 'on' ? 'Switched on for tonight' : 'The church calendar says Backwards Night';
  const when = v.changedAt && v.mode !== 'auto' ? ` (${agoWords(v.changedAt)})` : '';
  return `${why}${when}. Screens spell their words backwards and name tags print the name and group backwards.`;
}

export default function BackwardsNightCard() {
  const [data, setData] = useState(/** @type {any} */ (null));
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => getTheme().then((a) => {
    if (a.ok) { setData(a.body); setProblem(''); } else setProblem(a.message);
  }), []);
  useEffect(() => { load(); }, [load]);
  const pick = async (mode) => {
    setBusy(true);
    const a = await putTheme(mode);
    setBusy(false);
    if (a.ok) { setData(a.body); setProblem(''); } else setProblem(a.message);
  };
  return (
    <PanelCard title="Backwards Night" tab="var(--brand-journey, #8A649D)">
      <p className="hint">Words spelled backwards on every screen, animations in reverse, the gym countdown counting up, and backwards name tags.</p>
      {problem && <p className="hint hint--warn" role="status">{problem}</p>}
      {!data && !problem && <p className="hint" role="status">Reading…</p>}
      {data && (
        <>
          <div className="store-night-modes" role="radiogroup" aria-label="Backwards Night">
            {BACKWARDS_MODES.map((m) => (
              <button
                key={m.mode} type="button" role="radio" aria-checked={data.mode === m.mode}
                className={data.mode === m.mode ? 'primary' : 'secondary'}
                disabled={busy} onClick={() => pick(m.mode)} title={m.hint}
              >{m.label}</button>
            ))}
          </div>
          <p className="hint">{BACKWARDS_MODES.find((m) => m.mode === data.mode)?.hint}</p>
          <p className="hint" role="status" data-backwards-status>{backwardsWords(data)}</p>
        </>
      )}
    </PanelCard>
  );
}
