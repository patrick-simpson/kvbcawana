// The two static about pages (/lobby/about.html, /journey/about.html) were
// merged into the one page at / (the printer's React site): the lobby signage
// and projector are its #lobby section, the Journey kiosk its #journey one.
// Old links, bookmarks and search results keep working: a permanent redirect
// to the section (Cloudflare Pages _redirects, written by site/build.mjs).
// Both spellings, because Pages serves foo.html at /foo.
// The desk check-in page (/desk) became the one check-in page at /checkin
// (owner, 2026-10-12): bookmarks at the desk land there.
export const PAGE_REDIRECTS = [
  ['/lobby/about.html', '/#lobby'],
  ['/lobby/about', '/#lobby'],
  ['/journey/about.html', '/#journey'],
  ['/journey/about', '/#journey'],
  ['/desk', '/checkin/'],
  ['/desk/', '/checkin/'],
  ['/desk/index.html', '/checkin/'],
  // The letterhead maker became the Print tool (owner 2026-11-05): old bookmarks land there.
  ['/tools/letterhead', '/tools/print/'],
  ['/tools/letterhead/', '/tools/print/'],
  ['/tools/letterhead/index.html', '/tools/print/'],
];

export const pageRedirects = () => PAGE_REDIRECTS.map(([from, to]) => `${from} ${to} 301`);

// Cast moved to its own site (owner 2026-11-09): https://cast.kvbchurch.org, the presenter
// page at its root and the TV page at /screen/. Every old awana.kvbchurch.org/cast
// address goes there permanently with its path kept (/cast/ -> /, /cast/screen/ ->
// /screen/); a QR code's #code= fragment rides along (the browser keeps it). Pages
// follows a redirect even where a file exists, and this site builds no /cast copy.
export const CAST_HOME = 'https://cast.kvbchurch.org';
export const CAST_REDIRECTS = [
  ['/cast', `${CAST_HOME}/`],
  ['/cast/', `${CAST_HOME}/`],
  ['/cast/*', `${CAST_HOME}/:splat`],
];

export const castRedirects = () => CAST_REDIRECTS.map(([from, to]) => `${from} ${to} 301`);
