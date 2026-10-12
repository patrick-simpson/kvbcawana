import { useEffect, useId, useState } from 'react';
import { PICKUP_CLUBS, auditSummary, timeToday } from '../../lib/printServer.js';
import { PanelCard } from './fields.jsx';

// The tools the check-in laptop's print dashboard used to hold, now that the
// dashboard is retired (ROADMAP.md#online-only). They are the Laptop section's
// (laptop.jsx), drawn with the same `api` it uses for everything: this page's
// sync sign-in is the proof, the print server's route table
// (print-server/security.js, SETTINGS_PAGE_ROUTES) is the rule, and nothing
// here ever sees a key or a token.

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

function LeaderTags({ api, clubs }) {
  const id = useId();
  const [name, setName] = useState('');
  const [club, setClub] = useState('');
  const [leaders, setLeaders] = useState([]);
  const [hidden, setHidden] = useState(0);
  const [picked, setPicked] = useState({});
  const [note, setNote] = useState(null);

  const load = async () => {
    const r = await api('/leaders');
    if (r.ok && r.data) { setLeaders(r.data.leaders || []); setHidden(r.data.hidden || 0); }
  };
  useEffect(() => {
    let alive = true;
    api('/leaders').then((r) => {
      if (alive && r.ok && r.data) { setLeaders(r.data.leaders || []); setHidden(r.data.hidden || 0); }
    });
    return () => { alive = false; };
    // Once, when the card opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const printTyped = async () => {
    const who = name.trim();
    if (!who) return setNote({ bad: true, text: 'Type the leader’s name first.' });
    setNote({ text: 'Printing…' });
    const r = await api('/print-leader', { method: 'POST', body: { name: who, clubName: club } });
    if (!r.ok) return setNote({ bad: true, text: `Print failed: ${r.error}` });
    setNote({ text: r.data?.duplicate ? 'Already printed a moment ago.' : `Printed ${who}.` });
    if (!r.data?.duplicate) setName('');
    load();
  };
  const printThese = async (list) => {
    setNote({ text: `Printing ${list.length} tag${list.length === 1 ? '' : 's'}…` });
    const r = await api('/print-leader', {
      method: 'POST',
      body: { leaders: list.map((l) => ({ firstName: l.firstName, lastName: l.lastName, clubName: l.clubName || '' })) },
    });
    if (!r.ok) return setNote({ bad: true, text: `Print failed: ${r.error}` });
    const b = r.data || {};
    if (b.failed) {
      const bad = (b.results || []).filter((x) => !x.success).map((x) => x.name).join(', ');
      setNote({ bad: true, text: `Printed ${b.printed}; failed: ${bad}` });
    } else {
      setNote({ text: `Printed ${b.printed} tag${b.printed === 1 ? '' : 's'}.` });
      setPicked({});
    }
    load();
  };
  const forget = async (l) => {
    const who = `${l.firstName || ''} ${l.lastName || ''}`.trim();
    if (!window.confirm(`Forget ${who}? Their tag can still be printed by typing the name.`)) return;
    const r = await api('/leaders/forget', { method: 'POST', body: { key: l.key } });
    if (!r.ok) return setNote({ bad: true, text: r.error });
    setLeaders(r.data?.leaders || []);
    setHidden(r.data?.hidden || 0);
    setPicked((p) => { const n = { ...p }; delete n[l.key]; return n; });
  };
  const chosen = leaders.filter((l) => picked[l.key]);

  return (
    <>
      <h4 className="settings-subhead">Leader name tag</h4>
      <p className="hint">For adult volunteers: the name, a LEADER pill and the club. Never counted toward tonight.</p>
      <div className="field">
        <label htmlFor={`${id}-name`}>Leader’s name</label>
        <input id={`${id}-name`} type="text" maxLength={80} value={name} autoComplete="off"
          onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && printTyped()} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-club`}>Leader’s club</label>
        <select id={`${id}-club`} value={club} onChange={(e) => setClub(e.target.value)}>
          <option value="">No club</option>
          {clubs.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="laptop-actions">
        <button type="button" className="primary" onClick={printTyped}>Print leader tag</button>
      </div>
      {leaders.length > 0 && (
        <>
          <h4 className="settings-subhead">Remembered leaders</h4>
          <ul className="laptop-history">
            {leaders.map((l) => {
              const who = `${l.firstName || ''} ${l.lastName || ''}`.trim();
              return (
                <li key={l.key}>
                  <span className="laptop-history__who">
                    <label className="laptop-club">
                      <input type="checkbox" checked={Boolean(picked[l.key])} aria-label={`Select ${who}`}
                        onChange={(e) => setPicked((p) => ({ ...p, [l.key]: e.target.checked }))} />
                      <strong>{who}</strong>
                    </label>
                  </span>
                  <span className="hint">{l.clubName || ''}</span>
                  <span className="laptop-actions" style={{ margin: 0 }}>
                    <button type="button" className="ghost" aria-label={`Print ${who}’s tag`} onClick={() => printThese([l])}>Print</button>
                    <button type="button" className="ghost" aria-label={`Forget ${who}`} onClick={() => forget(l)}>Forget</button>
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="laptop-actions">
            <button type="button" className="ghost" disabled={chosen.length === 0} onClick={() => printThese(chosen)}>Print selected</button>
          </div>
          {hidden > 0 && <p className="hint">{hidden} leader{hidden === 1 ? '' : 's'} not printed this season (hidden).</p>}
        </>
      )}
      <Note note={note} />
    </>
  );
}

function OneOffTag({ api, clubs }) {
  const id = useId();
  const [first, setFirst] = useState('');
  const [club, setClub] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const print = async () => {
    const firstName = first.replace(/\s+/g, ' ').trim();
    if (!firstName) return setNote({ bad: true, text: 'Type the child’s first name first.' });
    if (!club) return setNote({ bad: true, text: 'Pick the child’s club.' });
    setBusy(true); setNote({ text: 'Printing…' });
    const r = await api('/print-oneoff', { method: 'POST', body: { firstName, clubName: club } });
    setBusy(false);
    if (!r.ok || r.data?.success !== true) return setNote({ bad: true, text: `Print failed: ${r.error || 'see the print server’s log'}` });
    const who = r.data.firstName || firstName;
    setNote({ text: r.data.duplicate ? `Already printing ${who}’s tag.`
      : r.data.demo ? 'Test tag printed (rehearsal mode): nothing recorded, nothing on the screens.'
        : `Printed ${who}’s tag: welcomed on the screens, not counted.` });
    if (!r.data.duplicate) setFirst('');
  };
  return (
    <>
      <h4 className="settings-subhead">One-off name tag</h4>
      <p className="hint">For a lost tag, or a child who isn’t checking in tonight. It welcomes them on the screens and doesn’t count toward tonight.</p>
      <div className="field">
        <label htmlFor={`${id}-first`}>Child’s first name</label>
        <input id={`${id}-first`} type="text" maxLength={40} value={first} autoComplete="off"
          onChange={(e) => setFirst(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && print()} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-club`}>Child’s club</label>
        <select id={`${id}-club`} value={club} onChange={(e) => setClub(e.target.value)}>
          <option value="">Pick a club</option>
          {clubs.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="laptop-actions">
        <button type="button" className="primary" onClick={print} disabled={busy}>Print tag</button>
      </div>
      <Note note={note} />
    </>
  );
}

