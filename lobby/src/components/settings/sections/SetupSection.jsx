import { useContext } from 'react';
import { DESKTOP_APP_DOWNLOAD_URL } from '../../../lib/constants.js';
import {
  ChangePassphraseField, PanelCard, ReleaseNotesField, RemoteScreenContext,
  ScreenNameField, SettingsPageContext, SyncSignInField, TemplateField, Toggle,
} from '../fields.jsx';

/** "rev 4, 7:35 PM" for a shared layer, or what is true when there is none. */
function sharedLine(shared) {
  if (!shared) return 'No church-wide settings have reached this screen yet.';
  if (shared.local && !shared.publishedAt) return 'A change made here has not reached the other screens yet.';
  const when = shared.publishedAt
    ? new Date(shared.publishedAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
    : '';
  const tail = shared.local ? ' A newer change made here has not reached the other screens yet.' : '';
  return `Following update ${shared.rev}${when ? `, sent ${when}` : ''}.${tail}`;
}

/** Whether this screen follows the church-wide settings (and, on a TV, sends its own). */
export function SharedSettingsCard({ form, set, shared, shareStatus, onShareNow }) {
  const following = form.followSharedSettings !== false;
  // Opened from the settings page, only the switch is that screen's; the
  // line and the button below are about this browser.
  const remote = useContext(RemoteScreenContext);
  return (
    <PanelCard title="Church-wide settings" tab="var(--brand-blue)" scope="screen">
      <Toggle
        checked={following}
        onChange={set('followSharedSettings')}
        title="Follow the church-wide settings"
        hint="Settings tagged EVERY SCREEN (banner times, celebrations, the pickup board, the look, the calendar and weather) come from whichever signed-in screen last changed them, and a change made anywhere reaches every screen. Turn off to keep this one screen on its own values. Settings tagged THIS SCREEN never travel."
      />
      {!remote && <p className="hint">{following ? sharedLine(shared) : 'This screen keeps its own values for everything.'}</p>}
      {shareStatus?.state === 'failed' && <p className="hint hint--warn" role="status">{shareStatus.message}</p>}
      {following && onShareNow && !remote && (
        <div className="field">
          <button type="button" className="ghost section-jump" onClick={onShareNow}>
            Send this screen&rsquo;s church-wide settings to every screen
          </button>
          <span className="hint">
            Every signed-in screen takes these values within seconds (a screen that is off, when it next starts).
          </span>
        </div>
      )}
    </PanelCard>
  );
}

/** This browser's settings file and counter: a TV only. */
export function ToolsCard({ onOpenDebug, onExport, onImport, onResetTally, onReset }) {
  return (
    <PanelCard title="This screen's tools" tab="var(--brand-trek)">
      <div className="tool-grid">
        {onOpenDebug && (
          <div className="tool">
            <button type="button" className="ghost" onClick={onOpenDebug}>Debug panel</button>
            <span className="hint">Simulate check-ins and see connection stats (Ctrl+Shift+D).</span>
          </div>
        )}
        <div className="tool">
          <button type="button" className="ghost" onClick={onExport}>Export settings</button>
          <span className="hint">Download this screen’s settings as a file. Never includes the sign-in or keys.</span>
        </div>
        <div className="tool">
          <button type="button" className="ghost" onClick={onImport}>Import settings</button>
          <span className="hint">Load a settings file exported from another screen. Applies at once.</span>
        </div>
        {onResetTally && (
          <div className="tool">
            <button type="button" className="ghost" onClick={onResetTally}>Reset tonight&rsquo;s counter</button>
            <span className="hint">Back to zero until the next count arrives. Also re-arms the “Doors are open” moment.</span>
          </div>
        )}
        <div className="tool">
          <button type="button" className="danger" onClick={onReset}>Reset this screen</button>
          <span className="hint">Every setting back to its default, typed slides included. The sign-in, keys and uploaded files stay.</span>
        </div>
      </div>
    </PanelCard>
  );
}

/** The one Windows app, and its release notes. */
export function KvbcAwanaCards() {
  return (
    <>
      <PanelCard title="KVBC Awana for Windows" tab="var(--brand-blue)" local>
        <p className="hint">
          <strong>KVBC Awana</strong> is the one app for every church computer: a display that puts a screen full
          screen on a TV on club nights (5:00 to 8:00 pm unless you change it), the check-in laptop&rsquo;s printing, or
          both. Its first run asks which; change it later under Screens on the settings page. It keeps itself up to date.
        </p>
        <div className="panel-links">
          <a className="panel-button secondary" href={DESKTOP_APP_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">
            Download for Windows
          </a>
        </div>
        <p className="hint">
          The first time, Windows may say &ldquo;Windows protected your PC&rdquo; (the app is not code signed): choose{' '}
          <strong>More info</strong>, then <strong>Run anyway</strong>.
        </p>
      </PanelCard>

      <PanelCard title="KVBC Awana release notes" tab="var(--brand-trek)" local>
        <p className="hint">Everything that has changed in KVBC Awana, newest first.</p>
        <ReleaseNotesField />
      </PanelCard>
    </>
  );
}

/** Sign in, rename this screen, make it the template, change the passphrase. */
export function SignInCard({ secure, title, includePassphrase = true }) {
  const page = useContext(SettingsPageContext);
  return (
    <PanelCard title={title ?? (page ? 'Sign in' : 'Connect this screen')} scope="screen" keep local>
      <SyncSignInField secure={secure} />
      {!page && <ScreenNameField />}
      {!page && <TemplateField />}
      {includePassphrase && <ChangePassphraseField />}
    </PanelCard>
  );
}

// The classic rail's Setup section (?rail=classic), minus the display login,
// the display key fold, the publish token and the stale cloud check-in card
// (docs/SETTINGS-OVERHAUL.md section 3). The new rail's Account & app uses the
// same cards (AccountSection).
export function SetupSection({
  form, set, secure, onOpenDebug, onExport, onImport, onResetTally, onReset, shared, shareStatus, onShareNow,
}) {
  const page = useContext(SettingsPageContext);
  return (
    <>
      <SignInCard secure={secure} />
      <SharedSettingsCard
        form={form} set={set} shared={shared} shareStatus={shareStatus} onShareNow={onShareNow}
      />
      {/* This browser's own settings file and counter: not on the settings page. */}
      {!page && (
        <ToolsCard onOpenDebug={onOpenDebug} onExport={onExport} onImport={onImport} onResetTally={onResetTally} onReset={onReset} />
      )}
      <KvbcAwanaCards />
    </>
  );
}
