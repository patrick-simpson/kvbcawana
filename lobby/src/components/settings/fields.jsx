import { createContext, useContext, useEffect, useId, useState } from 'react';
import { parseMilestoneList } from '../../lib/milestones.js';
import { deleteDeck, getDeck, putDeck } from '../../lib/pptxStore.js';
import { BACKGROUND_VIDEO_ID, deleteVideo, getVideo, putVideo } from '../../lib/videoStore.js';
import { BACKGROUND_VIDEO_CHANGED_EVENT } from '../VideoBackground.jsx';
import { parseAndCacheDeck } from '../../lib/pptxModel.js';
import { useDisplayKey } from '../../hooks/useDisplayKey.js';
import { maskDisplayKey } from '../../lib/displayKey.js';
import { isPlausibleKey } from '../../lib/envelope.js';
import { loadPublishToken, maskPublishToken, savePublishToken } from '../../lib/publishToken.js';
import CornerTab from '../brand/CornerTab.jsx';
import { changePassphrase, loadFriendsReport, printBarfBags, saveTemplate, signIn, signOut, testCloudCheckin, useSync } from '../../hooks/useSync.js';
import { RELEASE_NOTES_URL, parseReleaseNotes } from '../../lib/releaseNotes.js';
import { useConfig } from '../../hooks/useConfig.js';
import { PASSPHRASE_MIN, TEMPLATE_KEYS } from '../../lib/syncSpecs.js';
import { renameThisScreen, useThisScreen } from '../../hooks/useScreenSync.js';

// The Settings panel's building blocks: rows, cards, and the fields that keep
// their own storage (the three secrets, the uploaded files) and so are never
// part of the panel's config form.

export const INSECURE_CONTEXT_COPY = (
  <>
    <strong>This page is not in a secure context</strong>, so this browser cannot read encrypted names at
    all — logging in or pasting a key by hand will not help. Open the display over <code>https://</code>{' '}
    (or <code>http://localhost</code>).
  </>
);

// A real <label>: the whole row — title and hint — is the hit target, and
// the checkbox gets an accessible name (getByRole('checkbox', { name })).
// A comma-separated threshold list ("5, 10, 25"). The TEXT is local state and
// the parsed array is what reaches the form: parsing on every keystroke while
// rendering `value.join(', ')` back would eat a trailing comma the moment it
// was typed, so the two are deliberately kept apart.
export function MilestoneListField({ id, label, hint, value, onChange }) {
  const [text, setText] = useState(() => (Array.isArray(value) ? value : []).join(', '));
  const parsed = parseMilestoneList(text);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        maxLength={80}
        value={text}
        placeholder="5, 10, 25"
        onChange={(e) => {
          setText(e.target.value);
          onChange(parseMilestoneList(e.target.value));
        }}
      />
      <span className="hint">
        {hint}
        {/* Echo what was actually understood — whole numbers only, sorted and
            de-duplicated — so a typo is visible at once, not after club. */}
        {parsed.length > 0
          ? <> Celebrating at {parsed.join(', ')}.</>
          : <> Nothing set — these celebrations are off.</>}
      </span>
    </div>
  );
}

export function Toggle({ checked, onChange, title, hint, disabled }) {
  const id = useId();
  return (
    <label className="toggle">
      <span className="toggle-copy">
        <span className="toggle-title" id={`${id}-t`}>{title}</span>
        {hint ? <span className="hint" id={`${id}-h`}>{hint}</span> : null}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        aria-labelledby={`${id}-t`}
        aria-describedby={hint ? `${id}-h` : undefined}
      />
    </label>
  );
}

// Whether this screen follows the shared settings (contract v6): the card tags
// say "Every screen" only while it does.
export const FollowingContext = createContext(true);
// True on awana.kvbchurch.org/settings (SETTINGS.md): the device is not a
// screen, so a "This screen" card has nothing to set and is left out unless
// it is marked `keep` (signing in, the slide editor).
export const SettingsPageContext = createContext(false);
// On the settings page, a screen opened from Screens (SETTINGS.md, phase 2):
// {id, kind, name}, else null. Its "This screen" cards come back, reading and
// writing that screen's settings in the sync Worker; a card about THIS device
// (`local`: signing in, uploads, keys, tools) stays out.
export const RemoteScreenContext = createContext(/** @type {null | {id: string, kind: string, name: string}} */ (null));

/**
 * Where a card's settings apply: `shared` ones reach every screen through the
 * check-in computer (src/lib/sharedSettings.js), `screen` ones stay on this
 * one. A tag says so on the card, so nobody has to guess.
 */
