import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { CLUBS } from '../config.js';
import { stateKey, stateForWindow, windowsForDate } from '../lib/schedule.js';
import { localDateKey } from '../lib/shared-config.js';
import { addSkipDate, overlayEntries, removeSkipDate, subscribeOverlay } from '../lib/scheduleOverlay.js';
import { setStingersEnabled, stingersEnabled, subscribeStingers, unlockStingers } from '../lib/stingers.js';
import { clearBirthdays, useBirthdays } from '../hooks/useBirthdays.js';
import { useEffectiveSchedule } from '../hooks/useEffectiveSchedule.js';
import { lowPowerPreference, setLowPowerPreference, useLowPower } from '../hooks/useLowPower.js';
import { useClockDrift } from '../hooks/useClockDrift.js';
import { useConfig } from '../../hooks/useConfig.js';
import { useDisplayLogin } from '../../hooks/useDisplayLogin.js';
import { useDisplayKey } from '../../hooks/useDisplayKey.js';
import { maskDisplayKey } from '../../lib/displayKey.js';
import { isPlausibleKey } from '../../lib/envelope.js';
import { GlassPanel } from '../components/GlassPanel.jsx';

/**
 * Hidden operator menu. Its hover zone is only the top-right corner —
 * the old version keyed off the whole screen, so any mouse nudge
 * anywhere revealed it. Windows listed are the ones in effect on
 * `now`'s date (special dates can replace the normal table), and the
 * active probe uses the app clock so it is honest under `?now=` QA.
 *
 * This is the projector PC's menu (a mouse and a keyboard). A phone or tablet
 * cannot hover, so there App renders TouchMenu instead, a visible button and
 * a full-screen sheet holding these same items (`QuickNavItems` with
 * `touch`); nothing of this hover panel is on a touch page at all, so its
 * invisible buttons can never catch a tap meant for the wall.
 */
export const QuickNav = ({ now, state, isOverride, onSelect, onResume, socketStatus }) => {
  const skewMs = useClockDrift();

  return (
    <div className="absolute top-0 right-0 z-50 p-4 pl-16 pb-16 group/nav">
      {/* Clock-drift warning is visible WITHOUT hovering — a wrong clock
          means every screen below is wrong, so it must not hide. */}
      {skewMs !== null && (
        <div
          className="absolute top-3 right-3 px-3 py-1 rounded-full text-[0.65rem] uppercase text-[var(--brand-sun)] bg-[var(--brand-sun)]/15 border border-[var(--brand-sun)]/45"
          style={{ fontFamily: 'var(--font-condensed)', fontWeight: 800, letterSpacing: '0.1em' }}
          title={CLOCK_DRIFT_HELP}
        >
          ⚠ clock off by ~{Math.round(Math.abs(skewMs) / 60000)} min
        </div>
      )}
      <div className="opacity-0 group-hover/nav:opacity-100 transition-opacity duration-300">
        <GlassPanel className="p-2 flex flex-col gap-1 max-h-[92vh] overflow-y-auto">
          <QuickNavItems
            now={now}
            state={state}
            isOverride={isOverride}
            onSelect={onSelect}
            onResume={onResume}
            socketStatus={socketStatus}
          />
        </GlassPanel>
      </div>
    </div>
  );
};

/** What the clock-drift pill means and how to fix it (a tooltip on the PC, tap-to-read on touch). */
export const CLOCK_DRIFT_HELP =
  "This device's clock disagrees with the web server — the countdown and schedule may be wrong. Fix the system clock / enable network time.";

/**
 * The menu's items: the window jumps, Resume Schedule, Skip Weeks, the
 * birthday roster, the two switches and Display Settings. The hover panel
 * above renders them as they always were; `touch` renders the same items for
 * the touch sheet (TouchMenu.jsx): full-width rows at least 44px tall, the
 * tooltips written out as visible hints, 16px inputs (iOS zooms the page on a
 * smaller one) in real forms, so a phone keyboard's Go key submits.
 * `displayOpen` opens Display Settings from the start (the setup note's
 * shortcut).
 */
