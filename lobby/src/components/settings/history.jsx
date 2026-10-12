import { useEffect, useMemo, useState } from 'react';
import { useSync } from '../../hooks/useSync.js';
import { loadSyncSession } from '../../lib/syncService.js';
import { getClubPalette } from '../../lib/clubs.js';
import {
  fetchNightRows, fetchNights, fetchSummary, historyUnlocked, lockHistory, unlockHistory,
} from '../../lib/historyCrypto.js';
import { buildTrends, checkoutRate, nightCsv, nightWords, rowLines, seasonAverages } from '../../lib/historyTrends.js';
import { PanelCard } from './fields.jsx';
import { BarChart, LineChart } from './historyCharts.jsx';
import '../../styles/history.css';

// The History section (ROADMAP.md#online-check-in, P6), on the settings page
// only, like the Laptop section. Trends come from the Worker's plaintext
// night_summary and need only the sync sign-in. A night's rows are sealed
// (the Worker cannot read them); the page opens them with the passphrase, which
// is used once to open the key and never kept (historyCrypto.js).

const TAB = 'var(--brand-blue)';

/** @param {{ children?: any }} p */
function Hint({ children }) {
  return <p className="hint" role="status">{children}</p>;
}

/** A client-side download: nothing leaves the browser. @param {string} text @param {string} name */
function downloadText(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Trends({ trends }) {
  const [season, setSeason] = useState('all');
  const shown = useMemo(() => (season === 'all' ? trends.perNight : trends.perNight.filter((p) => p.season === season)), [trends, season]);
  const nights = shown.map((p) => p.night);
  const clubs = trends.clubs.filter((c) => shown.some((p) => p.byClub[c] > 0));
  const series = clubs.map((c) => ({ label: c, color: getClubPalette(c).primary, values: shown.map((p) => p.byClub[c]) }));
  const total = shown.reduce((n, p) => n + p.checkedIn, 0);
  const averages = seasonAverages(trends);
  return (
    <>
      <div className="field">
        <label htmlFor="hist-season">Season</label>
        <select id="hist-season" value={season} onChange={(e) => setSeason(e.target.value)}>
          <option value="all">All seasons</option>
          {trends.seasons.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <LineChart
        title="Attendance by club"
        summary={`Children checked in per club on each of ${nights.length} nights, ${total} check-ins in all.`}
        nights={nights} series={series}
      />
      <BarChart
        title="Visitors"
        summary={`Visitors on each night: ${shown.map((p) => `${nightWords(p.night)} ${p.visitors}`).join(', ')}.`}
        nights={nights} values={shown.map((p) => p.visitors)} color="var(--brand-sparks, #D9382C)"
      />
      <BarChart
        title="Checked out"
        summary="The share of children checked in who were checked out, on each night."
        nights={nights} values={shown.map((p) => checkoutRate(p.checkedOut, p.checkedIn))} color="var(--brand-blue, #1C5FAF)" unit="%" max={100}
      />
      <h4 className="settings-subhead">Average attendance per season</h4>
      <div className="hist-table-wrap">
        <table className="hist-table">
          <thead><tr><th scope="col">Season</th><th scope="col">Nights</th>{trends.clubs.map((c) => <th scope="col" key={c}>{c}</th>)}</tr></thead>
          <tbody>{averages.map((a) => (
            <tr key={a.season}><th scope="row">{a.season}</th><td>{a.nights}</td>{trends.clubs.map((c) => <td key={c}>{a.avg[c] || ''}</td>)}</tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}

function NightRows({ night, session, url }) {
  const [pass, setPass] = useState('');
  const [unlocked, setUnlocked] = useState(historyUnlocked());
  const [busy, setBusy] = useState(unlocked);   // already unlocked: the rows load on arrival
  const [state, setState] = useState(/** @type {any} */ (null));
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!unlocked) return undefined;
    let live = true;
    (async () => {
      const res = await fetchNightRows(url, session, night);
      if (!live) return;
      setBusy(false);
      if (!res.ok) { setNote(res.message); setState(null); return; }
      setNote('');
      setState({ lines: rowLines(res.rows), unreadable: res.unreadable });
    })();
    return () => { live = false; };
  }, [unlocked, night, session, url]);

  const open = async () => {
    setBusy(true);
    const res = await unlockHistory(url, session, pass);
    setBusy(false);
    setPass('');
    if (res.ok) { setNote(''); setBusy(true); setUnlocked(true); } else setNote(res.message);
  };

  if (!unlocked) {
    return (
      <form className="hist-unlock" onSubmit={(e) => { e.preventDefault(); if (pass.trim() && !busy) open(); }}>
        <div className="field">
          <label htmlFor="hist-pass">Passphrase</label>
          <input id="hist-pass" type="password" autoComplete="off" value={pass} onChange={(e) => setPass(e.target.value)} />
          <span className="hint">Children&rsquo;s names are sealed. The passphrase opens them in this browser only; it is never sent for this, and never saved.</span>
        </div>
        <button type="submit" className="ghost section-jump" disabled={busy || !pass.trim()}>{busy ? 'Opening…' : 'Open the names'}</button>
        {note ? <Hint>{note}</Hint> : null}
      </form>
    );
  }
  return (
    <div className="hist-night">
      <div className="hist-actions">
        <button type="button" className="ghost section-jump" disabled={!state || !state.lines.length}
          onClick={() => downloadText(nightCsv(night, state.lines), `awana-${night}.csv`)}>Download CSV</button>
        <button type="button" className="ghost section-jump" onClick={() => { lockHistory(); setUnlocked(false); setState(null); }}>Lock the names</button>
      </div>
      {busy ? <Hint>Opening…</Hint> : null}
      {note ? <Hint>{note}</Hint> : null}
      {state ? (
        <div className="hist-table-wrap">
          <table className="hist-table">
            <caption>{nightWords(night)}: {state.lines.length} {state.lines.length === 1 ? 'entry' : 'entries'}</caption>
            <thead><tr><th scope="col">Time</th><th scope="col">What</th><th scope="col">Name</th><th scope="col">Club</th></tr></thead>
            <tbody>{state.lines.map((l) => <tr key={l.id}><td>{l.time}</td><td>{l.kind}</td><td>{l.name}</td><td>{l.club}</td></tr>)}</tbody>
          </table>
          {state.unreadable ? <Hint>{state.unreadable} {state.unreadable === 1 ? 'entry' : 'entries'} could not be opened and {state.unreadable === 1 ? 'is' : 'are'} not shown.</Hint> : null}
        </div>
      ) : null}
    </div>
  );
}

export default function HistorySection() {
  const { signedIn, url } = useSync();
  const session = loadSyncSession();
  const [data, setData] = useState(/** @type {any} */ (null));
  const [problem, setProblem] = useState('');
  const [open, setOpen] = useState('');

  useEffect(() => {
    if (!signedIn || !url) return undefined;
    let live = true;
    (async () => {
      const [n, s] = await Promise.all([fetchNights(url, session), fetchSummary(url, session)]);
      if (!live) return;
      if (!n.ok) { setProblem(n.message); return; }
      if (!s.ok) { setProblem(s.message); return; }
      setProblem('');
      setData({ nights: n.nights, trends: buildTrends(s.lines, n.nights) });
    })();
    return () => { live = false; };
  }, [signedIn, url, session]);

  if (!signedIn || !url) {
    return <PanelCard title="History" tab={TAB}><Hint>Sign in to the sync service under Setup to see past nights.</Hint></PanelCard>;
  }
  return (
    <>
      <PanelCard title="Trends" tab={TAB}>
        {problem ? <Hint>{problem}</Hint> : null}
        {!problem && !data ? <Hint>Loading…</Hint> : null}
        {data && !data.nights.length ? <Hint>No nights saved yet. They appear here after the next club night.</Hint> : null}
        {data && data.nights.length ? <Trends trends={data.trends} /> : null}
      </PanelCard>
      <PanelCard title="Nights" tab={TAB}>
        {data && data.nights.length ? (
          <ul className="hist-nights">
            {data.nights.map((n) => (
              <li key={n.night}>
                <button type="button" className="hist-night-btn" aria-expanded={open === n.night} onClick={() => setOpen(open === n.night ? '' : n.night)}>
                  <strong>{nightWords(n.night)}</strong> <span>{n.rows} {n.rows === 1 ? 'entry' : 'entries'}</span>
                </button>
                {open === n.night ? <NightRows night={n.night} session={session} url={url} /> : null}
              </li>
            ))}
          </ul>
        ) : <Hint>Nothing to list yet.</Hint>}
      </PanelCard>
    </>
  );
}
