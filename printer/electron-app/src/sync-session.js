// This computer's sign-in to the sync service (KVBC Awana v9, the wizard's
// passphrase step). The church passphrase signs in exactly as a screen does:
// POST {sync url}/v1/login (print-server/sync-client.js, the same helper the
// print server signs in with, on the shared protocol in lobby/shared/
// sync-protocol.js; the url comes from the site's lobby/shared/sync.json). The passphrase itself is never stored.
//
// The session is a secret (CLAUDE.md: "never config, an export or a
// URL"), so it is kept with Electron's safeStorage (DPAPI on Windows, bound
// to this Windows user) in userData\sync-session.bin, never in a plain file.
// Where safeStorage cannot encrypt, it is held in memory only, for this run.
//
// What it is for: the hook for /settings (ROADMAP.md#kvbc-awana-one-app, "each computer
// registers as a device, kind `computer`"). Nothing reads it yet beyond
// status(); the device registration will use session() as its bearer.
'use strict';

const fs = require('fs');
const path = require('path');

const FILE = 'sync-session.bin';

/**
 * @param {{ userData: string, safeStorage: Electron.SafeStorage, syncClient: any, fetchFn?: typeof fetch }} deps
 */
function createSyncSession({ userData, safeStorage, syncClient, fetchFn }) {
  const file = path.join(userData, FILE);
  let memory = null; // { url, session, at } when safeStorage cannot be used

  const canEncrypt = () => {
    try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
  };

  function read() {
    if (memory) return memory;
    if (!canEncrypt()) return null;
    try {
      const parsed = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
      if (parsed && syncClient.isValidSyncUrl(parsed.url) && syncClient.isValidSession(parsed.session)) return parsed;
    } catch { /* none, or not ours to read (another Windows user) */ }
    return null;
  }

  function save(value) {
    if (!canEncrypt()) { memory = value; return 'memory'; }
    const tmp = `${file}.tmp`;
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(value)));
    fs.renameSync(tmp, file);
    memory = null;
    return 'encrypted';
  }

  /** Where the service is: '' none, null unknown (offline). */
  async function syncUrl() {
    return syncClient.resolveSyncUrl({ fetchFn });
  }

  /**
   * Signs in with the passphrase. Never throws.
   * @returns {Promise<{ ok: true, url: string, kept: string } | { ok: false, error: string, triesLeft?: number }>}
   */
  async function signIn(passphrase) {
    if (!syncClient.normalizeSyncPassphrase(passphrase)) return { ok: false, error: 'Type the passphrase first.' };
    const url = await syncUrl();
    if (url === null) return { ok: false, error: 'Could not reach awana.kvbchurch.org. Check this computer\'s internet connection.' };
    if (url === '') return { ok: false, error: 'The sync service is not set up yet.' };
    const r = await syncClient.syncLogin(url, passphrase, { fetchFn });
    if (!r.ok) {
      const out = { ok: false, error: r.error || 'The sign-in did not work.' };
      if (r.triesLeft !== undefined) out.triesLeft = r.triesLeft;
      return out;
    }
    let kept;
    try {
      kept = save({ url, session: r.session, at: new Date().toISOString() });
    } catch (e) {
      return { ok: false, error: `Signed in, but this computer could not keep the sign-in: ${e.message}` };
    }
    return { ok: true, url, kept };
  }

  function signOut() {
    memory = null;
    try { fs.unlinkSync(file); } catch { /* none */ }
  }

  /** For the wizard and the tray: never the session itself. */
  function status() {
    const s = read();
    return s ? { signedIn: true, url: s.url, at: s.at, kept: memory ? 'memory' : 'encrypted' } : { signedIn: false };
  }

  return { signIn, signOut, status, syncUrl, session: () => read() };
}

module.exports = { createSyncSession, FILE };
