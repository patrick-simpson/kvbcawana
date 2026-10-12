import { useCallback, useEffect, useState } from 'react';
import { CloudCheckinTestField, PanelCard, Toggle } from './fields.jsx';
import { agoWords } from '../../lib/missionControl.js';
import { getSwitches, oldStationWords, predictWarnings, putSwitch, warningWords } from '../../lib/workerClient.js';

// Online check-in switches (docs/SETTINGS-OVERHAUL.md 2.1, routes.md 10.2): the
// Worker's runtime switches, stored, with `wrangler.toml` as the default. Each
// press asks the Worker first (`dryRun`: the warnings and older stations the
// flip WOULD get; this page's own guess only if that call fails), confirms
// naming them, writes ONE switch against the revision shown, and then shows
// the Worker's own warnings. "Back to default" deletes the stored value.

/** What each of the three online switches is called here (the owner's words). */
export const ONLINE_SWITCHES = [
  { name: 'CLOUD_PRINT', title: 'Print TwoTimTwo-page check-ins', hint: 'A child checked in on TwoTimTwo’s own page gets a label from the service, with no laptop clicks.' },
  { name: 'SINGLE_PUBLISHER', title: 'The service runs the screens’ count and pickup list', hint: 'Turn off to hand the count and the pickup list back to the check-in laptop within about 5 seconds.' },
  { name: 'YM_CHECKOUT', title: 'Check out Trek and Journey automatically (7:15 pm)', hint: 'The service checks the older children out of TwoTimTwo for you at 7:15 pm on club nights.' },
];
const ADVANCED = [
  { name: 'CHURCH_SETTINGS', title: 'Printing settings from this page', hint: 'Off: the Printing section is read-only and the laptop uses what it has.' },
  { name: 'NOTICES', title: 'Notices to every screen', hint: 'Off: the notice composer is refused.' },
  { name: 'CHANGE_LOG', title: 'Write the change log', hint: 'Off: nothing new is recorded in the change log.' },
];

const onOff = (v) => (v === 'on' ? 'on' : 'off');

/** @param {{ overview?: any }} props */
export default function SwitchesCard({ overview }) {
  const [data, setData] = useState(/** @type {any} */ (null));
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState(/** @type {{ text: string, warn?: boolean, warnings?: string[], old?: string } | null} */ (null));

  const [round, setRound] = useState(0);
  const load = useCallback(() => setRound((n) => n + 1), []);
  useEffect(() => {
    let live = true;
    getSwitches().then((a) => {
      if (!live) return;
      if (a.ok) { setData(a.body); setProblem(''); } else setProblem(a.message);
    });
    return () => { live = false; };
  }, [round]);

  const rowOf = (name) => (data?.switches || []).find((s) => s.name === name);

  const change = async (name, title, value) => {
    setBusy(name);
    setNote(null);
    const dry = await putSwitch({ name, value, rev: data?.rev, dryRun: true });
    setBusy('');
    if (!dry.ok && dry.status === 409 && dry.body?.reason === 'stale') {
      setNote({ warn: true, text: 'Someone else changed a switch a moment ago. Check it and press again.' });
      load();
      return;
    }
    const expected = dry.ok && Array.isArray(dry.body?.warnings) ? dry.body.warnings : predictWarnings(data, overview, name, value);
    const old = dry.ok ? oldStationWords(dry.body?.oldStations) : '';
    const verb = value === 'default' ? 'Put back to its default' : value === 'on' ? 'Turn on' : 'Turn off';
    const lines = expected.map((c) => `• ${warningWords(c)}`);
    const ask = `${verb}: ${title}?\n\nIt takes effect within seconds, on every screen and printing computer.${lines.length ? `\n\n${dry.ok ? 'The service warns' : 'The service may warn'}:\n${lines.join('\n')}` : ''}${old ? `\n${old}` : ''}`;
    if (!window.confirm(ask)) return;
    setBusy(name);
    const a = await putSwitch({ name, value, rev: data?.rev });
    setBusy('');
    if (a.ok) {
      const warnings = Array.isArray(a.body?.warnings) ? a.body.warnings : [];
      setNote({ text: value === 'default' ? 'Back to its default.' : `Turned ${value}.`, warnings, old: oldStationWords(a.body?.oldStations) });
      load();
    } else if (a.status === 409 && a.body?.reason === 'stale') {
      setNote({ warn: true, text: 'Someone else changed a switch a moment ago. Check it and press again.' });
      load();
    } else if (a.status === 409 && a.body?.reason === 'stored-off') {
      setNote({ warn: true, text: 'The switches are fixed at their defaults by the service’s own settings, so they cannot be changed here.' });
    } else setNote({ warn: true, text: a.message });
  };

  // A function, not a component: a component defined here would remount every render.
  const renderRow = (spec) => {
    const row = rowOf(spec.name);
    if (!row) return null;
    const stored = row.source === 'worker';
    return (
      <div className="switch-row" data-switch={spec.name} key={spec.name}>
        <Toggle
          checked={onOff(row.value) === 'on'}
          disabled={busy !== ''}
          onChange={(e) => change(spec.name, spec.title, e.target.checked ? 'on' : 'off')}
          title={spec.title}
          hint={spec.hint}
        />
        <p className="hint switch-row__meta">
          Default: {onOff(row.default)}.
          {stored && data?.by ? ` Changed by ${data.by.name || 'a device'}${data.updatedAt ? `, ${agoWords(data.updatedAt)}` : ''}.` : ''}
          {stored && (
            <>{' '}<button type="button" className="ghost small" disabled={busy !== ''} onClick={() => change(spec.name, spec.title, 'default')}>Back to default</button></>
          )}
        </p>
      </div>
    );
  };

  return (
    <PanelCard title="Online check-in switches" tab="var(--brand-trek)">
      {problem && <p className="hint hint--warn" role="status">{problem}</p>}
      {!data && !problem && <p className="hint" role="status">Reading the switches…</p>}
      {data && ONLINE_SWITCHES.map(renderRow)}
      {note && (
        <div className={`status-alert${note.warn || note.warnings?.length ? ' status-alert--warn' : ''}`} role="status">
          <strong>{note.text}</strong>
          {note.warnings?.length > 0 && (
            <ul className="switch-warnings">{note.warnings.map((c) => <li key={c}>{warningWords(c)}</li>)}</ul>
          )}
          {note.old && <p className="hint">{note.old}</p>}
        </div>
      )}
      {data && (
        <details className="advanced-fields">
          <summary>Advanced</summary>
          {ADVANCED.map(renderRow)}
          <CloudCheckinTestField />
        </details>
      )}
    </PanelCard>
  );
}