export const QuickNavItems = ({ now, state, isOverride, onSelect, onResume, socketStatus, touch = false, displayOpen = false }) => {
  const activeKey = stateKey(state);
  const cfg = useEffectiveSchedule();
  const windows = windowsForDate(now, cfg) ?? cfg.windows;

  if (touch) {
    return (
      <>
        <section className="pj-sheet__group pj-sheet__group--first" aria-label="Show on the wall">
          <h3 className="pj-sheet__label">Show on the wall</h3>
          <NavButton
            touch
            label="Main Countdown"
            active={activeKey === 'countdown'}
            onClick={() => onSelect({ type: 'countdown' })}
          />
          {windows.map((window, index) => (
            <NavButton
              touch
              key={window.title}
              label={window.title}
              dotColor={window.kind === 'game' ? CLUBS[window.clubs[0]].color : undefined}
              active={activeKey === stateKey(stateForWindow(window, now))}
              onClick={() => onSelect({ type: 'window', index })}
            />
          ))}
          {isOverride && (
            <button type="button" onClick={onResume} className="pj-sheet__action pj-sheet__action--go">
              Resume Schedule
            </button>
          )}
          {isOverride && <p className="pj-sheet__hint">A pick holds for 15 minutes, then the schedule takes over again.</p>}
        </section>
        <SkipWeeks now={now} cfg={cfg} touch />
        <BirthdayStatus touch />
        <TogglesRow touch />
        <DisplaySettings socketStatus={socketStatus} touch initialOpen={displayOpen} />
        <p className="pj-panel-note pj-sheet__fine">
          Awana® is a trademark of Awana Clubs International.
          <br />
          Not affiliated or endorsed by Awana Clubs International.
        </p>
      </>
    );
  }

  return (
    <>
      <NavButton
        label="Main Countdown"
        active={activeKey === 'countdown'}
        onClick={() => onSelect({ type: 'countdown' })}
      />
      {windows.map((window, index) => (
        <NavButton
          key={window.title}
          label={window.title}
          dotColor={window.kind === 'game' ? CLUBS[window.clubs[0]].color : undefined}
          active={activeKey === stateKey(stateForWindow(window, now))}
          onClick={() => onSelect({ type: 'window', index })}
        />
      ))}
      {isOverride && (
        <button
          onClick={onResume}
          className="mt-2 px-3 py-1.5 text-xs uppercase text-[var(--brand-tnt)] hover:bg-[var(--brand-tnt)]/15 rounded-lg transition-all border border-[var(--brand-tnt)]/40 text-center"
          style={{ fontFamily: 'var(--font-condensed)', fontWeight: 800, letterSpacing: '0.12em' }}
        >
          Resume Schedule
        </button>
      )}
      <SkipWeeks now={now} cfg={cfg} />
      <BirthdayStatus />
      <TogglesRow />
      <DisplaySettings socketStatus={socketStatus} />
      <p
        className="pj-panel-note mt-2 pt-2 border-t border-white/10 px-3 pb-1 text-[0.62rem] text-white/45 text-right leading-relaxed"
      >
        Awana® is a trademark of Awana Clubs International.
        <br />
        Not affiliated or endorsed by Awana Clubs International.
      </p>
    </>
  );
};

/** A switch-style state marker for a touch row: the dot the hover panel shows, grown into a track. */
const Switch = ({ on }) => <span className={`pj-sheet__switch${on ? ' is-on' : ''}`} aria-hidden="true" />;

/**
 * Operator "skip weeks" editor (device-local overlay over the shared
 * schedule): cancel an upcoming club night without a deploy. Entries
 * baked into shared/schedule.json show read-only; reshaped window
 * tables still require editing the JSON (validated in CI).
 */
