// @ts-check
// The session token, read in ONE place (code review 2026-10-13). A sign-in
// (sync.js mintSession) hands out `v1.<epoch>.<issued>.<sig>`: the passphrase
// epoch, the issue time (ms) and an HMAC of `v1.<epoch>.<issued>` under the
// object's secret. SyncCore.authorized() checks it, and the Journey phone
// remote counts presses per sign-in by it (journeyRemote.js sessionKeyOf):
// both read the header through parseSession, so a change of the token's format
// is made here once and can never leave the press allowance reading a
// different shape (every phone silently in one bucket).

/** The token's shape: version, epoch, issue time, signature (base64url). */
const TOKEN_RE = /^v1\.(\d+)\.(\d+)\.([A-Za-z0-9_-]+)$/;

/**
 * The session in a request's `Authorization: Bearer <token>` header, as
 * parts, or null when there is none of that shape. Parsing only: whether it is
 * genuine is SyncCore.authorized()'s check of `sig` over `signed`. Pure.
 * @param {Request} request
 * @returns {{ epoch: number, issued: number, sig: string, signed: string } | null}
 */
export function parseSession(request) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const m = TOKEN_RE.exec(token);
  return m ? { epoch: Number(m[1]), issued: Number(m[2]), sig: m[3], signed: `v1.${m[1]}.${m[2]}` } : null;
}

/** What a session's signature signs (mintSession and authorized). @param {number} epoch @param {number} issued */
export const sessionBody = (epoch, issued) => `v1.${epoch}.${issued}`;
