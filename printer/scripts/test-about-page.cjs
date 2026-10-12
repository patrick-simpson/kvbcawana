// The family's one public page (the React site at awana.kvbchurch.org/: the
// label printer, the lobby signage + projector at #lobby, the Journey kiosk at
// #journey) keeps the rules of the three static about pages it replaced
// (printer/CLAUDE.md, "Public website"). The site has no browser test of its
// own, so these read its sources: nothing here would otherwise notice a screen
// recreation drifting from the kit, a brand face coming from Google, or an
// Awana logo slipping onto a public page.
//
// Reads only printer/ (the kit's mirror in print-server/public/brand/ is
// byte-identical to the lobby's canonical shared/brand/).
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
// What the browser acts on: the story a comment tells is allowed.
const live = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const PAGES = ['index.html', 'capabilities.html'];
const CSS = ['styles/site.css', 'styles/page.css', 'styles/lobby.css', 'styles/journey.css'];
const SECTIONS = ['components/Lobby.tsx', 'components/Journey.tsx'];
const COMPONENTS = ['App.tsx', 'components/Lobby.tsx', 'components/Journey.tsx', 'components/Features.tsx', 'components/Hero.tsx',
  'components/Showcase.tsx', 'components/Mocks.tsx', 'components/family/Family.tsx', 'components/family/ScreenIcons.tsx'];
const lobbyCss = live(read('styles/lobby.css'));
const journeyCss = live(read('styles/journey.css'));
const kitTokens = read('print-server/public/brand/tokens.css');
const kitFonts = read('print-server/public/brand/fonts.css');

let n = 0;
const test = (name, fn) => { fn(); n += 1; console.log(`ok - ${name}`); };

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return (m && (m[1] ?? m[2] ?? m[3]) || '').trim();
};
const token = (css, name) => (css.match(new RegExp(`${name}:\\s*([^;]+);`)) || [])[1]?.trim();
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// ── The faces: the kit's own, never Google's (owner, 2026-09-29) ──────────────
test('no page, section or style names Galindo or Lilita One', () => {
  // Galindo "looks too much like SpongeBob"; the projector retired Lilita One.
  for (const rel of [...PAGES, ...CSS, ...COMPONENTS]) {
    const text = live(read(rel));
    assert.doesNotMatch(text, /galindo/i, `${rel} names Galindo`);
    assert.doesNotMatch(text, /lilita/i, `${rel} names Lilita One`);
  }
});