const SkipWeeks = ({ now, cfg, touch = false }) => {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState('');
  const [error, setError] = useState(null);
  const overlay = useSyncExternalStore(subscribeOverlay, overlayEntries, overlayEntries);

  const todayKey = localDateKey(now);
  const upcoming = Object.entries(cfg.specialDates)
    .filter(([key, val]) => key >= todayKey && val.noClub)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .slice(0, 6);

  const add = () => {
    const err = addSkipDate(date, 'No club (set at the projector)');
    setError(err);
    if (!err) setDate('');
  };

  if (touch) {
    return (
      <section className="pj-sheet__group" aria-label="Skip weeks">
        <button type="button" onClick={() => setOpen((v) => !v)} className="pj-sheet__row" aria-expanded={open}>
          <span className="pj-sheet__grow">Skip Weeks</span>
          <span aria-hidden="true">{open ? '▴' : '📅'}</span>
        </button>
        {open && (
          <div className="pj-sheet__fold">
            {upcoming.length > 0 && (
              <ul className="pj-sheet__list">
                {upcoming.map(([key, val]) => (
                  <li key={key} className="pj-sheet__item">
                    <span className="pj-sheet__grow">
                      {key} — no club{val.label ? ` (${val.label})` : ''}
                    </span>
                    {key in overlay ? (
                      <button type="button" onClick={() => removeSkipDate(key)} className="pj-sheet__pill pj-sheet__pill--hot">
                        Undo
                      </button>
                    ) : (
                      <span className="pj-sheet__hint">shared: edit shared/schedule.json to change</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <form
              className="pj-sheet__field"
              onSubmit={(e) => {
                e.preventDefault();
                add();
              }}
            >
              <input
                type="date"
                className="pj-sheet__input"
                value={date}
                onChange={(e) => { setDate(e.target.value); setError(null); }}
                aria-label="Night with no club"
              />
              <button type="submit" className="pj-sheet__pill pj-sheet__pill--sun">
                Mark “no club”
              </button>
            </form>
            <p className="pj-sheet__hint">
              {error ? error : 'This device only · shared/schedule.json is the master copy'}
            </p>
          </div>
        )}
      </section>
    );
  }

  const inputStyle =
    'px-2 py-1 text-xs rounded bg-white/10 border border-white/15 text-white outline-none focus:border-white/40 w-40';

  return (
    <div
      className="mt-2 pt-2 border-t border-white/10 flex flex-col gap-1"
      style={{ fontFamily: 'var(--font-condensed)', letterSpacing: '0.12em' }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="px-3 py-1.5 text-xs uppercase text-white/60 hover:text-white hover:bg-white/10 rounded-lg transition-all text-right flex items-center justify-end gap-2"
        style={{ fontWeight: 700 }}
      >
        Skip Weeks
        <span style={{ letterSpacing: 0 }}>{open ? '▴' : '📅'}</span>
      </button>
      {open && (
        <div className="px-3 pb-1 flex flex-col items-end gap-1.5">
          {upcoming.length > 0 && (
            <ul className="flex flex-col items-end gap-1">
              {upcoming.map(([key, val]) => (
                <li key={key} className="flex items-center gap-2 text-[0.65rem] uppercase text-white/60">
                  <span style={{ fontWeight: 700 }}>
                    {key} — no club{val.label ? ` (${val.label})` : ''}
                  </span>
                  {key in overlay ? (
                    <button
                      onClick={() => removeSkipDate(key)}
                      className="text-[var(--brand-hot)]/80 hover:text-[var(--brand-hot)] transition-colors"
                      style={{ fontWeight: 700 }}
                    >
                      Undo
                    </button>
                  ) : (
                    <span className="text-white/30" title="Baked into shared/schedule.json — edit the file to change">
                      (shared)
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <input
            type="date"
            className={inputStyle}
            value={date}
            onChange={(e) => { setDate(e.target.value); setError(null); }}
          />
          <button
            onClick={add}
            className="px-3 py-1 text-xs uppercase text-[var(--brand-sun)] hover:bg-[var(--brand-sun)]/15 rounded-lg transition-all border border-[var(--brand-sun)]/40"
            style={{ fontWeight: 800 }}
          >
            Mark “no club”
          </button>
          <p className="pj-panel-note text-[0.7rem] text-white/50 text-right">
            {error ? error : 'This device only · shared/schedule.json is the master copy'}
          </p>
        </div>
      )}
    </div>
  );
};

const LOW_POWER_HINT = 'Hides particle / weather layers for weak hardware';
const SOUNDS_HINT = 'Chimes at 1hr/30/10/5/1min — off by default';

/** Low-power mode + countdown-stinger switches. */
const TogglesRow = ({ touch = false }) => {
  useLowPower(); // subscribe so the row re-renders when either side flips
  const stingers = useSyncExternalStore(subscribeStingers, stingersEnabled, stingersEnabled);

  if (touch) {
    return (
      <section className="pj-sheet__group" aria-label="Switches">
        <ToggleButton
          touch
          label="Low power mode"
          hint={LOW_POWER_HINT}
          on={lowPowerPreference()}
          onToggle={() => setLowPowerPreference(!lowPowerPreference())}
        />
        <ToggleButton
          touch
          label="Countdown sounds"
          hint={SOUNDS_HINT}
          on={stingers}
          onToggle={() => {
            // A phone lets a page make sound only from inside a tap, so the
            // chimes' audio is woken here, by the tap that arms them.
            setStingersEnabled(!stingers);
            if (!stingers) unlockStingers();
          }}
        />
        <FullscreenToggle />
      </section>
    );
  }

  return (
    <div
      className="mt-2 pt-2 border-t border-white/10 flex flex-col gap-1"
      style={{ fontFamily: 'var(--font-condensed)', letterSpacing: '0.12em' }}
    >
      <ToggleButton
        label="Low power mode"
        hint={LOW_POWER_HINT}
        on={lowPowerPreference()}
        onToggle={() => setLowPowerPreference(!lowPowerPreference())}
      />
      <ToggleButton
        label="Countdown sounds"
        hint={SOUNDS_HINT}
        on={stingers}
        onToggle={() => setStingersEnabled(!stingers)}
      />
    </div>
  );
};

/**
 * Full screen, on a touch device whose browser can do it for a page (Android,
 * iPadOS; iPhone Safari cannot, so there the row is not offered): the browser's
 * own bars leave the wall. The tap is the gesture the browser asks for.
 */
const fullscreenSubscribe = (fn) => {
  document.addEventListener('fullscreenchange', fn);
  return () => document.removeEventListener('fullscreenchange', fn);
};
const isFullscreen = () => Boolean(document.fullscreenElement);
const FullscreenToggle = () => {
  const on = useSyncExternalStore(fullscreenSubscribe, isFullscreen, () => false);
  if (!document.fullscreenEnabled || typeof document.documentElement.requestFullscreen !== 'function') return null;
  return (
    <ToggleButton
      touch
      label="Full screen"
      hint="Hides the browser's own bars, until you switch it off here"
      on={on}
      onToggle={() => {
        const done = on ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.();
        done?.catch?.(() => {});
      }}
    />
  );
};

const ToggleButton = ({ label, hint, on, onToggle, touch = false }) => (touch ? (
  <button type="button" onClick={onToggle} className="pj-sheet__toggle" role="switch" aria-checked={on}>
    <span className="pj-sheet__grow">
      <span className="pj-sheet__toggle-label">{label}</span>
      <span className="pj-sheet__hint">{hint}</span>
    </span>
    <Switch on={on} />
  </button>
) : (
  <button
    onClick={onToggle}
    title={hint}
    className={`px-3 py-1.5 text-xs uppercase rounded-lg transition-all text-right flex items-center justify-end gap-2 ${
      on ? 'text-[var(--brand-tnt)] bg-[var(--brand-tnt)]/15' : 'text-white/60 hover:text-white hover:bg-white/10'
    }`}
    style={{ fontFamily: 'var(--font-condensed)', fontWeight: 700, letterSpacing: '0.12em' }}
  >
    {label}
    <span
      className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${on ? 'bg-[var(--brand-tnt)]' : 'bg-white/25'}`}
    />
  </button>
));

/**
 * Birthday roster status. The roster fills itself from the print
 * server's `birthdays` broadcast (through the sanitized socket — the
 * exact source the check-in display uses), so the only operator
 * control left is Clear; the list refills on the next broadcast. The
 * CSV upload this replaced is gone on purpose: two sources meant a
 * stale spreadsheet could contradict the live one.
 */
const BirthdayStatus = ({ touch = false }) => {
  const roster = useBirthdays();
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  const clear = () => {
    clearBirthdays();
    setNotice({ text: 'Cleared — refills on the next broadcast', ok: true });
  };

  if (touch) {
    return (
      <section className="pj-sheet__group" aria-label="Birthdays">
        <div className="pj-sheet__item pj-sheet__item--status">
          <span className="pj-sheet__grow">
            {roster.length > 0 ? `${roster.length} birthdays · synced live` : 'Birthdays sync from check-in'}
          </span>
          <span aria-hidden="true">🎂</span>
          {roster.length > 0 && (
            <button type="button" onClick={clear} className="pj-sheet__pill pj-sheet__pill--hot">
              Clear
            </button>
          )}
        </div>
        {notice && (
          <p className={`pj-sheet__note ${notice.ok ? 'is-ok' : 'is-warn'}`} role="status">
            {notice.text}
          </p>
        )}
      </section>
    );
  }

  return (
    <div
      className="mt-2 pt-2 border-t border-white/10 flex flex-col gap-1"
      style={{ fontFamily: 'var(--font-condensed)', letterSpacing: '0.12em' }}
    >
      <div className="px-3 py-1.5 flex items-center justify-end gap-2 text-xs uppercase text-white/60" style={{ fontWeight: 700 }}>
        {roster.length > 0 ? `${roster.length} birthdays · synced live` : 'Birthdays sync from check-in'}
        <span style={{ letterSpacing: 0 }}>🎂</span>
      </div>
      {roster.length > 0 && (
        <div className="px-3 flex items-center justify-end gap-2 text-[0.65rem] uppercase text-white/45">
          <button
            onClick={clear}
            className="text-[var(--brand-hot)]/80 hover:text-[var(--brand-hot)] transition-colors"
            style={{ fontWeight: 700 }}
          >
            Clear
          </button>
        </div>
      )}
      {notice && (
        <p
          className={`pj-panel-note px-3 text-right text-[0.7rem] ${notice.ok ? 'text-[var(--brand-tnt)]' : 'text-[var(--brand-sun)]'}`}
        >
          {notice.text}
        </p>
      )}
    </div>
  );
};

/**
 * Display settings (#42): the live-data connection, editable on the
 * display machine itself instead of via URL flags. The Pusher key is
 * the PUBLIC subscribe-only key (the print server holds the secret).
 * Credentials live in the display's shared device config
 * (`awanaConfig.v1` via useConfig) — the same store the signage page's
 * Settings panel writes — and the sanctioned socket picks changes up
 * immediately (no reload needed).
 */
const DisplaySettings = ({ socketStatus, touch = false, initialOpen = false }) => {
  const { config, updateConfig } = useConfig();
  const [open, setOpen] = useState(initialOpen);
  // The by-hand fold opens itself when it IS the fix: no Pusher key yet.
  const [advanced, setAdvanced] = useState(() => socketStatus === 'off');
  const [key, setKey] = useState(config.pusherAppKey || '');
  const [cluster, setCluster] = useState(config.pusherCluster || 'us2');
  const [saved, setSaved] = useState(false);
  // Display login: one passphrase provisions the display key + publish token
  // (the sealed birthday list needs the key). Same store the signage page's
  // Settings uses — src/lib/displayLogin.js.
  const { frameStatus, loginStatus, kid, pendingLogin, login, logout, viaSync } = useDisplayLogin();
  const [passphrase, setPassphrase] = useState('');
  const [reveal, setReveal] = useState(false);
  const [loginNote, setLoginNote] = useState('');
  const [loginTone, setLoginTone] = useState('muted');
  // The display key by hand — the same slot the signage Settings writes.
  const secure = Boolean(globalThis.crypto?.subtle);
  const { displayKey, setDisplayKey } = useDisplayKey();
  const [editingKey, setEditingKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [keyNote, setKeyNote] = useState('');

  const save = () => {
    updateConfig({ pusherAppKey: key.trim(), pusherCluster: cluster.trim() });
    setSaved(true);
    setTimeout(() => setSaved(false), 4000);
  };

  const busy = loginStatus === 'busy';
  const canLogin = secure && !busy && passphrase.trim().length > 0;

  const doLogin = async () => {
    const p = passphrase.trim();
    if (!p || !canLogin) return;
    const result = await login(p);
    if (result === 'logged-in') setPassphrase('');
    const notes = {
      'logged-in': ['Logged in — birthdays + names unlocked', 'ok'],
      wrong: [viaSync ? 'That is not the passphrase' : 'Wrong passphrase — check the dashboard (Settings → Display login)', 'bad'],
      locked: ['Too many wrong tries — wait 15 minutes, then try again', 'bad'],
      'no-frame': ['Waiting for the print server — will log in when its frame arrives', 'muted'],
      unsupported: ['Insecure page — open this page over https:// to log in', 'bad'],
      storage: ['Could not save (storage blocked)', 'bad'],
    };
    const [note, tone] = notes[result] || ['', 'muted'];
    setLoginNote(note);
    setLoginTone(tone);
  };

  // Status first: the print server is usually fine and the screen is simply
  // not connected yet — the old line blamed the server for every wait.
  let loginLine;
  let lineTone = 'muted';
  if (!secure) { loginLine = 'Insecure page — open over https:// to log in'; lineTone = 'bad'; }
  else if (loginStatus === 'logged-in') { loginLine = `Logged in${kid ? ` · key ${kid}` : ''}`; lineTone = 'ok'; }
  else if (loginStatus === 'stale') { loginLine = 'Passphrase changed — log in again'; lineTone = 'bad'; }
  else if (busy) loginLine = 'Checking…';
  else if (viaSync) loginLine = 'Type the church passphrase to set this screen up';
  else if (socketStatus === 'off') { loginLine = 'Not connected — add the live data key under Advanced first'; lineTone = 'bad'; }
  else if (socketStatus === 'disconnected') { loginLine = 'Not connected — check the network, then the key under Advanced'; lineTone = 'bad'; }
  else if (socketStatus === 'connecting') loginLine = 'Connecting…';
  else if (loginStatus === 'wrong') { loginLine = 'Wrong passphrase'; lineTone = 'bad'; }
  else if (pendingLogin) loginLine = 'Will log in when the print server is heard';
  else if (frameStatus === 'received') loginLine = 'Type the display passphrase';
  else if (frameStatus === 'miss') loginLine = 'Print server has not published lately';
  else loginLine = 'Waiting for the print server…';
  const tone = loginNote ? loginTone : lineTone;
  const toneClass = tone === 'ok' ? 'text-[var(--brand-tnt)]' : tone === 'bad' ? 'text-[var(--brand-hot)]' : 'text-white/60';

  const saveKey = () => {
    const next = keyDraft.trim();
    if (!isPlausibleKey(next)) return;
    const ok = setDisplayKey(next);
    setKeyNote(ok ? 'Saved — applies immediately' : 'Could not save (storage blocked)');
    if (ok) { setKeyDraft(''); setEditingKey(false); }
  };
  const confirmLogout = () => {
    if (window.confirm('Log this screen out? It forgets the display key and publish token too.')) { logout(); setLoginNote(''); }
  };
  const confirmRemoveKey = () => {
    if (window.confirm('Remove the display key from THIS screen? Names and birthdays stop here until it is set again.')) setDisplayKey('');
  };

  if (touch) {
    // Typed on a phone keyboard: never capitalised or "corrected", and each
    // field is its own form, so the keyboard's Go / Done key submits it.
    const typed = { spellCheck: false, autoComplete: 'off', autoCapitalize: 'none', autoCorrect: 'off' };
    const toneTouch = tone === 'ok' ? 'is-ok' : tone === 'bad' ? 'is-bad' : '';
    return (
      <section className="pj-sheet__group" aria-label="Display settings">
        <button type="button" onClick={() => setOpen((v) => !v)} className="pj-sheet__row" aria-expanded={open}>
          <span className="pj-sheet__grow">Display Settings</span>
          <span aria-hidden="true">{open ? '▴' : '⚙️'}</span>
        </button>
        {open && (
          <div className="pj-sheet__fold">
            <h4 className="pj-sheet__label">Display login</h4>
            {loginStatus !== 'logged-in' ? (
              <form
                className="pj-sheet__field"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (canLogin) doLogin();
                }}
              >
                <input
                  className="pj-sheet__input"
                  type={reveal ? 'text' : 'password'}
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="display passphrase"
                  enterKeyHint="go"
                  disabled={!secure || busy}
                  aria-label="Display passphrase"
                  {...typed}
                />
                <button type="button" onClick={() => setReveal((v) => !v)} aria-pressed={reveal} className="pj-sheet__pill">
                  {reveal ? 'Hide' : 'Show'}
                </button>
                <button type="submit" disabled={!canLogin} className="pj-sheet__pill pj-sheet__pill--go">
                  Log in
                </button>
              </form>
            ) : (
              <button type="button" onClick={confirmLogout} className="pj-sheet__pill">
                Log out
              </button>
            )}
            <p className={`pj-sheet__note ${toneTouch}`} role="status">
              {loginNote || loginLine}
            </p>

            <button type="button" onClick={() => setAdvanced((v) => !v)} className="pj-sheet__row pj-sheet__row--quiet" aria-expanded={advanced}>
              <span className="pj-sheet__grow">{advanced ? 'Advanced' : 'Advanced (paste keys by hand)'}</span>
              <span aria-hidden="true">{advanced ? '▴' : '▾'}</span>
            </button>
            {advanced && (
              <>
                <form
                  className="pj-sheet__fields"
                  onSubmit={(e) => {
                    e.preventDefault();
                    save();
                  }}
                >
                  <h4 className="pj-sheet__label">Live data key (Pusher, public)</h4>
                  <input
                    className="pj-sheet__input"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder="public key — blank = off"
                    enterKeyHint="next"
                    aria-label="Pusher app key"
                    {...typed}
                  />
                  <input
                    className="pj-sheet__input"
                    value={cluster}
                    onChange={(e) => setCluster(e.target.value)}
                    placeholder="cluster (us2)"
                    enterKeyHint="done"
                    aria-label="Pusher cluster"
                    {...typed}
                  />
                  <button type="submit" className="pj-sheet__pill pj-sheet__pill--go">
                    Save
                  </button>
                  <p className="pj-sheet__hint">
                    {saved ? 'Saved — applies immediately' : 'Powers live counts + birthday sync'}
                  </p>
                </form>

                <h4 className="pj-sheet__label">Display key (names + birthdays)</h4>
                {!secure ? (
                  <p className="pj-sheet__note is-bad">
                    Insecure page — encrypted names cannot be read here. Open this page over https://
                  </p>
                ) : displayKey && !editingKey ? (
                  <div className="pj-sheet__field">
                    <span className="pj-sheet__mono">{maskDisplayKey(displayKey)}</span>
                    <button type="button" onClick={() => setEditingKey(true)} className="pj-sheet__pill">Replace</button>
                    <button type="button" onClick={confirmRemoveKey} className="pj-sheet__pill">Remove</button>
                  </div>
                ) : (
                  <form
                    className="pj-sheet__field"
                    onSubmit={(e) => {
                      e.preventDefault();
                      saveKey();
                    }}
                  >
                    <input
                      className="pj-sheet__input"
                      type="password"
                      value={keyDraft}
                      onChange={(e) => setKeyDraft(e.target.value)}
                      placeholder="paste the 44-character key"
                      enterKeyHint="done"
                      aria-label="Display key"
                      {...typed}
                    />
                    <button type="submit" disabled={!isPlausibleKey(keyDraft.trim())} className="pj-sheet__pill pj-sheet__pill--go">
                      Save key
                    </button>
                    {editingKey && (
                      <button type="button" onClick={() => { setEditingKey(false); setKeyDraft(''); }} className="pj-sheet__pill">
                        Cancel
                      </button>
                    )}
                  </form>
                )}
                {keyNote && <p className="pj-sheet__note" role="status">{keyNote}</p>}
              </>
            )}
          </div>
        )}
      </section>
    );
  }

  const inputStyle =
    'px-2 py-1 text-xs rounded bg-white/10 border border-white/15 text-white placeholder-white/40 outline-none focus:border-white/40 w-40 disabled:opacity-40';
  const pillGrey = 'px-3 py-1 text-xs uppercase text-white/60 hover:text-white hover:bg-white/10 rounded-lg transition-all border border-white/15';
  const pillGreen = 'px-3 py-1 text-xs uppercase text-[var(--brand-tnt)] hover:bg-[var(--brand-tnt)]/15 rounded-lg transition-all border border-[var(--brand-tnt)]/40 disabled:opacity-40';

  return (
    <div
      className="mt-2 pt-2 border-t border-white/10 flex flex-col gap-1.5"
      style={{ fontFamily: 'var(--font-condensed)', letterSpacing: '0.12em' }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="px-3 py-1.5 text-xs uppercase text-white/60 hover:text-white hover:bg-white/10 rounded-lg transition-all text-right flex items-center justify-end gap-2"
        style={{ fontWeight: 700 }}
      >
        Display Settings
        <span style={{ letterSpacing: 0 }}>{open ? '▴' : '⚙️'}</span>
      </button>
      {open && (
        <div className="px-3 pb-1 flex flex-col items-end gap-1.5">
          <label className="text-[0.6rem] uppercase text-white/45" style={{ fontWeight: 700 }}>
            Display login
          </label>
          {loginStatus !== 'logged-in' ? (
            <>
              <div className="flex items-center gap-1.5">
                <input
                  className={inputStyle}
                  type={reveal ? 'text' : 'password'}
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && canLogin) doLogin(); }}
                  placeholder="display passphrase"
                  spellCheck={false}
                  autoComplete="off"
                  disabled={!secure || busy}
                  aria-label="Display passphrase"
                />
                <button
                  onClick={() => setReveal((v) => !v)}
                  aria-pressed={reveal}
                  className="px-2 py-0.5 text-[0.6rem] uppercase text-white/60 hover:text-white rounded"
                  style={{ fontWeight: 700 }}
                >
                  {reveal ? 'Hide' : 'Show'}
                </button>
              </div>
              <button
                onClick={doLogin}
                disabled={!canLogin}
                className={pillGreen}
                style={{ fontWeight: 800 }}
              >
                Log in
              </button>
            </>
          ) : (
            <button
              onClick={confirmLogout}
              className={pillGrey}
              style={{ fontWeight: 800 }}
            >
              Log out
            </button>
          )}
          <p className={`pj-panel-note text-[0.75rem] text-right ${toneClass}`}>
            {loginNote || loginLine}
          </p>

          <button
            onClick={() => setAdvanced((v) => !v)}
            className="px-2 py-0.5 text-[0.6rem] uppercase text-white/45 hover:text-white rounded transition-all"
            style={{ fontWeight: 700 }}
          >
            {advanced ? '▴ Advanced' : '▾ Advanced (paste keys by hand)'}
          </button>
          {advanced && (
            <>
              <label className="text-[0.6rem] uppercase text-white/45" style={{ fontWeight: 700 }}>
                Live data key (Pusher, public)
              </label>
              <input
                className={inputStyle}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="public key — blank = off"
                spellCheck={false}
                aria-label="Pusher app key"
              />
              <input
                className={inputStyle}
                value={cluster}
                onChange={(e) => setCluster(e.target.value)}
                placeholder="cluster (us2)"
                spellCheck={false}
                aria-label="Pusher cluster"
              />
              <button
                onClick={save}
                className="px-3 py-1 text-xs uppercase text-[var(--brand-tnt)] hover:bg-[var(--brand-tnt)]/15 rounded-lg transition-all border border-[var(--brand-tnt)]/40"
                style={{ fontWeight: 800 }}
              >
                Save
              </button>
              <p className="pj-panel-note text-[0.7rem] text-white/50 text-right">
                {saved ? 'Saved — applies immediately' : 'Powers live counts + birthday sync'}
              </p>

              <label className="text-[0.6rem] uppercase text-white/45 mt-1" style={{ fontWeight: 700 }}>
                Display key (names + birthdays)
              </label>
              {!secure ? (
                <p className="pj-panel-note text-[0.75rem] text-[var(--brand-hot)] text-right">
                  Insecure page — encrypted names cannot be read here. Open this page over https://
                </p>
              ) : displayKey && !editingKey ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-white/80" style={{ fontFamily: 'monospace', letterSpacing: 0 }}>
                    {maskDisplayKey(displayKey)}
                  </span>
                  <button onClick={() => setEditingKey(true)} className={pillGrey} style={{ fontWeight: 800 }}>Replace</button>
                  <button
                    onClick={confirmRemoveKey}
                    className={pillGrey}
                    style={{ fontWeight: 800 }}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <input
                    className={inputStyle}
                    type="password"
                    value={keyDraft}
                    onChange={(e) => setKeyDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveKey(); }}
                    placeholder="paste the 44-character key"
                    spellCheck={false}
                    autoComplete="off"
                    aria-label="Display key"
                  />
                  <button disabled={!isPlausibleKey(keyDraft.trim())} onClick={saveKey} className={pillGreen} style={{ fontWeight: 800 }}>
                    Save key
                  </button>
                  {editingKey && (
                    <button onClick={() => { setEditingKey(false); setKeyDraft(''); }} className={pillGrey} style={{ fontWeight: 800 }}>
                      Cancel
                    </button>
                  )}
                </div>
              )}
              {keyNote && (
                <p className="pj-panel-note text-[0.7rem] text-white/60 text-right">{keyNote}</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

const NavButton = ({ label, active, dotColor, onClick, touch = false }) => (touch ? (
  <button type="button" onClick={onClick} className={`pj-sheet__row${active ? ' is-on' : ''}`} aria-current={active ? 'true' : undefined}>
    <span className="pj-sheet__dot" style={dotColor ? { backgroundColor: dotColor } : undefined} aria-hidden="true" />
    <span className="pj-sheet__grow">{label}</span>
  </button>
) : (
  <button
    onClick={onClick}
    className={`px-3 py-1.5 text-xs uppercase rounded-lg transition-all text-right flex items-center justify-end gap-2 ${
      active ? 'text-[var(--brand-ink)] bg-white' : 'text-white/60 hover:text-white hover:bg-white/10'
    }`}
    style={{ fontFamily: 'var(--font-condensed)', fontWeight: 700, letterSpacing: '0.12em' }}
  >
    {label}
    {dotColor && (
      <span
        className="inline-block w-2 h-2 rounded-full flex-shrink-0"
        style={{ backgroundColor: dotColor }}
      />
    )}
  </button>
));