function ScopeTag({ scope }) {
  const following = useContext(FollowingContext);
  const page = useContext(SettingsPageContext);
  const remote = useContext(RemoteScreenContext);
  if (!scope || (page && scope === 'screen' && !remote)) return null;
  const shared = scope === 'shared' && following;
  return (
    <span className={`scope-tag scope-tag--${shared ? 'shared' : 'screen'}`}
      title={shared
        ? 'Shared: a change here reaches every screen (made on the check-in computer).'
        : scope === 'shared' ? 'This screen is not following the shared settings, so these stay on this screen.'
          : remote ? `${remote.name} only.` : 'This screen only.'}>
      {shared ? 'Every screen' : remote ? `${remote.name} only` : 'This screen'}
    </span>
  );
}

// One white card on the panel's pale field, like the printer dashboard's
// cards. A titled card names its section with the kit's corner tab (the
// colour only tells the sections apart); the heading inside it is the same
// <h3 className="section"> the tab always had.
export function PanelCard({ title, tab = 'var(--brand-blue)', scope, keep = false, local = false, children }) {
  const page = useContext(SettingsPageContext);
  const remote = useContext(RemoteScreenContext);
  const following = useContext(FollowingContext);
  if (remote) {
    // A screen opened from the settings page: its own cards, and the shared
    // ones only while it follows them (else a change there would not reach it).
    if (local || (scope === 'shared' && !following)) return null;
  } else if (page && scope === 'screen' && !keep) return null;
  return (
    <div className="panel-card">
      {title ? (
        <div className="panel-card__head">
          <CornerTab color={tab} className="panel-card__tab">
            <h3 className="section">{title}</h3>
          </CornerTab>
          <ScopeTag scope={scope} />
        </div>
      ) : null}
      {children}
    </div>
  );
}

/**
 * Display login — the one thing a volunteer types on a new screen. The print
 * server publishes the display key + publish token sealed under a
 * passphrase-derived key; typing the passphrase here opens that frame and
 * fills both secrets in. Like the key and token fields below it, this is
 * deliberately NOT part of `form`/`set`: the derived login key lives in its
 * own storage slot (src/lib/displayLogin.js) so it never rides the settings
 * export, a `?config=` file, or a URL.
 */
export function DisplayLoginField({ status, secure, login }) {
  const { frameStatus, loginStatus, kid, pendingLogin } = login;
  const [draft, setDraft] = useState('');
  const [reveal, setReveal] = useState(false);
  const [note, setNote] = useState('');

  const busy = loginStatus === 'busy';
  const canSubmit = secure && !busy && draft.trim().length > 0;

  const submit = async () => {
    const p = draft.trim();
    if (!p || !canSubmit) return;
    setNote('');
    const result = await login.login(p);
    if (result === 'logged-in') { setDraft(''); setNote('Logged in. Names and published slides now work on this screen.'); }
    else if (result === 'storage') setNote('This screen cannot save the keys — browser storage is blocked.');
    // 'wrong', 'no-frame' and 'unsupported' are described by the status line below.
  };

  // In the order a volunteer needs them: the one thing nothing here can fix,
  // then the settled states, then whatever is standing between them and
  // logging in — starting with the socket, because the print server is
  // usually fine and the screen simply is not connected yet.
  let statusCopy;
  if (!secure || loginStatus === 'unsupported') {
    statusCopy = INSECURE_CONTEXT_COPY;
  } else if (loginStatus === 'logged-in') {
    statusCopy = <><strong>Logged in</strong>{kid ? <> · key <code>{kid}</code></> : null} — the display key and publish token were filled in automatically and will follow rotations on the print server.</>;
  } else if (loginStatus === 'stale') {
    statusCopy = <><strong>The display passphrase was changed on the print server.</strong> Names keep working with the key this screen already holds until you log in again.</>;
  } else if (busy) {
    statusCopy = <>Checking… (this takes a few seconds on a small TV stick — it only happens once)</>;
  } else if (status === 'off') {
    statusCopy = <><strong>This screen is not connected yet.</strong> It has no sync service to sign in to, so it cannot reach the live channel.</>;
  } else if (status === 'disconnected') {
    statusCopy = <><strong>Not connected</strong> — check the network. The print server is probably fine.</>;
  } else if (status === 'connecting') {
    statusCopy = <>Connecting… the login frame arrives as soon as the connection is up.</>;
  } else if (loginStatus === 'wrong') {
    statusCopy = <><strong>That passphrase does not match the print server’s.</strong> Check the dashboard → Settings → Display login and try again.</>;
  } else if (pendingLogin) {
    statusCopy = <><strong>Waiting for the print server’s login frame</strong> — this passphrase will be tried automatically the moment it arrives.</>;
  } else if (frameStatus === 'waiting') {
    statusCopy = <>Connected — waiting for the print server’s login frame. It must be running, with a display key <em>and</em> a display passphrase set (dashboard → Settings → Display login). You can type the passphrase now; it is tried as soon as the frame lands.</>;
  } else if (frameStatus === 'miss') {
    statusCopy = <><strong>The print server has not published a login frame in the last 30 minutes.</strong> Start it then try again.</>;
  } else {
    statusCopy = <>Type the church’s display passphrase from the print-server dashboard (Settings → Display login). This screen then receives the display key and publish token by itself.</>;
  }

  const loggedIn = loginStatus === 'logged-in';
  return (
    <div className="field">
      {!loggedIn ? (
        <>
          <label htmlFor="dlogin">Display login</label>
          <div className="display-key-row">
            <input
              id="dlogin"
              type={reveal ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) submit(); }}
              placeholder="display passphrase"
              disabled={!secure || busy}
            />
            <button
              type="button"
              className="ghost"
              aria-pressed={reveal}
              aria-label={reveal ? 'Hide passphrase' : 'Show passphrase'}
              onClick={() => setReveal((v) => !v)}
            >
              {reveal ? 'Hide' : 'Show'}
            </button>
            <button type="button" className="ghost" disabled={!canSubmit} onClick={submit}>Log in</button>
          </div>
        </>
      ) : (
        <>
          <span className="field-label" id="dlogin-label">Display login</span>
          <div className="display-key-row" role="group" aria-labelledby="dlogin-label">
            <code className="display-key-value">logged in{kid ? ` · key ${kid}` : ''}</code>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                if (window.confirm('Log this screen out? It forgets the login key, the display key and the publish token — names and published slides stop here until someone logs in again.')) {
                  login.logout();
                  setNote('');
                }
              }}
            >
              Log out
            </button>
          </div>
        </>
      )}
      <span className="hint">
        {note && <><strong>{note}</strong> </>}
        {statusCopy}
      </span>
    </div>
  );
}

