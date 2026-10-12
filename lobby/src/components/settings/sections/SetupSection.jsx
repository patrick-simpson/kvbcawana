import { useContext, useState } from 'react';
import { useSync } from '../../../hooks/useSync.js';
import { DESKTOP_APP_DOWNLOAD_URL } from '../../../lib/constants.js';
import {
  ChangePassphraseField, DisplayKeyField, DisplayLoginField, PanelCard, BarfBagsField,
  CloudCheckinTestField, FriendsListField, PublishTokenField, ReleaseNotesField, SettingsPageContext,
  SyncSignInField, TemplateField, Toggle, ScreenNameField, RemoteScreenContext,
} from '../fields.jsx';

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
  // Opened from the settings page, only the switch is that screen's; the
  // line and the button below are about this browser.
  const remote = useContext(RemoteScreenContext);
  const from = viaSync ? 'any signed-in screen' : 'the check-in computer';
  return (
    <PanelCard title="Shared settings" tab="var(--brand-blue)" scope="screen">
      <Toggle
        checked={following}
        onChange={set('followSharedSettings')}
        title="Follow the shared settings"
        hint={`Settings tagged EVERY SCREEN (banner times, celebrations, the pickup board, the look, the calendar and weather) come from ${from}, and a change made there reaches every screen. Turn off to keep this one screen on its own values. Settings tagged THIS SCREEN never travel.`}
      />
      {!remote && <p className="hint">{following ? sharedLine(shared, viaSync) : 'This screen keeps its own values for everything.'}</p>}
      {shareStatus?.state === 'failed' && <p className="hint hint--warn" role="status">{shareStatus.message}</p>}
      {following && onShareNow && !remote && (
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
  // fix: no connection, or no secure crypto.
  const [advancedOpen, setAdvancedOpen] = useState(() => status === 'off' || status === 'disconnected' || !secure);
  // Once the site names a sync service, the passphrase signs in through it;
  // until then the print server's display login, exactly as before.
  const syncState = useSync();
  const viaSync = Boolean(syncState.url);
  const page = useContext(SettingsPageContext);

  return (
    <>
      <PanelCard title={page ? 'Sign in' : 'Connect this screen'} scope="screen" keep local>
        {viaSync ? (
          <>
            <SyncSignInField secure={secure} />
            {!page && <ScreenNameField />}
            {!page && <TemplateField />}
            <ChangePassphraseField />
          </>
        ) : <DisplayLoginField status={status} secure={secure} login={login} />}
        <details
          className="advanced-fields"
          hidden={page}
          open={advancedOpen}
          onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}
        >
          <summary>Advanced — paste keys by hand</summary>
          <span className="hint">
            Only needed when this screen cannot log in — no print server on this network,
            or a page not served over https. A logged-in screen fills the display key and publish token in by itself.
          </span>
          <DisplayKeyField secure={secure} />
        </details>
      </PanelCard>

      <SharedSettingsCard
        form={form} set={set} shared={shared} shareStatus={shareStatus} onShareNow={onShareNow}
        viaSync={viaSync && syncState.signedIn}
      />

      <PanelCard title="Publishing slides" tab="var(--brand-journey)" scope="screen" local>
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

      {viaSync && syncState.signedIn && (
        <PanelCard title="Cloud check-in" tab="var(--brand-sparks)" local>
          <p className="hint">
            Being built to replace the check-in laptop: the sync service reads TwoTimTwo itself on club nights. For
            now it only watches and counts, beside the laptop.
          </p>
          <CloudCheckinTestField />
          <h4 className="settings-subhead">BARF Night</h4>
          <FriendsListField />
          <BarfBagsField />
        </PanelCard>
      )}

      <PanelCard title="Release notes" tab="var(--brand-trek)" local>
        <p className="hint">Everything that has changed in the check-in laptop&rsquo;s Club Label Printer, newest first.</p>
        <ReleaseNotesField />
      </PanelCard>

      {/* This browser's own settings file and counter: not on the settings page. */}
      {!page && (
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
      )}

      <PanelCard title="KVBC Awana for Windows" tab="var(--brand-blue)" local>
        <p className="hint">
          <strong>KVBC Awana</strong> is the one app for every church computer: a display that puts this screen full
          screen on a TV on club nights (5:00 to 8:00 pm unless you change it), the check-in print server, or both. Its
          first run asks which; change it later under Screens on the settings page. It keeps itself up to date.
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
    </>
  );
}
