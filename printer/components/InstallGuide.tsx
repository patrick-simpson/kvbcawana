import React, { useState } from 'react';
import { HEALTH_CHECK_ENDPOINT, HEALTH_CHECK_TIMEOUT } from '../src/constants';
import { Ico } from './home/Icons';
import { StepChip } from './home/Kit';

type ConnectionStatus = 'idle' | 'checking' | 'connected' | 'error';

const INSTALLER_URL = 'https://awana.kvbchurch.org/download/kvbc-awana';

const Step: React.FC<{ n: number; title: string; club: string; children: React.ReactNode }> = ({ n, title, club, children }) => (
  <li className="kv-step-card" data-club={club}>
    <StepChip className="kv-step-card__chip" label="Step" value={String(n)} />
    <h3 className="kv-step-card__title"><span className="kv-sr">Step {n}: </span>{title}</h3>
    <div className="kv-step-card__body">{children}</div>
  </li>
);

const Code: React.FC<{ children: React.ReactNode }> = ({ children }) => <code className="kv-code">{children}</code>;

export const InstallGuide: React.FC = () => {
  const [connStatus, setConnStatus] = useState<ConnectionStatus>('idle');
  const [connDetail, setConnDetail] = useState('');

  const testConnection = async () => {
    setConnStatus('checking');
    setConnDetail('');
    try {
      const res = await fetch(HEALTH_CHECK_ENDPOINT, { signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT) });
      const data = await res.json();
      setConnStatus('connected');
      setConnDetail(`v${data.version} — printer: ${data.printer}`);
    } catch {
      setConnStatus('error');
      setConnDetail('Server not reachable — make sure KVBC Awana is running on this computer as a print server.');
    }
  };

  return (
    <section id="install" className="kv-install" aria-labelledby="install-title">
      <div className="kv-wrap">
        <div className="kv-head">
          <p className="kv-tabkicker">Install</p>
          <h2 className="kv-h2" id="install-title">Set it up in a few minutes</h2>
          <p className="kv-lede">
            A Windows PC and any thermal label printer that takes 4×2 inch labels. One installer, with no
            Node.js and no scripts.
          </p>
          <p className="kv-note">
            <Ico name="shield" />
            <span><strong>An independent tool.</strong> KVBC Awana is not affiliated with or endorsed by
            TwoTimTwo.com. It is a companion made by a church that works alongside their check-in system.</span>
          </p>
        </div>

        <ol className="kv-steps">
          <Step n={1} title="Install the app" club="puggles">
            <p className="kv-steps__cta">
              <a href={INSTALLER_URL} className="kv-btn kv-btn--hot"><Ico name="download" />Download KVBC Awana for Windows</a>
              <span>then run the downloaded file</span>
            </p>
            <div className="kv-callout">
              <p><strong>Windows may show a blue “Windows protected your PC” screen.</strong></p>
              <p>
                That’s SmartScreen being cautious about a new community app. Click{' '}
                <strong>More info</strong>, then <strong>Run anyway</strong>. It only happens on the first install.
              </p>
            </div>
            <p>
              The app is <strong>KVBC Awana</strong>, one app for every computer at club (it was called
              Club Label Printer until version 9). Its setup asks what this computer is for: choose{' '}
              <strong>Print server</strong> (add <strong>Display</strong> too if this PC also puts a screen
              on a TV), type the church passphrase, give the computer a name, pick your label printer and
              confirm your church’s check-in address. The app then lives in the system tray (near the
              clock), starts automatically when the PC boots, prints a test label on demand, and{' '}
              <strong>updates itself</strong>, so there are no installers to re-run. A computer that already
              ran Club Label Printer updates to KVBC Awana by itself and stays a print server, with no
              setup to redo.
            </p>
            <p className="kv-small">
              Server not running for any reason? Launch <strong>KVBC Awana</strong> from the desktop
              or Start menu again: every launch checks the server and starts it if it’s down. There’s also a{' '}
              <strong>Start print server</strong> button in the tray menu and in the print server window.
            </p>
            <p className="kv-small">
              Settings live at <strong>awana.kvbchurch.org/settings</strong> (the tray’s <strong>Settings</strong>{' '}
              opens it): open it in Chrome on this computer and it finds the printer by itself. The print server
              answers only this computer, so Windows has nothing to ask about the network, and phones check in at
              awana.kvbchurch.org/checkin.
            </p>
          </Step>

          <Step n={2} title="Load the browser extension" club="sparks">
            <p>
              The app already installed the extension’s files for you. You just have to point your browser
              at them <em>once</em>.
            </p>
            <div className="kv-callout">
              <p><strong>In Edge or Chrome:</strong></p>
              <ol className="kv-olist">
                <li>Open <Code>edge://extensions</Code> or <Code>chrome://extensions</Code></li>
                <li>Turn on <strong>Developer Mode</strong> (top right)</li>
                <li>Click <strong>Load unpacked</strong> and pick <Code>%APPDATA%\awana-label-printer\chrome-extension</Code></li>
              </ol>
              <p className="kv-small">
                Can’t find it? The tray menu has <strong>Open Chrome extension folder</strong>, which opens it
                in Explorer so you can drag it onto the dialog.
              </p>
            </div>
            <div className="kv-callout kv-callout--tint">
              <p><strong>Why that folder and not a download</strong></p>
              <p>
                The app rewrites that folder every time it starts, so when the app updates itself the
                extension updates with it. Just <strong>restart Chrome</strong> to pick it up, and the widget
                tells you when one is owed. A copy you download and unzip somewhere else never updates, and
                quietly drifts behind the print server.
              </p>
            </div>
            <p className="kv-small">
              The green <strong>Club Print</strong> widget appears on your check-in page once it’s loaded.
              (<a href="/chrome-extension.zip" download>The zip</a> is still there for anyone not using the
              Windows app.)
            </p>
          </Step>

          <Step n={3} title="Enrich labels from your roster (automatic)" club="tnt">
            <p>
              The extension syncs your TwoTimTwo roster to the print server on every visit, which unlocks
              allergy icons, birthday cakes, handbook groups and the no-photo flag. You can also drop a{' '}
              <Code>clubbers.csv</Code> next to the server with these columns:
            </p>
            <div className="kv-scroll" tabIndex={0} role="region" aria-label="CSV columns">
              <Code>FirstName, LastName, Birthdate, Allergies, HandbookGroup, MedRelease</Code>
            </div>
            <p className="kv-small">
              A “no” in <strong>MedRelease</strong> (or TwoTimTwo’s photo-release column) prints a crossed-out
              camera on that child’s label, so volunteers know not to photograph them. Unknown children still
              get a basic label; nothing ever crashes.
            </p>
          </Step>

          <Step n={4} title="Test the connection" club="journey">
            <p>With the app running on this computer, check that everything is wired up:</p>
            <div className="kv-conn">
              <button type="button" onClick={testConnection} disabled={connStatus === 'checking'} className="kv-btn kv-btn--line">
                {connStatus === 'checking' ? 'Checking…' : 'Test connection'}
              </button>
              <span role="status">
                {connStatus === 'connected' && <span className="kv-conn__ok"><Ico name="check" />Connected: {connDetail}</span>}
                {connStatus === 'error' && <span className="kv-conn__err"><Ico name="close" />{connDetail}</span>}
              </span>
            </div>
            <p className="kv-small">
              Then open your church’s TwoTimTwo check-in page in Chrome and check a child in. A real label
              should print. (The settings page’s test label works too.)
            </p>
          </Step>
        </ol>
      </div>
    </section>
  );
};
