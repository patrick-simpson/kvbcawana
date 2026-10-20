import { useState } from 'react';
import { useSync } from '../../../hooks/useSync.js';
import {
  deriveClubInfo, formatShortDate, isStoreNight, localDateStr, splitTitle,
} from '../../../lib/calendarLogic.js';
import { phaseWords } from '../../../lib/settingsSections.js';
import { PanelCard } from '../fields.jsx';

/** The one-line status the header and the Status section both lead with. */
export function statusSentence(status, keyed, where = 'Account & app → Sign in') {
  return {
    connected: keyed
      ? 'Connected — check-ins will appear instantly'
      : `Connected — not signed in yet (${where})`,
    connecting: 'Connecting…',
    disconnected: 'Disconnected — check the network',
    off: `Not set up yet — sign in under ${where.split(' → ')[0]}`,
  }[status] || status;
}

/** "just now", "12 min ago", "3 h ago", "2 days ago". @param {string} iso */
function ago(iso) {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

// Live summary of what the calendar logic resolves to right now, so a
// leader can sanity-check the feed without waiting for club night.
export function calendarPreview(calendar) {
  if (!calendar) return null;
  const { events, source, generatedAt } = calendar;
  if (!events?.length) {
    return source === 'none' ? null : 'No calendar data loaded yet.';
  }
  const info = deriveClubInfo(events, localDateStr());
  const parts = [`${events.length} events loaded`];
  if (source === 'sync') {
    const checked = calendar.checkedAt || generatedAt;
    parts[0] += checked ? ` (read from the church calendar ${ago(checked)})` : ' (from the sync service)';
  } else if (source === 'feed' && generatedAt) {
    const days = Math.max(0, Math.round((Date.now() - Date.parse(generatedAt)) / 86400000));
    parts[0] += days === 0 ? ' (updated today)' : ` (updated ${days}d ago)`;
  } else if (source === 'proxy') {
    parts[0] += ' (live fetch)';
  } else if (source === 'cache') {
    parts[0] += ' (offline cache)';
  }
  if (info.tonight) {
    parts.push(`Tonight: ${splitTitle(info.tonight.title).title}`);
  } else if (info.nextNight) {
    const masked = !info.nextNight.isSpecial || isStoreNight(info.nextNight.title);
    const when = formatShortDate(info.nextNight.date);
    parts.push(`Next night: ${masked ? when : `${splitTitle(info.nextNight.title).title} (${when})`}`);
  }
  parts.push(`${info.nightsRemaining} night${info.nightsRemaining === 1 ? '' : 's'} left after tonight`);
  return parts.join(' · ');
}

/**
 * Everything the panel knows is wrong, worded by fix. The Status section
 * lists them; the rail counts them.
 */
export function statusProblems({ opsFailures, layerFaults, remoteConfigError, wakeLockStatus, demoActive, status }) {
  const out = [];
  if (status === 'disconnected') out.push('disconnected');
  if (opsFailures?.length) out.push('printer');
  if (layerFaults?.length) out.push('layer');
  if (remoteConfigError) out.push('remote');
  if (wakeLockStatus && !['active', 'off', 'requesting'].includes(wakeLockStatus)) out.push('wake');
  if (demoActive) out.push('demo');
  return out;
}

export function slideSyncLines({ syncedDeck, slidesStatus, following, hasKey, nowAt, where = 'Account & app' }) {
  let statusLine;
  if (syncedDeck) {
    const when = new Date(syncedDeck.publishedAt);
    const mins = Math.max(0, Math.round((nowAt - syncedDeck.publishedAt) / 60000));
    const age = mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
    statusLine = `Received rev ${syncedDeck.deckRev} — ${syncedDeck.slides.length} slide${syncedDeck.slides.length === 1 ? '' : 's'}, published ${when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} (${age}).`;
  } else {
    statusLine = 'Never received a published deck on this screen.';
  }
  // Why frames might not be opening — worded by fix, not by mechanism, and
  // leading with the login (pasting the key by hand is the fallback).
  let hintLine = null;
  if (following && !hasKey) {
    hintLine = `This screen is not signed in, so it cannot read published decks — type the church passphrase under ${where}.`;
  } else if (slidesStatus === 'bad-key') {
    hintLine = `Published decks are arriving but will not open with this screen’s key — sign in again under ${where} to pick up the current key.`;
  } else if (slidesStatus === 'no-key') {
    hintLine = `Published decks are arriving but this screen has no usable key — sign in under ${where}.`;
  } else if (slidesStatus === 'refused-plaintext') {
    hintLine = 'The check-in laptop is publishing slides UNENCRYPTED; this keyed screen refuses them. Sign the laptop in again under Printing → At the laptop.';
  }
  return { statusLine, hintLine };
}

/**
 * "Refresh calendar now", saying what happened. Signed in to the sync
 * service it reads the church calendar right now and every screen follows;
 * otherwise it can only re-read the copies this screen reaches (the site's
 * nightly feed), and says so instead of looking like it did nothing.
 */
export function CalendarRefresh({ calendar }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(/** @type {{text: string, warn?: boolean} | null} */ (null));
  const run = async () => {
    setBusy(true);
    setNote(null);
    const res = await calendar.refresh();
    setBusy(false);
    if (!res?.ok) { setNote({ warn: true, text: res?.message || 'The calendar could not be refreshed.' }); return; }
    if (res.viaSync) {
      setNote({ text: res.changed ? 'Read the church calendar: it changed, and every screen is updating now.' : 'Read the church calendar: nothing has changed.' });
    } else {
      setNote({ text: 'Checked again for the newest copy this screen can reach. Sign this screen in with the passphrase (Account & app) to read the church calendar right now.' });
    }
  };
  return (
    <div className="field">
      <button type="button" className="ghost small section-jump" disabled={busy} onClick={run} title={busy ? 'Refreshing calendar...' : undefined}>
        {busy ? 'Reading the calendar…' : 'Refresh calendar now'}
      </button>
      {note && <span className={`hint${note.warn ? ' hint--warn' : ''}`} role="status">{note.text}</span>}
    </div>
  );
}


/** The names line: can this screen read the encrypted names, and if not, the fix. */
export function namesLineFor(nameStatus, displayKey) {
  return {
    'no-key': 'encrypted names are arriving but this screen has no key — sign in under Account & app',
    'bad-key': 'encrypted names are arriving but will not open with this screen’s key — sign in again under Account & app',
    downgraded: 'the check-in laptop is sending names unencrypted and this keyed screen refuses them — sign the laptop in again under Printing → At the laptop',
  }[nameStatus] ?? (displayKey
    ? 'this screen can read encrypted names'
    : 'no key yet — encrypted names will not open here until you sign in');
}

/** Everything the panel knows is wrong on THIS screen, as the alert boxes. */
export function StatusAlerts({ opsFailures, layerFaults, remoteConfigError, wakeLockStatus, demoActive, onReload }) {
  const alerts = [];
  if (opsFailures?.length) {
    const latest = opsFailures[0];
    alerts.push(
      <div className="status-alert" key="printer">
        <strong>The printer reported {opsFailures.length} problem{opsFailures.length > 1 ? 's' : ''} tonight</strong>
        {latest?.at ? <> (latest{latest.club ? `: ${latest.club}` : ''} at {new Date(latest.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })})</> : null}
        {' '}— see Printing → At the laptop on awana.kvbchurch.org/settings.
      </div>,
    );
  }
  if (layerFaults?.length) {
    alerts.push(
      <div className="status-alert" key="layer">
        <strong>A screen layer crashed</strong> and is being retried every 30 s: {layerFaults.join(', ')}. If it keeps
        failing, reload the page (F5) — and report it.
      </div>,
    );
  }
  if (remoteConfigError) {
    alerts.push(
      <div className="status-alert" key="remote">
        <strong>The central config for this screen could not be applied</strong> ({remoteConfigError}) — from this
        page&rsquo;s <code>?config=</code> URL. This display is running on its built-in defaults and its own settings
        instead.
      </div>,
    );
  }
  if (wakeLockStatus && !['active', 'off', 'requesting'].includes(wakeLockStatus)) {
    alerts.push(
      <div className="status-alert status-alert--warn" key="wake">
        {wakeLockStatus === 'unsupported'
          ? 'This browser has no Screen Wake Lock — the TV may sleep mid-club; turn off sleep in the device’s own settings instead.'
          : 'The browser refused the screen wake lock (battery saver?) — the TV may sleep mid-club.'}
      </div>,
    );
  }
  if (demoActive) {
    alerts.push(
      <div className="status-alert status-alert--warn" key="demo">
        <strong>Demo mode</strong> — a sample or simulated check-in was fired on this screen, so the red “not real
        check-ins” badge stays up until the page reloads.{' '}
        <button type="button" className="ghost small" onClick={onReload}>Reload display</button>
      </div>,
    );
  }
  return alerts.length > 0 ? <div className="status-alerts" role="status">{alerts}</div> : null;
}