/** "7:42 PM" today, else "Tue 7:42 PM". @param {number|string|null|undefined} at */
function whenWords(at) {
  if (at == null || at === '') return '';
  const d = new Date(at);
  if (!Number.isFinite(d.getTime())) return '';
  const sameDay = d.toDateString() === new Date().toDateString();
  return d.toLocaleString([], sameDay
    ? { hour: 'numeric', minute: '2-digit' }
    : { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

/**
 * Sign this screen in to the sync service with the church passphrase
 * (worker/). One word sets it up completely: the display key, the live
 * channel, the shared settings, the slides and, for a new screen, the template.
 * Shown instead of the print server's display login once shared/sync.json
 * names a sync service.
 */
export function SyncSignInField({ secure }) {
  const sync = useSync();
  const { config, overrides, updateConfig } = useConfig();
  const [draft, setDraft] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(/** @type {{text: string, warn?: boolean} | null} */ (null));

  const submit = async () => {
    const p = draft.trim();
    if (!p || busy || !secure) return;
    setBusy(true);
    setNote(null);
    const res = await signIn(p, { config, overrides, updateConfig });
    setBusy(false);
    if (res.ok) {
      setDraft('');
      setNote({ text: 'Signed in. This screen now has everything it needs, and changes made here reach every screen.' });
      return;
    }
    /** @type {any} */
    const err = res;
    if (err.reason === 'wrong') {
      const left = err.triesLeft;
      setNote({ warn: true, text: `That is not the passphrase.${Number.isFinite(left) ? ` ${left} ${left === 1 ? 'try' : 'tries'} left before a 15-minute wait.` : ''}` });
    } else if (err.reason === 'locked') {
      setNote({ warn: true, text: `Too many wrong tries. Try again in about ${Math.max(1, Math.ceil((err.retryAfterSec || 900) / 60))} minutes.` });
    } else {
      setNote({ warn: true, text: err.message });
    }
  };

  if (!sync.signedIn) {
    return (
      <div className="field">
        <label htmlFor="sync-pass">Passphrase</label>
        <div className="display-key-row">
          <input
            id="sync-pass"
            type={reveal ? 'text' : 'password'}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="go"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder="the church passphrase"
            disabled={!secure || busy}
          />
          <button
            type="button"
            className="ghost"
            aria-pressed={reveal}
            aria-label={reveal ? 'Hide passphrase' : 'Show passphrase'}
            onClick={() => setReveal((v) => !v)}
          >
            {reveal ? 'Hide' : 'Show'}
          </button>
          <button type="button" className="ghost" disabled={!secure || busy || !draft.trim()} onClick={submit}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
        <span className="hint" role="status">
          {note && <><strong className={note.warn ? 'hint--warn' : undefined}>{note.text}</strong> </>}
          {!secure
            ? INSECURE_CONTEXT_COPY
            : sync.phase === 'expired'
              ? <><strong>The passphrase was changed.</strong> Type the new one to sign this screen in again. Names keep working meanwhile.</>
              : <>Type the church&rsquo;s passphrase. This screen then gets the encryption key, the shared settings, the slides and the calendar by itself.</>}
        </span>
      </div>
    );
  }

  return (
    <div className="field">
      <span className="field-label" id="sync-label">Passphrase</span>
      <div className="display-key-row" role="group" aria-labelledby="sync-label">
        <code className="display-key-value">signed in{sync.kid ? ` · key ${sync.kid}` : ''}</code>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            if (window.confirm('Sign this screen out of the sync service? It keeps its key and settings, but stops receiving changes until someone types the passphrase again.')) {
              signOut();
              setNote(null);
            }
          }}
        >
          Sign out
        </button>
      </div>
      <span className="hint" role="status">
        {note && <><strong>{note.text}</strong> </>}
        {sync.phase === 'offline'
          ? <><strong>Cannot reach the sync service right now.</strong> This screen keeps what it has and tries again.</>
          : <>Synced{sync.lastSyncAt ? ` at ${whenWords(sync.lastSyncAt)}` : ''}. Changes made on any signed-in screen reach this one within seconds.</>}
      </span>
    </div>
  );
}

/** Change the church passphrase for every screen (needs the current one). */
export function ChangePassphraseField() {
  const sync = useSync();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(/** @type {{text: string, warn?: boolean} | null} */ (null));
  if (!sync.signedIn) return null;
  const mismatch = again !== '' && next.trim().toLowerCase() !== again.trim().toLowerCase();
  const tooShort = next.trim().length > 0 && next.trim().length < PASSPHRASE_MIN;
  const canSubmit = !busy && current.trim() && next.trim() && !mismatch && !tooShort && again.trim();
  const submit = async () => {
    if (!canSubmit) return;
    if (!window.confirm('Change the passphrase for EVERY screen?\n\nEvery other screen, and the check-in laptop, is signed out until someone types the new word on it, and the encryption key is replaced. This screen stays signed in.')) return;
    setBusy(true);
    const res = await changePassphrase(current, next);
    setBusy(false);
    if (res.ok) {
      setCurrent(''); setNext(''); setAgain('');
      setNote({ text: 'Changed. Type the new passphrase on every other screen, and sign the check-in laptop in first so check-ins keep showing.' });
    } else {
      setNote({ warn: true, text: res.message });
    }
  };
  return (
    <details className="advanced-fields">
      <summary>Change the passphrase</summary>
      <div className="field">
        <label htmlFor="pp-current">Current passphrase</label>
        <input id="pp-current" type="password" autoComplete="off" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="pp-next">New passphrase</label>
        <input id="pp-next" type="password" autoComplete="off" value={next} onChange={(e) => setNext(e.target.value)} />
        {tooShort && <span className="hint hint--warn">At least {PASSPHRASE_MIN} characters.</span>}
      </div>
      <div className="field">
        <label htmlFor="pp-again">New passphrase again</label>
        <input id="pp-again" type="password" autoComplete="off" value={again} onChange={(e) => setAgain(e.target.value)} />
        {mismatch && <span className="hint hint--warn">The two do not match.</span>}
      </div>
      <button type="button" className="ghost section-jump" disabled={!canSubmit} onClick={submit}>
        {busy ? 'Changing…' : 'Change it for every screen'}
      </button>
      <span className="hint" role="status">
        {note ? <strong className={note.warn ? 'hint--warn' : undefined}>{note.text}</strong>
          : 'Do this if the word got out. It signs every screen out and replaces the encryption key.'}
      </span>
    </details>
  );
}

/**
 * This screen's name on /settings (SETTINGS.md, phase 2). Shown once the
 * screen has registered with the sync service; saved on Enter or on leaving
 * the field.
 */
export function ScreenNameField() {
  const me = useThisScreen();
  const [draft, setDraft] = useState(/** @type {string | null} */ (null));
  const [note, setNote] = useState(/** @type {{text: string, warn?: boolean} | null} */ (null));
  if (!me.registered) return null;
  const value = draft ?? me.name;
  const save = async () => {
    if (draft == null || draft.trim() === me.name) { setDraft(null); return; }
    const res = await renameThisScreen(draft);
    setNote(res.ok ? { text: 'Saved.' } : { warn: true, text: res.message || 'Not saved.' });
    if (res.ok) setDraft(null);
  };
  return (
    <div className="field">
      <label htmlFor="screen-name">This screen&rsquo;s name</label>
      <input
        id="screen-name" type="text" maxLength={40} value={value} autoComplete="off"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
      />
      <span className="hint" role="status">
        {note && <><strong className={note.warn ? 'hint--warn' : undefined}>{note.text}</strong> </>}
        How the settings page lists this screen. Its own settings can be changed there from any phone or computer.
      </span>
    </div>
  );
}

/** Save this screen's per-screen settings as what new screens start from. */
export function TemplateField() {
  const sync = useSync();
  const { config } = useConfig();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(/** @type {{text: string, warn?: boolean} | null} */ (null));
  if (!sync.signedIn) return null;
  const save = async () => {
    setBusy(true);
    /** @type {Record<string, unknown>} */
    const picked = {};
    for (const key of TEMPLATE_KEYS) if (config[key] !== undefined) picked[key] = config[key];
    const res = await saveTemplate(picked);
    setBusy(false);
    setNote(res.ok ? { text: 'Saved. The next new screen signed in starts from these.' } : { warn: true, text: res.message });
  };
  return (
    <div className="field">
      <button type="button" className="ghost section-jump" disabled={busy} onClick={save}>
        Use this screen as the template for new screens
      </button>
      <span className="hint" role="status">
        {note ? <strong className={note.warn ? 'hint--warn' : undefined}>{note.text}</strong> : null}{' '}
        A screen signed in for the first time takes this screen&rsquo;s own settings (what plays behind the names,
        the chime, motion, confetti and the like) wherever it has none of its own.
        {sync.template?.savedAt ? ` Last saved ${whenWords(sync.template.savedAt)}.` : ' None saved yet.'}
      </span>
    </div>
  );
}

/**
 * Cloud check-in (CLOUD-CHECKIN.md): one button that has the sync service sign
 * in to TwoTimTwo as the church's check-in user and read the most recent club
 * night's report once (today's has no club tables on any other day),
 * so the owner can prove the secrets work before a club night. Read-only, and
 * the answer is counts only; TwoTimTwo allows one read every 15 seconds, so a
 * second press inside that reports the last read instead.
 */
export function CloudCheckinTestField() {
  const sync = useSync();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(/** @type {{text: string, ok: boolean} | null} */ (null));
  if (!sync.signedIn) return null;
  const run = async () => {
    setBusy(true);
    setNote(null);
    const res = await testCloudCheckin();
    setBusy(false);
    setNote(res);
  };
  return (
    <div className="field">
      <button type="button" className="ghost section-jump" disabled={busy} onClick={run}>
        {busy ? 'Signing in to TwoTimTwo…' : 'Test TwoTimTwo sign-in'}
      </button>
      <span className="hint" role="status">
        {note ? <strong className={note.ok ? undefined : 'hint--warn'}>{note.text}</strong> : null}{' '}
        The sync service signs in as the church&rsquo;s check-in user and reads the last club night&rsquo;s
        check-in report once. It changes nothing on TwoTimTwo and shows only a count.
      </span>
    </div>
  );
}

/**
 * BARF Night (owner, 2026-10-11): one press prints a BARF Bag label for each
 * child who brought a friend tonight and for each friend, as one job on the
 * label printer (through the sync service to the check-in laptop). It asks
 * first: a stray tap would spend a strip of labels.
 */
export function BarfBagsField() {
  const sync = useSync();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(/** @type {{text: string, ok: boolean} | null} */ (null));
  if (!sync.signedIn) return null;
  const run = async () => {
    if (!window.confirm('Print a BARF Bag label for every child who brought a friend tonight, and for each friend?')) return;
    setBusy(true);
    setNote(null);
    setNote(await printBarfBags());
    setBusy(false);
  };
  return (
    <div className="field">
      <button type="button" className="ghost section-jump" disabled={busy} onClick={run}>
        {busy ? 'Sending to the label printer…' : 'Print BARF Bag labels'}
      </button>
      <span className="hint" role="status">
        {note ? <strong className={note.ok ? undefined : 'hint--warn'}>{note.text}</strong> : null}{' '}
        One label each, &ldquo;SOPHIA&rsquo;S BARF BAG&rdquo;, for every child checked in with Brought a friend
        tonight and every friend whose name was typed, printed together on the check-in laptop&rsquo;s label printer.
      </span>
    </div>
  );
}

/** Tonight's "who brought a friend", grouped by club, on request (BARF Night). */
export function FriendsListField() {
  const sync = useSync();
  const [busy, setBusy] = useState(false);
  const [got, setGot] = useState(/** @type {any} */ (null));
  if (!sync.signedIn) return null;
  const run = async () => { setBusy(true); setGot(await loadFriendsReport()); setBusy(false); };
  const r = got && got.ok ? got.report : null;
  return (
    <div className="field">
      <button type="button" className="ghost section-jump" disabled={busy} onClick={run}>
        {busy ? 'Loading…' : r ? 'Refresh tonight’s list' : 'Show tonight’s list'}
      </button>
      {got && !got.ok && <span className="hint hint--warn" role="status">{got.text}</span>}
      {r && (
        <div className="release-notes" role="status">
          <p className="hint"><strong>{r.total} {r.total === 1 ? 'child' : 'children'} brought a friend tonight.</strong></p>
          {r.clubs.map((/** @type {any} */ c) => (
            <section key={c.club} className="release-notes__version">
              <h4>{c.club}</h4>
              {c.kids.map((/** @type {any} */ k) => (
                <p key={k.name} className="hint">{k.name}: {k.friend ? `brought ${k.friend}` : 'friend’s name not given'}</p>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The label printer's full release notes (owner, 2026-10-11), read from the
 * site (printer/changes.md, published by site/build.mjs). Loaded when opened.
 */
export function ReleaseNotesField() {
  const [notes, setNotes] = useState(/** @type {import('../../lib/releaseNotes.js').Section[] | null | 'error'} */ (null));
  const load = () => {
    if (notes) return;
    fetch(RELEASE_NOTES_URL, { cache: 'no-store' })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => { const parsed = parseReleaseNotes(t); setNotes(parsed.length ? parsed : 'error'); })
      .catch(() => setNotes('error'));
  };
  return (
    <details className="advanced-fields release-notes" onToggle={(e) => { if (e.currentTarget.open) load(); }}>
      <summary>Club Label Printer release notes</summary>
      {notes === null && <p className="hint">Loading…</p>}
      {notes === 'error' && <p className="hint hint--warn">The release notes could not be loaded. Check this screen&rsquo;s internet connection.</p>}
      {Array.isArray(notes) && notes.map((sec) => (
        <section key={sec.title} className="release-notes__version">
          <h4>{sec.title}</h4>
          {sec.paragraphs.map((runs, i) => (
            <p key={i} className="hint">{runs.map((r, j) => (r.bold ? <strong key={j}>{r.text}</strong> : <span key={j}>{r.text}</span>))}</p>
          ))}
        </section>
      ))}
    </details>
  );
}

/**
 * The display key — the secret that lets this screen read children's names.
 *
 * Deliberately NOT part of `form`/`set` like every other field on this panel.
 * `form` is the config overrides object, and that object is what
 * `exportSettings()` writes to a downloadable JSON file and what a
 * `?config=<url>` file can populate. Routing the key through it would publish
 * it through two workflows the docs actively recommend. See the long comment in
 * src/lib/displayKey.js; src/lib/displayKey.test.js asserts both stay closed.
 */
export function DisplayKeyField({ secure }) {
  const { displayKey, setDisplayKey } = useDisplayKey();
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);

  const configured = Boolean(displayKey);
  const valid = isPlausibleKey(draft.trim());

  const commit = () => {
    const next = draft.trim();
    if (next && !isPlausibleKey(next)) return;
    const ok = setDisplayKey(next);
    setSaved(ok);
    setEditing(false);
    setDraft('');
    if (!ok) window.alert('This screen cannot save the key — browser storage is blocked, so names will not appear.');
  };

  return (
    <div className="field">
      {editing ? (
        <>
          <label htmlFor="dkey">Display key</label>
          <div className="display-key-row">
            <input
              id="dkey"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (valid || !draft.trim())) commit(); }}
              placeholder="paste the 44-character key"
            />
            <button type="button" className="ghost" disabled={!valid} onClick={commit}>Save</button>
            <button type="button" className="ghost" onClick={() => { setEditing(false); setDraft(''); }}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          <span className="field-label" id="dkey-label">Display key</span>
          <div className="display-key-row" role="group" aria-labelledby="dkey-label">
            <code className="display-key-value">
              {configured ? maskDisplayKey(displayKey) : (secure ? 'not set — names will not appear' : 'not set')}
            </code>
            {secure && (
              <button type="button" className="ghost" onClick={() => { setEditing(true); setSaved(false); }}>
                {configured ? 'Replace' : 'Paste key'}
              </button>
            )}
            {configured && (
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  if (window.confirm('Remove the display key from THIS screen? Names will stop appearing here until you paste it again.')) {
                    setDisplayKey('');
                  }
                }}
              >
                Remove
              </button>
            )}
          </div>
        </>
      )}
      <span className="hint">
        {!secure && <>{INSECURE_CONTEXT_COPY} </>}
        {editing && draft.trim() && !valid && (
          <><strong>That does not look like a display key.</strong> It should be 44 characters ending in <code>=</code>. </>
        )}
        {saved && <><strong>Saved.</strong> Press <em>Night Test</em> on the print-server dashboard to confirm. </>}
        Children&apos;s names travel <strong>encrypted</strong>, because the realtime channel itself is public.
        Normally filled in by Display login above. To do it by hand: generate the key once on the print-server
        dashboard (its front page says whether names are encrypted; the button there opens
        <code>Settings → Realtime privacy</code>) and paste the same value into every screen. Without it the
        clock, weather, counts and slides all still work — only the welcome banners stop.
        {' '}<strong>Never</strong> email it, put it in a URL, or include it in a settings export — it is the one
        secret here that is worth something.
      </span>
    </div>
  );
}

/**
 * The publish token — the credential the print server requires before THIS
 * machine's slide editor may publish to every screen. Deliberately NOT part of
 * `form`/`set`, for exactly the reasons the display key is not: `form` backs
 * the settings export and the ?config= merge, and a credential must ride
 * neither. See src/lib/publishToken.js; publishToken.test.js pins the paths.
 */
export function PublishTokenField() {
  const [token, setToken] = useState(loadPublishToken);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);

  const commit = () => {
    const next = draft.trim();
    const ok = savePublishToken(next);
    if (ok) setToken(next);
    else window.alert('This machine cannot save the token — browser storage is blocked.');
    setEditing(false);
    setDraft('');
  };

  return (
    <div className="field" style={{ marginTop: '0.5rem' }}>
      {editing ? (
        <>
          <label htmlFor="ptoken">Publish token</label>
          <div className="display-key-row">
            <input
              id="ptoken"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
              placeholder="paste the token from the printer dashboard"
            />
            <button type="button" className="ghost" disabled={!draft.trim()} onClick={commit}>Save</button>
            <button type="button" className="ghost" onClick={() => { setEditing(false); setDraft(''); }}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          <span className="field-label" id="ptoken-label">Publish token</span>
          <div className="display-key-row" role="group" aria-labelledby="ptoken-label">
            <code className="display-key-value">
              {token ? maskPublishToken(token) : 'not set — the Publish button will explain how to get one'}
            </code>
            <button type="button" className="ghost" onClick={() => setEditing(true)}>
              {token ? 'Replace' : 'Paste token'}
            </button>
            {token && (
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  if (window.confirm('Remove the publish token from this machine? Its Publish button will stop working; other screens are unaffected.')) {
                    savePublishToken('');
                    setToken('');
                  }
                }}
              >
                Remove
              </button>
            )}
          </div>
        </>
      )}
      <span className="hint">
        Only needed on the machine that edits slides, and filled in automatically on a logged-in screen.
        By hand: print-server dashboard → <strong>Lobby Slides</strong> → Generate. It stays on this machine —
        never in a settings export, a <code>?config=</code> file, or a URL.
      </span>
    </div>
  );
}

export function PptxUploadField() {
  const [stored, setStored] = useState(null);
  const [busy, setBusy] = useState(false);
  // Inline status line (replaces window.alert): { tone, text }.
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let live = true;
    getDeck().then((d) => { if (live) setStored(d); });
    return () => { live = false; };
  }, []);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setStatus({ tone: 'info', text: 'Reading deck…' });

    const ok = await putDeck(file, file.name);
    if (!ok) {
      setBusy(false);
      setStatus({ tone: 'warn', text: 'Could not save the deck on this device (storage blocked or full).' });
      e.target.value = '';
      return;
    }
    // Re-read so the model cache is keyed to the real stored savedAt.
    const deck = await getDeck();
    setStored(deck || { blob: file, name: file.name, savedAt: Date.now() });

    try {
      const model = await parseAndCacheDeck(file, deck?.savedAt);
      const broken = model.slides.filter((s) => s.error).length;
      const ready = model.slides.length - broken;
      setStatus({
        tone: 'ok',
        text: `Saved: ${file.name} — ${ready} slide${ready === 1 ? '' : 's'} ready`
          + (broken
            ? ` · ${broken} slide${broken === 1 ? ' has' : 's have'} unsupported content and will show the placeholder`
            : ''),
      });
    } catch (err) {
      console.warn('pptx: uploaded deck failed to parse:', err);
      setStatus({
        tone: 'warn',
        text: `Saved ${file.name}, but it couldn't be read as a presentation — the display will fall back to the embed URL or placeholder.`,
      });
    }
    setBusy(false);
    e.target.value = '';
  };

  const remove = async () => {
    if (!window.confirm(`Remove ${stored?.name || 'the uploaded deck'} from this device? The file is not stored anywhere else — you would need the original .pptx to upload it again.`)) return;
    await deleteDeck();
    setStored(null);
    setStatus(null);
  };

  return (
    <div className="field">
      <label htmlFor="pptx-upload">Upload a .pptx</label>
      <input id="pptx-upload" type="file" accept=".pptx" onChange={onFile} disabled={busy} />
      {status && (
        <span
          className="hint"
          role="status"
          style={status.tone === 'warn' ? { color: '#ff8a80' } : undefined}
        >
          {status.text}
        </span>
      )}
      <span className="hint">
        {stored
          ? `Saved on this device: ${stored.name || 'presentation.pptx'} — it renders locally, no iframe.`
          : 'The deck is stored on this device only (never uploaded). '}
        Rendering covers backgrounds, text, pictures and solid/gradient shapes (with rotation
        and per-slide timings); animations, SmartArt, charts and tables are not rendered, and
        fonts substitute to the system stack. If the deck cannot render, the OneDrive embed
        URL below is the automatic fallback.
      </span>
      {stored && (
        <button type="button" className="ghost" style={{ alignSelf: 'flex-start' }} onClick={remove}>
          Remove uploaded deck
        </button>
      )}
    </div>
  );
}

