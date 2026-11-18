import { useCallback, useEffect, useState } from 'react';
import { PanelCard } from './fields.jsx';
import { agoWords } from '../../lib/missionControl.js';
import { getStoreNight, putStoreNight } from '../../lib/workerClient.js';

// Awana store night (owner 2026-11-18): each child's share balance prints on their
// name tag as a coin badge. Automatic follows the church calendar ("store" in
// tonight's event title), On and Off override it (worker/src/shares.js,
// routes.md 10.20). Counts only: the page never sees a name or a balance.

export const STORE_MODES = [
  { mode: 'auto', label: 'Automatic', hint: 'On when tonight’s calendar event says “store”.' },
  { mode: 'on', label: 'On', hint: 'Show share balances on the labels, whatever the calendar says.' },
  { mode: 'off', label: 'Off', hint: 'Never show share balances.' },
];

/** The status line under the buttons. @param {any} v */
export function storeNightWords(v) {
  if (!v) return '';
  if (!v.active) {
    if (v.mode === 'off') return 'Off: labels show no share balances.';
    return v.calendarSaysStore ? 'Not on yet.' : 'Tonight’s calendar does not say store night, so labels show no share balances.';
  }
  const why = v.mode === 'on' ? 'Switched on' : 'Tonight’s calendar says store night';
  if (!v.readAt) return `${why}. Reading share balances from TwoTimTwo… (labels printed before this finishes have no coin).`;
  const part = v.clubsRead < v.clubs ? ` (${v.clubsRead} of ${v.clubs} clubs read${v.error ? `; ${v.error}` : ''})` : '';
  return `${why}. ${v.balances} balances read ${agoWords(v.readAt)}${part}. Each label shows the balance plus tonight’s share.`;
}

export default function StoreNightCard() {
  const [data, setData] = useState(/** @type {any} */ (null));
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => getStoreNight().then((a) => {
    if (a.ok) { setData(a.body); setProblem(''); } else setProblem(a.message);
  }), []);
  useEffect(() => {
    load();
    // While store night is on, the line keeps up with the reads (once a minute, visible only).
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60000);
    return () => clearInterval(t);
  }, [load]);

  const pick = async (mode) => {
    setBusy(true);
    const a = await putStoreNight(mode);
    setBusy(false);
    if (a.ok) { setData(a.body); setProblem(''); setTimeout(load, 15000); } else setProblem(a.message);
  };

  return (
    <PanelCard title="Awana store night" tab="var(--brand-sun, #F7B917)">
      <p className="hint">Puts each child’s share balance on their name tag (🪙 and a number) on store nights.</p>
      {problem && <p className="hint hint--warn" role="status">{problem}</p>}
      {!data && !problem && <p className="hint" role="status">Reading…</p>}
      {data && (
        <>
          <div className="store-night-modes" role="radiogroup" aria-label="Store night">
            {STORE_MODES.map((m) => (
              <button
                key={m.mode} type="button" role="radio" aria-checked={data.mode === m.mode}
                className={data.mode === m.mode ? 'primary' : 'secondary'}
                disabled={busy} onClick={() => pick(m.mode)} title={m.hint}
              >{m.label}</button>
            ))}
          </div>
          <p className="hint">{STORE_MODES.find((m) => m.mode === data.mode)?.hint}</p>
          <p className="hint" role="status" data-store-night-status>{storeNightWords(data)}</p>
        </>
      )}
    </PanelCard>
  );
}
