import { useState } from 'react';
import { getClubPalette } from '../../lib/clubs.js';
import { callPrintServer } from '../../lib/printServer.js';
import { loadSyncSession } from '../../lib/syncService.js';
import { agoWords, atMs, readWords, runningCount, ymWords } from '../../lib/missionControl.js';
import { PanelCard } from './fields.jsx';
import '../../styles/settings-overhaul.css';

// Tonight's mission control (docs/SETTINGS-OVERHAUL.md section 5). Purely
// presentational: the Worker's overview (counts, codes, station names) and the
// reducer's last five FIRST NAMES come in as props. The names are React state
// only: this card draws them and nothing else ever sees them.

function ClubChip({ club }) {
  const palette = getClubPalette(club);
  return (
    <span className="club-chip" style={{ '--club': palette.primary, '--club-deep': palette.deep }}>{club || 'Club'}</span>
  );
}

const PRINTER_WORDS = { ok: 'ready', busy: 'printing', offline: 'offline', error: 'needs a look', paper: 'out of paper', unknown: 'unknown' };

function clock(at) {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** "I looked at it": clears CHECK THE PRINTER on this laptop only (POST /cloud/print-status/clear). */
function LookedAtIt() {
  const [note, setNote] = useState(/** @type {{text: string, bad?: boolean} | null} */ (null));
  const [busy, setBusy] = useState(false);
  const press = async () => {
    setBusy(true);
    const r = await callPrintServer('/cloud/print-status/clear', { session: loadSyncSession(), method: 'POST', body: {} });
    setBusy(false);
    if (r.ok) setNote({ text: 'Cleared. Thank you for looking.' });
    else if (r.reason === 'unreachable') setNote({ bad: true, text: 'Open this page on the check-in laptop to clear it.' });
    else setNote({ bad: true, text: r.error });
  };
  return (
    <span className="mission-looked">
      <button type="button" className="ghost small" onClick={press} disabled={busy}>I looked at it</button>
      {note && <span className={`hint${note.bad ? ' hint--warn' : ''}`} role="status">{note.text}</span>}
    </span>
  );
}

/**
 * @param {{ overview: any, mission: import('../../lib/missionControl.js').MissionState, error: string, stopped: boolean, onRetry: () => void }} props
 */
export default function MissionControl({ overview, mission, error, stopped, onRetry }) {
  // The service's clock when it has one, so every "ago" is measured on the same clock as its numbers.
  const [mountedAt] = useState(() => Date.now());
  const now = atMs(overview?.at) ?? mountedAt;
  const count = runningCount(overview, mission.tally);
  const clubs = Object.entries(count?.byClub || {}).filter(([, n]) => Number(n) > 0);
  const print = overview?.print;
  const stations = Array.isArray(print?.stations) ? print.stations : [];
  const checks = Array.isArray(print?.checkThePrinter) ? print.checkThePrinter.length : Number(print?.checkThePrinter) || 0;
  const read = overview?.read ? readWords(overview.read, now) : null;
  const ym = overview ? ymWords(overview.ym) : null;
  const win = overview?.window;

  return (
    <PanelCard title="Tonight at a glance" tab="var(--brand-sparks)">
      {stopped ? (
        <p className="hint hint--warn" role="status">
          {error || 'The live numbers stopped coming.'}{' '}
          <button type="button" className="ghost small" onClick={onRetry}>Try again</button>
        </p>
      ) : !overview && <p className="hint" role="status">{error || 'Reading tonight’s numbers…'}</p>}

      <div className="mission-count" aria-live="polite">
        <span className="mission-count__total" data-testid="mission-total">{count ? count.total : '—'}</span>
        <span className="mission-count__label">checked in tonight</span>
        {win && <span className="mission-count__window hint">{win.open ? 'Check-in is open.' : win.opensInMin > 0 ? `Check-in opens in ${win.opensInMin} min.` : 'Check-in is closed.'}</span>}
      </div>
      {clubs.length > 0 && (
        <div className="mission-clubs" role="list" aria-label="Checked in by club">
          {clubs.map(([club, n]) => (
            <span role="listitem" key={club} className="mission-club"><ClubChip club={club} /> <strong>{n}</strong></span>
          ))}
        </div>
      )}
      {count && (
        <p className="hint">
          {count.source ? `From ${count.source === 'report' ? 'the TwoTimTwo report' : count.source}` : 'Live count'}
          {count.reportAgeMs != null ? `, ${agoWords(now - count.reportAgeMs, now)}` : ''}.
        </p>
      )}

      <h4 className="settings-subhead">Last check-ins</h4>
      {mission.recent.length === 0 ? (
        <p className="hint">Nobody yet this session. Names appear here as children check in, and are forgotten when you leave this page.</p>
      ) : (
        <ul className="mission-recent" data-testid="mission-recent">
          {mission.recent.map((s) => (
            <li key={s.id}>
              <strong>{s.firstName}</strong> <ClubChip club={s.club} />
              {s.oneOff && <span className="laptop-tag">tag</span>}
              <span className="hint mission-recent__at">{clock(s.at)}</span>
            </li>
          ))}
        </ul>
      )}

      <h4 className="settings-subhead">Printing</h4>
      {stations.length === 0 ? (
        <p className="hint">{overview ? 'No printing computer is registered yet.' : 'Waiting for the first reading…'}</p>
      ) : (
        <ul className="mission-stations">
          {stations.map((s) => (
            <li key={s.stationId}>
              <strong>{s.name || 'Printing computer'}</strong>{' '}
              <span className="hint">seen {agoWords(s.lastSeenAt, now)}, printer {PRINTER_WORDS[s.printer?.state ?? s.printer] || 'unknown'}</span>
            </li>
          ))}
        </ul>
      )}
      {checks > 0 && (
        <p className="status-alert" role="alert">
          <strong>CHECK THE PRINTER</strong>: {checks} label{checks === 1 ? '' : 's'} may not have come out. <LookedAtIt />
        </p>
      )}

      {read && (
        <p className={`hint mission-line${read.tone === 'ok' ? '' : ' hint--warn'}`}>
          <strong>TwoTimTwo:</strong> {read.text}
        </p>
      )}
      {ym && <p className="hint mission-line"><strong>Trek and Journey check-out:</strong> {ym}</p>}
      <p className="mission-desk"><a className="panel-button secondary" href="/desk">Open the desk</a></p>
    </PanelCard>
  );
}
