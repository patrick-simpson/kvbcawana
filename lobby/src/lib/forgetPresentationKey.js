// The archived presentation's saved key (owner 2026-11-09: "fix three", the security
// check). The presentation page (site/presentation/, archived 2026-11-09) kept the
// unwrapped history key in the KVBC Awana app's IndexedDB `awanaPresentationKey` so a
// relaunch skipped the passphrase. That page no longer runs any script, so nothing
// would ever forget it; the lobby page, which the same computer loads in the same
// profile and origin, deletes the database once at startup. Deleting a database that
// does not exist is a no-op, so this is harmless on every other screen and browser.
// Nothing else is touched (the lobby's own video and PowerPoint stores stay).

export const PRESENTATION_KEY_DB = 'awanaPresentationKey';

/** @param {IDBFactory | undefined} [idb] */
export function forgetPresentationKey(idb = typeof indexedDB === 'undefined' ? undefined : indexedDB) {
  try {
    if (idb && typeof idb.deleteDatabase === 'function') idb.deleteDatabase(PRESENTATION_KEY_DB);
  } catch {
    // A browser that refuses storage (private window, blocked site data) has nothing to forget.
  }
}
