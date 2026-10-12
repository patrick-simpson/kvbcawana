import { useCallback, useEffect, useState } from 'react';
import { PanelCard } from './fields.jsx';
import { CHANGE_KINDS, canUndo, describeChange, filterChanges, switchUndoValue, undoConfirmText, whenWords } from '../../lib/changeLog.js';
import { getChanges, oldStationWords, putSwitch, undoChange, undoFailure, warningWords } from '../../lib/workerClient.js';
import { emitSettingsChanged } from '../../lib/settingsBus.js';

// The change log (docs/SETTINGS-OVERHAUL.md 2.1 / 2.7 and 7, routes.md 10.5):
// who changed what, when, with Undo where the Worker can do it. Account & app
// shows the newest 50 with "Older" and a kind filter; Tonight shows the last 5.

/** @param {{ entry: any, onUndo: (e: any) => void, busy: boolean }} props */
function Row({ entry, onUndo, busy }) {
  const d = describeChange(entry);
  return (
    <li className={`change-row${d.undone ? ' is-undone' : ''}`} data-seq={entry.seq}>
      <span className="change-row__text">
        <strong>{d.who}</strong> {d.isUndo ? 'undid a change to' : 'changed'} {d.what}
        {d.detail ? <span className="hint">: {d.detail}</span> : null}
        {d.undone ? <span className="laptop-tag">undone</span> : null}
        <span className="hint change-row__at">{whenWords(entry.at)}</span>
      </span>
      {canUndo(entry) && <button type="button" className="ghost small" disabled={busy} onClick={() => onUndo(entry)} aria-label={`Undo: ${d.who} changed ${d.what}`}>Undo</button>}
    </li>
  );
}

/**
 * The shared loader: entries, the next cursor, undo with the Worker's own
 * refusal words, and a refresh after an undo lands.
 * @param {number} limit
 */
function useChanges(limit) {
  const [entries, setEntries] = useState(/** @type {any[] | null} */ (null));
  const [next, setNext] = useState(/** @type {number | null} */ (null));
  const [off, setOff] = useState(false);
  const [problem, setProblem] = useState('');
  const [note, setNote] = useState(/** @type {{ text: string, warn?: boolean } | null} */ (null));
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0);
  const load = useCallback(() => setRound((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    getChanges({ limit }).then((a) => {
      if (!live) return;
      if (a.ok) {
        setEntries(Array.isArray(a.body?.entries) ? a.body.entries : []);
        setNext(a.body?.next ?? null);
        setOff(a.body?.off === true);
        setProblem('');
      } else setProblem(a.message);
    });
    return () => { live = false; };
  }, [limit, round]);

  const older = async () => {
    if (!next) return;
    const a = await getChanges({ before: next, limit });
    if (a.ok) {
      setEntries((cur) => [...(cur || []), ...(Array.isArray(a.body?.entries) ? a.body.entries : [])]);
      setNext(a.body?.next ?? null);
    } else setNote({ warn: true, text: a.message });
  };

  const undo = async (entry) => {
    setBusy(true);
    setNote(null);
    // A switch asks the Worker what putting it back would warn about first.
    let dry = null;
    if (entry.what === 'switch' && entry.target) {
      const r = await putSwitch({ name: entry.target, value: switchUndoValue(entry), dryRun: true });
      if (r.ok) dry = { warnings: Array.isArray(r.body?.warnings) ? r.body.warnings.map((c) => warningWords(c)) : [], old: oldStationWords(r.body?.oldStations) };
    }
    if (!window.confirm(undoConfirmText(entry, dry))) { setBusy(false); return; }
    const a = await undoChange(entry.seq);
    setBusy(false);
    if (a.ok) { setNote({ text: 'Undone.' }); load(); emitSettingsChanged(entry.what); } else setNote({ warn: true, text: undoFailure(a) });
  };

  return { entries, next, off, problem, note, busy, undo, older, load };
}

/** Account & app: the 50 newest, Older, Undo, filter by kind. */
export function ChangeLogCard() {
  const log = useChanges(50);
  const [kind, setKind] = useState('all');
  const shown = log.entries ? filterChanges(log.entries, kind) : [];
  return (
    <PanelCard title="Change log" tab="var(--brand-journey)">
      <p className="hint panel-intro">Who changed what, from any phone or computer. Undo puts a setting back, unless it was changed again since.</p>
      {log.problem && <p className="hint hint--warn" role="status">{log.problem}</p>}
      {log.off && <p className="hint hint--warn">The change log is switched off, so new changes are not recorded (Tonight → Online check-in switches → Advanced).</p>}
      <div className="field">
        <label htmlFor="changes-kind">Show</label>
        <select id="changes-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          {CHANGE_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
      </div>
      {log.entries === null && !log.problem && <p className="hint" role="status">Loading…</p>}
      {log.entries && shown.length === 0 && <p className="hint">Nothing to show yet.</p>}
      {shown.length > 0 && <ul className="change-list">{shown.map((e) => <Row key={e.seq} entry={e} onUndo={log.undo} busy={log.busy} />)}</ul>}
      {log.note && <span className={`hint${log.note.warn ? ' hint--warn' : ''}`} role="status">{log.note.text}</span>}
      {log.next && <div className="laptop-actions"><button type="button" className="ghost" onClick={log.older}>Older</button></div>}
    </PanelCard>
  );
}

/** Tonight: the last 5, Undo on the undoable ones, a way to the full log. @param {{ goTo: (id: string) => void }} props */
export function RecentChangesCard({ goTo }) {
  const log = useChanges(5);
  const shown = (log.entries || []).slice(0, 5);
  return (
    <PanelCard title="Recent changes" tab="var(--brand-journey)">
      {log.problem && <p className="hint hint--warn" role="status">{log.problem}</p>}
      {log.entries === null && !log.problem && <p className="hint" role="status">Loading…</p>}
      {log.entries && shown.length === 0 && <p className="hint">No changes recorded yet.</p>}
      {shown.length > 0 && <ul className="change-list">{shown.map((e) => <Row key={e.seq} entry={e} onUndo={log.undo} busy={log.busy} />)}</ul>}
      {log.note && <span className={`hint${log.note.warn ? ' hint--warn' : ''}`} role="status">{log.note.text}</span>}
      <div className="laptop-actions">
        <button type="button" className="ghost" onClick={() => goTo('account')}>All changes</button>
      </div>
    </PanelCard>
  );
}
