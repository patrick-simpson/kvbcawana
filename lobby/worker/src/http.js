// The small response helpers every route module shares (sync.js re-exports
// `json` for the modules that already import it from there).

/** @param {unknown} body @param {number} [status] @param {Record<string, string>} [headers] */
export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

/** @param {string} message @param {number} status @param {Record<string, unknown>} [extra] */
export function fail(message, status, extra = {}) {
  return json({ error: message, ...extra }, status);
}

/** A request the caller got wrong: answered 400 with its message. */
export class BadRequest extends Error {}
