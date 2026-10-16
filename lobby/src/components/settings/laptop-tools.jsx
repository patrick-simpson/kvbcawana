import { useEffect, useId, useState } from 'react';
import { PICKUP_CLUBS, timeToday } from '../../lib/printServer.js';
import { PanelCard } from './fields.jsx';

// The tools the check-in laptop's print dashboard used to hold, now that the
// dashboard is retired (ROADMAP.md#online-only). They are the At the laptop
// card's (AtTheLaptop.jsx), drawn with the same `api` it uses for everything: this page's
// sync sign-in is the proof, the print server's route table
// (print-server/security.js, SETTINGS_PAGE_ROUTES) is the rule, and nothing
// here ever sees a key or a token. (Leader, one-off and custom labels print
// as sealed jobs from Printing → Name tags and labels; the attendance audit
// went with the Chrome extension in KVBC Awana 10.0.0.)

/** One line of feedback under a control, announced politely. */
function Note({ note }) {
  if (!note) return null;
  return <span className={`hint laptop-note${note.bad ? ' hint--warn' : ''}`} role="status">{note.text}</span>;
}

/** The club list the server keeps (GET /clubs), the same one every other dropdown reads. */
export function useClubs(api) {
  const [clubs, setClubs] = useState(PICKUP_CLUBS);
  useEffect(() => {
    let alive = true;
    api('/clubs').then((r) => { if (alive && r.ok && Array.isArray(r.data?.clubs)) setClubs(r.data.clubs); });
    return () => { alive = false; };
    // Once, when the card opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return clubs;
}

/**
 * Reprint a whole stretch of tonight. Two steps on purpose: the first press is
 * a dry run (the server counts and names, prints nothing), and that answer is
 * the confirm: the number the person agrees to comes from the server.
 */
export function ReprintStretch({ api, clubs, onDone }) {
  const id = useId();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [club, setClub] = useState('');
  const [plan, setPlan] = useState(null);
  const [note, setNote] = useState(null);

  const check = async () => {
    setPlan(null);
    const fromTs = timeToday(from, false);
    const toTs = timeToday(to, true);
    if (!fromTs || !toTs) return setNote({ bad: true, text: 'Enter both a start and an end time, like 6:30.' });
    setNote({ text: 'Checking…' });
    const body = { fromTs, toTs, club };
    const r = await api('/reprint-range', { method: 'POST', body });
    if (!r.ok) return setNote({ bad: true, text: r.error });
    if (!r.data?.count) return setNote({ text: 'Nothing to reprint in that stretch.' });
    setPlan({ body, data: r.data });
    setNote(null);
  };
  const go = async () => {
    if (!plan) return;
    const { body } = plan;
    setPlan(null);
    setNote({ text: 'Printing…' });
    const r = await api('/reprint-range', { method: 'POST', body: { ...body, confirm: true } });
    if (!r.ok) return setNote({ bad: true, text: r.error });
    const n = (r.data?.printed || []).length;
    setNote(r.data?.stoppedAt
      ? { bad: true, text: `Printed ${n} label${n === 1 ? '' : 's'}, then failed on ${r.data.stoppedAt.name}. Clear the jam and run the rest.` }
      : { text: `Reprinted ${n} label${n === 1 ? '' : 's'}.` });
    onDone?.();
  };
  const names = plan ? (plan.data.rows || []).map((r) => `${r.name}${r.clubName ? ` (${r.clubName})` : ''}`).join(', ') : '';

  return (
    <>
      <h4 className="settings-subhead">Reprint this stretch</h4>
      <div className="laptop-schedule__row">
        <input id={`${id}-from`} type="text" aria-label="From (time)" placeholder="From 6:30" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input id={`${id}-to`} type="text" aria-label="To (time)" placeholder="To 6:45" value={to} onChange={(e) => setTo(e.target.value)} />
        <select aria-label="Club for the stretch" value={club} onChange={(e) => setClub(e.target.value)}>
          <option value="">All clubs</option>
          {clubs.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button type="button" className="ghost" onClick={check}>Reprint this stretch</button>
      </div>
      {plan && (
        <div className="laptop-away">
          <p className="laptop-away__lead">{plan.data.count} label{plan.data.count === 1 ? '' : 's'} will reprint</p>
          <p className="hint">
            {names}{plan.data.capped ? ' (capped at 20: run a narrower stretch for the rest)' : ''}. Awards, leader tags and removed kids are skipped.
          </p>
          <div className="laptop-actions">
            <button type="button" className="primary" onClick={go}>Print {plan.data.count} label{plan.data.count === 1 ? '' : 's'}</button>
            <button type="button" className="ghost" onClick={() => setPlan(null)}>Cancel</button>
          </div>
        </div>
      )}
      <Note note={note} />
    </>
  );
}

/**
 * This laptop's own sign-in to the sync service. The page's session already
 * proved who it is, so this asks only for the passphrase, and the print server
 * signs in to the service it already uses (never one this page names).
 */
export function SyncSignInCard({ health, api, onRefresh }) {
  const id = useId();
  const [pass, setPass] = useState('');
  const [note, setNote] = useState(null);
  const sync = health.sync || {};
  const out = sync.signedIn !== true;
  const signIn = async () => {
    if (!pass.trim()) return setNote({ bad: true, text: 'Type the church passphrase first.' });
    setNote({ text: 'Signing in…' });
    const r = await api('/config/sync-login', { method: 'POST', body: { passphrase: pass } });
    if (!r.ok) return setNote({ bad: true, text: r.error });
    setPass('');
    setNote({ text: 'Signed in. Check-ins on this laptop reach the screens again.' });
    onRefresh();
  };
  return (
    <PanelCard title="This laptop’s sign-in" tab="var(--brand-journey)">
      <p className="laptop-away__lead">
        {out ? (sync.state === 'signed-out' ? 'This laptop was signed out of the church’s sign-in.' : 'This laptop is not signed in to the church’s sign-in.')
          : 'This laptop is signed in to the church’s sign-in.'}
      </p>
      <p className="hint">
        {out
          ? 'Without it the screens, phone check-in (awana.kvbchurch.org/checkin) and the count do not hear this laptop’s check-ins. Labels still print. Type the church passphrase to sign it in again.'
          : 'It seals each check-in with the key the screens share and relays it. If the passphrase is ever changed, sign this laptop in again here.'}
      </p>
      {sync.error ? <p className="hint hint--warn">{sync.error}</p> : null}
      {out && (
        <div className="field">
          <label htmlFor={`${id}-pass`}>Church passphrase</label>
          <input id={`${id}-pass`} type="password" autoComplete="off" value={pass}
            onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && signIn()} />
          <div className="laptop-actions">
            <button type="button" className="primary" onClick={signIn}>Sign this laptop in</button>
          </div>
        </div>
      )}
      <Note note={note} />
    </PanelCard>
  );
}