// One background video, stored in this browser's IndexedDB under the single
// well-known slot (#25) — mirrors PptxUploadField's one-deck model. The file
// never leaves this device; exported settings carry only the source choice.
export function VideoUploadField() {
  const [stored, setStored] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let live = true;
    getVideo(BACKGROUND_VIDEO_ID).then((blob) => { if (live) setStored(blob); });
    return () => { live = false; };
  }, []);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setStatus({ tone: 'info', text: 'Storing video…' });
    try {
      // A File survives IndexedDB structured clone with .name/.size intact,
      // so the slot needs no side-channel metadata.
      await putVideo(BACKGROUND_VIDEO_ID, file);
      setStored(file);
      setStatus({ tone: 'ok', text: `Saved: ${file.name} — it plays full-screen on a loop, muted.` });
      // Tell a mounted background to re-read the slot — see VideoBackground.
      window.dispatchEvent(new Event(BACKGROUND_VIDEO_CHANGED_EVENT));
    } catch {
      setStatus({ tone: 'warn', text: 'Could not save the video on this device (storage blocked or full).' });
    }
    setBusy(false);
    e.target.value = '';
  };

  const remove = async () => {
    if (!window.confirm(`Remove ${stored?.name || 'the video'} from this device? The file is not stored anywhere else — you would need the original to upload it again.`)) return;
    await deleteVideo(BACKGROUND_VIDEO_ID);
    setStored(null);
    setStatus(null);
    window.dispatchEvent(new Event(BACKGROUND_VIDEO_CHANGED_EVENT));
  };

  return (
    <div className="field">
      <label htmlFor="video-upload">Upload a video</label>
      <input id="video-upload" type="file" accept="video/*" onChange={onFile} disabled={busy} />
      {status && (
        <span
          className="hint"
          role="status"
          style={status.tone === 'warn' ? { color: '#ff8a80' } : undefined}
        >
          {status.text}
        </span>
      )}
      <span className="hint">
        {stored
          ? `Saved on this device: ${stored.name || 'video'}`
            + (stored.size > 0 ? ` · ${(stored.size / 1e6).toFixed(1)} MB` : '')
            + '. '
          : 'The video is stored on this device only (never uploaded). '}
        It plays muted on an endless loop behind the banners — MP4 (H.264) is the safest
        format for kiosk hardware. If the video is missing or cannot play, the friendly
        welcome scene shows instead, so the screen is never black.
      </span>
      {stored && (
        <button type="button" className="ghost" style={{ alignSelf: 'flex-start' }} onClick={remove}>
          Remove video
        </button>
      )}
    </div>
  );
}
