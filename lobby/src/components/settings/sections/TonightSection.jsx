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
 * Tonight (docs/SETTINGS-OVERHAUL.md 2.1, reordered 2026-10-13 "Reorganize").
 * The settings page, in club-night order: a sign-in pointer only while signed
 * out (the header says when it is signed in), what needs a look, tonight at a
 * glance, the notice to every screen, the schedule and calendar, recent
 * changes, and last the online check-in switches (set once, rarely touched). A
 * TV's own panel: its alerts, its connection, the schedule and calendar, and
 * About this screen. `mission` is the page's memory-only feed of recent first
 * names (App); `noticeDraft` is lifted so the TV preview can show it.
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
  const calendarCard = (
    <CalendarPhaseCard
      phase={phase} scheduleSource={scheduleSource} calendar={calendar} calendarEnabled={calendarEnabled}
      syncedDeck={syncedDeck} slidesStatus={slidesStatus} following={following} keyed={keyed} openedAt={openedAt}
    />
  );

  return (
    <>
      <StatusAlerts
        opsFailures={opsFailures} layerFaults={layerFaults} remoteConfigError={remoteConfigError}
        wakeLockStatus={wakeLockStatus} demoActive={demoActive} onReload={onReload}
      />
      {page ? (
        !sync.signedIn && (
          <PanelCard title="Sign in first">
            <p className="status-sentence off">
              <span className="dot" />
              Not signed in: nothing here reaches a screen yet.
            </p>
            <button type="button" className="secondary section-jump" onClick={() => goTo('account')}>Sign in →</button>
          </PanelCard>
        )
      ) : (
        <ConnectionCard
          status={status} keyed={keyed} displayKey={displayKey} nameStatus={nameStatus}
          lastEventAt={lastEventAt} openedAt={openedAt} goTo={goTo}
        />
      )}

      {live && <OverviewAlerts alerts={alerts} />}
      {live && missionEnabled() && (
        <MissionControl overview={overview} mission={mission} error={error} stopped={stopped} onRetry={retry} />
      )}
      {live && <NoticeCard draft={noticeDraft} onDraft={onNoticeDraft} overviewNotice={overview ? overview.notice ?? null : undefined} />}

      {calendarCard}

      {live && <RecentChangesCard goTo={goTo} />}
      {live && <SwitchesCard overview={overview} />}

      {!page && <AboutCard build={build} part="screen" />}
    </>
  );
}
