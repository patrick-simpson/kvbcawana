import { useEffect, useId, useState } from 'react';
import { onSettingsChanged } from '../../lib/settingsBus.js';
import { PanelCard } from './fields.jsx';
import { untilWords } from '../../lib/missionControl.js';
import {
  NOTICE_DURATIONS, NOTICE_LEVELS, NOTICE_MESSAGE_MAX, deleteNotice, getNotice, noticeFailure, postNotice,
} from '../../lib/workerClient.js';

// Notice to every screen (docs/SETTINGS-OVERHAUL.md 2.1 and 7, routes.md 10.4):
// church-authored plain text, sent to every screen's banner. The Worker
// publishes it with a `durationSec`, so each screen hides it by itself;
// "Take it down" publishes a durationSec 0 and forgets it.

export const EMPTY_NOTICE = { level: 'info', message: '', durationMin: 30 };

/** @param {any} n @returns {string} "Info", "Heads up", "Urgent" */
const levelWords = (n) => NOTICE_LEVELS.find((l) => l.value === n)?.label || 'Info';

/**
 * @param {{ draft: typeof EMPTY_NOTICE, onDraft: (d: typeof EMPTY_NOTICE) => void, overviewNotice?: any }} props
 */
export default function NoticeCard({ draft, onDraft, overviewNotice }) {
  const id = useId();
  const [current, setCurrent] = useState(/** @type {any} */ (undefined));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(/** @type {{ text: string, warn?: boolean } | null} */ (null));

  useEffect(() => {
    let live = true;
    getNotice().then((a) => { if (live) setCurrent(a.ok ? a.body?.notice ?? null : null); });
    return () => { live = false; };
  }, []);
  // An Undo in the change log may have sent or taken down the notice.
  useEffect(() => onSettingsChanged((what) => {
    if (what === 'notice') getNotice().then((a) => setCurrent(a.ok ? a.body?.notice ?? null : null));
  }), []);
  // The 10 s poll sees a notice come and go (this page's, or another device's):
  // adopted while rendering, when the overview's own value changes.
  const [seenOverview, setSeenOverview] = useState(overviewNotice);
  if (overviewNotice !== seenOverview) {
    setSeenOverview(overviewNotice);
    if (overviewNotice !== undefined) setCurrent(overviewNotice);
  }

  const message = draft.message.trim();
  const send = async () => {
    if (!message) { setNote({ warn: true, text: 'Write a message first.' }); return; }
    if (draft.level === 'critical' && !window.confirm(`Send an URGENT notice to every screen?\n\n“${message}”\n\nIt takes over the middle of every TV until it times out or you take it down.`)) return;
    setBusy(true);
    setNote(null);
    const a = await postNotice({ level: draft.level, message, durationMin: draft.durationMin });
    setBusy(false);
    if (a.ok) {
      setCurrent(a.body?.notice ? { ...a.body.notice, until: a.body.until } : null);
      setNote({ text: `Sent to ${a.body?.screens != null ? `${a.body.screens} screen${a.body.screens === 1 ? '' : 's'}` : 'every screen'}.` });
      onDraft({ ...draft, message: '' });
    } else setNote({ warn: true, text: noticeFailure(a) });
  };
  const takeDown = async () => {
    setBusy(true);
    setNote(null);
    const a = await deleteNotice();
    setBusy(false);
    if (a.ok) { setCurrent(null); setNote({ text: 'Taken down.' }); } else setNote({ warn: true, text: noticeFailure(a) });
  };

  return (
    <PanelCard title="Notice to every screen" tab="var(--brand-hot)" preview="notice">
      {current && (
        <div className="status-alert status-alert--warn notice-current" role="status" data-testid="notice-current">
          <strong>On the screens now ({levelWords(current.level)}):</strong> {current.message}
          {current.until && <span className="hint"> Comes down {untilWords(current.until)}.</span>}
          {' '}<button type="button" className="ghost small" onClick={takeDown} disabled={busy} title={busy ? 'Taking down notice...' : undefined}>Take it down</button>
        </div>
      )}
      <div className="field">
        <label htmlFor={`${id}-level`}>How important</label>
        <select id={`${id}-level`} value={draft.level} onChange={(e) => onDraft({ ...draft, level: e.target.value })}>
          {NOTICE_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${id}-message`}>Message</label>
        <textarea
          id={`${id}-message`} rows={3} maxLength={NOTICE_MESSAGE_MAX} value={draft.message}
          placeholder="Club is cancelled tonight because of the snow."
          onChange={(e) => onDraft({ ...draft, message: e.target.value })}
        />
        <span className="hint" aria-live="polite">{draft.message.length} of {NOTICE_MESSAGE_MAX}. Plain text; it shows on every TV and projector exactly as you type it.</span>
      </div>
      <div className="field">
        <label htmlFor={`${id}-dur`}>How long</label>
        <select id={`${id}-dur`} value={draft.durationMin} onChange={(e) => onDraft({ ...draft, durationMin: Number(e.target.value) })}>
          {NOTICE_DURATIONS.map((d) => <option key={d.min} value={d.min}>{d.label}</option>)}
        </select>
        <span className="hint">Each screen takes it down by itself after this.</span>
      </div>
      <div className="laptop-actions">
        <button type="button" className="primary" onClick={send} disabled={busy || !message} title={!message ? 'Type a message first' : busy ? 'Sending notice...' : undefined}>Send to every screen</button>
      </div>
      {note && <span className={`hint${note.warn ? ' hint--warn' : ''}`} role="status">{note.text}</span>}
    </PanelCard>
  );
}
