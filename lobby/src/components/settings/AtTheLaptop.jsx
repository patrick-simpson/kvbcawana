import { Fragment, useEffect, useState } from 'react';
import { probePrintServer } from '../../lib/printServer.js';
import { ConnectCard, LabelsCard, NightCard, PrintersCard, StatusCard, useLaptopApi } from './laptop.jsx';
import { AttendanceAuditCard, ReprintStretch, SyncSignInCard, useClubs } from './laptop-tools.jsx';
import { PanelCard, Toggle } from './fields.jsx';
import '../../styles/laptop.css';
import '../../styles/settings-overhaul.css';

// Printing → At the laptop (docs/SETTINGS-OVERHAUL.md 2.5): the one card for
// what needs the check-in laptop's own localhost. Collapsed until opened; it
// probes http://localhost:3456/health only THEN (never on load: Chrome may ask
// the person before an https page talks to their own computer). Found: the
// laptop's status and tools. Not found: one calm line.

/** CHECK THE PRINTER, and the button that says the printer was looked at. */
function LookedCard({ api }) {
  const [checks, setChecks] = useState(/** @type {string[] | null} */ (null));
  const [note, setNote] = useState('');
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    api('/cloud/print-status').then((r) => { if (live && r.ok) setChecks(Array.isArray(r.data?.jobs?.checkThePrinter) ? r.data.jobs.checkThePrinter : []); });
    return () => { live = false; };
  }, [api, round]);
  // The thank-you stays after the re-read empties the list (it used to vanish with the card).
  if ((!checks || checks.length === 0) && !note) return null;
  const clear = async () => {
    const r = await api('/cloud/print-status/clear', { method: 'POST', body: {} });
    setNote(r.ok ? 'Cleared. Thank you for looking.' : r.error);
    if (r.ok) setRound((n) => n + 1);
  };
  return (
    <PanelCard title="Check the printer" tab="var(--brand-sparks)">
      {checks && checks.length > 0 && (
        <>
          <p className="status-alert" role="alert">
            <strong>CHECK THE PRINTER</strong>: {checks.length} label{checks.length === 1 ? '' : 's'} went to the printer and may not have come out.
          </p>
          <div className="laptop-actions"><button type="button" className="primary" onClick={clear}>I looked at it</button></div>
        </>
      )}
      {note && <span className="hint" role="status">{note}</span>}
    </PanelCard>
  );
}

/** The two hardware switches that stay per laptop: the musical printer and the update beacon. */
function HardwareToggles({ cfg, save }) {
  const [note, setNote] = useState('');
  const apply = async (patch) => { const r = await save(patch); setNote(r.ok ? 'Saved.' : r.error); };
  return (
    <>
      <Toggle title="Musical printer" hint="A tune with every label, Happy Birthday for birthday kids (TSPL printers such as the D450). If the label creeps forward instead of returning, turn it off."
        checked={cfg.musicalPrinter === true} onChange={(e) => apply({ musicalPrinter: e.target.checked })} />
      <Toggle title="Update health beacon" hint="After an update, announce that the new version came back cleanly (the version number only)."
        checked={cfg.updateBeacon === true} onChange={(e) => apply({ updateBeacon: e.target.checked })} />
      {note && <span className="hint laptop-note" role="status">{note}</span>}
    </>
  );
}

/** Leaders this laptop remembers: print again, or forget (the laptop's own file). */
function RememberedLeaders({ api }) {
  const [leaders, setLeaders] = useState(/** @type {any[]} */ ([]));
  const [note, setNote] = useState('');
  useEffect(() => {
    let live = true;
    api('/leaders').then((r) => { if (live && r.ok && r.data) setLeaders(r.data.leaders || []); });
    return () => { live = false; };
  }, [api]);
  const forget = async (l) => {
    const who = `${l.firstName || ''} ${l.lastName || ''}`.trim();
    if (!window.confirm(`Forget ${who}? Their tag can still be printed by typing the name.`)) return;
    const r = await api('/leaders/forget', { method: 'POST', body: { key: l.key } });
    if (r.ok) setLeaders(r.data?.leaders || []); else setNote(r.error);
  };
  const print = async (l) => {
    const r = await api('/print-leader', { method: 'POST', body: { leaders: [{ firstName: l.firstName, lastName: l.lastName, clubName: l.clubName || '' }] } });
    setNote(r.ok ? `Printed ${l.firstName}’s tag.` : `Print failed: ${r.error}`);
  };
  if (leaders.length === 0) return null;
  return (
    <PanelCard title="Remembered leaders" tab="var(--brand-orange)">
      <ul className="laptop-history">
        {leaders.map((l) => {
          const who = `${l.firstName || ''} ${l.lastName || ''}`.trim();
          return (
            <li key={l.key}>
              <span className="laptop-history__who"><strong>{who}</strong></span>
              <span className="hint">{l.clubName || ''}</span>
              <span className="laptop-actions">
                <button type="button" className="ghost" aria-label={`Print ${who}’s tag`} onClick={() => print(l)}>Print</button>
                <button type="button" className="ghost" aria-label={`Forget ${who}`} onClick={() => forget(l)}>Forget</button>
              </span>
            </li>
          );
        })}
      </ul>
      {note && <span className="hint laptop-note" role="status">{note}</span>}
    </PanelCard>
  );
}

