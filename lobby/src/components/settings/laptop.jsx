import { Fragment, useCallback, useEffect, useId, useState } from 'react';
import { PUBLISH_TOKEN_CHANGE_EVENT, loadPublishToken } from '../../lib/publishToken.js';
import { loadSyncSession } from '../../lib/syncService.js';
import { useSync } from '../../hooks/useSync.js';
import {
  PICKUP_CLUBS, PRINT_DASHBOARD_URL, callPrintServer, canReprint, cleanScheduleRows, formToTemplate, healthSummary,
  historyTags, NAME_SIZE_MAX, NAME_SIZE_MIN, pickupTicked, printerOptions, probePrintServer, TEMPLATE_FIELDS,
  templateClubLabel, templateToForm, validStartTime, withTemplate,
} from '../../lib/printServer.js';
import { PanelCard, PublishTokenField, Toggle } from './fields.jsx';
import '../../styles/laptop.css';

// The Laptop section (SETTINGS.md phase 3): the check-in laptop's own settings,
// the print dashboard's parts, on the one settings page. It looks for the print
// server on http://localhost:3456 only when the section is opened (a browser
// may ask the person before an https page talks to their own computer, so it
// must not do that on load). Found: the printer's parts, through the same
// routes the dashboard uses. Not found: one calm card that says where to open
// this page. What the page may change is the server's call (printer's own keys
// only; the PIN and the keys stay on the dashboard), see lib/printServer.js.

const SEASONS = [
  ['auto', 'Auto (follow the calendar)'], ['off', 'Off: each screen uses its own skin'], ['back-to-school', 'Back to school'],
  ['fall', 'Fall'], ['thanksgiving', 'Thanksgiving'], ['christmas', 'Christmas'], ['winter', 'Winter'],
  ['spring', 'Spring'], ['easter', 'Easter'], ['vbs-summer', 'VBS / Summer'],
];

const WOULD_SHOW = [
  ['The printer', 'which printer prints the name tags, and the backup'],
  ['Labels', 'the footer, the visitor and connect-card options, each club’s layout with a preview'],
  ['Pickup list and schedule', 'which clubs are on the pickup list, the club schedule, the late grace'],
  ['Tonight’s prints', 'the list, with a Reprint on each'],
  ['Checks', 'diagnostics, a test label, clear the print queue'],
];

/** One line of feedback under a control, announced politely. */
function Note({ note }) {
  if (!note) return null;
  return <span className={`hint laptop-note${note.bad ? ' hint--warn' : ''}`} role="status">{note.text}</span>;
}

function NotFound({ onLookAgain, checking }) {
  return (
    <PanelCard title="The check-in laptop" tab="var(--brand-blue)">
      <div className="laptop-away">
        <p className="laptop-away__lead">Open this page on the check-in laptop to set the printer.</p>
        <p className="hint">
          The printer’s settings live on the laptop that runs the Club Label Printer app, and this page can only
          reach them from that computer, in Chrome, with the app running. Everything else here works from any device.
        </p>
        <h4 className="settings-subhead">What shows up there</h4>
        <ul className="laptop-would">
          {WOULD_SHOW.map(([title, text]) => (
            <li key={title}><strong>{title}</strong>{' '}<span>{text}</span></li>
          ))}
        </ul>
        <div className="field">
          <button type="button" className="ghost section-jump" onClick={onLookAgain} disabled={checking}>
            {checking ? 'Looking…' : 'Look again'}
          </button>
          <span className="hint">
            On the laptop and still here? Check the Club Label Printer app is running (its tray icon), then look again.
            Chrome may also ask to let this site connect to devices on your computer: allow it.
          </span>
        </div>
      </div>
    </PanelCard>
  );
}

/**
 * How the page proves itself to the printer: signing in under Setup (the
 * print server asks the sync service), or, as a fallback, its publish token.
 */
