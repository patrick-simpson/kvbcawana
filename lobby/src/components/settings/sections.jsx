import { useState } from 'react';
import { useSync } from '../../hooks/useSync.js';
import { geocodeLocation } from '../../lib/weather.js';
import { deriveClubInfo, formatShortDate, isStoreNight, localDateStr, splitTitle } from '../../lib/calendarLogic.js';
import { skinOptions } from '../../lib/skins.js';
import { getAllClubs, getClubPalette } from '../../lib/clubs.js';
import { maskDisplayKey } from '../../lib/displayKey.js';
import { SEASON_PROMOS } from '../../lib/promos.js';
import { SAMPLE_BOARD_NAMES } from '../../lib/demoNames.js';
import { decideBoard, demoCheckout } from '../../lib/checkoutBoard.js';
import CheckoutBoard from '../CheckoutBoard.jsx';
import { DESKTOP_APP_DOWNLOAD_URL, DESKTOP_APP_GUIDE_URL, JOURNEY_URL, PROJECTOR_GAME_TIME_URL } from '../../lib/constants.js';
import { phaseWords } from '../../lib/settingsSections.js';
import {
  ChangePassphraseField, DisplayKeyField, DisplayLoginField, MilestoneListField, PanelCard, PptxUploadField,
  PublishTokenField, SyncSignInField, TemplateField,
  Toggle, VideoUploadField,
} from './fields.jsx';

// Radio order = the setup journey: the typed/published deck is the default
// and the one the print server can drive; the others are per-device choices.
export const SOURCE_LABELS = {
  manual: 'Typed & published slides',
  powerpoint: 'OneDrive PowerPoint',
  pptx: 'Uploaded PowerPoint',
  video: 'Looping video',
};

// The last day any fall promo can show; past it the toggle has nothing to
// turn off, so it leaves the page instead of sitting there all year.
const PROMOS_END = SEASON_PROMOS.reduce((max, p) => (p.eventDate > max ? p.eventDate : max), '');

/** A duration kept in milliseconds, typed in seconds. */
function SecondsField({ id, label, hint, ms, min, max, onChange }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id} type="number" min={min} max={max} step="0.5" inputMode="decimal"
        value={Number.isFinite(ms) ? ms / 1000 : ''}
        onChange={(e) => onChange(Math.round(Number(e.target.value) * 1000))}
      />
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

// ── Status ────────────────────────────────────────────────────────────────

/** The one-line status the header and the Status section both lead with. */
export function statusSentence(status, keyed) {
  return {
    connected: keyed
      ? 'Connected — check-ins will appear instantly'
      : 'Connected — not logged in yet (Setup → Connect this screen)',
    connecting: 'Connecting to Pusher…',
    disconnected: 'Disconnected — check the network, then the App Key and Cluster under Setup → Advanced',
    off: 'Not set up yet — add the Pusher App Key under Setup → Advanced',
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

function slideSyncLines({ syncedDeck, slidesStatus, following, hasKey, nowAt }) {
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
    hintLine = 'This screen is not logged in, so it cannot read published decks — type the church’s display passphrase under Setup → Connect this screen (or paste the display key by hand under Setup → Advanced).';
  } else if (slidesStatus === 'bad-key') {
    hintLine = 'Published decks are arriving but will not open with this screen’s key — log in again under Setup → Connect this screen to pick up the current key (or re-paste it under Advanced).';
  } else if (slidesStatus === 'no-key') {
    hintLine = 'Published decks are arriving but this screen has no usable key — log in under Setup → Connect this screen.';
  } else if (slidesStatus === 'refused-plaintext') {
    hintLine = 'The print server is publishing slides UNENCRYPTED (no display key set there); this keyed screen refuses them. Set the display key on the print server.';
  }
  return { statusLine, hintLine };
}

/**
 * "Refresh calendar now", saying what happened. Signed in to the sync
 * service it reads the church calendar right now and every screen follows;
 * otherwise it can only re-read the copies this screen reaches (the site's
 * nightly feed), and says so instead of looking like it did nothing.
 */
function CalendarRefresh({ calendar }) {
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
      setNote({ text: 'Checked again for the newest copy this screen can reach. Sign this screen in with the passphrase (Setup) to read the church calendar right now.' });
    }
  };
  return (
    <div className="field">
      <button type="button" className="ghost small section-jump" disabled={busy} onClick={run}>
        {busy ? 'Reading the calendar…' : 'Refresh calendar now'}
      </button>
      {note && <span className={`hint${note.warn ? ' hint--warn' : ''}`} role="status">{note.text}</span>}
    </div>
  );
}

