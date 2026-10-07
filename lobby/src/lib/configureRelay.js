// @ts-check
// Configure mode (`?configure=1`): a screen's own settings, opened beside the
// live screen rather than over it. The sound room app's Settings window loads
// it (desktop/, the configurator), in the same browser profile as the screen
// it shows, so every saved setting already reaches the live screen through
// the shared localStorage (useConfig's storage listener). What storage cannot
// carry are the buttons that act on the screen itself (Preview a check-in,
// Reset tonight's counter, the projector's view jumps): those are relayed
// here, over one same-origin BroadcastChannel, to whichever live screen of
// that kind is open in the same profile.
//
// A relay is only a request, and the live screen treats it like a click on
// its own button: a preview check-in still goes through the same sanitizers
// as a real event. Nothing crosses a machine or the network: a
// BroadcastChannel only reaches pages of the same origin in the same browser
// profile. Journey's kiosk (journey/public/src/schedule.js) speaks the same
// channel with screen 'journey'.

export const CONFIGURE_CHANNEL = 'awana-configure';

/** @param {string} [search] */
export function isConfigureMode(search = typeof window === 'undefined' ? '' : window.location.search) {
  try {
    return new URLSearchParams(search).get('configure') === '1';
  } catch {
    return false;
  }
}

/**
 * From a configure-mode page: ask the live `screen` to do `action`.
 *
 * @param {'lobby' | 'projector' | 'journey'} screen
 * @param {string} action
 * @param {unknown} [data]
 */
export function relayToScreen(screen, action, data = null) {
  try {
    const ch = new BroadcastChannel(CONFIGURE_CHANNEL);
    ch.postMessage({ screen, action, data });
    ch.close();
  } catch { /* no BroadcastChannel: the button simply does nothing */ }
}

/**
 * On a live screen: run `handler` for this screen's relayed actions in
 * `allowed`, and nothing else. Returns the unsubscribe.
 *
 * @param {'lobby' | 'projector' | 'journey'} screen
 * @param {readonly string[]} allowed
 * @param {(action: string, data: unknown) => void} handler
 */
export function listenForRelay(screen, allowed, handler) {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  const ch = new BroadcastChannel(CONFIGURE_CHANNEL);
  ch.onmessage = (event) => {
    const m = event.data;
    if (!m || typeof m !== 'object' || m.screen !== screen || !allowed.includes(m.action)) return;
    handler(m.action, m.data);
  };
  return () => ch.close();
}
