// Which `sourceUrl` the nightly feed should carry for a lesson.
//
// fetch-current-lesson.mjs resolves clubs.awana.org's redirect to the CDN URL
// with one HEAD request, and falls back to the ORIGINAL url when that request
// fails. `sourceUrl` is the lesson's identity (sameLesson), so one transient
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