export function StatusSection({
  status, nameStatus, keyed, displayKey, login, lastEventAt, openedAt, phase, scheduleSource,
  calendar, calendarEnabled, opsFailures, layerFaults, remoteConfigError, wakeLockStatus, demoActive,
  syncedDeck, slidesStatus, following, build, goTo, onReload,
}) {
  const syncState = useSync();
  const realtime = {
    connected: 'connected',
    connecting: 'connecting…',
    disconnected: 'disconnected',
    off: 'not set up — no Pusher App Key',
  }[status] || status;
  const lastSeen = lastEventAt
    ? `${new Date(lastEventAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} (${Math.max(0, Math.round((openedAt - lastEventAt) / 60000))} min ago)`
    : 'none yet this session';

  let loginLine;
  if (login.loginStatus === 'logged-in') {
    loginLine = `logged in${login.kid ? ` (key ${login.kid})` : ''} — display key and publish token filled in automatically`;
  } else if (login.loginStatus === 'stale') {
    loginLine = 'passphrase changed on the print server — log in again under Setup (names keep working meanwhile)';
  } else if (login.loginStatus === 'busy') {
    loginLine = 'checking…';
  } else if (displayKey) {
    loginLine = `not logged in — display key pasted by hand (${maskDisplayKey(displayKey)})`;
  } else {
    loginLine = 'not logged in — no display key on this screen, so names will not appear';
  }

  const namesLine = {
    'no-key': 'encrypted names are arriving but this screen has no key — log in under Setup',
    'bad-key': 'encrypted names are arriving but will not open with this screen’s key — log in again, or paste the current key under Setup → Advanced',
    downgraded: 'the print server is sending names unencrypted and this keyed screen refuses them — set the display key on the print server',
  }[nameStatus] ?? (displayKey
    ? 'this screen can read encrypted names'
    : 'no key yet — encrypted names will not open here until you log in');

  const needsSetup = status === 'off' || !keyed;
  const preview = calendarEnabled ? calendarPreview(calendar) : null;
  const sync = slideSyncLines({ syncedDeck, slidesStatus, following, hasKey: keyed, nowAt: openedAt });

  const alerts = [];
  if (opsFailures?.length) {
    const latest = opsFailures[0];
    alerts.push(
      <div className="status-alert" key="printer">
        <strong>The printer reported {opsFailures.length} problem{opsFailures.length > 1 ? 's' : ''} tonight</strong>
        {latest?.at ? <> (latest{latest.club ? `: ${latest.club}` : ''} at {new Date(latest.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })})</> : null}
        {' '}— check the print server dashboard.
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
        page&rsquo;s <code>?config=</code> URL, or the address the display login handed it. This display is running
        on its built-in defaults and its own settings instead.
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

  return (
    <>
      {alerts.length > 0 && <div className="status-alerts" role="status">{alerts}</div>}

      <PanelCard title="Connection">
        <p className={`status-sentence ${status}`}><span className="dot" />{statusSentence(status, keyed)}</p>
        <div className="hint conn-summary">
          <div><strong>Realtime:</strong> {realtime} · last check-in {lastSeen}</div>
          {syncState.url
            ? <div><strong>Sync service:</strong> {syncState.signedIn ? `signed in${syncState.lastSyncAt ? `, synced ${new Date(syncState.lastSyncAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}` : (syncState.phase === 'expired' ? 'signed out: the passphrase was changed, type the new one under Setup' : 'not signed in: type the passphrase under Setup')}</div>
            : <div><strong>Display login:</strong> {loginLine}</div>}
          {status !== 'off' && <div><strong>Names:</strong> {namesLine}</div>}
        </div>
        {needsSetup && (
          <button type="button" className="secondary section-jump" onClick={() => goTo('setup')}>
            Set up this screen →
          </button>
        )}
      </PanelCard>

      <PanelCard title="Tonight" tab="var(--brand-journey)">
        <div className="hint conn-summary">
          <div><strong>Right now:</strong> {phaseWords(phase) || 'unknown'}{scheduleSource ? ` (schedule: ${scheduleSource})` : ''}</div>
          {calendarEnabled
            ? <div><strong>Calendar:</strong> {preview || 'no calendar data loaded yet'}{calendar?.source && calendar.source !== 'none' ? ` · source: ${calendar.source}` : ''}</div>
            : <div><strong>Calendar:</strong> calendar slides are off (Slides)</div>}
          <div><strong>Published slides:</strong> {sync.statusLine}</div>
          {sync.hintLine && <div><strong>{sync.hintLine}</strong></div>}
        </div>
        {calendarEnabled && calendar?.refresh ? (
          <CalendarRefresh calendar={calendar} />
        ) : null}
      </PanelCard>

      <PanelCard title="Other screens" tab="var(--brand-blue)">
        <div className="panel-links">
          <a className="panel-button secondary" href={PROJECTOR_GAME_TIME_URL} target="_blank" rel="noopener noreferrer">
            Projector: game time
          </a>
          <a className="panel-button secondary" href={JOURNEY_URL} target="_blank" rel="noopener noreferrer">
            Journey
          </a>
        </div>
        <p className="hint">
          Each opens in a new tab. The projector starts on game time and goes back to its own schedule after
          15 minutes or at the evening&rsquo;s next change.
        </p>
      </PanelCard>

      <PanelCard title="About" tab="var(--brand-trek)">
        <p className="hint">
          {build ? <>This screen is running build <code>{build}</code>. </> : null}
          It updates itself within a few minutes of a new release, whenever nothing is on screen.
        </p>
        <p className="hint panel-legal">
          Awana® and the Awana club names are trademarks of Awana Clubs International.
          This display is an independent church project — NOT AFFILIATED OR ENDORSED BY
          AWANA CLUBS INTERNATIONAL.
        </p>
      </PanelCard>
    </>
  );
}

// ── Check-ins ─────────────────────────────────────────────────────────────

export function CheckinsSection({ form, set, update, onPreview }) {
  return (
    <>
      <PanelCard title="Welcome banners" scope="shared">
        <SecondsField
          id="std" label="How long each name stays up (seconds)" min="2" max="20"
          ms={form.standardDisplayMs}
          onChange={(ms) => update({ standardDisplayMs: ms }, { apply: false })}
          hint="Every child gets the full time, even in a rush: the banner stays up and the next name flips in."
        />
        <SecondsField
          id="special" label="Birthdays and first-timers (seconds)" min="3" max="25"
          ms={form.specialDisplayMs}
          onChange={(ms) => update({ specialDisplayMs: ms }, { apply: false })}
          hint="The extra-celebratory banners hold a little longer."
        />
        <button type="button" className="secondary section-jump" onClick={onPreview}
          title="Shows a sample welcome on this screen. It marks the screen ‘demo mode’ (red badge at the top) until it is reloaded.">
          Preview a check-in
        </button>
      </PanelCard>

      <PanelCard title="Extras" tab="var(--brand-journey)" scope="shared">
        <Toggle
          checked={form.firstArrivalMoment}
          onChange={set('firstArrivalMoment')}
          title="First arrival of the night"
          hint={<>
            The very first child checked in each night gets a one-time &ldquo;Doors are open&rdquo; flourish — the
            cue that check-in has started. Skipped on a screen that boots after the program is underway.
          </>}
        />
        <Toggle
          checked={form.showBirthdayWeekRibbon !== false}
          onChange={set('showBirthdayWeekRibbon')}
          title="Birthday-this-week ribbon"
          hint={<>
            When a child’s birthday falls later this week, their banner names the day (&ldquo;Birthday this
            Friday!&rdquo;). Needs a display key — the birthday roster arrives encrypted.
          </>}
        />
        <Toggle
          checked={form.clubTintBackground === true}
          onChange={set('clubTintBackground')}
          title="Wash the background in the arriving club's color"
          hint="While a name is up the scene briefly breathes that club's color. Off by default because it competes with a night skin you chose on purpose."
        />
      </PanelCard>

      <PanelCard title="Club lines" tab="var(--brand-trek)" scope="shared">
        <span className="hint panel-intro">
          A short line under the child’s name on their welcome, one per club. Leave a club blank for no line. Up to
          80 characters.
        </span>
        <div className="panel-phrases">
          {getAllClubs().map((name) => {
            const key = name.toLowerCase();
            const id = `phrase-${key.replace(/[^a-z0-9]/g, '-')}`;
            const club = getClubPalette(name);
            return (
              <div className="field" key={key}>
                {/* The club's own chip: the label still reads "Puggles phrase". */}
                <label htmlFor={id}>
                  <span className="club-chip" style={{ '--club': club.primary, '--club-deep': club.deep }}>{name}</span>
                  {' '}phrase
                </label>
                <input
                  id={id}
                  type="text"
                  maxLength={80}
                  value={form.clubPhrases[key] || ''}
                  onChange={(e) => update((f) => ({ ...f, clubPhrases: { ...f.clubPhrases, [key]: e.target.value } }), { apply: false })}
                  placeholder="Shine bright tonight!"
                />
              </div>
            );
          })}
        </div>
      </PanelCard>
    </>
  );
}

// ── Slides ────────────────────────────────────────────────────────────────

export function SlidesSection({ form, set, update, slideCount, onEditSlides, syncedDeck, today }) {
  const n = slideCount;
  const typedLine = form.backgroundSource === 'manual'
    ? (n === 0
      ? 'No slides typed on this device yet — the welcome slide and calendar slides play on their own.'
      : `${n} slide${n === 1 ? '' : 's'} saved on this device.`)
    : 'Typed and published slides only show while “Typed & published slides” is picked above.';
  const ignored = syncedDeck && form.backgroundSource !== 'manual';
  const promosLive = !PROMOS_END || today <= PROMOS_END;

  return (
    <>
      {ignored && (
        <div className="notice-warn" role="status">
          A published deck has arrived (rev {syncedDeck.deckRev}, {syncedDeck.slides.length} slide
          {syncedDeck.slides.length === 1 ? '' : 's'}) but this screen is set to{' '}
          {SOURCE_LABELS[form.backgroundSource] || form.backgroundSource}, so it is not showing.{' '}
          <button type="button" className="ghost small" onClick={() => update({ backgroundSource: 'manual' })}>
            Show the published slides
          </button>
        </div>
      )}

      <PanelCard title="What plays behind the names" scope="screen">
        <div className="field">
          <span className="field-label" id="bgsource-label">Background</span>
          <div className="radio-row" role="radiogroup" aria-labelledby="bgsource-label">
            {Object.entries(SOURCE_LABELS).map(([value, label]) => (
              <label className="radio-option" key={value}>
                <input
                  type="radio"
                  name="backgroundSource"
                  value={value}
                  checked={form.backgroundSource === value}
                  onChange={set('backgroundSource')}
                />
                {label}
              </label>
            ))}
          </div>
          <span className="hint">
            Typed slides are made right here in the app and get the catalog look automatically;
            publish them from the check-in computer and every screen shows the same deck.
          </span>
        </div>

        {form.backgroundSource === 'pptx' && <PptxUploadField />}
        {form.backgroundSource === 'video' && <VideoUploadField />}

        {(form.backgroundSource === 'powerpoint' || form.backgroundSource === 'pptx') && (
          <div className="field">
            <label htmlFor="iframe">
              {form.backgroundSource === 'pptx'
                ? 'OneDrive PowerPoint embed URL (fallback if the uploaded deck cannot render)'
                : 'OneDrive PowerPoint embed URL'}
            </label>
            <input
              id="iframe" type="url" value={form.powerpointEmbedUrl}
              onChange={set('powerpointEmbedUrl')}
              placeholder="https://onedrive.live.com/embed?…"
            />
            <span className="hint">
              In OneDrive, open your <code>.pptx</code> → File → Share → Embed, then paste the URL from the{' '}
              <code>&lt;iframe src="…"&gt;</code> snippet here.
            </span>
          </div>
        )}

        {form.backgroundSource !== 'video' && (
          <div className="field">
            <label htmlFor="slideDelay">Seconds per slide</label>
            <input
              id="slideDelay" type="number" min="0" max="120" step="1"
              value={form.slideshowDelaySec}
              onChange={set('slideshowDelaySec')}
            />
            <span className="hint">
              Unless a slide sets its own time. For a PowerPoint, 0 lets the file keep its own timing (typed slides
              then fall back to 8 seconds).
            </span>
          </div>
        )}
      </PanelCard>

      <PanelCard title="Typed & published slides" tab="var(--brand-journey)" scope="screen">
        <div className="field">
          <span className="hint">{typedLine}</span>
          <button type="button" className="secondary section-jump" onClick={onEditSlides}>
            Edit slides… (Ctrl+Shift+E)
          </button>
        </div>
        <Toggle
          checked={form.followPublishedSlides !== false}
          onChange={set('followPublishedSlides')}
          title="Follow published slides"
          hint="Show the deck published from the check-in computer instead of this device’s own typed slides. Video slides saved on this device still play alongside it."
        />
      </PanelCard>

      <PanelCard title="Calendar slides" tab="var(--brand-trek)" scope="shared">
        <Toggle
          checked={form.calendarEnabled}
          onChange={set('calendarEnabled')}
          title="Calendar-aware slides"
          hint='"Welcome to…", "Next week…" and nights-remaining slides, made from the church calendar. They join the slide rotation.'
        />
        {form.calendarEnabled && (
          <>
            <div className="field">
              <label htmlFor="calwelcome">Calendar welcome wording (regular nights)</label>
              <input
                id="calwelcome" type="text" maxLength="80" value={form.calendarWelcomeText}
                onChange={set('calendarWelcomeText')}
                placeholder="Welcome to Awana!"
              />
              <span className="hint">Special nights use their calendar title instead — "Welcome to Water Night!".</span>
            </div>
            <Toggle checked={form.calendarShowWelcome} onChange={set('calendarShowWelcome')}
              title="Welcome slide" hint="Tonight's greeting — or a pointer to the next club night." />
            <Toggle checked={form.calendarShowNextWeek} onChange={set('calendarShowNextWeek')}
              title="Next-week slide" hint='"Next week…!" announcements and break-week notices.' />
            <Toggle checked={form.calendarShowRemaining} onChange={set('calendarShowRemaining')}
              title="Nights-remaining slide" hint="A countdown nudge once fewer than 10 club nights remain." />
          </>
        )}
        {promosLive && (
          <Toggle checked={form.seasonPromos} onChange={set('seasonPromos')}
            title="Fall event promos" hint="Poster Contest, BARF Night, Parents' Night. Animated, dated, retire themselves." />
        )}
        <details className="advanced-fields">
          <summary>Calendar source</summary>
          <div className="field">
            <label htmlFor="calurl">Calendar page URL</label>
            <input
              id="calurl" type="url" value={form.calendarUrl}
              onChange={set('calendarUrl')}
              placeholder="https://yourchurch.twotimtwo.com/calendar/index"
            />
            <span className="hint">
              The public club calendar (twotimtwo format). A nightly job turns it into a data file the display reads;
              if that goes stale the display tries this URL directly, then its last good copy.
            </span>
          </div>
        </details>
      </PanelCard>
    </>
  );
}

// ── Screen & corner ───────────────────────────────────────────────────────

export function ScreenSection({ form, set, update, panicMode, onPanic, wakeLockStatus, lowPowerForced }) {
  const [lookup, setLookup] = useState({ state: 'idle', message: '' });
  const lookUpLocation = async () => {
    setLookup({ state: 'busy', message: 'Looking up…' });
    const hit = await geocodeLocation(form.weatherLocationName);
    if (hit) {
      update({ weatherLocationName: hit.name, weatherLat: hit.lat, weatherLon: hit.lon });
      setLookup({ state: 'done', message: `Found: ${hit.name} (${hit.lat.toFixed(2)}, ${hit.lon.toFixed(2)})` });
    } else {
      setLookup({ state: 'error', message: 'No match found — try "Town, State".' });
    }
  };
  const wakeTrouble = wakeLockStatus && !['active', 'off', 'requesting'].includes(wakeLockStatus);

  return (
    <>
      <PanelCard title="Simplified mode" tab="var(--brand-sparks-deep)" scope="screen">
        <Toggle
          checked={panicMode}
          onChange={(e) => onPanic(e.target.checked)}
          title="Strip the screen to the basics"
          hint="For when something on screen looks wrong and the room is full: a plain background and the clock, while welcomes keep working. Takes effect at once. Also Ctrl+Shift+X."
        />
      </PanelCard>

      <PanelCard title="Corner" scope="shared">
        <p className="hint panel-intro">
          One item at a time — the time, tonight's tally or the weather — changing with each slide. They step
          aside while a poster or a slide marked “Hold check-ins” is up. A connection or printer problem always shows.
        </p>
        <Toggle checked={form.showClock} onChange={set('showClock')}
          title="Wall clock" hint="The time of day, bottom-right, as of each slide." />
        <Toggle checked={form.showTally} onChange={set('showTally')}
          title="Tonight's check-in counter" hint='A "checked in tonight" tally. Counts only a number, resets daily.' />
        {form.showTally && (
          <div className="toggle-nested">
            <Toggle
              checked={form.showTallySyncNote !== false}
              onChange={set('showTallySyncNote')}
              title="Explain corrections to the counter"
              hint={<>When the check-in desk's count jumps by more than one, or goes down after an undo, the counter
                says &ldquo;synced with the check-in desk&rdquo; so it reads as a correction, not a glitch.</>}
            />
          </div>
        )}
        <Toggle checked={form.showWeatherChip} onChange={set('showWeatherChip')}
          title="Corner weather" hint="The temperature and the sky, top-right. Refreshes every 15 minutes." />
      </PanelCard>

      <PanelCard title="Weather" tab="var(--brand-journey)" scope="shared">
        <div className="field">
          <label htmlFor="wloc">Weather location</label>
          <div className="lookup-row">
            <input
              id="wloc" type="text" value={form.weatherLocationName}
              onChange={set('weatherLocationName')}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); lookUpLocation(); } }}
              placeholder="Waterville, Maine"
            />
            <button type="button" className="ghost" onClick={lookUpLocation} disabled={lookup.state === 'busy'}>
              Look up
            </button>
          </div>
          {lookup.message ? (
            <span className={`hint lookup-${lookup.state}`} role="status">{lookup.message}</span>
          ) : (
            <span className="hint">
              Type a town and press <strong>Look up</strong> (currently {Number(form.weatherLat).toFixed(2)},{' '}
              {Number(form.weatherLon).toFixed(2)}). Used by the corner weather, the ambient particles and the
              weather mood (Look &amp; season).
            </span>
          )}
        </div>
        <div className="field">
          <label htmlFor="wunits">Temperature units</label>
          <select id="wunits" value={form.weatherUnits} onChange={set('weatherUnits')}>
            <option value="fahrenheit">Fahrenheit (°F)</option>
            <option value="celsius">Celsius (°C)</option>
          </select>
        </div>
      </PanelCard>

      <PanelCard title="This TV" tab="var(--brand-trek)" scope="screen">
        <Toggle
          checked={!form.audioMuted}
          onChange={(e) => update({ audioMuted: !e.target.checked })}
          title="Play a chime with each welcome"
          hint="Browsers stay silent until someone has clicked the page once."
        />
        <Toggle
          checked={form.keepScreenAwake}
          onChange={set('keepScreenAwake')}
          title="Keep screen awake"
          hint={wakeTrouble
            ? <strong>{wakeLockStatus === 'unsupported'
              ? 'This browser cannot keep the screen awake — turn off sleep in the device’s own settings.'
              : 'The browser refused (battery saver?) — the TV may sleep mid-club.'}</strong>
            : 'Asks the browser to stop the TV or monitor from sleeping while the display is open.'}
        />
        <div className="field">
          <label htmlFor="confettiLevel">Confetti</label>
          <select id="confettiLevel" value={form.confettiLevel} onChange={set('confettiLevel')}>
            <option value="full">Full celebration</option>
            <option value="reduced">Reduced (half the particles)</option>
            <option value="off">Off (banners and chimes only)</option>
          </select>
          <span className="hint">Every burst — welcomes, birthdays, milestones. "Reduced" helps weak TV sticks keep up on busy nights.</span>
        </div>
        <Toggle
          checked={form.reduceMotion}
          onChange={set('reduceMotion')}
          title="Reduce motion on this screen"
          hint={lowPowerForced
            ? <>Freezes every animation — banners still appear, just instantly. <strong>This page’s address has <code>?lowPower=1</code>, which is forcing it on (and confetti off) whatever these say.</strong></>
            : 'Freezes every animation — banners still appear, just instantly. For weak TV sticks, or when the movement is distracting.'}
        />
        <Toggle checked={form.showConnectionStatus} onChange={set('showConnectionStatus')}
          title="Always show the connection sticker"
          hint="Useful while setting up. Even when off, it appears by itself if the connection drops or the screen is not set up." />
      </PanelCard>
    </>
  );
}

// ── Celebrations ──────────────────────────────────────────────────────────

export function CelebrationsSection({ form, set, update }) {
  return (
    <PanelCard title="Celebrations" tab="var(--brand-journey)" scope="shared">
      <div className="field">
        <label htmlFor="milestone">Room milestone (every N check-ins)</label>
        <input
          id="milestone" type="number" min="0" max="10000" step="5"
          value={form.milestoneEvery}
          onChange={set('milestoneEvery')}
        />
        <span className="hint">
          {form.milestoneEvery > 0
            ? <>Every {form.milestoneEvery} check-ins, a room-wide confetti moment with a &ldquo;{form.milestoneEvery} kids checked in tonight!&rdquo; toast.</>
            : <>Milestone celebrations are off. Set a number (25 is typical) to turn them on.</>}
        </span>
      </div>
      <div className="field">
        <label htmlFor="clubMilestone">Club milestone (every N per club)</label>
        <input
          id="clubMilestone" type="number" min="0" max="1000" step="5"
          value={form.clubMilestoneEvery}
          onChange={set('clubMilestoneEvery')}
        />
        <span className="hint">Uses the printer's live per-club counts — "Sparks 20 kids strong!". 0 turns it off.</span>
      </div>
      <MilestoneListField
        id="bookMilestones"
        label="Books finished tonight (celebrate at)"
        value={form.bookMilestones}
        onChange={(list) => update({ bookMilestones: list }, { apply: false })}
        hint="When the check-in system reports this many handbooks finished tonight, the toast says so. Comma-separated; blank turns it off."
      />
      <MilestoneListField
        id="awardMilestones"
        label="Awards earned tonight (celebrate at)"
        value={form.awardMilestones}
        onChange={(list) => update({ awardMilestones: list }, { apply: false })}
        hint="Same, for awards handed out tonight. Comma-separated; blank turns it off."
      />
    </PanelCard>
  );
}

// ── Pickup board ──────────────────────────────────────────────────────────

export function PickupSection({ form, set, onBoardDemo }) {
  const boardOn = form.checkoutBoardMode !== 'off';
  const [sample] = useState(() => demoCheckout(getAllClubs(), SAMPLE_BOARD_NAMES, Date.now()));
  // The preview follows the form: the same rules the TV applies, on sample
  // names, so turning the naming guard up shows what the room would see.
  const previewDecision = decideBoard({
    checkout: sample,
    mode: 'pickup',
    namesAbove: Number(form.checkoutBoardNamesAbove) || 0,
    staleMin: 120,
    now: sample.at,
    demo: true,
  });
  return (
    <>
      <PanelCard title={<>Who&apos;s still here</>} tab="var(--brand-puggles-deep)" scope="shared">
        <div className="field">
          <label htmlFor="cbmode">Who&apos;s still here board</label>
          <select id="cbmode" value={form.checkoutBoardMode} onChange={set('checkoutBoardMode')}>
            <option value="off">Off</option>
            <option value="pickup">During pickup (the times below)</option>
            <option value="always">Whenever data is arriving</option>
          </select>
          <span className="hint">
            Lists children who have <strong>not been checked out yet</strong> in the check-in system, one column per
            club, so a parent can look under their child&apos;s club. Needs the print server and a volunteer with the
            check-in page open — when that tab closes, the board shows its age instead of freezing.
            {' '}<strong>It is not a verified headcount:</strong> it reflects whether checkout was actually recorded,
            which during a busy pickup often lags. Treat it as a prompt to go look, never as proof the building is clear.
          </span>
        </div>
        {boardOn && (
          <>
            <div className="field-row">
              <div className="field">
                <label htmlFor="cbfrom">Show from</label>
                <input id="cbfrom" type="time" value={form.checkoutBoardFrom} onChange={set('checkoutBoardFrom')} />
              </div>
              <div className="field">
                <label htmlFor="cbuntil">Hide after</label>
                <input id="cbuntil" type="time" value={form.checkoutBoardUntil} onChange={set('checkoutBoardUntil')} />
              </div>
            </div>
            <span className="hint panel-intro">
              {form.checkoutBoardMode === 'pickup'
                ? <>The board comes up at the first time and stays until everyone is checked out. Then it says
                  &ldquo;Everyone has been checked out&rdquo; for a minute and steps away. By the second time it is gone,
                  whatever the list says.</>
                : <>The board shows all evening; between these times it takes the middle of the screen, and the rest of
                  the time it is a one-line card at the bottom.</>}
            </span>
            <Toggle
              checked={form.cornerStillHere !== false}
              onChange={set('cornerStillHere')}
              title="Count down in the corner during pickup"
              hint="Between these times the corner's tonight counter becomes PICKUP and counts down as children are checked out. Not while the board hides names (below), and not from a list that has stopped updating."
            />
            <div className="field">
              <label htmlFor="cbnames">Stop showing names at or below</label>
              <input
                id="cbnames" type="number" min="0" max="200"
                value={form.checkoutBoardNamesAbove}
                onChange={set('checkoutBoardNamesAbove')}
              />
              <span className={`hint${Number(form.checkoutBoardNamesAbove) === 0 ? ' hint--warn' : ''}`}>
                At or below this many children, the board hides the names and shows &ldquo;almost everyone has been
                picked up&rdquo; instead.
                {' '}<strong>This is the setting that matters.</strong> A long list is anonymous — one name among forty
                tells a passer-by nothing. A list of two names, late in the evening, points at two specific children who
                are not yet with a parent. 0 turns the guard off entirely, which is not recommended on a public screen.
              </span>
            </div>
            <div className="field">
              <label htmlFor="cbstale">Treat the list as stale after (minutes)</label>
              <input
                id="cbstale" type="number" min="1" max="120"
                value={form.checkoutBoardStaleMin}
                onChange={set('checkoutBoardStaleMin')}
              />
              <span className="hint">After this long with no update the board says so, rather than showing a frozen list that still looks live.</span>
            </div>
          </>
        )}
      </PanelCard>

      <PanelCard title="Preview" tab="var(--brand-journey)">
        <div className="board-preview" role="img" aria-label="A preview of the pickup board with sample names, one column per club">
          <CheckoutBoard decision={previewDecision} checkout={sample} calm placement="centre" demo />
        </div>
        <span className="hint panel-intro">
          Sample names, not real children. It follows the settings above as you change them.
        </span>
        {onBoardDemo && (
          <button type="button" className="secondary section-jump" onClick={onBoardDemo}
            title="Settings closes and this screen shows the board with sample names for about 20 seconds. Only this screen; it marks it ‘demo mode’ until reloaded.">
            Show a demo on this TV (20 s)
          </button>
        )}
      </PanelCard>
    </>
  );
}

// ── Look & season ─────────────────────────────────────────────────────────

export function LookSection({ form, set }) {
  return (
    <>
      <PanelCard title="Season" tab="var(--brand-journey)" scope="shared">
        <div className="field">
          <label htmlFor="nightTheme">Themed night skin</label>
          <select id="nightTheme" value={form.nightTheme} onChange={set('nightTheme')}>
            <option value="none">None (classic)</option>
            {/* Generated from SKIN_TABLE so a new season needs one edit, not five. */}
            {skinOptions().filter((o) => o.value !== 'none').map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <span className="hint">
            Dresses the stage for the season. Banners always keep their club colors. Auto reads tonight&apos;s calendar
            title (Easter, VBS, Thanksgiving&hellip;) and falls back to the month.
          </span>
        </div>
        {form.nightTheme === 'auto' && (
          <Toggle
            checked={form.followPrinterTheme === true}
            onChange={set('followPrinterTheme')}
            title="Follow the printer's season"
            hint="When the label printer broadcasts its season theme, this screen wears the matching skin so labels and screens switch together."
          />
        )}
      </PanelCard>

      <PanelCard title="Weather effects" tab="var(--brand-trek)" scope="shared">
        <div className="field">
          <label htmlFor="particleEffect">Ambient particles</label>
          <select id="particleEffect" value={form.particleEffect} onChange={set('particleEffect')}>
            <option value="auto">Auto — match the weather</option>
            <option value="off">Off</option>
            <option value="snow">Snow</option>
            <option value="rain">Rain</option>
            <option value="sparkle">Sparkles</option>
          </select>
          <span className="hint">
            A gentle full-screen effect. Auto mirrors the sky outside, using the weather location under Screen &amp;
            corner. Or force one: snowfall for a Christmas party, sparkles for awards night.
          </span>
        </div>
        <Toggle
          checked={form.weatherTheme === true}
          onChange={set('weatherTheme')}
          title="Let the weather set the mood"
          hint="A rainy or snowy night cools and dims the background. The season still picks the colors."
        />
      </PanelCard>

      <details className="advanced-fields panel-fold">
        <summary>Just for fun</summary>
        <Toggle
          checked={form.aprilFools === true}
          onChange={set('aprilFools')}
          title="April Fools: flip this screen upside down"
          hint="Only does anything on April 1st. Labels and the printer stay serious, and this settings panel (plus its gear) stays right-side up so you can always turn it off."
        />
      </details>
    </>
  );
}

// ── Setup ─────────────────────────────────────────────────────────────────

/** "rev 4, 7:35 PM" for a shared layer, or what is true when there is none. */
function sharedLine(shared, viaSync = false) {
  const home = viaSync ? 'the sync service' : 'the print server';
  if (!shared) return 'No shared settings have reached this screen yet.';
  if (shared.local && !shared.publishedAt) return `A change made here has not reached ${home} yet.`;
  const when = shared.publishedAt
    ? new Date(shared.publishedAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
    : '';
  const tail = shared.local ? ` A newer change made here has not reached ${home} yet.` : '';
  return `Following update ${shared.rev}${when ? `, sent ${when}` : ''}.${tail}`;
}

function SharedSettingsCard({ form, set, shared, shareStatus, onShareNow, viaSync }) {
  const following = form.followSharedSettings !== false;
  const from = viaSync ? 'any signed-in screen' : 'the check-in computer';
  return (
    <PanelCard title="Shared settings" tab="var(--brand-blue)" scope="screen">
      <Toggle
        checked={following}
        onChange={set('followSharedSettings')}
        title="Follow the shared settings"
        hint={`Settings tagged EVERY SCREEN (banner times, celebrations, the pickup board, the look, the calendar and weather) come from ${from}, and a change made there reaches every screen. Turn off to keep this one screen on its own values. Settings tagged THIS SCREEN never travel.`}
      />
      <p className="hint">{following ? sharedLine(shared, viaSync) : 'This screen keeps its own values for everything.'}</p>
      {shareStatus?.state === 'failed' && <p className="hint hint--warn" role="status">{shareStatus.message}</p>}
      {following && onShareNow && (
        <div className="field">
          <button type="button" className="ghost section-jump" onClick={onShareNow}>
            Send this screen&rsquo;s shared settings to every screen
          </button>
          <span className="hint">
            {viaSync
              ? 'Every signed-in screen takes these values within seconds (a screen that is off, when it next starts).'
              : 'Works on the check-in computer, while the printer app is running. Every other screen then takes these values, the next time it hears from the print server (within 5 minutes, or at once if it is on).'}
          </span>
        </div>
      )}
    </PanelCard>
  );
}

export function SetupSection({
  form, set, status, secure, login, syncedDeck, onForgetSyncedDeck,
  onOpenDebug, onExport, onImport, onResetTally, onReset,
  shared, shareStatus, onShareNow,
}) {
  // The by-hand fields fold away behind the login — unless they are the
  // fix: no Pusher connection, or no secure crypto.
  const [advancedOpen, setAdvancedOpen] = useState(() => status === 'off' || status === 'disconnected' || !secure);
  // Once the site names a sync service, the passphrase signs in through it;
  // until then the print server's display login, exactly as before.
  const syncState = useSync();
  const viaSync = Boolean(syncState.url);

  return (
    <>
      <PanelCard title="Connect this screen" scope="screen">
        {viaSync ? (
          <>
            <SyncSignInField secure={secure} />
            <TemplateField />
            <ChangePassphraseField />
          </>
        ) : <DisplayLoginField status={status} secure={secure} login={login} />}
        <details
          className="advanced-fields"
          open={advancedOpen}
          onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}
        >
          <summary>Advanced — paste keys by hand</summary>
          <span className="hint">
            Only needed when this screen cannot log in — no Pusher App Key yet, no print server on this network,
            or a page not served over https. A logged-in screen fills the display key and publish token in by itself.
          </span>
          <div className="field">
            <label htmlFor="pkey">Pusher App Key</label>
            <input id="pkey" type="text" value={form.pusherAppKey} onChange={set('pusherAppKey')} placeholder="abcdef1234567890" />
            <span className="hint">
              From your Pusher Channels app's <code>App Keys</code> page — the <code>key</code> value (public, safe to
              ship). Must be the <strong>same app</strong> the label print server uses. A site built with the
              repository variables (see the README) has this filled in already.
            </span>
          </div>
          <div className="field">
            <label htmlFor="pcluster">Pusher Cluster</label>
            <input id="pcluster" type="text" value={form.pusherCluster} onChange={set('pusherCluster')} placeholder="us2" />
            <span className="hint">From the same page (e.g. <code>us2</code>, <code>eu</code>, <code>ap1</code>) — must also match the print server.</span>
          </div>
          <DisplayKeyField secure={secure} />
        </details>
      </PanelCard>

      <SharedSettingsCard
        form={form} set={set} shared={shared} shareStatus={shareStatus} onShareNow={onShareNow}
        viaSync={viaSync && syncState.signedIn}
      />

      <PanelCard title="Publishing slides" tab="var(--brand-journey)" scope="screen">
        {viaSync && syncState.signedIn
          ? <p className="hint">Signed in: Publish in the slide editor sends the deck to every screen from here. No token needed.</p>
          : <PublishTokenField />}
        {syncedDeck && (
          <div className="field">
            <span className="hint">This screen holds a received deck (rev {syncedDeck.deckRev}).</span>
            <button
              type="button"
              className="ghost section-jump"
              onClick={() => {
                if (window.confirm('Forget the received deck on THIS screen? It falls back to its locally saved slides until the next publish arrives.')) {
                  onForgetSyncedDeck?.();
                }
              }}
            >
              Forget received deck
            </button>
          </div>
        )}
      </PanelCard>

      <PanelCard title="Tools" tab="var(--brand-trek)">
        <div className="tool-grid">
          {onOpenDebug && (
            <div className="tool">
              <button type="button" className="ghost" onClick={onOpenDebug}>Debug panel</button>
              <span className="hint">Simulate check-ins and see connection stats (Ctrl+Shift+D).</span>
            </div>
          )}
          <div className="tool">
            <button type="button" className="ghost" onClick={onExport}>Export settings</button>
            <span className="hint">Download this screen’s settings as a file. Never includes the login or keys.</span>
          </div>
          <div className="tool">
            <button type="button" className="ghost" onClick={onImport}>Import settings</button>
            <span className="hint">Load a settings file exported from another screen. Applies at once.</span>
          </div>
          {onResetTally && (
            <div className="tool">
              <button type="button" className="ghost" onClick={onResetTally}>Reset tonight&rsquo;s counter</button>
              <span className="hint">Back to zero until the printer’s next count. Also re-arms the “Doors are open” moment.</span>
            </div>
          )}
          <div className="tool">
            <button type="button" className="danger" onClick={onReset}>Reset this screen</button>
            <span className="hint">Every setting back to its default, typed slides included. The login, keys and uploaded files stay.</span>
          </div>
        </div>
      </PanelCard>

      <PanelCard title="Sound room app" tab="var(--brand-blue)">
        <p className="hint">
          <strong>Awana Lobby Display</strong> is a Windows app for the sound room PC. It puts this lobby screen full
          screen on the lobby TV on club nights, from 5:00 to 8:00 pm, starts with Windows and keeps itself up to date.
        </p>
        <div className="panel-links">
          <a className="panel-button secondary" href={DESKTOP_APP_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">
            Download for Windows
          </a>
          <a className="panel-button ghost" href={DESKTOP_APP_GUIDE_URL} target="_blank" rel="noopener noreferrer">
            Setup guide
          </a>
        </div>
        <p className="hint">
          The first time, Windows may say &ldquo;Windows protected your PC&rdquo; (the app is not code signed): choose{' '}
          <strong>More info</strong>, then <strong>Run anyway</strong>.
        </p>
      </PanelCard>
    </>
  );
}