function CustomLabel({ api }) {
  const id = useId();
  const [text, setText] = useState('');
  const [note, setNote] = useState(null);
  const print = async () => {
    const t = text.trim();
    if (!t) return setNote({ bad: true, text: 'Type the label text first.' });
    setNote({ text: 'Printing…' });
    const r = await api('/print-custom', { method: 'POST', body: { text: t } });
    if (!r.ok) return setNote({ bad: true, text: `Print failed: ${r.error}` });
    setNote({ text: r.data?.duplicate ? 'Already printed a moment ago.' : 'Printed.' });
    if (!r.data?.duplicate) setText('');
  };
  return (
    <>
      <h4 className="settings-subhead">Custom label</h4>
      <p className="hint">One line of text, auto-sized, on an otherwise blank label. Not a check-in: nothing is counted, no history row is written and nothing reaches the lobby screens.</p>
      <div className="field">
        <label htmlFor={`${id}-text`}>Label text</label>
        <input id={`${id}-text`} type="text" maxLength={60} value={text} autoComplete="off" placeholder="VOLUNTEER, KITCHEN, Room 4 Helper…"
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && print()} />
      </div>
      <div className="laptop-actions">
        <button type="button" className="primary" onClick={print}>Print custom label</button>
      </div>
      <Note note={note} />
    </>
  );
}

