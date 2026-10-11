// The stable download links (site/build.mjs writes them into _redirects): the
// newest installer each update feed names, else the releases page until a
// feed exists. Pure, so site/test/downloads.test.mjs pins it.
//
// /download/kvbc-awana and /download/club-label-printer are the same app
// since 9.0.0 (UNIFIED-APP.md: the printer became KVBC Awana and keeps its
// feed), so both follow printer/latest.yml; the old name stays for every link
// already printed or bookmarked (the Install Guide, the extension popup, the
// app's own repair). /download/lobby-display stays the sound room app's last
// release (the 2.1.0 bridge), never a KVBC Awana installer.

/** The installer's absolute URL in an electron-builder feed, or null. @param {string} text */
export function installerFromFeed(text) {
  const m = /^\s*(?:-\s+)?url:\s*(https:\/\/\S+\.exe)\s*$/m.exec(String(text || ''));
  return m ? m[1] : null;
}

/**
 * The _redirects lines for the downloads.
 * @param {(feed: string) => string | null} readFeed  a feed's text by its path under site/updates, null when missing
 * @param {string} releases  where to send people when a feed has no installer yet
 */
export function downloadRedirects(readFeed, releases) {
  const newest = (feed) => installerFromFeed(readFeed(feed)) || releases;
  const app = newest('printer/latest.yml');
  return [
    `/download/kvbc-awana ${app} 302`,
    `/download/club-label-printer ${app} 302`,
    `/download/lobby-display ${newest('lobby/lobby.yml')} 302`,
  ];
}
