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

          <Step n={2} title="Check children in at /checkin" club="sparks">
            <p>
              Check-in happens at <strong>awana.kvbchurch.org/checkin</strong>, in any browser at the desk
              (or on a phone), signed in with the church passphrase. Each check-in is made on TwoTimTwo
              and its label prints on this computer within seconds. A child checked in on TwoTimTwo’s own
              page gets a label too.
            </p>
            <div className="kv-callout kv-callout--tint">
              <p><strong>No browser extension</strong></p>
              <p>
                Since version 10 there is nothing to load in Chrome. A laptop that had the old KVBC Kids
                Check-in Extension updates by itself: the app empties that extension and restarts Chrome
                once, and you may remove it from <Code>chrome://extensions</Code> whenever you like.
              </p>
            </div>
            <p className="kv-small">
              With no internet, nothing checks in or prints: use TwoTimTwo’s paper sign-in sheet and
              hand-written tags, and key the sheet into TwoTimTwo when the connection is back.
            </p>
          </Step>

          <Step n={3} title="Labels know your roster (automatic)" club="tnt">
            <p>
              The church’s check-in service reads your TwoTimTwo roster and completed books and seals them
              to this computer, which unlocks allergy icons, birthday cakes, handbook groups, trophy bands
              and the no-photo flag. Only the printing computers can open them.
            </p>
            <p className="kv-small">
              A “no” in TwoTimTwo’s photo-release column prints a crossed-out camera on that child’s label,
              so volunteers know not to photograph them. Unknown children still get a basic label; nothing
              ever crashes.
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
              Then check a child in at awana.kvbchurch.org/checkin. A real label should print. (The
              settings page’s test label works too.)
            </p>
          </Step>
        </ol>
      </div>
    </section>
  );
};
