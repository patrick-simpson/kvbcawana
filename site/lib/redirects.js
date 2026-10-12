// The two static about pages (/lobby/about.html, /journey/about.html) were
// merged into the one page at / (the printer's React site): the lobby signage
// and projector are its #lobby section, the Journey kiosk its #journey one.
// Old links, bookmarks and search results keep working: a permanent redirect
// to the section (Cloudflare Pages _redirects, written by site/build.mjs).
// Both spellings, because Pages serves foo.html at /foo.
export const PAGE_REDIRECTS = [
  ['/lobby/about.html', '/#lobby'],
  ['/lobby/about', '/#lobby'],
  ['/journey/about.html', '/#journey'],
  ['/journey/about', '/#journey'],
];

export const pageRedirects = () => PAGE_REDIRECTS.map(([from, to]) => `${from} ${to} 301`);