/** The label as the laptop's printer would draw it, for a made-up name (GET /preview). */
function LabelPreviewCard({ api }) {
  const [first, setFirst] = useState('Maya');
  const [visitor, setVisitor] = useState(false);
  const [img, setImg] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => () => { if (img) URL.revokeObjectURL(img); }, [img]);
  const show = async () => {
    setNote('');
    const q = new URLSearchParams({ firstName: first || 'Preview', template: '{}' });
    if (visitor) q.set('visitor', '1');
    const r = await api(`/preview?${q}`, { raw: true });
    if (r.ok) setImg(URL.createObjectURL(r.data)); else setNote(r.error);
  };
  return (
    <PanelCard title="Label preview" tab="var(--brand-tnt)">
      <div className="field">
        <label htmlFor="at-laptop-preview-name">Preview name</label>
        <input id="at-laptop-preview-name" type="text" value={first} maxLength={30} onChange={(e) => setFirst(e.target.value)} />
      </div>
      <Toggle title="Preview as a visitor" checked={visitor} onChange={(e) => setVisitor(e.target.checked)} />
      <div className="laptop-actions"><button type="button" className="ghost" onClick={show}>Show the label</button></div>
      {img && <img className="laptop-label" src={img} alt={`Label preview for ${first || 'a child'}`} width="384" />}
      {note && <span className="hint hint--warn" role="status">{note}</span>}
    </PanelCard>
  );
}

function Found({ health, onRefresh, paused }) {
  const { api, signedIn, proof, problem } = useLaptopApi();
  const clubs = useClubs(api);
  const [cfg, setCfg] = useState(/** @type {any} */ (null));
  const [printers, setPrinters] = useState(/** @type {any} */ (undefined));

  useEffect(() => {
    if (!proof) return undefined;
    let live = true;
    Promise.all([api('/config'), api('/printers')]).then(([c, p]) => {
      if (!live) return;
      if (c.ok) setCfg(c.data);
      setPrinters(p.ok ? p.data.printers || [] : null);
    });
    return () => { live = false; };
  }, [proof, api]);

  const save = async (patch) => {
    const r = await api('/config', { method: 'POST', body: patch });
    if (r.ok) setCfg((c) => ({ ...c, ...patch }));
    return r;
  };
  const connected = Boolean(proof) && !problem;
  return (
    <>
      <StatusCard health={health} api={api} onRefresh={onRefresh} />
      {!connected && <ConnectCard problem={problem} signedIn={signedIn} />}
      {connected && health.sync?.signedIn === false && <SyncSignInCard health={health} api={api} onRefresh={onRefresh} />}
      {connected && <LookedCard api={api} />}
      {connected && cfg && (
        <Fragment key={proof}>
          <PrintersCard cfg={cfg} printers={printers} save={save} />
          <PanelCard title="This printer" tab="var(--brand-sparks)"><HardwareToggles cfg={cfg} save={save} /></PanelCard>
          <LabelPreviewCard api={api} />
          <ReprintStretch api={api} clubs={clubs} />
          <RememberedLeaders api={api} />
          <AttendanceAuditCard api={api} />
          {paused && (
            <>
              <p className="hint hint--warn" role="status">Printing settings are paused on the service, so these are this laptop’s own again.</p>
              <LabelsCard cfg={cfg} save={save} api={api} />
              <NightCard cfg={cfg} save={save} api={api} />
            </>
          )}
        </Fragment>
      )}
      {connected && !cfg && <p className="hint">Reading the printer’s settings…</p>}
    </>
  );
}

/** @param {{ paused?: boolean }} props */
export default function AtTheLaptop({ paused = false }) {
  const [open, setOpen] = useState(false);
  const [probe, setProbe] = useState(/** @type {any} */ (null));
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    probePrintServer().then((p) => { if (live) setProbe(p); });
    return () => { live = false; };
  }, [open, round]);
  const look = () => { setProbe(null); setRound((n) => n + 1); };

  return (
    <details className="advanced-fields panel-fold at-laptop" onToggle={(e) => setOpen(e.currentTarget.open)} data-testid="at-the-laptop">
      <summary>At the laptop</summary>
      <p className="hint">The printer itself, the laptop’s checks and its own list of tags. These only work on the check-in laptop, in Chrome, with KVBC Awana running.</p>
      {open && !probe && <p className="hint" role="status">Looking for the printer on this computer…</p>}
      {open && probe && !probe.found && (
        <div className="laptop-away">
          <p className="laptop-away__lead">Open this page on the check-in laptop for the printer itself.</p>
          <div className="field">
            <button type="button" className="ghost section-jump" onClick={look}>Look again</button>
            <span className="hint">On the laptop and still here? Check the KVBC Awana app is running (its tray icon), then look again. Chrome may also ask to let this site connect to devices on your computer: allow it.</span>
          </div>
        </div>
      )}
      {open && probe?.found && <Found health={probe.health} onRefresh={look} paused={paused} />}
    </details>
  );
}
