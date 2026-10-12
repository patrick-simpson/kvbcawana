import { useChurch } from '../../../hooks/useChurch.js';
import {
  BarfNightCard, ChurchGate, ClubLabelCard, ClubNightCard, LabelsCard, NameTagsCard, PickupListCard, TonightsPrintsCard,
} from '../ChurchCards.jsx';
import AtTheLaptop from '../AtTheLaptop.jsx';
import { PanelCard } from '../fields.jsx';
import { useSync } from '../../../hooks/useSync.js';

/**
 * Printing (docs/SETTINGS-OVERHAUL.md 2.5), the settings page only: works from
 * anywhere. The church-wide labels, schedule, pickup list and BARF Night come
 * from (and go to) the Worker's church document; tonight's reprints and name
 * tags are sealed in this browser and printed by the check-in laptop's station;
 * ONE collapsed card, "At the laptop", holds what needs localhost.
 */
export function PrintingSection() {
  const sync = useSync();
  const church = useChurch();
  if (!sync.signedIn) {
    return <PanelCard title="Printing" tab="var(--brand-tnt)"><p className="hint">Sign in under Account &amp; app to change the printing settings from here.</p></PanelCard>;
  }
  return (
    <>
      <ChurchGate church={church} />
      <LabelsCard church={church} />
      <ClubLabelCard church={church} />
      <ClubNightCard church={church} />
      <PickupListCard church={church} />
      <BarfNightCard church={church} />
      <TonightsPrintsCard />
      <NameTagsCard />
      <AtTheLaptop paused={church.state === 'paused'} />
    </>
  );
}