test('Google Fonts is asked only for the editorial faces, never a brand face', () => {
  for (const rel of PAGES) {
    const families = [...live(read(rel)).matchAll(/fonts\.googleapis\.com\/css2\?([^"']+)/g)]
      .flatMap(([, query]) => [...query.replace(/&amp;/g, '&').matchAll(/family=([^:&@]+)/g)].map((m) => m[1]));
    assert.deepEqual(families.sort(), ['Fraunces', 'IBM+Plex+Mono', 'Source+Sans+3'], rel);
  }
});

test('Paytone One, Londrina Solid and Figtree load from the kit\'s own fonts.css', () => {
  assert.match(live(read('index.html')), /<link[^>]+rel="stylesheet"[^>]+href="\/lobby\/shared\/brand\/fonts\.css"/);
  for (const family of ['Paytone One', 'Londrina Solid', 'Figtree']) {
    assert.match(kitFonts, new RegExp(`font-family:\\s*'${family}'`));
  }
  // Every file the sheet names is really in the kit.
  for (const [, file] of kitFonts.matchAll(/url\('([^']+)'\)/g)) {
    assert.ok(existsSync(path.join(ROOT, 'print-server/public/brand', file)), `${file} is in the kit`);
  }
});

test('the lobby section names its three voices once, shout first, and no other family', () => {
  const voice = (name) => token(lobbyCss, `--cid-${name}`);
  assert.match(voice('shout'), /^"Paytone One"/);
  assert.match(voice('label'), /^"Londrina Solid"/);
  assert.match(voice('read'), /^"Figtree"/);
  assert.doesNotMatch(lobbyCss, /--cid-poster/);
  const allowed = new Set(['Paytone One', 'Arial Rounded MT Bold', 'Londrina Solid', 'Arial Narrow', 'Figtree', 'Segoe UI']);
  const named = [...lobbyCss.matchAll(/(?:--cid-(?:shout|label|read)|font(?:-family)?)\s*:[^;}]+/g)]
    .flatMap(([decl]) => [...decl.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  assert.deepEqual(new Set(named), allowed);
});

test('a one-weight brand face is never asked for a bold it does not have', () => {
  assert.match(lobbyCss, /\.cid-scr\s*\{[^}]*font-synthesis-weight:\s*none/);
  assert.match(lobbyCss, /\.cid-slide__text\s*\{[^}]*font:\s*400\b/); // the lobby headline is 400, as on the screens
  assert.match(journeyCss, /\.jd-ink\s*\{[^}]*font-synthesis-weight:\s*none/);
});

test('the three journey voices lead with the kit\'s families, in the kit\'s roles', () => {
  const voice = (name) => token(journeyCss, `--jd-${name}`);
  assert.match(voice('shout'), /^"Paytone One"/);
  assert.match(voice('label'), /^"Londrina Solid"/);
  assert.match(voice('read'), /^"Figtree"/);
  assert.match(token(kitTokens, '--brand-font-display'), /^'Paytone One'/);
  assert.match(token(kitTokens, '--brand-font-label'), /^'Londrina Solid'/);
  assert.match(token(kitTokens, '--brand-font-body'), /^'Figtree'/);
});

// The Google check above pins the css2 request's family list, but a brand face
// could reach the page by any other road: the v1 API (css?family=Paytone+One),
// a third-party mirror, a preload of a woff2, an @import, a page-local
// @font-face. Paytone One's and Londrina's licenses reserve their names, so the
// only copy this page may draw is the kit's own full file. So these list
// everything the pages fetch from another host and allow exactly one thing:
// the Google stylesheet for the editorial faces (and its preconnects).
const isExternal = (url) => /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(url); // absolute or protocol-relative
const isEditorialSheet = (l) => l.rel === 'stylesheet' && /^https:\/\/fonts\.googleapis\.com\/css2\?/.test(l.href);
const isGooglePreconnect = (l) => l.rel === 'preconnect' && ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'].includes(l.href);

test('every <link> to another host is the one editorial Google stylesheet or a Google preconnect', () => {
  for (const rel of PAGES) {
    const links = [...live(read(rel)).matchAll(/<link\b[^>]*>/gi)].map(([tag]) => ({ rel: attr(tag, 'rel').toLowerCase(), href: attr(tag, 'href') }));
    assert.deepEqual(links.filter((l) => isExternal(l.href) && !isEditorialSheet(l) && !isGooglePreconnect(l)), [], rel);
    assert.equal(links.filter(isEditorialSheet).length, 1, rel);
  }
});

test('no @import, no page-local @font-face, no url() to another host in the site\'s styles', () => {
  for (const rel of CSS) {
    const css = live(read(rel));
    // site.css imports its own stylesheets and Tailwind; nothing else may be imported.
    const imports = [...css.matchAll(/@import\s+(?:url\()?["']?([^"')\s;]+)/gi)].map((m) => m[1]);
    assert.deepEqual(imports.filter((i) => i !== 'tailwindcss' && !i.startsWith('./')), [], `${rel} @import`);
    assert.doesNotMatch(css, /@font-face\b/i, `${rel} declares a font`);
    const urls = [...css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi)].map((m) => (m[1] ?? m[2] ?? m[3]).trim());
    assert.deepEqual(urls.filter(isExternal), [], `${rel} url()`);
  }
});

test('no address on the page names a brand face', () => {
  let found = 0;
  for (const rel of [...PAGES, ...COMPONENTS]) {
    const addresses = live(read(rel)).match(/(?:https?:)?\/\/[^\s"'<>)]+/gi) || [];
    found += addresses.length;
    assert.deepEqual(addresses.filter((a) => /paytone|londrina|figtree|galindo|lilita/i.test(a)), [], rel);
  }
  assert.ok(found > 0, 'found the page\'s addresses');
});

// ── The Journey start screen is the kit's ────────────────────────────────────
test('the Journey start-screen recreation is drawn in the kit\'s Journey colours', () => {
  const same = (mine, kit) => assert.equal(token(journeyCss, mine).toLowerCase(), token(kitTokens, kit).toLowerCase(), `${mine} is ${kit}`);
  same('--jd-ink', '--brand-journey-ink');
  same('--jd-purple', '--brand-journey');
  same('--jd-deep', '--brand-journey-deep');
  same('--jd-tint', '--brand-journey-tint');
  same('--jd-hot-deep', '--brand-hot-deep');
  // The button's orange is the one deliberate departure: a shade deeper than
  // the kit's hot, so its white label passes AA at the size a mock draws it.
  const hot = token(journeyCss, '--jd-hot');
  assert.notEqual(hot.toLowerCase(), token(kitTokens, '--brand-hot').toLowerCase());
  assert.ok(contrast('#ffffff', hot) >= 4.5, `white on ${hot} passes AA`);
  assert.ok(contrast('#ffffff', token(kitTokens, '--brand-hot')) < 4.5, 'and the kit\'s own would not, which is why');
});

test('the Journey start-screen rules use the kit, not the pre-kit black, red, gold and system font', () => {
  const splash = [...journeyCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, selector, body]) => ({ selector: selector.trim(), body }))
    .filter(({ selector }) => /\.jd-(splash|kbtn|ink|wave|doodles|art|demo-splash)/.test(selector));
  assert.ok(splash.length >= 15, 'found the start screen\'s rules');
  for (const { selector, body } of splash) {
    assert.doesNotMatch(body, /--jd-red|--jd-gold|--jd-kiosk-font|#000\b|#c8102e|#f2b705/i, selector);
  }
  // Fig. 1 sits on the indigo field, not the black one the other recreations keep.
  assert.match(live(read('components/Journey.tsx')), /className="fam-frame__screen jd-ink"[^>]*>\s*<div className="jd-splash">/);
});

test('the lobby recreations keep the lobby\'s two deliberate AA departures', () => {
  assert.match(lobbyCss, /\.cid-moment__kicker\s*\{[^}]*color:\s*#fff/); // white on the club's deep wave, not its pale tint
  assert.match(lobbyCss, /--cid-hot:\s*#cf4518/i); // not the kit's #F15A28
  assert.ok(contrast('#ffffff', '#cf4518') >= 4.5);
});

// ── The public page's own rules ──────────────────────────────────────────────
test('the page draws its own art: no image, no Awana wordmark, nothing copied from the kit', () => {
  for (const rel of [...COMPONENTS, 'index.html']) {
    const text = live(read(rel));
    assert.doesNotMatch(text, /<img\b/i, `${rel} has an <img>`);
    assert.doesNotMatch(text, /brand\/(logos|shapes|doodles)\//, `${rel} reaches into the kit's art`);
    assert.doesNotMatch(text, /Awana-?Clubs-?(logo|mark)|awana-logo|club-?mark/i, `${rel} names an Awana mark`);
  }
});

test('the not-affiliated line is in the disclaimer bar, the meta description and the footer', () => {
  const family = read('components/family/Family.tsx');
  assert.match(family, /<p className="fam-disclaimer"[\s\S]*Not affiliated with or endorsed by Awana<sup>®<\/sup> Clubs International/);
  assert.match(family, /<div className="fam-footer__legal">[\s\S]*NOT AFFILIATED WITH OR ENDORSED BY AWANA CLUBS INTERNATIONAL/);
  for (const rel of PAGES) {
    const description = live(read(rel)).match(/<meta name="description" content="([^"]*)"/)[1];
    assert.match(description, /Not affiliated with or endorsed by Awana® Clubs International\./, rel);
  }
});

test('links out go only to the three repos, this app\'s own downloads and this page\'s own sections, never to a live screen', () => {
  for (const rel of [...COMPONENTS, 'components/InstallGuide.tsx', 'components/Faq.tsx']) {
    const text = live(read(rel));
    for (const [, url] of text.matchAll(/(?:href=|=\s*|:\s*)["'`{]?(https?:\/\/[^\s"'`}<)]+)/g)) {
      if (/awana\.kvbchurch\.org/.test(url)) {
        // the home page itself, with a section, and the app's stable download links
        assert.match(url, /^https:\/\/awana\.kvbchurch\.org\/(?:#[a-z-]*|download\/[a-z-]+)?$/, `${rel}: ${url}`);
      }
      if (/awana\.kvbchurch\.org/.test(url)) assert.doesNotMatch(url, /countdown\.html|\/lobby\/?(?:index\.html)?$|\/journey\/?(?:index\.html)?$/, `${rel}: ${url} is a live screen`);
    }
    assert.doesNotMatch(text, /href=["'](?:\.\.?\/)?(?:lobby|journey)\/?(?:index\.html|countdown\.html)?["']/, `${rel} links a live screen`);
  }
});

test('the Journey section keeps the licensing wording strict and the room students', () => {
  const text = live(read('components/Journey.tsx'));
  // Never links to, names or advertises a lesson video, transcoded copy, release asset, transcript file, handout or slide image.
  assert.doesNotMatch(text, /\.mp4|\.vtt|releases\/download|journey-videos|<video\b|<source\b/i);
  assert.doesNotMatch(text, /re-?host|mirror|re-?encod|transcod|a smaller copy|a copy of/i);
  assert.match(text, /already licenses through its own Awana/);
  // (the one use is the Check-in Display's own line in the day's timeline: it welcomes children at the lobby)
  assert.doesNotMatch(text.replace('welcoming children by first name', ''), /\bchildren\b/i, 'Journey is the high-school ministry: students, never children');
});

test('the anchors people link to still resolve, and so do the page\'s own links', () => {
  const sources = [...COMPONENTS, 'components/Simulator.tsx', 'components/InstallGuide.tsx', 'components/Faq.tsx'].map((rel) => live(read(rel))).join('\n');
  const ids = new Set([...sources.matchAll(/\bid=["']([^"']+)["']/g)].map((m) => m[1]));
  for (const id of ['install', 'simulator', 'faq', 'features', 'how-it-works', 'family', 'lobby', 'journey']) {
    assert.ok(ids.has(id), `#${id} exists`);
  }
  const missing = [...sources.matchAll(/href=["']#([^"']+)["']/g)].map((m) => m[1]).filter((id) => !id.startsWith('i-') && !ids.has(id)); // (#i-… are sprite symbols)
  assert.deepEqual([...new Set(missing)], []);
});

test('no id repeats on the home page, so every anchor has one target', () => {
  const sources = ['App.tsx', 'components/Hero.tsx', 'components/Showcase.tsx', 'components/Features.tsx', 'components/Simulator.tsx',
    'components/InstallGuide.tsx', 'components/Faq.tsx', 'components/Lobby.tsx', 'components/Journey.tsx']
    .map((rel) => live(read(rel))).join('\n');
  const all = [...sources.matchAll(/\bid=["']([^"']+)["']/g)].map((m) => m[1]);
  const dupes = all.filter((id, i) => all.indexOf(id) !== i);
  assert.deepEqual(dupes, []);
});

test('the two sections are the ones the old about pages redirect to', () => {
  for (const [rel, id] of [['components/Lobby.tsx', 'lobby'], ['components/Journey.tsx', 'journey']]) {
    assert.match(read(rel), new RegExp(`<section id="${id}"`));
  }
  assert.equal(SECTIONS.length, 2);
});

console.log(`\n${n} checks passed`);
