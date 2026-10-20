import { useCallback, useEffect, useId, useState } from 'react';
import { loadSyncSession } from '../../lib/syncService.js';
import { useSync } from '../../hooks/useSync.js';
import {
  PICKUP_CLUBS, callPrintServer, cleanScheduleRows, formToTemplate, healthSummary,
  NAME_SIZE_MAX, NAME_SIZE_MIN, pickupTicked, printerOptions, TEMPLATE_FIELDS,
  templateClubLabel, templateToForm, validStartTime, withTemplate,
} from '../../lib/printServer.js';
import { PanelCard, Toggle } from './fields.jsx';
import '../../styles/laptop.css';

// The cards Printing → At the laptop (AtTheLaptop.jsx) is made of: the
// check-in laptop's own settings and tools. What the page may do is the
// server's call (security.js SETTINGS_PAGE_ROUTES; POST /config takes the
// printer's own keys only, never a key or a token), see lib/printServer.js.

/** One line of feedback under a control, announced politely. */
function Note({ note }) {
  if (!note) return null;
  return <span className={`hint laptop-note${note.bad ? ' hint--warn' : ''}`} role="status">{note.text}</span>;
}

export function ConnectCard({ problem, signedIn }) {
  const lead = problem?.reason === 'sign-in-refused' || problem?.reason === 'no-token-on-server' ? problem.error
    : signedIn ? 'The printer is here.' : 'The printer is here. Sign in under Account & app with the church passphrase to change its settings.';
  return (
    <PanelCard title="Connect to the printer" tab="var(--brand-sun)">
      <p className="laptop-away__lead">{lead}</p>
    </PanelCard>
  );
}

