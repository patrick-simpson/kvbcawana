// Which `sourceUrl` the nightly feed should carry for a lesson.
//
// fetch-current-lesson.mjs resolves clubs.awana.org's redirect to the CDN URL
// with one HEAD request, and falls back to the ORIGINAL url when that request
// fails. The HEAD carries the kiosk's Origin header (CloudFront sends
// access-control-allow-origin only when one is present: it varies on Origin),
// the same way resolve-lesson-files.mjs asks for lessons.json's cdnUrl.
// `sourceUrl` is the lesson's identity (sameLesson), so one transient
// failure used to look like "the lesson changed": transcodedAt was cleared,
// the 480p copy re-made and a new ~20 MB file committed to history. When the
// resolution failed and the feed already holds a resolved address for this
// same week and title, that address is kept.

/**
 * @param {{week?: number, title?: string, sourceUrl?: string}|null} existing  the feed on disk
 * @param {{week: number, title: string, downloadUrl: string}} lesson          the lessons.json entry
 * @param {string} resolved                                                    what resolveCorsFriendlyVideoUrl returned
 * @returns {string}
 */
export function keepResolvedUrl(existing, lesson, resolved) {
  const failed = resolved === lesson.downloadUrl;
  if (
    failed &&
    existing &&
    existing.week === lesson.week &&
    existing.title === lesson.title &&
    typeof existing.sourceUrl === 'string' &&
    existing.sourceUrl &&
    existing.sourceUrl !== lesson.downloadUrl
  ) {
    return existing.sourceUrl;
  }
  return resolved;
}

export const ORIGIN = 'https://awana.kvbchurch.org';

/** Resolve a lesson's downloadUrl redirect to its final CDN URL, server-side,
 * so the browser never has to follow a cross-origin redirect that lacks CORS
 * headers of its own. The HEAD sends the kiosk's Origin; the final URL is
 * kept only when the answer is ok and allows `*` or that origin. Otherwise
 * (or on any failure) falls back to the original URL (still fine for direct
 * <video> playback, just not for the Cache API pre-fetch): a transient
 * failure must never block writing the rest of the feed.
 * @param {string} downloadUrl
 * @param {typeof fetch} [fetchImpl]
 */
export async function resolveCorsFriendlyVideoUrl(downloadUrl, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(downloadUrl, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { Origin: ORIGIN },
      signal: AbortSignal.timeout(30000),
    });
    const allow = res.headers.get('access-control-allow-origin');
    if (res.ok && (allow === '*' || allow === ORIGIN)) {
      return res.url;
    }
  } catch {
    // fall through
  }
  return downloadUrl;
}
