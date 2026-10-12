import { useContext, useState } from 'react';
import { useSync } from '../../../hooks/useSync.js';
import { defaultDeviceName, loadDevice, saveDeviceName } from '../../../lib/deviceId.js';
import { ChangePassphraseField, PanelCard, RemoteScreenContext, SettingsPageContext } from '../fields.jsx';
import { ChangeLogCard } from '../ChangeLogCard.jsx';
import { AboutCard } from './StatusSection.jsx';
import { KvbcAwanaCards, SharedSettingsCard, SignInCard, ToolsCard } from './SetupSection.jsx';

/** The name the change log calls this browser (awanaDevice.v1). Saved on Enter or on leaving the field. */
function DeviceCard() {
  const [saved, setSaved] = useState(() => loadDevice().name);
  const [draft, setDraft] = useState(/** @type {string | null} */ (null));
  const [note, setNote] = useState('');
  const value = draft ?? saved;
  const save = () => {
    if (draft == null) return;
    const next = saveDeviceName(draft);
    setSaved(next.name);
    setDraft(null);
    setNote('Saved.');
  };
  return (
    <PanelCard title="This device" tab="var(--brand-trek)">
      <div className="field">
        <label htmlFor="device-name">What the change log calls this device</label>
        <input
          id="device-name" type="text" maxLength={40} autoComplete="off" value={value}
          placeholder={defaultDeviceName()}
          onChange={(e) => { setDraft(e.target.value); setNote(''); }}
          onBlur={save}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
        />
        <span className="hint" role="status">{note ? <strong>{note} </strong> : null}Shown next to every change you make, so the others can tell whose it was. Only this browser keeps it.</span>
      </div>
    </PanelCard>
  );
}

/**
 * Account & app (docs/SETTINGS-OVERHAUL.md 2.7): sign in, the passphrase, this
 * device's name for the change log, the church-wide settings follow switch
 * (a TV, or a screen opened from the page), the change log, KVBC Awana, this
 * screen's tools (a TV) and the trademark line.
 */
export function AccountSection({
  form, set, secure, build, shared, shareStatus, onShareNow, onOpenDebug, onExport, onImport, onResetTally, onReset,
}) {
  const page = useContext(SettingsPageContext);
  const remote = useContext(RemoteScreenContext);
  const sync = useSync();
  return (
    <>
      <SignInCard secure={secure} includePassphrase={false} />
      <PanelCard title="Passphrase" tab="var(--brand-sparks)" scope="screen" keep local>
        <ChangePassphraseField />
        {!sync.signedIn && <p className="hint">Sign in first to change the passphrase.</p>}
      </PanelCard>
      {page && !remote && <DeviceCard />}
      {(!page || remote) && (
        <SharedSettingsCard form={form} set={set} shared={shared} shareStatus={shareStatus} onShareNow={onShareNow} />
      )}
      {page && !remote && <ChangeLogCard />}
      <KvbcAwanaCards />
      {!page && (
        <ToolsCard onOpenDebug={onOpenDebug} onExport={onExport} onImport={onImport} onResetTally={onResetTally} onReset={onReset} />
      )}
      <AboutCard build={build} />
    </>
  );
}
