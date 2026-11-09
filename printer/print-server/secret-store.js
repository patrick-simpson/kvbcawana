// The print server's sign-in secrets at rest (10.14.0): the sync session and the display
// key. Until 10.14.0 they sat in config.json as plain text, against the wizard's own rule
// (electron-app/src/sync-session.js keeps its session with safeStorage only). Inside the
// KVBC Awana app they now live in `config-secrets.bin`, encrypted with Electron's
// safeStorage (Windows data protection, bound to this Windows user); config.json never
// holds them. Where safeStorage cannot encrypt they are kept in memory only, never in a
// plain file (the wizard's rule): this computer then signs in again after a restart.
//
// Outside the app (bare `node server.js`, the test suites, the CUPS station) nothing is
// injected and server/config.js keeps them in config.json as before.
//
// Electron-free: `safeStorage` is injected ({isEncryptionAvailable, encryptString,
// decryptString}), the way station-keys.js takes it, so scripts/test-secret-store.cjs runs
// it with a stand-in. Never logs a value.
'use strict';

const fs = require('fs');
const path = require('path');

const SECRETS_FILE = 'config-secrets.bin';
/** The config keys that are secrets at rest. */
const STORED_SECRET_KEYS = Object.freeze(['syncSession', 'displayKey']);

/** Just the secret keys of a config object, strings only. */
function pickSecrets(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const k of STORED_SECRET_KEYS) if (typeof obj[k] === 'string' && obj[k]) out[k] = obj[k];
  return out;
}

/** A copy of a config object without the secret keys. */
function omitSecrets(obj) {
  const out = { ...(obj && typeof obj === 'object' ? obj : {}) };
  for (const k of STORED_SECRET_KEYS) delete out[k];
  return out;
}

/**
 * @param {{ dir: string, safeStorage: any, log?: Function }} deps
 */
function createSecretStore({ dir, safeStorage, log = () => {} }) {
  const file = path.join(dir, SECRETS_FILE);
  /** @type {Record<string,string>|null} */ let cache = null;

  const canEncrypt = () => {
    try { return !!safeStorage && safeStorage.isEncryptionAvailable() === true; } catch { return false; }
  };

  /** What is kept now. {} when nothing (or a file another Windows user wrote). */
  function read() {
    if (cache) return { ...cache };
    let value = {};
    if (canEncrypt()) {
      try {
        if (fs.existsSync(file)) value = pickSecrets(JSON.parse(safeStorage.decryptString(fs.readFileSync(file))));
      } catch {
        log('[secrets] config-secrets.bin could not be opened; this computer must sign in again');
        value = {};
      }
    }
    cache = value;
    return { ...cache };
  }

  /**
   * Keep exactly these secrets (a key left out is forgotten). Encrypted to disk when
   * safeStorage can; otherwise memory only and the file is removed. Returns true when
   * what is kept is on disk.
   * @param {object} obj
   */
  function write(obj) {
    const value = pickSecrets(obj);
    cache = { ...value };
    if (!canEncrypt()) {
      try { fs.unlinkSync(file); } catch { /* none */ }
      return false;
    }
    try {
      fs.mkdirSync(dir, { recursive: true });
      if (!Object.keys(value).length) {
        try { fs.unlinkSync(file); } catch { /* none */ }
        return true;
      }
      const tmp = `${file}.tmp`;
      const fd = fs.openSync(tmp, 'w');
      try { fs.writeSync(fd, safeStorage.encryptString(JSON.stringify(value))); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, file);
      return true;
    } catch (e) {
      log(`[secrets] could not save the sign-in (${e && e.code ? e.code : 'error'}); it is kept in memory until the app restarts`);
      return false;
    }
  }

  return { file, canEncrypt, read, write };
}

module.exports = { SECRETS_FILE, STORED_SECRET_KEYS, pickSecrets, omitSecrets, createSecretStore };
