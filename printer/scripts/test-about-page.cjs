// The public pages of awana.kvbchurch.org: the home page (/, one club night
// played on the REAL screens, owner 2026-10-16) and /help (the install guide and
// the FAQ), plus the capabilities reference. These read the sources for the rules
// in CLAUDE.md, "Public website": the kit's own faces and nothing from another
// host, the kit's art from its one copy, the trademark line, the reel's contract,
// motion that stops for reduced motion, AA colour pairs, the anchors people link
// to, the screens framed only as showcase twins, Journey's wording, and where
// links may go.
const assert = require('node:assert/strict');
const { existsSync, readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const REPO = path.resolve(ROOT, '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
// What the browser acts on: the story a comment tells is allowed.
const live = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const PAGES = ['index.html', 'help.html'];
const HOME = ['App.tsx', 'HelpPage.tsx', 'components/InstallGuide.tsx', 'components/Faq.tsx',
  ...readdirSync(path.join(ROOT, 'components/home')).filter((f) => f.endsWith('.tsx')).map((f) => `components/home/${f}`)];
const HOME_PAGE = ['App.tsx', 'components/home/Chrome.tsx', 'components/home/Night.tsx', 'components/home/Reel.tsx', 'components/home/Twin.tsx'];
const HELP_PAGE = ['HelpPage.tsx', 'components/InstallGuide.tsx', 'components/Faq.tsx', 'components/home/Chrome.tsx'];
const CSS = 'styles/home.css';
const css = read(CSS);
const kitTokens = readFileSync(path.join(REPO, 'shared/brand/tokens.css'), 'utf8');
const kitFonts = readFileSync(path.join(REPO, 'shared/brand/fonts.css'), 'utf8');

let n = 0;
const test = (name, fn) => { fn(); n += 1; console.log(`ok - ${name}`); };

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return (m && (m[1] ?? m[2] ?? m[3]) || '').trim();
};
const isExternal = (url) => /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(url);
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
// A colour as home.css means it: its own value, a var() of home.css or of the kit's tokens.css.
const declared = (name) => {
  const m = live(css).match(new RegExp(`${name}:\\s*([^;]+);`)) || kitTokens.match(new RegExp(`${name}:\\s*([^;]+);`));
  assert.ok(m, `${name} is declared`);
  const v = m[1].trim();
  const ref = v.match(/^var\((--[a-z0-9-]+)\)$/i);
  return ref ? declared(ref[1]) : v.toLowerCase();
};
const club = (id, prop) => {
  const rule = live(css).match(new RegExp(`\\[data-club="${id}"\\]\\s*\\{([^}]*)\\}`))[1];
  const v = rule.match(new RegExp(`${prop}:\\s*([^;]+);`))[1].trim();
  const ref = v.match(/^var\((--[a-z0-9-]+)\)$/i);
  return (ref ? declared(ref[1]) : v).toLowerCase();
};

// ── Faces and hosts: the kit's own files, nothing from another host ──────────
test('no page, style or component names Galindo or Lilita One', () => {
  // Galindo "looks too much like SpongeBob" (owner, 2026-09-29); the projector retired Lilita One.
  for (const rel of [...PAGES, 'capabilities.html', CSS, ...HOME]) {
    const text = live(read(rel));
    assert.doesNotMatch(text, /galindo/i, `${rel} names Galindo`);
    assert.doesNotMatch(text, /lilita/i, `${rel} names Lilita One`);
  }
});

test('the two pages load Paytone One, Londrina Solid and Figtree from the kit\'s own fonts.css, and nothing from another host', () => {
  for (const rel of PAGES) {
    const page = live(read(rel));
    assert.match(page, /<link[^>]+rel="stylesheet"[^>]+href="\/lobby\/shared\/brand\/fonts\.css"/, rel);
    const external = [...page.matchAll(/<(?:link|script|img|source|video|iframe)\b[^>]*>/gi)]
      .map(([tag]) => attr(tag, 'href') || attr(tag, 'src')).filter(isExternal);
    assert.deepEqual(external, [], `${rel} fetches from another host`);
    assert.doesNotMatch(page, /fonts\.googleapis|fonts\.gstatic/, rel);
  }
  for (const family of ['Paytone One', 'Londrina Solid', 'Figtree']) {
    assert.match(kitFonts, new RegExp(`font-family:\\s*'${family}'`));
  }
});

test('the capabilities reference asks Google only for its editorial faces, never a brand face', () => {
  const page = live(read('capabilities.html'));
  const families = [...page.matchAll(/fonts\.googleapis\.com\/css2\?([^"']+)/g)]
    .flatMap(([, query]) => [...query.replace(/&amp;/g, '&').matchAll(/family=([^:&@]+)/g)].map((m) => m[1]));
  assert.deepEqual(families.sort(), ['Fraunces', 'IBM+Plex+Mono', 'Source+Sans+3']);
});

test('home.css declares no font, imports only the kit\'s tokens and reaches no other host', () => {
  const sheet = live(css);
  assert.doesNotMatch(sheet, /@font-face\b/i);
  const imports = [...sheet.matchAll(/@import\s+(?:url\()?["']?([^"')\s;]+)/gi)].map((m) => m[1]);
  assert.deepEqual(imports, ['../../shared/brand/tokens.css']);
  const urls = [...sheet.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi)].map((m) => (m[1] ?? m[2] ?? m[3]).trim());
  assert.deepEqual(urls.filter(isExternal), []);
  // The three voices come from the kit's tokens, never a family named here.
  assert.match(sheet, /--shout:\s*var\(--brand-font-display\)/);
  assert.match(sheet, /--label:\s*var\(--brand-font-label\)/);
  assert.match(sheet, /--read:\s*var\(--brand-font-body\)/);
  assert.doesNotMatch(sheet.replace(/font:[^;]*(ui-monospace|system-ui)[^;]*;/g, ''), /font(?:-family)?:[^;]*["'](?:Paytone|Londrina|Figtree)/i);
});

test('no address on the pages names a brand face', () => {
  for (const rel of [...PAGES, ...HOME]) {
    const addresses = live(read(rel)).match(/(?:https?:)?\/\/[^\s"'<>)]+/gi) || [];
    assert.deepEqual(addresses.filter((a) => /paytone|londrina|figtree|galindo|lilita/i.test(a)), [], rel);
  }
});

// ── The kit's art, from its one copy; Awana marks with the trademark line ────
test('every shape, doodle and club mark is the kit\'s own file, imported from shared/brand', () => {
  const kit = read('components/home/Kit.tsx');
  const imports = [...kit.matchAll(/from\s+'([^']+\.svg)'/g)].map((m) => m[1]);
  assert.ok(imports.length >= 18, 'the club marks are imported');
  for (const rel of imports) {
    assert.match(rel, /^\.\.\/\.\.\/\.\.\/shared\/brand\/logos\/[a-z-]+\.svg$/, rel);
    assert.ok(existsSync(path.join(ROOT, 'components/home', rel)), `${rel} is in the kit`);
  }
  for (const folder of ['doodles', 'shapes']) {
    assert.match(kit, new RegExp(`import\\.meta\\.glob<string>\\('\\.\\./\\.\\./\\.\\./shared/brand/${folder}/\\*\\.svg'`), folder);
  }
  // Every shape and doodle name the pages ask for is a file in the kit.
  const names = new Set();
  for (const rel of HOME) {
    for (const [, kind, name] of live(read(rel)).matchAll(/<(Doodle|Shape)\s+(?:key=\{[^}]*\}\s+)?name=["']([a-z0-9-]+)["']/g)) names.add(`${kind === 'Doodle' ? 'doodles' : 'shapes'}/${name}`);
  }
  assert.ok(names.size >= 6, 'found the pages\' shapes and doodles');
  for (const n of names) assert.ok(existsSync(path.join(REPO, 'shared/brand', `${n}.svg`)), `${n}.svg is in the kit`);
  // Nothing else on the pages is an image from elsewhere: every <img> draws a kit mark,
  // or a label the print server's own renderer drew (scripts/showcase-labels.cjs).
  for (const rel of HOME) {
    for (const [tag] of live(read(rel)).matchAll(/<img\b[^>]*>/g)) {
      const src = attr(tag, 'src');
      if (!src && /\bhidden\b/.test(tag)) continue; // the replica's empty club image (its alt names the club)
      assert.match(src, /^\{(?:LOGO\.(?:twoLineInk|twoLineWhite|fullWhite|stackedInk)|c\.(?:color|white)|spec\.club\.black|club\('[a-z]+'\)\.white|`\/showcase\/labels\/\$\{last\.first\.toLowerCase\(\)\}\.png`)\}$/, `${rel}: ${tag}`);
      assert.ok(/\balt=/.test(tag), `${rel}: ${tag} has alt`);
    }
  }
});

test('the trademark line is in the disclaimer bar, the footer and both meta descriptions, word for word', () => {
  const LINE = 'Awana® and club marks are trademarks of Awana Clubs International, used here by a member church. Not affiliated with or endorsed by Awana.';
  const chrome = read('components/home/Chrome.tsx');
  assert.ok(chrome.includes(`export const TRADEMARK = '${LINE}';`));
  assert.match(chrome, /<p className="kv-disclaimer" role="note">\{TRADEMARK\}<\/p>/);
  assert.match(chrome, /<footer className="kv-footer">[\s\S]*<strong>\{TRADEMARK\}<\/strong>/);
  for (const rel of PAGES) {
    const description = live(read(rel)).match(/<meta name="description" content="([^"]*)"/)[1];
    assert.ok(description.includes(LINE), rel);
  }
  // Both pages render the header and the footer.
  for (const rel of ['App.tsx', 'HelpPage.tsx']) {
    assert.match(read(rel), /<Header page="(?:home|help)" \/>[\s\S]*<Footer \/>/, rel);
  }
});

// ── The reel ─────────────────────────────────────────────────────────────────
test('the reel plays /reel/ muted and inline, ends on its poster, waits under reduced motion, and has a stand-in', () => {
  const reel = live(read('components/home/Reel.tsx'));
  assert.match(reel, /FILM = '\/reel\/reel\.mp4'/);
  assert.doesNotMatch(reel, /reel-1080|reel-720/, 'one film, no size choice');
  assert.match(reel, /POSTER = '\/reel\/poster\.jpg'/);
  for (const f of ['reel.mp4', 'poster.jpg']) assert.ok(require('fs').existsSync(require('path').join(__dirname, '..', 'public', 'reel', f)), `public/reel/${f} is committed, so the page never shows Coming soon`);
  assert.ok(require('fs').statSync(require('path').join(__dirname, '..', 'public', 'reel', 'reel.mp4')).size <= 6.2 * 1000 * 1000, 'the film stays about 5.5 MB (720p, owner 2026-10-16)');
  assert.match(reel, /<video[\s\S]*playsInline[\s\S]*muted[\s\S]*\/>/);
  assert.match(reel, /prefers-reduced-motion: reduce/);
  assert.match(reel, /onEnded=\{\(e\) => \{ setMode\('ended'\); e\.currentTarget\.load\(\);/);
  assert.match(reel, /onError=\{\(\) => setMode\('missing'\)\}/);
  assert.match(reel, /Tap for sound/);
  assert.match(reel, /aria-label=\{mode === 'paused' \? 'Play' : 'Pause'\}/, 'anything moving longer than five seconds can be paused');
  assert.match(read('App.tsx'), /<section id="reel"[\s\S]*<Reel \/>/);
});

// ── Motion ───────────────────────────────────────────────────────────────────
test('every animation lives under prefers-reduced-motion: no-preference', () => {
  const sheet = live(css);
  const start = sheet.indexOf('@media (prefers-reduced-motion: no-preference) {');
  assert.ok(start > 0, 'the motion block exists');
  let depth = 0, end = start;
  for (let i = sheet.indexOf('{', start); i < sheet.length; i += 1) {
    if (sheet[i] === '{') depth += 1;
    if (sheet[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  const outside = sheet.slice(0, start) + sheet.slice(end + 1);
  assert.doesNotMatch(outside, /@keyframes|\banimation(?:-name)?\s*:/, 'an animation outside the no-preference block');
  assert.ok((sheet.slice(start, end).match(/@keyframes/g) || []).length >= 8);
  // Script-driven motion checks the same preference.
  for (const rel of ['components/home/Night.tsx', 'components/home/Chrome.tsx', 'components/home/Reel.tsx']) {
    assert.match(read(rel), /prefers-reduced-motion: reduce/, rel);
  }
});

// ── Colour: AA for text ──────────────────────────────────────────────────────
test('the text colour pairs pass AA', () => {
  const white = '#ffffff';
  const pairs = [
    ['white on the hot buttons', white, declared('--hot-btn')],
    ['white on the simulator red', white, declared('--sim-red')],
    ['navy on the sky', declared('--navy'), declared('--sky')],
    ['ink on the sun band', declared('--ink'), declared('--sun')],
    ['white on the footer', white, declared('--footer')],
    ['ink-2 on paper', declared('--ink-2'), declared('--paper')],
    ['navy on the sky (the opening)', declared('--navy'), declared('--sky')],
    ['ink on the sun (6:00)', declared('--ink'), declared('--sun')],
    ['white on the Journey room (6:30)', white, declared('--brand-journey-ink')],
    ['white on dusk (7:30)', white, declared('--navy')],
    ['the hot program times on paper', declared('--hot-btn'), '#ffffff'],
  ];
  for (const id of [/* the club plates the old page drew are gone; the colours stay pinned */ 'puggles', 'cubbies', 'sparks', 'tnt', 'trek', 'journey']) {
    pairs.push([`${id} text on white`, club(id, '--c-text'), white]);
    pairs.push([`white on the ${id} plate`, white, club(id, '--c-text')]);
  }
  // Plates with white text sit on --c-text, never the kit's deep (T&T's fails).
  assert.doesNotMatch(live(css), /background:\s*var\(--c-deep\)/);
  for (const [what, fg, bg] of pairs) assert.ok(contrast(fg, bg) >= 4.5, `${what}: ${fg} on ${bg} is ${contrast(fg, bg).toFixed(2)}`);
  // The hot button is the one deliberate departure: the kit's own hot would fail.
  assert.ok(contrast(white, declared('--brand-hot')) < 4.5);
});

// ── Anchors and links ────────────────────────────────────────────────────────
const ids = (files) => files.map((rel) => live(read(rel))).join('\n').match(/\bid=["']([^"']+)["']/g).map((m) => m.slice(4, -1));

test('the anchors people link to resolve: the home page\'s sections, the old about pages\' targets, /help\'s two', () => {
  const home = new Set(ids(HOME_PAGE));
  for (const id of ['top', 'night', 'doors', 'projector', 'journey', 'pickup', 'reel', 'lobby', 'labels', 'phone', 'app', 'main']) assert.ok(home.has(id), `#${id} on /`);
  const help = new Set(ids(HELP_PAGE));
  for (const id of ['install', 'faq', 'main']) assert.ok(help.has(id), `#${id} on /help`);
  // The old about pages' redirects land on sections that exist.
  const redirects = readFileSync(path.join(REPO, 'site/lib/redirects.js'), 'utf8');
  for (const [, id] of redirects.matchAll(/'\/#([a-z-]+)'/g)) assert.ok(home.has(id), `/#${id} (site/lib/redirects.js)`);
  // Old links to the install guide and the FAQ go to /help.
  const index = read('index.html');
  for (const hash of ['#install', '#how-it-works', '#faq']) assert.match(index, new RegExp(`'${hash}': '/help#(?:install|faq)'`), hash);
  // Every in-page link has a target on its page.
  for (const [files, have] of [[HOME_PAGE, home], [HELP_PAGE, help]]) {
    const missing = files.flatMap((rel) => [...live(read(rel)).matchAll(/href=["']#([^"']+)["']/g)].map((m) => m[1]))
      .filter((id) => !id.startsWith('kv-') && !have.has(id));
    assert.deepEqual([...new Set(missing)], []);
  }
});

test('no id repeats on a page', () => {
  for (const files of [HOME_PAGE, HELP_PAGE]) {
    const all = ids(files).filter((id) => !/\$\{/.test(id));
    const dupes = all.filter((id, i) => all.indexOf(id) !== i);
    assert.deepEqual(dupes, []);
  }
});

test('links out go only to the repo, the app\'s own downloads, this site\'s pages and sections, never to a live screen', () => {
  for (const rel of HOME) {
    const text = live(read(rel));
    for (const [, url] of text.matchAll(/(?:href=|=\s*|:\s*)["'`{]?(https?:\/\/[^\s"'`}<)]+)/g)) {
      assert.match(url, /^https:\/\/(?:github\.com\/patrick-simpson\/kvbcawana(?:\/tree\/main\/(?:printer|lobby|journey))?|awana\.kvbchurch\.org\/(?:download\/[a-z-]+)?)$/, `${rel}: ${url}`);
    }
    for (const [, href] of text.matchAll(/href=["']([^"'#][^"']*)["']/g)) {
      assert.match(href, /^(?:\/|\/help(?:#[a-z]+)?|\/#[a-z]+|\/capabilities\.html|\/download\/[a-z-]+)$/, `${rel}: ${href}`);
    }
    assert.doesNotMatch(text, /["'`]\/(?:lobby|journey)\/?(?:index\.html|countdown(?:\.html)?)?["'`]/, `${rel} links a live screen`);
  }
});

// ── The real screens, only as showcase twins (owner, 2026-10-16) ─────────────
test('the home page frames the screens only as their showcase twins, and only the check-in phone takes taps', () => {
  const twin = live(read('components/home/Twin.tsx'));
  const srcs = [...twin.matchAll(/:\s*'(\/[^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(srcs.sort(), ['/checkin/showcase.html', '/journey/showcase.html', '/lobby/countdown-showcase.html', '/lobby/settings-showcase.html', '/lobby/showcase.html']);
  assert.match(twin, /e\.source !== win \|\| e\.origin !== window\.location\.origin/, 'a twin is heard only from its own frame, same origin');
  assert.match(twin, /win\.postMessage\(msg, window\.location\.origin\)/, 'a twin is told things only on this origin');
  assert.match(twin, /pointerEvents: interactive \? 'auto' : 'none'/);
  const night = live(read('components/home/Night.tsx'));
  assert.equal((night.match(/\binteractive\b/g) || []).length, 1, 'one interactive screen: the check-in phone');
  assert.match(night, /kind="checkin"[^>]*interactive/);
  // Every made-up name on the page is the showcase club's (site/showcase/stub.js).
  const stub = readFileSync(path.join(REPO, 'site/showcase/stub.js'), 'utf8');
  for (const [, first, last] of night.matchAll(/'([A-Z][a-z]+) ([A-Z][a-z]+)'/g)) assert.ok(stub.includes(`['${first}', '${last}'`), `${first} ${last} is the showcase's`);
});

// ── The old home page, kept unlisted (owner, 2026-10-16) ─────────────────────
test('the old home page lives on at /classic, out of search engines, on its own stylesheet', () => {
  const page = read('classic.html');
  assert.match(page, /<meta name="robots" content="noindex, nofollow" \/>/);
  assert.match(page, /src="\/classic\.tsx"/);
  assert.match(read('classic.tsx'), /import '\.\/styles\/classic\.css';/);
  assert.match(read('vite.config.ts'), /classic: path\.resolve\(__dirname, 'classic\.html'\)/);
  assert.match(readFileSync(path.join(REPO, 'site/build.mjs'), 'utf8'), /'\/classic\*',\s*'  Cache-Control: no-cache',\s*'  X-Robots-Tag: noindex, nofollow'/);
});

// ── Journey's wording (CLAUDE.md, "Public website"; owner 2026-10-16) ─────────
test('the Journey scene says whose curriculum it is, and its room is students', () => {
  const night = live(read('components/home/Night.tsx'));
  const journey = night.slice(night.indexOf('const Journey: React.FC'), night.indexOf('const STILL_HERE'));
  assert.ok(journey.length > 200, 'found the Journey scene');
  assert.match(journey, /already licenses through its own Awana Ministry Membership/);
  assert.match(journey, /students/);
  assert.doesNotMatch(journey, /\bchildren\b|\bkids\b/i, 'Journey is the high-school ministry: students');
  // The page never links a lesson file or release asset (the twin plays what the kiosk plays).
  for (const rel of HOME_PAGE) assert.doesNotMatch(live(read(rel)), /\.vtt|releases\/download|journey-videos|current-lesson-video/i, rel);
});

console.log(`\n${n} checks passed`);
