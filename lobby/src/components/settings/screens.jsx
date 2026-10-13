import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { PanelCard, RemoteScreenContext, Toggle } from './fields.jsx';
import { useSync } from '../../hooks/useSync.js';
import {
  forgetScreen, listScreens, loadScreen, renameScreen, saveScreenSettings, sendScreenAction,
} from '../../hooks/useScreenSync.js';
import { SCREEN_SPECS, sanitizeScreenSettings } from '../../lib/syncSpecs.js';

// The settings page's Screens (ROADMAP.md#settings-page, phase 2): every screen signed in
// with the passphrase, and the way into any one's own settings. A lobby TV
// opens in the SAME Settings panel (RemoteScreenPanel in SettingsPanel's
// place, its "This screen" cards reading and writing the TV's settings in the
// sync Worker); the other kinds have a handful of switches, edited right in
// their row.

/** How often the list re-reads while it is open (a hello lands every 2 min). */
export const SCREENS_REFRESH_MS = 20 * 1000;

const KINDS = [
  { kind: 'lobby', title: 'Lobby TVs', tab: 'var(--brand-blue)' },
  { kind: 'projector', title: 'Projectors', tab: 'var(--brand-trek)' },
  { kind: 'journey', title: 'Journey kiosks', tab: 'var(--brand-journey)' },
  { kind: 'computer', title: 'Computers', tab: 'var(--brand-sparks)' },
];

