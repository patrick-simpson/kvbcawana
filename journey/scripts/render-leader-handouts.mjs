// Render the per-lesson Leader Handout PDFs in public/handouts/.
//
// Page 1 is the week at a glance, in the 2026-27 catalog look (the same kit
// the kiosk wears: Journey's club colours, the wave, the corner tab, doodles
// in a cluster of three, Paytone One shouts, Londrina Solid labels, Figtree
// reads): Big Idea, Key Points, the Scripture the video cites, and two
// question sets, "For you" (the leader's own reflection) and "Ask your group"
// (what the leader asks the students; left off when a week has none). It is
// read mostly ON A SCREEN (the kiosk, a phone, a laptop), so it is set in
// colour, full bleed; it still prints cleanly on Letter.
//
// After it come the transcript pages: that week's Leader Video, edited into
// readable prose in data/leader-transcript-prose.json, with a timestamp beside
// each paragraph so a leader can jump back to the moment in the video, and
// section headings to skim by. Both data files are hand-editable: correct the
// JSON and re-run. data/leader-handout-summaries.json is v2 (questions =
// { forYou, forGroup }); page 1 is laid out to hold the longest week the
// limits in scripts/handout-limits.mjs allow (`--fit-check` proves it).
//
// Output is a TAGGED PDF (real structure tags via Chromium's tagged export);
// scripts/finalize-handout-pdf.py then stamps /Lang, the XMP + docinfo title
// and DisplayDocTitle. Run that second: a handout is not finished until it
// is tagged, titled and language-marked.
//
// Fonts: the kit's own files from lobby/shared/brand/fonts/, the WHOLE font
// (never a webfont subset of a reserved-name face; see the kit README); the
// PDF embeds what it draws, as every PDF does (document embedding, which the
// OFL allows). Art: kit shapes and doodles, path data read from the kit at
// render time with only the fill set, and the Journey club mark, as on the
// kiosk. No Awana lesson art.
//
// Week 27 has no Leader Video, so it has no handout at all.
//
// It also refreshes public/leader-prep.json (the same page-1 summary as data
// the kiosk renders itself; see scripts/build-leader-prep.mjs), so the served
// copy cannot drift from the handouts it was generated beside.
//
// Usage: node scripts/render-leader-handouts.mjs [week ...]   (default: all)
//        node scripts/render-leader-handouts.mjs --fit-check  (worst case
//          at every limit, no file written; exit 1 if page 1 overflows)
//        HANDOUT_SCREENSHOTS=<dir> also writes week-NN-page-K.png of pages 1-2
import { chromium } from 'playwright-core';
import { writeLeaderPrep, questionSets } from './build-leader-prep.mjs';
import { worstCaseSummary } from './handout-limits.mjs';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const REPO = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const KIT = path.join(REPO, '..', 'lobby', 'shared', 'brand');
const OUT_DIR = path.join(REPO, 'public', 'handouts');
const SUMMARIES_PATH = path.join(REPO, 'data', 'leader-handout-summaries.json');
const PROSE_PATH = path.join(REPO, 'data', 'leader-transcript-prose.json');
const PROSE = existsSync(PROSE_PATH) ? JSON.parse(readFileSync(PROSE_PATH, 'utf8')).weeks : {};