function ConnectCard({ health, problem, signedIn }) {
  const serverHasNone = health.lobbySlides?.tokenConfigured === false || problem?.reason === 'no-token-on-server';
  const lead = problem?.reason === 'wrong-token' ? 'The printer did not accept that token.'
    : problem?.reason === 'sign-in-refused' ? problem.error
      : signedIn ? 'The printer is here.' : 'The printer is here. Sign in under Setup with the church passphrase to change its settings.';
  return (
    <PanelCard title="Connect to the printer" tab="var(--brand-sun)">
      <p className="laptop-away__lead">{lead}</p>
      <details className="advanced-fields">
        <summary>Or paste the printer&rsquo;s publish token</summary>
      <p className="hint">
        {serverHasNone
          ? 'The printer has no token yet. On the laptop open the print dashboard → Lobby slides → Generate publish token, then paste it here.'
          : 'On the laptop, the print dashboard → Lobby slides shows the token (Copy). It stays in this browser, never in a settings export or a link.'}
      </p>
      <PublishTokenField />
      </details>
      <div className="field">
        <a className="hint" href={PRINT_DASHBOARD_URL} target="_blank" rel="noopener noreferrer">Open the print dashboard on this computer</a>
      </div>
    </PanelCard>
  );
}

function StatusCard({ health, api, onRefresh }) {
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

  return (
    <PanelCard title="This laptop" tab="var(--brand-blue)">
      <div className={`laptop-status laptop-status--${summary.tone}`}>
        <span className="laptop-status__dot" aria-hidden="true" />
        <div>
          <strong>{summary.headline}</strong>
          <span className="hint">
            Club Label Printer {health.version}, printing to {health.printer}.
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
        <button type="button" className="ghost" onClick={testPrint} disabled={busy !== ''}>Print a test label</button>
        <button type="button" className="ghost" onClick={diagnostics} disabled={busy !== ''}>Run diagnostics</button>
        <button type="button" className="ghost" onClick={clearQueue} disabled={busy !== ''}>Clear print queue</button>
        {health.musicalTune?.enabled ? <button type="button" className="ghost" onClick={tune} disabled={busy !== ''}>Play test tune</button> : null}
      </div>
      <Note note={note} />
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

function PrintersCard({ cfg, printers, save }) {
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

function LabelsCard({ cfg, save, api }) {
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

function NightCard({ cfg, save, api }) {
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
  const season = async (e) => {
    const r = await save({ seasonTheme: e.target.value });
    setNote(r.ok ? { text: 'Saved. Screens take the new season in a moment.' } : { bad: true, text: r.error });
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
        <div className="field">
          <label htmlFor={`${id}-season`}>Screen season</label>
          <select id={`${id}-season`} value={cfg.seasonTheme || 'auto'} onChange={season}>
            {SEASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <span className="hint">Which seasonal skin the lobby screens wear. Auto follows the calendar.</span>
        </div>
        <Note note={note} />
      </PanelCard>
    </>
  );
}

function TonightCard({ api }) {
  const [rows, setRows] = useState(null);
  const [note, setNote] = useState(null);
  const [nonce, setNonce] = useState(0);
  const load = () => setNonce((n) => n + 1);
  useEffect(() => {
    let alive = true;
    api('/history/today').then((r) => {
      if (!alive) return;
      if (r.ok && Array.isArray(r.data)) setRows(r.data);
      else if (!r.ok) setNote({ bad: true, text: r.error });
    });
    return () => { alive = false; };
  }, [api, nonce]);
  const reprint = async (e) => {
    if (!window.confirm(`Reprint ${e.firstName}’s label?`)) return;
    const r = await api('/reprint', { method: 'POST', body: { name: `${e.firstName} ${e.lastName || ''}`.trim(), clubberId: e.clubberId || null } });
    setNote(r.ok ? { text: `Reprinted ${e.firstName}’s label.` } : { bad: true, text: r.error });
    if (r.ok) load();
  };
  const fmt = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
  return (
    <PanelCard title="Tonight’s prints" tab="var(--brand-sun)">
      <div className="laptop-actions"><button type="button" className="ghost" onClick={load}>Refresh</button></div>
      <Note note={note} />
      {rows && rows.length === 0 && <p className="hint">Nothing has printed today.</p>}
      {rows && rows.length > 0 && (
        <ul className="laptop-history">
          {rows.slice(0, 30).map((e, i) => (
            <li key={`${e.timestamp}-${i}`}>
              <span className="laptop-history__who">
                <strong>{e.firstName} {e.lastName}</strong>
                {historyTags(e).map((t) => <span className="laptop-tag" key={t}>{t}</span>)}
              </span>
              <span className="hint">{[e.clubName, fmt(e.timestamp)].filter(Boolean).join(' · ')}</span>
              {canReprint(e) ? <button type="button" className="ghost" aria-label={`Reprint ${e.firstName}`} onClick={() => reprint(e)}>Reprint</button> : <span />}
            </li>
          ))}
        </ul>
      )}
    </PanelCard>
  );
}

function DashboardOnlyCard() {
  return (
    <PanelCard title="PIN and keys" tab="var(--brand-blue)">
      <p className="hint">
        The phone PIN, the display key and login passphrase, the Pusher keys and Wi-Fi access for phones are set on the
        print dashboard on this computer only. They never pass through a web page.
      </p>
      <a className="hint" href={PRINT_DASHBOARD_URL} target="_blank" rel="noopener noreferrer">Open the print dashboard</a>
    </PanelCard>
  );
}

function Found({ health, onRefresh }) {
  const [token, setToken] = useState(loadPublishToken);
  // Signed in with the passphrase is enough: the print server confirms the
  // session with the sync service. A pasted token still wins.
  // (useSync re-renders this on signing in or out; the stored session is what
  // is sent, and one the service no longer knows is refused, with a word.)
  const { signedIn } = useSync();
  const session = loadSyncSession();
  const proof = token || session;
  const [problem, setProblem] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [printers, setPrinters] = useState(undefined);

  useEffect(() => {
    const sync = () => { setToken(loadPublishToken()); setProblem(null); };
    window.addEventListener(PUBLISH_TOKEN_CHANGE_EVENT, sync);
    return () => window.removeEventListener(PUBLISH_TOKEN_CHANGE_EVENT, sync);
  }, []);

  const api = useCallback(async (path, opts) => {
    const r = await callPrintServer(path, { token, session, ...opts });
    if (!r.ok && (r.reason === 'wrong-token' || r.reason === 'no-token-on-server' || r.reason === 'sign-in-refused')) setProblem(r);
    return r;
  }, [token, session]);

  useEffect(() => {
    if (!proof) return undefined;
    let alive = true;
    (async () => {
      const [c, p] = await Promise.all([api('/config'), api('/printers')]);
      if (!alive) return;
      if (c.ok) setCfg(c.data);
      setPrinters(p.ok ? p.data.printers || [] : null);
    })();
    return () => { alive = false; };
  }, [proof, api]);

  const save = useCallback(async (patch) => {
    const r = await api('/config', { method: 'POST', body: patch });
    if (r.ok) setCfg((c) => ({ ...c, ...patch }));
    return r;
  }, [api]);

  const connected = Boolean(proof) && !problem;
  return (
    <>
      <StatusCard health={health} api={api} onRefresh={onRefresh} />
      {!connected && <ConnectCard health={health} problem={problem} signedIn={signedIn} />}
      {connected && cfg && (
        <Fragment key={proof}>
          <PrintersCard cfg={cfg} printers={printers} save={save} />
          <LabelsCard cfg={cfg} save={save} api={api} />
          <NightCard cfg={cfg} save={save} api={api} />
          <TonightCard api={api} />
        </Fragment>
      )}
      {connected && !cfg && <PanelCard><p className="hint">Reading the printer’s settings…</p></PanelCard>}
      <DashboardOnlyCard />
    </>
  );
}

export default function LaptopSection() {
  const [probe, setProbe] = useState(null);
  const [round, setRound] = useState(0);
  const look = () => { setProbe(null); setRound((n) => n + 1); };
  useEffect(() => {
    let alive = true;
    probePrintServer().then((p) => { if (alive) setProbe(p); });
    return () => { alive = false; };
  }, [round]);

  if (!probe) return <PanelCard title="The check-in laptop" tab="var(--brand-blue)"><p className="hint" role="status">Looking for the printer on this computer…</p></PanelCard>;
  if (!probe.found) return <NotFound onLookAgain={look} checking={false} />;
  return <Found health={probe.health} onRefresh={look} />;
}
