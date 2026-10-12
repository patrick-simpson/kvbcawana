import { useContext } from 'react';
import { PanelCard, SettingsPageContext } from '../fields.jsx';
import { ClubLinesCard, WelcomeBannersCard, WelcomeExtrasCard } from './CheckinsSection.jsx';
import { CelebrationsSection } from './CelebrationsSection.jsx';
import { PickupBoardCard, PickupPreviewCard } from './PickupSection.jsx';
import { CornerToggles, SimplifiedModeCard, ThisTvCard, WeatherFields } from './ScreenSection.jsx';

/**
 * What screens show (docs/SETTINGS-OVERHAUL.md 2.3): welcome banners and
 * extras, club lines, celebrations, the pickup board, the corner, and (a TV,
 * or a screen opened from the page) its own switches. The old Check-ins,
 * Screen & corner, Celebrations and Pickup board sections, in one.
 */
export function ShowSection({
  form, set, update, onPreview, onBoardDemo, panicMode, onPanic, wakeLockStatus, lowPowerForced, goTo,
}) {
  const page = useContext(SettingsPageContext);
  return (
    <>
      <SimplifiedModeCard panicMode={panicMode} onPanic={onPanic} />
      <WelcomeBannersCard form={form} update={update} onPreview={onPreview} />
      <WelcomeExtrasCard form={form} set={set} />
      <ClubLinesCard form={form} update={update} />
      <CelebrationsSection form={form} set={set} update={update} />
      <PickupBoardCard form={form} set={set} goTo={page ? goTo : undefined} title="Pickup board" />
      {/* The page has the live TV preview; a TV's own panel keeps the miniature. */}
      {!page && <PickupPreviewCard form={form} onBoardDemo={onBoardDemo} />}
      <PanelCard title="Corner" scope="shared" preview="corner">
        <CornerToggles form={form} set={set} />
        <details className="advanced-fields">
          <summary>Weather location and units</summary>
          <WeatherFields form={form} set={set} update={update} where="Slides & look" />
        </details>
      </PanelCard>
      <ThisTvCard form={form} set={set} update={update} wakeLockStatus={wakeLockStatus} lowPowerForced={lowPowerForced} />
    </>
  );
}
