import { useContext } from 'react';
import { useSync } from '../../../hooks/useSync.js';
import { useOverview } from '../../../hooks/useOverview.js';
import { alertsFrom } from '../../../lib/missionControl.js';
import { PanelCard, SettingsPageContext } from '../fields.jsx';
import { AboutCard, CalendarPhaseCard, ConnectionCard, StatusAlerts } from './StatusSection.jsx';
import MissionControl from '../MissionControl.jsx';
import SwitchesCard from '../SwitchesCard.jsx';
import NoticeCard from '../NoticeCard.jsx';
import { RecentChangesCard } from '../ChangeLogCard.jsx';

/** ?mission=0 hides the mission control card (the kill switch, docs/SETTINGS-OVERHAUL.md section 10). */
export function missionEnabled(search = typeof window !== 'undefined' ? window.location.search : '') {
  try { return new URLSearchParams(search).get('mission') !== '0'; } catch { return true; }
}

/** The overview-derived alerts (CHECK THE PRINTER, no station, TwoTimTwo, dead jobs, …) as a card. */
function OverviewAlerts({ alerts }) {
  if (!alerts.length) return null;
  return (
    <PanelCard title="Needs a look" tab="var(--brand-sparks)">
      <ul className="mission-alerts" data-testid="overview-alerts">
        {alerts.map((a) => (
          <li key={a.id} className={`status-alert${a.tone === 'warn' ? ' status-alert--warn' : ''}`}>{a.text}</li>
        ))}
      </ul>
    </PanelCard>
  );
}

/**
 * Tonight (docs/SETTINGS-OVERHAUL.md 2.1). The settings page: sign-in line,
 * mission control, calendar and phase, alerts, the online check-in switches,
 * the notice composer and recent changes. A TV's own panel: its connection,
 * tonight and its alerts only. `mission` is the page's memory-only feed of
 * recent first names (App); `noticeDraft` is lifted so the TV preview can show it.
 */
export function TonightSection({
  status, nameStatus, keyed, displayKey, lastEventAt, openedAt, phase, scheduleSource, calendar, calendarEnabled,
  opsFailures, layerFaults, remoteConfigError, wakeLockStatus, demoActive, syncedDeck, slidesStatus, following, build, goTo,
  onReload, mission, noticeDraft, onNoticeDraft,
}) {
  const page = useContext(SettingsPageContext);
  const sync = useSync();
  const live = page && sync.signedIn;
  const { overview, error, stopped, retry } = useOverview({ enabled: live });
  const alerts = alertsFrom(overview);

  return (
    <>
      <StatusAlerts
        opsFailures={opsFailures} layerFaults={layerFaults} remoteConfigError={remoteConfigError}
        wakeLockStatus={wakeLockStatus} demoActive={demoActive} onReload={onReload}
      />
      {page ? (
        <PanelCard title="Sign-in & connection">
          <p className={`status-sentence ${sync.signedIn ? 'connected' : 'off'}`}>
            <span className="dot" />
            {sync.signedIn ? 'Signed in: changes here reach every screen.' : 'Not signed in: nothing here reaches a screen yet.'}
          </p>
          {!sync.signedIn && (
            <button type="button" className="secondary section-jump" onClick={() => goTo('account')}>Sign in →</button>
          )}
        </PanelCard>
      ) : (
        <ConnectionCard
          status={status} keyed={keyed} displayKey={displayKey} nameStatus={nameStatus}
          lastEventAt={lastEventAt} openedAt={openedAt} goTo={goTo} accountId="account"
        />
      )}

      {live && missionEnabled() && (
        <MissionControl overview={overview} mission={mission} error={error} stopped={stopped} onRetry={retry} />
      )}

      <CalendarPhaseCard
        phase={phase} scheduleSource={scheduleSource} calendar={calendar} calendarEnabled={calendarEnabled}
        syncedDeck={syncedDeck} slidesStatus={slidesStatus} following={following} keyed={keyed} openedAt={openedAt}
      />
      {live && <OverviewAlerts alerts={alerts} />}

      {live && <SwitchesCard overview={overview} />}
      {live && <NoticeCard draft={noticeDraft} onDraft={onNoticeDraft} overviewNotice={overview ? overview.notice ?? null : undefined} />}
      {live && <RecentChangesCard goTo={goTo} />}

      {!page && <AboutCard build={build} />}
    </>
  );
}