/** "just now", "4 min ago", "today 6:10 PM", "Tue 7:42 PM". @param {string} at @param {number} now */
export function seenWords(at, now = Date.now()) {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return 'never';
  const min = Math.round((now - t) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const d = new Date(t);
  const sameDay = d.toDateString() === new Date(now).toDateString();
  return d.toLocaleString([], sameDay ? { hour: 'numeric', minute: '2-digit' } : { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

/** "just now", "12 min ago", "2 h ago", "3 days ago". @param {string | null} at @param {number} now */
export function agoWords(at, now = Date.now()) {
  const t = at ? Date.parse(at) : NaN;
  if (!Number.isFinite(t)) return '';
  const min = Math.max(0, Math.round((now - t) / 60000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

const GIB = 1024 ** 3;
/** "11.2 GB" / "640 MB", as the kiosk's own Settings counts them. @param {number} n */
export function lessonBytes(n) {
  const v = Math.max(0, Number(n) || 0);
  return v >= GIB ? `${(v / GIB).toFixed(1)} GB` : `${Math.round(v / 1024 ** 2)} MB`;
}

/**
 * A Journey kiosk's saved lessons in plain words (its hello's `status.lessons`,
 * sanitized by the Worker). null without a status. `known`/`supported` missing
 * (an older kiosk page) count as true.
 * @param {any} l
 * @param {number} [now]
 * @returns {{ done: boolean, phase: 'done' | 'saving' | 'checking' | 'unsupported' | 'no-list',
 *   count: string, state: string, error: string, saved: string } | null}
 */
export function lessonStatusWords(l, now = Date.now()) {
  if (!l || typeof l !== 'object') return null;
  /** @param {'checking' | 'unsupported' | 'no-list'} phase @param {string} count */
  const only = (phase, count) => ({ done: false, phase, count, state: '', error: '', saved: '' });
  if (l.supported === false) return only('unsupported', "Lessons can't be saved on this device");
  if (l.known === false) return only('checking', 'Lessons: checking this computer…');
  if (!(l.total > 0)) return only('no-list', 'Lessons: the lesson list has not loaded yet');
  const done = l.saved >= l.total;
  const count = done ? `${l.total} of ${l.total} · ${lessonBytes(l.bytesTotal)}`
    : `Lessons: ${l.saved} of ${l.total} saved${l.bytesSaved > 0 ? ` · ${lessonBytes(l.bytesSaved)}` : ''}`;
  let state = '';
  if (!done) {
    if (l.downloading) state = `${l.percent}% · downloading${l.currentWeek ? ` Lesson ${l.currentWeek}` : ''}`;
    else if (l.paused) state = 'paused';
    else if (l.waiting) state = 'waiting: carries on by itself after the lesson';
    else if (!l.auto) state = 'automatic download is off here';
  }
  const ago = agoWords(l.lastSavedAt, now);
  return {
    done,
    phase: done ? 'done' : 'saving',
    count,
    state,
    error: typeof l.error === 'string' && l.error ? `Problem: ${l.error}` : '',
    saved: ago ? `last saved ${ago}` : '',
  };
}

/**
 * A computer's KVBC Awana app in plain words (its hello's `status.app`):
 * "KVBC Awana 9.4.0 · up to date", "· downloading update 42%", "· update
 * ready, installing when idle", "· update could not finish downloading".
 * null without a status.
 * @param {any} a
 * @returns {{ version: string, update: string, warn: boolean } | null}
 */
export function appStatusWords(a) {
  if (!a || typeof a !== 'object' || typeof a.version !== 'string' || !a.update) return null;
  const state = a.update.state;
  const update = state === 'downloading' ? `downloading update ${Number(a.update.percent) || 0}%`
    : state === 'ready' ? 'update ready, installing when idle'
      : state === 'error' ? 'update could not finish downloading'
        : 'up to date';
  return { version: `KVBC Awana ${a.version}`, update, warn: state === 'error' };
}

/** A TV's or projector's page build in plain words (its hello's `status.page`). @param {any} p */
export function pageStatusWords(p) {
  if (!p || typeof p !== 'object') return null;
  return typeof p.build === 'string' && p.build ? `Page version ${p.build}` : 'Page version unknown';
}

/** What a row says before its screen has reported anything (an older page or app sends none). @param {{kind: string, online: boolean}} s */
export function noStatusWords(s) {
  if (s.kind === 'computer') return 'Version and updates show here once this computer has the newest KVBC Awana app';
  return s.online ? 'Checking…' : 'Nothing reported yet';
}

/**
 * The one status line under a row's On now / Off line, in its kind's words;
 * greyed while the screen is off (the last it said).
 * @param {{ screen: any }} props
 */
export function ScreenStatusLine({ screen }) {
  const cls = `screen-row__status${screen.online ? '' : ' screen-row__status--stale'}`;
  const st = screen.status;
  if (screen.kind === 'journey' && st?.lessons) {
    const w = lessonStatusWords(st.lessons);
    if (w) {
      return (
        <span className={cls} data-status="lessons" data-lessons={w.phase}>
          {w.done && <><strong className="screen-row__done">All saved ✓</strong> · </>}
          {w.count}
          {w.state && <> · {w.state}</>}
          {w.saved && <> · {w.saved}</>}
          {w.error && <span className="screen-row__problem">{w.error}</span>}
        </span>
      );
    }
  }
  if (screen.kind === 'computer' && st?.app) {
    const w = appStatusWords(st.app);
    if (w) {
      return (
        <span className={cls} data-status="app" data-update={st.app.update.state}>
          {w.version} · {w.warn ? <span className="screen-row__warn">{w.update}</span> : w.update}
        </span>
      );
    }
  }
  if ((screen.kind === 'lobby' || screen.kind === 'projector') && st?.page) {
    const words = pageStatusWords(st.page);
    if (words) return <span className={cls} data-status="page">{words}</span>;
  }
  return <span className={cls} data-status="none">{noStatusWords(screen)}</span>;
}

/** A line drawing of the device, in the row's ink. @param {{kind: string}} props */
export function ScreenGlyph({ kind }) {
  const common = { width: 28, height: 28, viewBox: '0 0 28 28', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  if (kind === 'projector') {
    return <svg {...common}><rect x="3" y="9" width="22" height="11" rx="3" /><circle cx="18" cy="14.5" r="3" /><path d="M7 20v2M21 20v2M7 13h4" /></svg>;
  }
  if (kind === 'journey') {
    return <svg {...common}><rect x="6" y="3" width="16" height="22" rx="3" /><path d="M12 9.5l5 3.5-5 3.5z" /></svg>;
  }
  if (kind === 'computer') {
    return <svg {...common}><rect x="5" y="5" width="18" height="12" rx="2" /><path d="M2.5 22h23M8 17l-2 5M20 17l2 5" /></svg>;
  }
  return <svg {...common}><rect x="3" y="5" width="22" height="14" rx="2.5" /><path d="M10 23h8M14 19v4" /></svg>;
}

/** On now / Off, as a dot and a word. @param {{online: boolean}} props */
export function ScreenState({ online }) {
  return <span className={`screen-state screen-state--${online ? 'on' : 'off'}`}><span className="dot" />{online ? 'On now' : 'Off'}</span>;
}

// ── The list ────────────────────────────────────────────────────────────────

/**
 * @param {{ onOpen: (screen: any) => void, goTo?: (id: string) => void }} props
 */
export function ScreensSection({ onOpen, goTo }) {
  const { signedIn } = useSync();
  const [state, setState] = useState(/** @type {{screens: any[] | null, error: string, loading: boolean}} */ ({ screens: null, error: '', loading: false }));
  const [open, setOpen] = useState(/** @type {string | null} */ (null));

  const load = useCallback(() => listScreens().then((res) => {
    setState(res.ok ? { screens: res.screens, error: '', loading: false } : (s) => ({ ...s, error: res.message, loading: false }));
  }), []);
  const refresh = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    load();
  }, [load]);

  useEffect(() => {
    if (!signedIn) return undefined;
    load();
    const t = setInterval(load, SCREENS_REFRESH_MS);
    return () => clearInterval(t);
  }, [signedIn, load]);

  if (!signedIn) {
    return (
      <PanelCard title="Screens">
        <p className="hint panel-intro">Sign in with the church passphrase to see every screen and change any one of them from here.</p>
        {goTo && <button type="button" className="secondary section-jump" onClick={() => goTo('account')}>Sign in →</button>}
      </PanelCard>
    );
  }

  const screens = state.screens || [];
  const groups = KINDS.map((k) => ({ ...k, list: screens.filter((s) => s.kind === k.kind) })).filter((g) => g.list.length);
  const online = screens.filter((s) => s.online).length;

  return (
    <>
      <div className="panel-note screens-summary" role="status">
        {state.screens === null && !state.error ? 'Looking for screens…'
          : screens.length === 0 ? 'No screens yet.'
            : <><strong>{online} of {screens.length}</strong> {screens.length === 1 ? 'screen is' : 'screens are'} on now.</>}
        {' '}
        <button type="button" className="ghost small" onClick={refresh} disabled={state.loading}>{state.loading ? 'Checking…' : 'Check again'}</button>
        {state.error && <span className="hint hint--warn"> {state.error}</span>}
      </div>

      {state.screens !== null && screens.length === 0 && (
        <PanelCard title="How a screen shows up">
          <p className="hint panel-intro">
            Sign a screen in with the passphrase (a TV&rsquo;s or the projector&rsquo;s Settings → Account & app, a Journey
            kiosk&rsquo;s Settings → Sync) and it appears here within a couple of minutes, named &ldquo;Lobby TV&rdquo;,
            &ldquo;Projector&rdquo; or &ldquo;Journey kiosk&rdquo; until you rename it.
          </p>
        </PanelCard>
      )}

      {groups.map((g) => (
        <PanelCard key={g.kind} title={g.title} tab={g.tab}>
          <ul className="screen-list">
            {g.list.map((s) => (
              <li key={s.id} className={`screen-row${open === s.id ? ' is-open' : ''}`} data-screen={s.id}>
                <div className="screen-row__main">
                  <span className="screen-row__glyph"><ScreenGlyph kind={s.kind} /></span>
                  <span className="screen-row__text">
                    <span className="screen-row__name">{s.name}</span>
                    <span className="screen-row__meta"><ScreenState online={s.online} /> · {s.online ? 'seen' : 'last seen'} {seenWords(s.lastSeen)}
                      {s.pendingRoleChange?.printRole === false && <> · <span className="hint--warn">prints no labels once the last one is out</span></>}</span>
                    <ScreenStatusLine screen={s} />
                  </span>
                  {s.kind === 'lobby' ? (
                    <button type="button" className="secondary small" onClick={() => onOpen(s)} aria-label={`Open settings for ${s.name}`}>
                      Open settings
                    </button>
                  ) : (
                    <button type="button" className="secondary small" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)}
                      aria-label={`${open === s.id ? 'Close' : 'Open'} settings for ${s.name}`}>
                      {open === s.id ? 'Close' : 'Open settings'}
                    </button>
                  )}
                </div>
                {open === s.id && <KindSettings screen={s} goTo={goTo} onChanged={refresh} onGone={() => { setOpen(null); refresh(); }} />}
              </li>
            ))}
          </ul>
        </PanelCard>
      ))}
    </>
  );
}

// ── A projector, Journey kiosk or computer, edited in its row ───────────────

const FIELD_WORDS = {
  lowPower: { title: 'Low power', hint: 'No motion on the wall: for a weak projector PC.' },
  stingers: { title: 'Countdown chimes', hint: 'The chimes as the countdown runs out.' },
  printRole: { title: 'Prints labels', hint: 'Prints the check-in labels. Turned off mid-print, it waits for the last label, then restarts.', confirm: true },
  displayRole: { title: 'Display', hint: 'Shows a screen on its monitor on club nights.', confirm: true },
  displayFrom: { title: 'Display from', hint: 'Club nights only.' },
  displayUntil: { title: 'Display until', hint: '' },
};

/**
 * A Journey kiosk's own two settings (its lesson downloads) live with its
 * download buttons under Journey → Lessons on the Journey PCs, so its row
 * points there instead of repeating them.
 */
const ELSEWHERE = { journey: new Set(['downloadsAuto', 'downloadsLeader']) };

/** @param {{ screen: any, onChanged: () => void, onGone: () => void, goTo?: (id: string) => void }} props */
function KindSettings({ screen, onChanged, onGone, goTo }) {
  const [settings, setSettings] = useState(/** @type {Record<string, any> | null} */ (null));
  const [note, setNote] = useState(/** @type {{text: string, warn?: boolean} | null} */ (null));
  useEffect(() => {
    let live = true;
    loadScreen(screen.id).then((res) => {
      if (!live) return;
      if (res.ok) setSettings(res.settings?.settings ?? {});
      else setNote({ warn: true, text: res.message });
    });
    return () => { live = false; };
  }, [screen.id]);

  /** @param {string} key @param {unknown} value */
  const change = async (key, value) => {
    const words = /** @type {any} */ (FIELD_WORDS)[key];
    const ask = key === 'printRole' && value === false
      ? `Turn off label printing on ${screen.name}? If a label is printing or waiting, it finishes first; then ${screen.name} restarts without it.`
      : `${value ? 'Turn on' : 'Turn off'} ${words?.title.toLowerCase()} on ${screen.name}?`;
    const next = sanitizeScreenSettings(screen.kind, { ...(settings || {}), [key]: value });
    // A computer refuses both roles off and hours that end before they start
    // (it would put its own copy back two minutes later), so say so here.
    if (screen.kind === 'computer') {
      if (next.printRole === false && next.displayRole === false) {
        setNote({ warn: true, text: `${screen.name} needs at least one role: turn the other one on first.` });
        return;
      }
      if (typeof next.displayFrom === 'string' && typeof next.displayUntil === 'string' && next.displayFrom >= next.displayUntil) {
        setNote({ warn: true, text: 'Not saved: "Display from" has to be before "Display until", the same evening.' });
        return;
      }
    }
    if (words?.confirm && !window.confirm(ask)) return;
    setSettings(next);
    const res = await saveScreenSettings(screen.id, screen.kind, next);
    setNote(res.ok ? { text: `Saved. ${screen.name} takes it ${screen.kind === 'computer' ? 'within 2 minutes' : 'within seconds'}${screen.online ? '' : ' of coming on'}.` } : { warn: true, text: res.message || 'Not saved.' });
  };

  const spec = /** @type {Record<string, any>} */ (SCREEN_SPECS[/** @type {'projector'} */ (screen.kind)] || {});
  const elsewhere = /** @type {Record<string, Set<string>>} */ (ELSEWHERE)[screen.kind];
  return (
    <div className="screen-row__body">
      {settings === null && !note && <p className="hint">Opening…</p>}
      {screen.kind === 'journey' && (
        <p className="hint">
          Its saved lessons, the download buttons and its two download switches are under Journey.
          {goTo && <>{' '}<button type="button" className="ghost small" onClick={() => goTo('journey')}>Lessons on the Journey PCs →</button></>}
        </p>
      )}
      {settings !== null && Object.entries(spec).filter(([key]) => !elsewhere?.has(key)).map(([key, rule]) => {
        const words = /** @type {any} */ (FIELD_WORDS)[key] || { title: key, hint: '' };
        const id = `${screen.id}-${key}`;
        if (rule.type === 'bool') {
          return <Toggle key={key} checked={settings[key] === true} onChange={(e) => change(key, e.target.checked)} title={words.title} hint={words.hint} />;
        }
        if (rule.type === 'enum') {
          return (
            <div className="field" key={key}>
              <label htmlFor={id}>{words.title}</label>
              <select id={id} value={settings[key] ?? rule.values[0]} onChange={(e) => change(key, e.target.value)}>
                {rule.values.map((v) => <option key={v} value={v}>{words.options?.[v] ?? v}</option>)}
              </select>
              {words.hint && <span className="hint">{words.hint}</span>}
            </div>
          );
        }
        return (
          <div className="field" key={key}>
            <label htmlFor={id}>{words.title}</label>
            <input id={id} type="time" defaultValue={settings[key] ?? ''} onBlur={(e) => { if (e.target.value && e.target.value !== settings[key]) change(key, e.target.value); }} />
            {words.hint && <span className="hint">{words.hint}</span>}
          </div>
        );
      })}
      <ScreenNameAndForget screen={screen} onRenamed={onChanged} onForgotten={onGone} />
      {note && <p className={`hint${note.warn ? ' hint--warn' : ''}`} role="status">{note.text}</p>}
    </div>
  );
}

/** Rename and forget, shared by a row and a lobby TV's overview. */
function ScreenNameAndForget({ screen, onRenamed, onForgotten }) {
  const [name, setName] = useState(screen.name);
  const [note, setNote] = useState(/** @type {{text: string, warn?: boolean} | null} */ (null));
  const id = `name-${screen.id}`;
  const save = async () => {
    if (!name.trim() || name.trim() === screen.name) { setName(screen.name); return; }
    const res = await renameScreen(screen.id, name);
    setNote(res.ok ? { text: 'Renamed.' } : { warn: true, text: res.message || 'Not renamed.' });
    if (res.ok) { setName(res.name || name); onRenamed?.(res.name || name); }
  };
  const forget = async () => {
    if (!window.confirm(`Forget ${screen.name}? Its settings here are deleted. If it is still running, it shows up again within a few minutes with the settings it has.`)) return;
    const res = await forgetScreen(screen.id);
    if (res.ok) onForgotten?.();
    else setNote({ warn: true, text: res.message || 'Not forgotten.' });
  };
  return (
    <>
      <div className="field">
        <label htmlFor={id}>Name</label>
        <div className="lookup-row">
          <input id={id} type="text" maxLength={40} value={name} autoComplete="off"
            onChange={(e) => setName(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
          <button type="button" className="danger" onClick={forget}>Forget</button>
        </div>
        <span className="hint" role="status">
          {note && <><strong className={note.warn ? 'hint--warn' : undefined}>{note.text}</strong> </>}
          What this list calls it. Forget a screen that is gone for good.
        </span>
      </div>
    </>
  );
}

// ── A lobby TV opened from the list: its Status ─────────────────────────────

/**
 * The opened screen's own Status: whether it is on, the buttons that act on
 * it, its name. Shown in the Status section's place.
 * @param {{ screen: any, following: boolean, onAction: (action: string) => void, onRenamed: (name: string) => void,
 *   onForgotten: () => void, goTo: (id: string) => void }} props
 */
export function ScreenOverviewSection({ screen, following, onAction, onRenamed, onForgotten, goTo }) {
  const remote = useContext(RemoteScreenContext);
  return (
    <>
      <PanelCard title={remote?.name || screen.name} tab="var(--brand-blue)">
        <p className="screen-overview__state">
          <ScreenState online={screen.online} />
          <span className="hint"> {screen.online ? 'Seen' : 'Last seen'} {seenWords(screen.lastSeen)}.</span>
        </p>
        <p className="hint panel-intro">
          Every card tagged <strong>{screen.name} only</strong> in these sections is this TV&rsquo;s own: a change reaches it within
          seconds{screen.online ? '' : ', or when it next comes on'}. Cards tagged <strong>Every screen</strong> change every screen.
        </p>
        {!following && (
          <p className="hint hint--warn">
            This TV keeps its own values for the settings tagged Every screen (Account & app → Church-wide settings is off), so those are left out here.
          </p>
        )}
        <ScreenNameAndForget screen={screen} onRenamed={onRenamed} onForgotten={onForgotten} />
      </PanelCard>

      <PanelCard title="On the screen" tab="var(--brand-hot)">
        <div className="tool-grid">
          <div className="tool">
            <button type="button" className="ghost" onClick={() => onAction('preview-checkin')}>Preview a check-in</button>
            <span className="hint">A sample welcome on {screen.name}. It shows the demo badge there until it reloads.</span>
          </div>
          <div className="tool">
            <button type="button" className="ghost" onClick={() => onAction('board-demo')}>Show the pickup demo</button>
            <span className="hint">The pickup board with sample names, about 20 seconds, on {screen.name} only.</span>
          </div>
          <div className="tool">
            <button type="button" className="ghost"
              onClick={() => { if (window.confirm(`Reset tonight's counter on ${screen.name} to zero? It re-syncs from the next count.`)) onAction('reset-tally'); }}>
              Reset tonight&rsquo;s counter
            </button>
            <span className="hint">Back to zero until the printer&rsquo;s next count; the &ldquo;Doors are open&rdquo; moment can play again.</span>
          </div>
        </div>
        <button type="button" className="secondary section-jump" onClick={() => goTo('show')}>Its corner, chime and motion →</button>
      </PanelCard>
    </>
  );
}

/**
 * The opened TV's settings and its calls, for SettingsPanel: loads the TV's
 * own layer from the Worker, and writes every change back as the whole layer
 * (in order, one at a time). `ready` is false until loaded.
 * @param {{id: string, kind: string}} screen
 */
export function useRemoteScreen(screen) {
  const [loaded, setLoaded] = useState(/** @type {{screen: any, settings: Record<string, unknown>} | null} */ (null));
  const [error, setError] = useState('');
  const [note, setNote] = useState(/** @type {{text: string, warn?: boolean} | null} */ (null));
  const current = useRef(/** @type {Record<string, unknown>} */ ({}));
  const chain = useRef(Promise.resolve());

  useEffect(() => {
    let live = true;
    loadScreen(screen.id).then((res) => {
      if (!live) return;
      if (!res.ok) { setError(res.message || 'Could not open it.'); return; }
      const settings = sanitizeScreenSettings(/** @type {'lobby'} */ (screen.kind), res.settings?.settings);
      current.current = settings;
      setLoaded({ screen: res.screen, settings });
    });
    return () => { live = false; };
  }, [screen.id, screen.kind]);

  /** @param {Record<string, unknown>} next */
  const write = useCallback((next) => {
    const kind = /** @type {'lobby'} */ (screen.kind);
    current.current = sanitizeScreenSettings(kind, next);
    const snapshot = current.current;
    chain.current = chain.current.then(async () => {
      const res = await saveScreenSettings(screen.id, kind, snapshot);
      setNote(res.ok ? null : { warn: true, text: `Not saved: ${res.message}` });
    });
  }, [screen.id, screen.kind]);

  return {
    ready: Boolean(loaded),
    error,
    note,
    setNote,
    screen: loaded?.screen ?? screen,
    settings: loaded?.settings ?? {},
    /** A patch from the panel: its keys this screen keeps, merged in. @param {Record<string, unknown>} patch */
    change: (patch) => write({ ...current.current, ...patch }),
    /** Undo: the layer exactly as it was. @param {Record<string, unknown>} layer */
    replace: (layer) => write(layer),
    /** @param {string} action */
    act: async (action) => {
      const res = await sendScreenAction(screen.id, action);
      const name = loaded?.screen?.name ?? '';
      setNote(!res.ok ? { warn: true, text: res.message || 'Not sent.' }
        : res.delivered ? { text: `Sent to ${name}.` }
          : { warn: true, text: `${name} is not on right now, so it did not see that.` });
    },
  };
}