/** Leader tags, one-off name tags and custom labels: the printer's "not a check-in" labels. */
export function NameTagsCard({ api }) {
  const clubs = useClubs(api);
  return (
    <PanelCard title="Name tags and labels" tab="var(--brand-orange)">
      <LeaderTags api={api} clubs={clubs} />
      <OneOffTag api={api} clubs={clubs} />
      <CustomLabel api={api} />
    </PanelCard>
  );
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

/** The season ledger against TwoTimTwo's own attendance grid. Only adds dates, only on confirm. */
export function AttendanceAuditCard({ api }) {
  const [audit, setAudit] = useState(undefined);
  const [note, setNote] = useState(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    api('/attendance-audit').then((r) => { if (alive) setAudit(r.ok ? r.data : null); });
    return () => { alive = false; };
  }, [api, nonce]);

  const apply = async () => {
    if (!window.confirm('Add the missing night(s) to the season ledger?\n\nThis changes streaks and milestone counts for the rest of the season (a child jumping past 5 nights will not get their 5-night line). Nothing is ever deleted.')) return;
    const r = await api('/attendance-audit/apply', { method: 'POST', body: { confirm: true } });
    setNote(r.ok && r.data?.ok
      ? { text: `Added ${r.data.added} date(s) across ${(r.data.children || []).length} child(ren). 0 deleted.` }
      : { bad: true, text: r.error || 'Could not apply.' });
    setNonce((n) => n + 1);
  };

  const summary = audit === undefined ? null : auditSummary(audit);
  const buckets = audit?.known ? [
    ['Same name twice, skipped on purpose', audit.ambiguous],
    ['Walk-in guests TwoTimTwo never saw', audit.notOnRoster],
    ['On TwoTimTwo but never printed here, not added', audit.neverPrinted],
    ['Clubs that could not be read', audit.clubsUnread],
  ].filter(([, list]) => (list || []).length) : [];

  return (
    <PanelCard title="Attendance audit" tab="var(--brand-trek)">
      <p className="hint">Compares this laptop’s season ledger with TwoTimTwo’s attendance grid. Nothing is ever deleted.</p>
      {audit === undefined && <p className="hint" role="status">Reading the audit…</p>}
      {audit === null && <p className="hint hint--warn" role="status">The audit could not be read, so nothing is known about the ledger either way.</p>}
      {summary && <p className={summary.tone === 'warn' ? 'hint hint--warn' : 'hint'} role="status">{summary.text}</p>}
      {audit?.known && !audit.matches && (audit.rows || []).length > 0 && (
        <ul className="laptop-history" aria-label="Nights that differ">
          {audit.rows.map((r) => (
            <li key={r.key || r.name}>
              <span className="laptop-history__who"><strong>{r.name}</strong></span>
              <span className="hint">{r.club}</span>
              <span className="hint">
                {r.missingHere.length ? `Missing here: ${r.missingHere.join(', ')}` : ''}
                {r.missingHere.length && r.ledgerOnly.length ? ' · ' : ''}
                {r.ledgerOnly.length ? `Only here: ${r.ledgerOnly.join(', ')}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      {buckets.map(([title, list]) => (
        <p className="hint" key={title}>{title}: {list.length} ({list.slice(0, 8).join(', ')}{list.length > 8 ? '…' : ''})</p>
      ))}
      <div className="laptop-actions">
        <button type="button" className="ghost" onClick={() => setNonce((n) => n + 1)}>Refresh</button>
        <button type="button" className="primary" onClick={apply} disabled={!(audit?.known && audit.totals?.missing > 0)}>
          {audit?.known && audit.totals?.missing > 0 ? `Apply ${audit.totals.missing} missing date(s)` : 'Apply missing dates'}
        </button>
      </div>
      <Note note={note} />
    </PanelCard>
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
    <PanelCard title="Sync service" tab="var(--brand-journey)">
      <p className="laptop-away__lead">
        {out ? (sync.state === 'signed-out' ? 'This laptop was signed out of the sync service.' : 'This laptop is not signed in to the sync service.')
          : 'This laptop is signed in to the sync service.'}
      </p>
      <p className="hint">
        {out
          ? 'Without it the screens, the phone page and the count do not hear this laptop’s check-ins. Labels still print. Type the church passphrase to sign it in again.'
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
