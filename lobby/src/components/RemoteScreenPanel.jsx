import { useMemo } from 'react';
import SettingsPanel from './SettingsPanel.jsx';
import { resolveStoredConfig } from '../hooks/useConfig.js';
import { useRemoteScreen } from './settings/screens.jsx';

// A lobby TV opened from the settings page's Screens (SETTINGS.md, phase 2):
// the SAME Settings panel, its form seeded from the TV's own settings in the
// sync Worker (over this page's shared layer, as the TV resolves them), and
// every change written back there instead of to this browser. Shared changes
// still go out to every screen through the page's own path (`onShare`).

/**
 * @param {{ screen: any, shared: any, shareStatus: any, onShare: (s: Record<string, unknown>) => void,
 *   onOpenSlideEditor: () => void, onBack: () => void, onForgotten: () => void, onRenamed: (name: string) => void }} props
 */
export default function RemoteScreenPanel({ screen, shared, shareStatus, onShare, onOpenSlideEditor, onBack, onForgotten, onRenamed }) {
  const remote = useRemoteScreen(screen);
  const savedConfig = useMemo(
    () => (remote.ready ? resolveStoredConfig({}, remote.settings, shared) : null),
    [remote.ready, remote.settings, shared],
  );

  if (!remote.ready) {
    return (
      <div className="panel-backdrop">
        <div className="panel panel--settings panel--opening" role="dialog" aria-modal="true" aria-label="Settings">
          <p className={`hint${remote.error ? ' hint--warn' : ''}`} role="status">
            {remote.error || `Opening ${screen.name}…`}
          </p>
          <button type="button" className="ghost small" onClick={onBack}>← All screens</button>
        </div>
      </div>
    );
  }

  // The Worker's answer is fresher about being on; the name follows a rename made here.
  const info = { ...screen, ...remote.screen, name: screen.name };
  return (
    <SettingsPanel
      key={screen.id}
      config={savedConfig}
      savedConfig={savedConfig}
      overrides={remote.settings}
      status="connected"
      initialTab="status"
      page
      configure
      screen={info}
      screenNote={remote.note}
      onScreenAction={remote.act}
      onScreenRenamed={onRenamed}
      onScreenForgotten={onForgotten}
      onChange={remote.change}
      onReplace={remote.replace}
      onReset={() => {}}
      onClose={onBack}
      onTest={() => remote.act('preview-checkin')}
      onBoardDemo={() => remote.act('board-demo')}
      onOpenSlideEditor={onOpenSlideEditor}
      shared={shared}
      shareStatus={shareStatus}
      onShare={onShare}
    />
  );
}
