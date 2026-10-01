import { useEffect, useState } from 'react';

// Signage screens must never doze off mid-club. The Screen Wake Lock API
// asks the OS not to blank the display; the lock is silently released
// whenever the tab is hidden, so we re-request it on every return to
// visibility. Browsers without the API (or kiosks that deny it) simply
// no-op — the failure mode is the status quo, never an error on screen.
//
// Returns a status string so the Settings/Debug panels can tell the
// operator what actually happened instead of staying silent:
//   'active'      — lock held, the screen will stay awake
//   'denied'      — the browser refused (battery saver, permissions…)
//   'unsupported' — this browser has no Wake Lock API
//   'requesting'  — asked, no answer yet
//   'off'         — the feature is disabled in config
export function useWakeLock(enabled) {
  const supported = typeof navigator !== 'undefined' && !!navigator.wakeLock?.request;
  // Only the async outcome lives in state; 'off'/'unsupported' are
  // derived so the effect never needs a synchronous setState.
  const [lockState, setLockState] = useState('requesting');

  useEffect(() => {
    if (!enabled || !supported) return undefined;

    let lock = null;
    let disposed = false;

    const acquire = async () => {
      if (disposed || document.visibilityState !== 'visible') return;
      try {
        lock = await navigator.wakeLock.request('screen');
        if (disposed) {
          lock.release().catch(() => {});
          return;
        }
        setLockState('active');
        // The OS may revoke the lock later (tab hidden, power saver);
        // reflect that so the panel never over-promises.
        lock.addEventListener?.('release', () => {
          if (!disposed) setLockState('denied');
        });
      } catch {
        if (!disposed) setLockState('denied');
      }
    };

    acquire();
    document.addEventListener('visibilitychange', acquire);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', acquire);
      lock?.release().catch(() => {});
    };
  }, [enabled, supported]);

  if (!enabled) return 'off';
  if (!supported) return 'unsupported';
  return lockState;
}