// Journey's club colours (tokens.css); hot is the one thing to press, here
// the "Ask your group" card the leader takes into the room.
const C = {
  purple: '#8A649D',
  deep: '#56467F',
  ink: '#403A77',
  tint: '#DED5EA',
  hot: '#F15A28',
  hotDeep: '#9E3512',
  sun: '#FCB614',
  text: '#231F20',
  wash: '#F6F3FA',
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pad = (w) => String(w).padStart(2, '0');

// ── The kit, read from its one committed copy ────────────────────────────
const kitFile = (rel) => readFileSync(path.join(KIT, rel));
const fontURI = (file) => `data:font/ttf;base64,${kitFile(`fonts/${file}`).toString('base64')}`;
/** A kit SVG as a CSS url(), its path data untouched, currentColor filled. */
function art(rel, color, extra = (svg) => svg) {
  const svg = extra(kitFile(rel).toString('utf8').replace(/currentColor/g, color));
  return `url("data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}")`;
}
const stretch = (svg) => svg.replace('<svg ', '<svg preserveAspectRatio="none" ');
const svgURI = (rel) => `data:image/svg+xml;base64,${kitFile(rel).toString('base64')}`;

const FONTS = `
  @font-face { font-family: 'Paytone One'; font-weight: 400; src: url(${fontURI('PaytoneOne-Regular.ttf')}) format('truetype'); }
  @font-face { font-family: 'Londrina Solid'; font-weight: 400; src: url(${fontURI('LondrinaSolid-Regular.ttf')}) format('truetype'); }
  @font-face { font-family: 'Figtree'; font-weight: 300 900; src: url(${fontURI('Figtree-Variable.ttf')}) format('truetype'); }`;

const ART = {
  // The wave twice, as on the kiosk: the deep shade mirrored behind, then the
  // page colour in front, so the header ends on the catalog's S-curve.
  waveBack: art('shapes/wave-journey.svg', C.deep, (s) => stretch(s).replace('<path ', '<path transform="matrix(-1 0 0 1 576 0)" ')),
  waveFront: art('shapes/wave-journey.svg', '#ffffff', stretch),
  tab: art('shapes/tab-c-journey.svg', C.purple, stretch),
  sparkle: art('doodles/sparkle-4pt.svg', C.sun),
  dot: art('doodles/dot.svg', C.tint),
  squiggle: art('doodles/squiggle-s.svg', '#ffffff'),
  ring: art('doodles/ring.svg', C.purple),
  sparkleX: art('doodles/sparkle-4pt-x.svg', C.hot),
  zigzag: art('doodles/zigzag.svg', C.purple),
  mark: svgURI('logos/journey-white.svg'),
};

/** "Unit 2, Lesson 3: Pantheism" -> "Unit 2 · Lesson 3". */
function unitLine(title) {
  const m = /^Unit\s+(\d+),\s*Lesson\s+(\d+)/i.exec(title || '');
  return m ? `Unit ${m[1]} &middot; Lesson ${m[2]}` : '';
}

/** Cue number -> start time, read from the VTT the prose was edited from. */
function cueStarts(week) {
  const file = path.join(REPO, 'public', 'transcripts', `week-${pad(week)}-leader.vtt`);
  const starts = new Map();
  if (!existsSync(file)) return starts;
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const num = lines[i].trim();
    const time = (lines[i + 1] || '').trim();
    if (/^\d+$/.test(num) && time.includes('-->')) {
      const [h, m, s] = time.split('-->')[0].trim().split(':');
      starts.set(Number(num), Math.floor(Number(h) * 3600 + Number(m) * 60 + parseFloat(s)));
    }
  }
  return starts;
}

const clock = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

function transcriptHTML(week) {
  const prose = PROSE[String(week)];
  if (!prose || !Array.isArray(prose.paragraphs) || !prose.paragraphs.length) return '';
  const starts = cueStarts(week);
  const body = prose.paragraphs
    .map((p) => {
      const at = starts.get(p.fromCue);
      const stamp = at === undefined ? '' : `<span class="ts">${clock(at)}</span>`;
      const heading = p.heading ? `<h3>${esc(p.heading)}</h3>` : '';
      return `${heading}<p class="tp">${stamp}${esc(p.text)}</p>`;
    })
    .join('\n');
  return `<section class="transcript">
  <p class="t-kicker">Week ${week} &middot; Leader Video</p>
  <h2>The full transcript</h2>
  <p class="transcript-note">The talk from this week&rsquo;s Leader Video, lightly edited for reading.
  Times point back to that moment in the video.</p>
  ${body}
</section>`;
}