/** "Connection": the sentence, realtime, the church's sign-in, names. @param {{ goTo: (id: string) => void }} props */
export function ConnectionCard({ status, keyed, displayKey, nameStatus, lastEventAt, openedAt, goTo }) {
  const syncState = useSync();
  const realtime = {
    connected: 'connected',
    connecting: 'connecting…',
    disconnected: 'disconnected',
    off: 'not set up — not signed in',
  }[status] || status;
  const lastSeen = lastEventAt
    ? `${new Date(lastEventAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} (${Math.max(0, Math.round((openedAt - lastEventAt) / 60000))} min ago)`
    : 'none yet this session';
  const needsSetup = status === 'off' || !keyed;
  const where = 'Account & app';
  return (
    <PanelCard title="Sign-in & connection">
      <p className={`status-sentence ${status}`}><span className="dot" />{statusSentence(status, keyed)}</p>
      <div className="hint conn-summary">
        <div><strong>Realtime:</strong> {realtime} · last check-in {lastSeen}</div>
        <div><strong>Church sign-in:</strong> {syncState.signedIn ? `signed in${syncState.lastSyncAt ? `, synced ${new Date(syncState.lastSyncAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}` : (syncState.phase === 'expired' ? `signed out: the passphrase was changed, type the new one under ${where}` : `not signed in: type the passphrase under ${where}`)}</div>
        {status !== 'off' && <div><strong>Names:</strong> {namesLineFor(nameStatus, displayKey)}</div>}
      </div>
      {needsSetup && (
        <button type="button" className="secondary section-jump" onClick={() => goTo('account')}>
          Set up this screen →
        </button>
      )}
    </PanelCard>
  );
}

/** Right now (the phase), the calendar, the published slides, Refresh calendar now. */
export function CalendarPhaseCard({
  phase, scheduleSource, calendar, calendarEnabled, syncedDeck, slidesStatus, following, keyed, openedAt, slidesWhere = 'Slides & look',
  accountWhere = 'Account & app',
}) {
  const preview = calendarEnabled ? calendarPreview(calendar) : null;
  const sync = slideSyncLines({ syncedDeck, slidesStatus, following, hasKey: keyed, nowAt: openedAt, where: accountWhere });
  return (
    <PanelCard title="Schedule and calendar" tab="var(--brand-journey)">
      <div className="hint conn-summary">
        <div><strong>Right now:</strong> {phaseWords(phase) || 'unknown'}{scheduleSource ? ` (schedule: ${scheduleSource})` : ''}</div>
        {calendarEnabled
          ? <div><strong>Calendar:</strong> {preview || 'no calendar data loaded yet'}{calendar?.source && calendar.source !== 'none' ? ` · source: ${calendar.source}` : ''}</div>
          : <div><strong>Calendar:</strong> calendar slides are off ({slidesWhere})</div>}
        <div><strong>Published slides:</strong> {sync.statusLine}</div>
        {sync.hintLine && <div><strong>{sync.hintLine}</strong></div>}
      </div>
      {calendarEnabled && calendar?.refresh ? <CalendarRefresh calendar={calendar} /> : null}
    </PanelCard>
  );
}

/**
 * About. `part` 'screen': this screen's build and self-update line (a TV's
 * Tonight); 'legal': the trademark line (Account & app, everywhere); 'all':
 * both.
 * @param {{ build?: string | null, part?: 'screen' | 'legal' | 'all' }} props
 */
export function AboutCard({ build, part = 'all' }) {
  return (
    <PanelCard title={part === 'screen' ? 'About this screen' : 'About'} tab="var(--brand-trek)">
      {part !== 'legal' && (
        <p className="hint">
          {build ? <>This screen is running build <code>{build}</code>. </> : null}
          It updates itself within a few minutes of a new release, whenever nothing is on screen.
        </p>
      )}
      {part !== 'screen' && (
        <p className="hint panel-legal">
          Awana® and the Awana club names are trademarks of Awana Clubs International.
          This display is an independent church project — NOT AFFILIATED OR ENDORSED BY
          AWANA CLUBS INTERNATIONAL.
        </p>
      )}
    </PanelCard>
  );
}
