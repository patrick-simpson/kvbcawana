import { useCallback, useEffect, useState } from 'react';
import { PanelCard } from './fields.jsx';
import { agoWords } from '../../lib/missionControl.js';
import { getStoreNight, putStoreNight } from '../../lib/workerClient.js';

// Awana store night (owner 2026-11-18, 2026-11-21): each child's share number prints on
// their name tag in a SHARES box. Automatic follows the church calendar ("store" in
// tonight's event title), On and Off override it (worker/src/shares.js,
// routes.md 10.20). Counts only: the page never sees a name or a balance.

export const STORE_MODES = [
  { mode: 'auto', label: 'Automatic', hint: 'On when tonight’s church calendar or TwoTimTwo’s own meeting says “store”.' },
  { mode: 'on', label: 'On', hint: 'Show share balances on the labels tonight, whatever the calendars say.' },
  { mode: 'off', label: 'Off', hint: 'Never show share balances.' },
];

/** The status line under the buttons. @param {any} v */
export function storeNightWords(v) {
  if (!v) return '';
  const balances = v.readAt
    ? `${v.balances} balances read from TwoTimTwo ${agoWords(v.readAt)}.`
    : 'Balances are read from TwoTimTwo when club opens (about 4:30 pm).';
  if (!v.active) {
    if (v.mode === 'off') return `Off: labels show no share balances. ${balances}`;
    return `Tonight is not store night. ${balances}`;
  }
  const why = v.mode === 'on' ? 'Switched on' : v.twotimtwoSaysStore ? 'TwoTimTwo says store night' : 'The church calendar says store night';
  return `${why}. ${balances} Each label shows SHARES: the balance plus tonight’s share, never under ${v.minimum || 10}.`;
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
      <p className="hint">On store nights each name tag shows the child’s shares in a box. Every club night the lobby TV shows “+N SHARES!” for shares earned since last week.</p>
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