function questionCard(kind, label, note, list) {
  return `<section class="q q-${kind}" aria-labelledby="q-${kind}">
      <h2 id="q-${kind}" class="plate"><span>${label}</span></h2>
      <p class="q-note">${note}</p>
      <ol>${list.map((q) => `<li>${esc(q)}</li>`).join('')}</ol>
    </section>`;
}

export function renderHTML(d) {
  const week = d.week;
  const { forYou, forGroup } = questionSets(d.questions, week);
  const scriptures = (d.scriptures || []).filter(Boolean);
  const name = d.shortTitle || d.title;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Journey: Advocates Week ${week} Leader Handout — ${esc(d.title)}</title>
<style>
${FONTS}
  /* Page 1 is full bleed (its own named page with no margin; the art runs
     to the edge and the copy sits inside its own gutter). Every transcript
     page takes the margins from @page, never from body padding: body
     padding would only inset the first and last page. */
  @page { size: Letter; margin: 0.6in 0.7in 0.6in; }
  @page cover { size: Letter; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: 'Figtree', sans-serif; color: ${C.text}; font-size: 10.5pt; line-height: 1.38; }

  .cover { page: cover; width: 8.5in; height: 11in; position: relative; overflow: hidden; background: #fff; }

  /* ── Header: ink field, corner tab, the name shouted, wave below ── */
  .head { position: relative; background: ${C.ink}; color: #fff; height: 2.2in; padding: 0 0.6in; }
  .head::after {
    content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 0.5in;
    background: ${ART.waveFront} left bottom / 100% 100% no-repeat, ${ART.waveBack} left bottom / 100% 140% no-repeat;
  }
  .tab {
    position: absolute; left: 0; top: 0; width: 2.55in; height: 0.86in;
    background: ${ART.tab} left top / 100% 100% no-repeat;
    padding: 0.2in 0 0 0.6in;
    font-family: 'Londrina Solid', sans-serif; font-size: 21pt; line-height: 1; letter-spacing: 0.02em; color: #fff;
  }
  .mark { position: absolute; right: 0.6in; top: 0.34in; width: 1.55in; height: auto; }
  .doodles { position: absolute; right: 0.62in; top: 0.86in; width: 1.1in; height: 0.9in; }
  .doodles i { position: absolute; display: block; background-repeat: no-repeat; background-size: contain; }
  .doodles .d1 { left: 0.5in; top: 0; width: 0.34in; height: 0.34in; background-image: ${ART.sparkle}; }
  .doodles .d2 { left: 0.08in; top: 0.24in; width: 0.13in; height: 0.13in; background-image: ${ART.dot}; }
  .doodles .d3 { left: 0.9in; top: 0.3in; width: 0.2in; height: 0.36in; background-image: ${ART.squiggle}; }
  .head-copy { position: absolute; left: 0.6in; right: 2.2in; top: 0.84in; }
  .kicker {
    font-family: 'Londrina Solid', sans-serif; font-size: 12.5pt; letter-spacing: 0.06em; text-transform: uppercase;
    color: ${C.tint};
  }
  h1 {
    font-family: 'Paytone One', sans-serif; font-weight: 400; font-size: 38pt; line-height: 1.02;
    margin-top: 2pt; color: #fff; text-shadow: 3px 3px 0 ${C.deep};
  }

  /* ── Body ── */
  .body { padding: 0.06in 0.6in 0; }
  .plate {
    display: inline-block; font-family: 'Londrina Solid', sans-serif; font-weight: 400; font-size: 12.5pt;
    line-height: 1; letter-spacing: 0.05em; text-transform: uppercase; color: #fff; background: ${C.purple};
    padding: 4pt 9pt 3pt; border-radius: 999px;
  }
  .big {
    position: relative; background: ${C.tint}; border-radius: 16px; padding: 13pt 15pt 9pt;
    box-shadow: 5px 5px 0 ${C.purple}; margin-top: 4pt;
  }
  .big .plate { position: absolute; left: 14pt; top: -9pt; background: ${C.ink}; }
  .big p { font-size: 12pt; line-height: 1.34; font-weight: 600; color: ${C.ink}; }

  .sec-head { display: flex; align-items: baseline; gap: 8pt; margin: 11pt 0 5pt; }
  h2.shout { font-family: 'Paytone One', sans-serif; font-weight: 400; font-size: 14pt; line-height: 1.05; color: ${C.ink}; }
  .sec-head .zig { width: 0.26in; height: 0.22in; background: ${ART.zigzag} center / contain no-repeat; align-self: center; }

  ol.points { list-style: none; counter-reset: pt; display: grid; grid-template-columns: 1fr 1fr; column-gap: 16pt; row-gap: 5pt; }
  ol.points li { counter-increment: pt; position: relative; padding-left: 21pt; font-size: 10pt; line-height: 1.32; }
  ol.points li::before {
    content: counter(pt); position: absolute; left: 0; top: 0.5pt; width: 15pt; height: 15pt; border-radius: 50%;
    background: ${C.purple}; color: #fff; font-family: 'Paytone One', sans-serif; font-size: 8.6pt; line-height: 15pt;
    text-align: center;
  }

  .scripture { display: flex; flex-wrap: wrap; align-items: center; gap: 5pt; margin-top: 9pt; }
  .scripture h2 { font-family: 'Londrina Solid', sans-serif; font-weight: 400; font-size: 12.5pt; letter-spacing: 0.05em; text-transform: uppercase; color: ${C.deep}; margin-right: 2pt; }
  .scripture ul { display: contents; list-style: none; }
  .scripture li {
    font-weight: 700; font-size: 9.5pt; color: ${C.ink}; background: #fff; border: 1.5px solid ${C.ink};
    border-radius: 999px; padding: 2pt 9pt; box-shadow: 2px 2px 0 ${C.purple};
  }

  .qs { display: grid; grid-template-columns: 0.8fr 1.2fr; gap: 13pt; margin-top: 15pt; }
  .qs.single { grid-template-columns: 1fr; }
  .q { position: relative; border-radius: 16px; padding: 13pt 12pt 6pt; }
  .q .plate { position: absolute; left: 13pt; top: -9pt; }
  .q-note { font-size: 8.6pt; font-weight: 600; letter-spacing: 0.01em; margin-bottom: 4pt; }
  .q ol { padding-left: 14pt; }
  .q li { font-size: 10pt; line-height: 1.32; margin-bottom: 3.5pt; padding-left: 1pt; }
  .q li::marker { font-family: 'Paytone One', sans-serif; font-size: 9pt; }
  .q-you { background: ${C.wash}; border: 1.5px solid ${C.tint}; }
  .q-you .plate { background: ${C.ink}; }
  .q-you .q-note { color: ${C.deep}; }
  .q-you li::marker { color: ${C.purple}; }
  .qs.single .q-you ol { columns: 2; column-gap: 18pt; }
  .qs.single .q-you li { break-inside: avoid; }
  .q-group { background: #fff; border: 2.5px solid ${C.ink}; box-shadow: 5px 5px 0 ${C.hot}; }
  .q-group .plate { background: ${C.hot}; }
  .q-group .q-note { color: ${C.hotDeep}; }
  .q-group li::marker { color: ${C.hot}; }

  .foot {
    position: absolute; left: 0.6in; right: 0.6in; bottom: 0.26in; padding-top: 4pt; border-top: 1px solid ${C.tint};
    font-size: 6.6pt; line-height: 1.3; color: #5b5670;
  }

  /* ── Transcript pages: single column, larger and looser than page 1,
     read while teaching and annotated in the margin. ── */
  .transcript { break-before: page; }
  .t-kicker { font-family: 'Londrina Solid', sans-serif; font-size: 12pt; letter-spacing: 0.06em; text-transform: uppercase; color: ${C.purple}; }
  .transcript > h2 { font-family: 'Paytone One', sans-serif; font-weight: 400; font-size: 20pt; line-height: 1.1; color: ${C.ink}; margin: 1pt 0 4pt; }
  .transcript-note { font-size: 9pt; color: #5b5670; margin-bottom: 12pt; padding-bottom: 8pt; border-bottom: 3px solid ${C.tint}; }
  .transcript h3 {
    font-family: 'Londrina Solid', sans-serif; font-weight: 400; font-size: 15pt; line-height: 1.1; letter-spacing: 0.02em;
    color: ${C.deep}; margin: 14pt 0 5pt;
    /* A heading must never be stranded at the foot of a page. */
    break-after: avoid-page;
  }
  .transcript h3:first-of-type { margin-top: 0; }
  p.tp {
    font-size: 11pt; line-height: 1.5; margin-bottom: 9pt;
    /* Hanging indent: the timestamp sits out in the margin beside the first
       line, and still reads in document order for a screen reader. */
    padding-left: 0.62in; orphans: 2; widows: 2;
  }
  p.tp .ts {
    display: inline-block; width: 0.62in; margin-left: -0.62in;
    font-size: 9pt; font-weight: 700; color: ${C.purple}; font-variant-numeric: tabular-nums;
  }
</style>
</head>
<body>
<section class="cover">
  <header class="head">
    <p class="tab">Week ${week}</p>
    <img class="mark" src="${ART.mark}" alt="Journey">
    <div class="doodles"><i class="d1"></i><i class="d2"></i><i class="d3"></i></div>
    <div class="head-copy">
      <p class="kicker">Journey: Advocates&reg; &middot; Leader Handout${unitLine(d.title) ? ` &middot; ${unitLine(d.title)}` : ''}</p>
      <h1>${esc(name)}</h1>
    </div>
  </header>
  <main class="body">
    <section class="big" aria-labelledby="big-idea">
      <h2 id="big-idea" class="plate"><span>Big Idea</span></h2>
      <p>${esc(d.bigIdea)}</p>
    </section>
    <section aria-labelledby="key-points">
      <div class="sec-head"><h2 id="key-points" class="shout">Key points from the Leader Video</h2><span class="zig"></span></div>
      <ol class="points">${d.keyPoints.map((k) => `<li>${esc(k)}</li>`).join('')}</ol>
    </section>
    ${scriptures.length ? `<section class="scripture" aria-labelledby="scripture">
      <h2 id="scripture">Scripture in the video</h2>
      <ul>${scriptures.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
    </section>` : ''}
    <div class="qs${forGroup.length ? '' : ' single'}">
    ${questionCard('you', 'For you', 'Before club: think it through yourself.', forYou)}
    ${forGroup.length ? questionCard('group', 'Ask your group', 'In small group: questions to ask your students.', forGroup) : ''}
    </div>
  </main>
  <footer class="foot">
    <p>Summary and transcript of the Week ${week} Leader Video, for this church&rsquo;s Awana&reg; leaders:
    internal ministry use only, not for redistribution. Awana&reg; and Journey: Advocates&reg; and the Journey mark
    are trademarks of Awana Clubs International, used here by a member church; this handout is not affiliated with
    or endorsed by Awana. The transcript is of the Leader Video, lightly edited for reading.</p>
  </footer>
</section>
${transcriptHTML(week)}
</body>
</html>`;
}

/** Page 1's copy must end above the footer; returns the clearance in px (negative = overflow). */
async function pageOneClearance(page) {
  return page.evaluate(() => {
    const body = document.querySelector('.cover .body').getBoundingClientRect();
    const foot = document.querySelector('.cover .foot').getBoundingClientRect();
    const head = document.querySelector('.head-copy').getBoundingClientRect();
    const h1 = document.querySelector('h1');
    // The shouted name must stay on one line and clear of the mark/doodles.
    const oneLine = h1.getBoundingClientRect().height < parseFloat(getComputedStyle(h1).fontSize) * 1.6;
    return { room: foot.top - 6 - body.bottom, oneLine, headBottom: head.bottom };
  });
}

async function launch() {
  // PLAYWRIGHT_CHROMIUM override for machines that keep Chromium elsewhere.
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium',
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  return { browser, page };
}

async function load(page, d) {
  await page.setContent(renderHTML(d), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const missing = await page.evaluate(() =>
    ['400 12px "Paytone One"', '400 12px "Londrina Solid"', '600 12px "Figtree"'].filter((f) => !document.fonts.check(f))
  );
  if (missing.length) throw new Error(`week ${d.week}: kit font not loaded: ${missing.join(', ')}`);
}

async function screenshots(browser, pdfPath, week, dir) {
  // Pages 1-2 as PNG, drawn by Chromium's own PDF viewer is not scriptable,
  // so render through pdftoppm when it is installed.
  const { execFileSync } = await import('node:child_process');
  mkdirSync(dir, { recursive: true });
  execFileSync('pdftoppm', ['-png', '-r', '110', '-f', '1', '-l', '2', pdfPath, path.join(dir, `week-${pad(week)}-page`)]);
}

async function fitCheck() {
  const { browser, page } = await launch();
  let failed = false;
  for (const variant of [worstCaseSummary(), worstCaseSummary({ withGroup: false })]) {
    await load(page, variant);
    const { room, oneLine } = await pageOneClearance(page);
    const label = variant.questions.forGroup.length ? 'both question sets' : 'no "Ask your group"';
    console.log(`fit check (${label}): ${room >= 0 ? 'fits' : 'OVERFLOWS'}, ${(room / 96).toFixed(2)}in to spare; name ${oneLine ? 'on one line' : 'WRAPS'}`);
    if (room < 0 || !oneLine) failed = true;
    if (process.env.HANDOUT_SCREENSHOTS) {
      const dir = process.env.HANDOUT_SCREENSHOTS;
      mkdirSync(dir, { recursive: true });
      const out = path.join(dir, `fit-check-${variant.questions.forGroup.length ? 'both' : 'single'}.pdf`);
      await page.pdf({ path: out, preferCSSPageSize: true, printBackground: true, tagged: true });
      const { execFileSync } = await import('node:child_process');
      execFileSync('pdftoppm', ['-png', '-r', '80', '-f', '1', '-l', '1', out, out.replace(/\.pdf$/, '')]);
    }
  }
  await browser.close();
  return failed ? 1 : 0;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--fit-check')) return fitCheck();
  const summaries = JSON.parse(readFileSync(SUMMARIES_PATH, 'utf8')).weeks;
  const wanted = args.map(Number);
  const weeks = Object.keys(summaries)
    .map(Number)
    .filter((w) => wanted.length === 0 || wanted.includes(w))
    .sort((a, b) => a - b);

  // Always the whole file, whichever weeks were asked for: it is one small
  // write, and a partial refresh would be a way for it to drift.
  writeLeaderPrep();

  mkdirSync(OUT_DIR, { recursive: true });
  const { browser, page } = await launch();
  let failures = 0;
  for (const week of weeks) {
    const d = summaries[String(week)];
    const out = path.join(OUT_DIR, `week-${pad(week)}-leader-handout.pdf`);
    await load(page, d);
    const { room, oneLine } = await pageOneClearance(page);
    if (room < 0 || !oneLine) {
      failures++;
      console.error(`week ${week}: page 1 does not fit (${(room / 96).toFixed(2)}in, name ${oneLine ? 'one line' : 'wraps'}); not written`);
      continue;
    }
    await page.pdf({ path: out, preferCSSPageSize: true, printBackground: true, tagged: true });
    console.log(`week ${week}: ${path.basename(out)} (${(room / 96).toFixed(2)}in spare)${PROSE[String(week)] ? '' : ' — NO TRANSCRIPT PROSE'}`);
    if (process.env.HANDOUT_SCREENSHOTS) await screenshots(browser, out, week, process.env.HANDOUT_SCREENSHOTS);
  }
  await browser.close();
  return failures ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  process.exitCode = await main();
}
