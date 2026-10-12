import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useScreenSync } from '../../hooks/useScreenSync.js';
import { lowPowerPreference, setLowPowerPreference, subscribeLowPower } from './useLowPower.js';
import { setStingersEnabled, stingersEnabled, subscribeStingers } from '../lib/stingers.js';

// The projector, managed from /settings (ROADMAP.md#settings-page, phase 2): it registers
// with the sync Worker like a lobby TV, through the signage's own
// useScreenSync (one copy of the rules, on the isolation allowlist), and its
// two device switches are its layer: Low power and the countdown chimes, the
// same stores the menu writes. A wall pick or Resume from /settings is obeyed
// as the menu's own would be.

/** @param {{ enabled: boolean, onAction: (action: string, data?: unknown) => void }} opts */
export function useProjectorScreen({ enabled, onAction }) {
  const lowPower = useSyncExternalStore(subscribeLowPower, lowPowerPreference, lowPowerPreference);
  const stingers = useSyncExternalStore(subscribeStingers, stingersEnabled, stingersEnabled);
  // Both always written out, so "off" is a value /settings can see.
  const overrides = useMemo(() => ({ lowPower, stingers }), [lowPower, stingers]);
  const replaceConfig = useCallback((next) => {
    setLowPowerPreference(next.lowPower === true);
    setStingersEnabled(next.stingers === true);
  }, []);
  useScreenSync({ kind: 'projector', enabled, overrides, replaceConfig, onAction, defaultName: 'Projector' });
}