export function StatusCard({ health, api, onRefresh }) {
  const [note, setNote] = useState(null);
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState('');
  const summary = healthSummary(health);

  const run = async (what, fn) => { setBusy(what); setNote(null); try { await fn(); } finally { setBusy(''); } };

  const diagnostics = () => run('diag', async () => {
    const r = await api('/diagnostics');
    if (r.ok && Array.isArray(r.data)) setRows(r.data);
    else if (!r.ok) setNote({ bad: true, text: r.error });
  });
  const testPrint = () => run('print', async () => {
    const r = await api('/canary', { method: 'POST', body: {} });
    if (!r.ok) return setNote({ bad: true, text: r.error });
    const failed = Array.isArray(r.data?.stages) ? r.data.stages.filter((s) => s.passed === false || s.ok === false) : [];
    setNote(failed.length || r.data?.ok === false
      ? { bad: true, text: 'The test label did not print cleanly. Run the diagnostics for the details.' }
      : { text: 'A test label is on its way to the printer.' });
    onRefresh();
  });
  const clearQueue = () => run('clear', async () => {
    if (!window.confirm('Clear every waiting print job on this printer?\n\nAny label still in the queue will NOT print. Use this after a jam or a paper-out, once the printer is fixed.')) return;
    const r = await api('/printer/clear-queue', { method: 'POST', body: { confirm: true } });
    if (!r.ok) return setNote({ bad: true, text: r.error });
    setNote({ text: `Removed ${r.data.removed} waiting job${r.data.removed === 1 ? '' : 's'}${r.data.failed ? ` (${r.data.failed} could not be removed)` : ''}.` });
    onRefresh();
  });
  const tune = () => run('tune', async () => {
    const r = await api('/play-tune', { method: 'POST', body: {} });
    setNote(r.ok ? { text: 'Playing the test tune.' } : { bad: true, text: r.error });
  });
  const rehearsal = () => run('rehearsal', async () => {
    const arming = !health.rehearsal;
    if (arming && !window.confirm('Turn rehearsal mode on?\n\nEvery label prints with a TEST band, nothing is recorded, and every screen shows a TEST watermark, until you turn it off (it turns itself off after 2 hours).')) return;
    const r = await api('/rehearsal', { method: 'POST', body: { on: arming } });
    if (!r.ok) return setNote({ bad: true, text: r.error });
    setNote({ text: arming ? 'Rehearsal mode is on. Turn it off before real check-ins.' : 'Rehearsal mode is off.' });
    onRefresh();
  });
  const [failures, setFailures] = useState([]);
  useEffect(() => {
    if (!(health.printFailures > 0)) return undefined;
    let alive = true;
    api('/failures').then((r) => { if (alive && r.ok && Array.isArray(r.data)) setFailures(r.data); });
    return () => { alive = false; };
  }, [health.printFailures, api]);

  return (
    <PanelCard title="This laptop" tab="var(--brand-blue)">
      <div className={`laptop-status laptop-status--${summary.tone}`}>
        <span className="laptop-status__dot" aria-hidden="true" />
        <div>
          <strong>{summary.headline}</strong>
          <span className="hint">
            KVBC Awana {health.version}, printing to {health.printer}.
          </span>
        </div>
        <button type="button" className="ghost" onClick={onRefresh}>Refresh</button>
      </div>
      {summary.lines.length > 0 && (
        <ul className="laptop-warnings">
          {summary.lines.map((line) => <li key={line}>{line}</li>)}
        </ul>
      )}
      <div className="laptop-actions">
        <button type="button" className="ghost" onClick={testPrint} disabled={busy !== ''} title={busy !== '' ? 'Printer is busy' : undefined}>Print a test label</button>
        <button type="button" className="ghost" onClick={diagnostics} disabled={busy !== ''}>Run diagnostics</button>
        <button type="button" className="ghost" onClick={clearQueue} disabled={busy !== ''}>Clear print queue</button>
        <button type="button" className="ghost" onClick={rehearsal} disabled={busy !== ''} aria-pressed={Boolean(health.rehearsal)}>
          {health.rehearsal ? 'Turn rehearsal mode off' : 'Rehearsal mode'}
        </button>
        {health.musicalTune?.enabled ? <button type="button" className="ghost" onClick={tune} disabled={busy !== ''}>Play test tune</button> : null}
      </div>
      <Note note={note} />
      {health.printFailures > 0 && failures.length > 0 && (
        <ul className="laptop-warnings" aria-label="Print failures tonight">
          {failures.map((f, i) => (
            <li key={`${f.at}-${i}`}>
              <strong>{f.name}</strong> ({f.club || 'no club'}) at {new Date(f.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}: {f.error}
            </li>
          ))}
        </ul>
      )}
      {rows && (
        <ul className="laptop-diag" aria-label="Diagnostics">
          {rows.map((r) => (
            <li key={r.test} className={r.passed ? 'is-ok' : 'is-bad'}>
              <span className="laptop-diag__mark" aria-hidden="true">{r.passed ? '✓' : '✗'}</span>
              <span>{r.test}</span>
              {r.detail ? <span className="hint">{r.detail}</span> : null}
              <span className="sr-only">{r.passed ? 'passed' : 'failed'}</span>
            </li>
          ))}
        </ul>
      )}
    </PanelCard>
  );
}

export function PrintersCard({ cfg, printers, save }) {
  const id = useId();
  const [note, setNote] = useState(null);
  const pick = (key) => async (e) => {
    const value = e.target.value;
    const r = await save({ [key]: value });
    setNote(r.ok ? { text: 'Saved. The next label prints there.' } : { bad: true, text: r.error });
  };
  const tag = printerOptions(printers, cfg.printerName || '');
  const backup = printerOptions(printers, cfg.backupPrinterName || '');
  return (
    <PanelCard title="Printers" tab="var(--brand-sparks)">
      <div className="field">
        <label htmlFor={`${id}-tag`}>Name tag printer</label>
        <select id={`${id}-tag`} value={cfg.printerName || ''} onChange={pick('printerName')}>
          <option value="">{printers ? 'Windows default printer' : 'Could not list the printers'}</option>
          {tag.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span className="hint">The one place a printer is chosen: the check-in page and the phone page print to it.</span>
      </div>
      <div className="field">
        <label htmlFor={`${id}-backup`}>Backup printer</label>
        <select id={`${id}-backup`} value={cfg.backupPrinterName || ''} onChange={pick('backupPrinterName')}>
          <option value="">(no backup)</option>
          {backup.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span className="hint">Takes over when the name tag printer is offline.</span>
      </div>
      <Note note={note} />
    </PanelCard>
  );
}

function TemplateEditor({ templates, knownClubs, save, loadPreview }) {
  const id = useId();
  const [all, setAll] = useState(templates);
  const [club, setClub] = useState('default');
  const [note, setNote] = useState(null);
  const [first, setFirst] = useState('Maya');
  const [visitor, setVisitor] = useState(false);
  const [img, setImg] = useState('');
  const form = templateToForm(all[club]);
  const key = JSON.stringify([club, all[club], first, visitor]);

  useEffect(() => {
    let alive = true;
    let url = '';
    const t = setTimeout(async () => {
      const blob = await loadPreview({ first, club, template: all[club] || {}, visitor });
      if (!alive || !blob) return;
      url = URL.createObjectURL(blob);
      setImg((old) => { if (old) URL.revokeObjectURL(old); return url; });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
    // The preview follows the form: `key` is its whole input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => () => { if (img) URL.revokeObjectURL(img); }, [img]);

  const edit = (patch) => setAll((a) => withTemplate(a, club, formToTemplate({ ...form, ...patch })));
  const saveAll = async () => {
    const r = await save(all);
    if (r.ok) { setAll(r.data?.templates || all); setNote({ text: 'Label layouts saved.' }); } else setNote({ bad: true, text: r.error });
  };

  return (
    <>
      <h4 className="settings-subhead">Each club’s label</h4>
      <div className="field">
        <label htmlFor={`${id}-club`}>Club</label>
        <select id={`${id}-club`} value={club} onChange={(e) => setClub(e.target.value)}>
          <option value="default">Default (all clubs)</option>
          {knownClubs.map((k) => <option key={k} value={k}>{templateClubLabel(k)}</option>)}
        </select>
      </div>
      <div className="laptop-template">
        <div>
          {TEMPLATE_FIELDS.map(([f, label]) => (
            <Toggle key={f} title={label} checked={form[f]} onChange={(e) => edit({ [f]: e.target.checked })} />
          ))}
          <div className="field">
            <label htmlFor={`${id}-size`}>Name size cap: {form.nameMaxPt} pt</label>
            <input id={`${id}-size`} type="range" min={NAME_SIZE_MIN} max={NAME_SIZE_MAX} value={form.nameMaxPt}
              onChange={(e) => edit({ nameMaxPt: Number(e.target.value) })} />
          </div>
        </div>
        <div className="laptop-template__preview">
          <div className="field">
            <label htmlFor={`${id}-first`}>Preview name</label>
            <input id={`${id}-first`} type="text" value={first} maxLength={30} onChange={(e) => setFirst(e.target.value)} />
          </div>
          <Toggle title="Preview as a visitor" checked={visitor} onChange={(e) => setVisitor(e.target.checked)} />
          {img ? <img className="laptop-label" src={img} alt={`Label preview for ${first || 'a child'}`} width="384" /> : <p className="hint">Preview loading…</p>}
        </div>
      </div>
      <div className="laptop-actions">
        <button type="button" className="primary" onClick={saveAll}>Save label layouts</button>
        <button type="button" className="ghost" onClick={() => setAll((a) => withTemplate(a, club, {}))}>Reset this club</button>
      </div>
      <Note note={note} />
    </>
  );
}

export function LabelsCard({ cfg, save, api }) {
  const id = useId();
  const [footer, setFooter] = useState(cfg.labelFooter || '');
  const [greeting, setGreeting] = useState(cfg.connectCardGreeting || '');
  const [note, setNote] = useState(null);
  const [tpl, setTpl] = useState(null);
  const apply = async (patch) => {
    const r = await save(patch);
    setNote(r.ok ? { text: 'Saved.' } : { bad: true, text: r.error });
  };
  useEffect(() => {
    let alive = true;
    api('/config/label-templates').then((r) => { if (alive && r.ok) setTpl(r.data); });
    return () => { alive = false; };
    // Once, when the card opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const loadPreview = async ({ first, club, template, visitor }) => {
    const q = new URLSearchParams({ firstName: first || 'Preview', template: JSON.stringify(template) });
    if (club !== 'default') q.set('clubName', club);
    if (visitor) q.set('visitor', '1');
    const r = await api(`/preview?${q}`, { raw: true });
    return r.ok ? r.data : null;
  };
  const saveTemplates = async (templates) => {
    const r = await api('/config/label-templates', { method: 'POST', body: { templates } });
    return r;
  };
  return (
    <PanelCard title="Labels" tab="var(--brand-tnt)">
      <div className="field">
        <label htmlFor={`${id}-footer`}>Label footer</label>
        <input id={`${id}-footer`} type="text" maxLength={60} value={footer} placeholder="KVBC Awana · Wednesdays 6:15–8:00pm"
          onChange={(e) => setFooter(e.target.value)} onBlur={() => footer !== (cfg.labelFooter || '') && apply({ labelFooter: footer.trim() })} />
        <span className="hint">One line along the bottom of every name tag.</span>
      </div>
      <Toggle title="Visitor labels use the black palette" checked={cfg.firstTimerInverted !== false}
        onChange={(e) => apply({ firstTimerInverted: e.target.checked })} />
      <Toggle title="Band the next label of a child who finished a handbook" checked={cfg.trophyBand !== false}
        onChange={(e) => apply({ trophyBand: e.target.checked })} />
      <Toggle title="Print a connect card for visitors" hint="A second label with a welcome for first-time families."
        checked={!!cfg.connectCard} onChange={(e) => apply({ connectCard: e.target.checked })} />
      <Toggle title="Print it automatically on a first-ever check-in" checked={!!cfg.connectCardAutoFirstTimer}
        onChange={(e) => apply({ connectCardAutoFirstTimer: e.target.checked })} />
      <Toggle title="Musical printer" hint="A tune with every label, Happy Birthday for birthday kids (TSPL printers such as the D450). If the label creeps forward instead of returning, turn it off."
        checked={cfg.musicalPrinter === true} onChange={(e) => apply({ musicalPrinter: e.target.checked })} />
      <Toggle title="Update health beacon" hint="After an update, announce that the new version came back cleanly (the version number only)."
        checked={cfg.updateBeacon === true} onChange={(e) => apply({ updateBeacon: e.target.checked })} />
      <div className="field">
        <label htmlFor={`${id}-greeting`}>Connect card greeting</label>
        <input id={`${id}-greeting`} type="text" maxLength={60} value={greeting} placeholder="We’re so glad you’re here!"
          onChange={(e) => setGreeting(e.target.value)}
          onBlur={() => greeting !== (cfg.connectCardGreeting || '') && apply({ connectCardGreeting: greeting.trim() })} />
      </div>
      <Note note={note} />
      {tpl && <TemplateEditor templates={tpl.templates || {}} knownClubs={tpl.knownClubs || []} save={saveTemplates} loadPreview={loadPreview} />}
    </PanelCard>
  );
}

export function NightCard({ cfg, save, api }) {
  const id = useId();
  const [rows, setRows] = useState(null);
  const [late, setLate] = useState(String(cfg.lateGraceMin ?? 10));
  const [note, setNote] = useState(null);
  const [pickupNote, setPickupNote] = useState(null);
  const ticked = pickupTicked(cfg.pickupClubs);

  useEffect(() => {
    let alive = true;
    api('/config/schedule').then((r) => {
      if (!alive || !r.ok) return;
      setRows(r.data.schedule || []);
      setLate(String(r.data.lateGraceMin ?? 10));
    });
    return () => { alive = false; };
    // Once, when the card opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const togglePickup = async (club, on) => {
    const next = PICKUP_CLUBS.filter((c) => (c === club ? on : ticked.includes(c)));
    const r = await save({ pickupClubs: next });
    setPickupNote(r.ok ? { text: 'Saved. The pickup list follows it within a minute.' } : { bad: true, text: r.error });
  };
  const setRow = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const saveSchedule = async () => {
    const clean = cleanScheduleRows(rows);
    if (clean.some((r) => !validStartTime(r.startTime))) return setNote({ bad: true, text: 'A start time reads like 6:30.' });
    const r = await api('/config/schedule', { method: 'POST', body: { schedule: clean, lateGraceMin: Number(late) || 0 } });
    if (r.ok) { setRows(clean); setNote({ text: 'Schedule saved.' }); } else setNote({ bad: true, text: r.error });
  };

  return (
    <>
      <PanelCard title="Pickup list" tab="var(--brand-cubbies)">
        <p className="hint">Clubs whose children appear on the lobby’s still-here list at pickup.</p>
        <div className="laptop-clubs" role="group" aria-label="Clubs on the pickup list">
          {PICKUP_CLUBS.map((c) => (
            <label key={c} className="laptop-club">
              <input type="checkbox" checked={ticked.includes(c)} onChange={(e) => togglePickup(c, e.target.checked)} />
              {c}
            </label>
          ))}
        </div>
        <Note note={pickupNote} />
      </PanelCard>
      <PanelCard title="Club night" tab="var(--brand-journey)">
        <p className="hint">
          One row per slot of the night. A child who checks in late is sent to their club’s slot that started last:
          “Go to: Games, Fellowship Hall”. With no rows the church’s 2026-27 schedule is used.
        </p>
        {rows ? (
          <div className="laptop-schedule" role="group" aria-label="Club schedule">
            {rows.map((r, i) => (
                <div className="laptop-schedule__row" key={i}>
                <input type="text" aria-label={`Row ${i + 1} club`} placeholder="Sparks" value={r.club || ''} onChange={(e) => setRow(i, { club: e.target.value })} />
                <input type="text" aria-label={`Row ${i + 1} starts`} placeholder="6:30" value={r.startTime || ''} onChange={(e) => setRow(i, { startTime: e.target.value })} />
                <input type="text" aria-label={`Row ${i + 1} activity`} placeholder="Games" value={r.location || ''} onChange={(e) => setRow(i, { location: e.target.value })} />
                <input type="text" aria-label={`Row ${i + 1} place`} placeholder="Fellowship Hall" value={r.room || ''} onChange={(e) => setRow(i, { room: e.target.value })} />
                <button type="button" className="ghost" aria-label={`Remove row ${i + 1}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>Remove</button>
              </div>
            ))}
            <div className="laptop-actions">
              <button type="button" className="ghost" onClick={() => setRows((rs) => [...rs, { club: '', startTime: '', location: '', room: '' }])}>Add a slot</button>
            </div>
          </div>
        ) : <p className="hint">Loading the schedule…</p>}
        <div className="field">
          <label htmlFor={`${id}-late`}>Late grace (minutes)</label>
          <input id={`${id}-late`} type="number" min="0" max="120" value={late} onChange={(e) => setLate(e.target.value)} />
          <span className="hint">How long after a club starts a check-in still counts as on time.</span>
        </div>
        <div className="laptop-actions">
          <button type="button" className="primary" onClick={saveSchedule} disabled={!rows}>Save schedule</button>
        </div>
        <Note note={note} />
      </PanelCard>
    </>
  );
}

export function useLaptopApi() {
  // (useSync re-renders this on signing in or out; the stored session is what
  // is sent, and one the church's sign-in no longer knows is refused, with a word.)
  const { signedIn } = useSync();
  const session = loadSyncSession();
  // A refusal belongs to the session that earned it: a new sign-in starts clean.
  const [refused, setRefused] = useState({ session: '', problem: null });
  const problem = refused.session === session ? refused.problem : null;
  const api = useCallback(async (path, opts) => {
    const r = await callPrintServer(path, { session, ...opts });
    if (!r.ok && (r.reason === 'no-token-on-server' || r.reason === 'sign-in-refused')) setRefused({ session, problem: r });
    return r;
  }, [session]);
  return { api, signedIn, proof: session, problem };
}
