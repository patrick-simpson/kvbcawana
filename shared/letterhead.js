// @ts-check
// Awana letterhead (owner 2026-10-28): plain text in, one Letter page out, in
// the 2026-27 catalog look with the church's own logo. ONE copy of the rules
// and the drawing, used by the hidden page awana.kvbchurch.org/tools/letterhead/
// (preview, Print / Save as PDF) and by the print job
// (scripts/letterhead/letterhead-print.mjs: PDF in Chromium, emailed to the
// downstairs Epson). Pure (no DOM, no imports, no clock unless given): the
// caller hands in the kit's base URL and the four kit SVGs it read itself.
//
// The text format, written the way a newsletter email already reads:
// - the first line is the title ("November Update");
// - the first paragraph is the lead (bold, a little bigger);
// - each other paragraph (or "- " / "• " line) is a reminder with a sparkle
//   bullet in the next club's colour;
// - a short line with no end punctuation ("Upcoming Events") is a section
//   heading ("## " in front forces one);
// - "11/4 - text" or "Nov 4 - text" is an event with a date chip;
// - a paragraph after a section's events is a callout box;
// - the last block, when it is 2 to 5 short lines, is the signature.
// The drawn page fits itself to one sheet (`FIT`): the type steps down to
// `FIT.minPt`, and only text that still will not fit flows to a second page.
//
// Pinned by shared/letterhead.test.js.

/** The kit files the page draws, relative to shared/brand/. */
export const LETTERHEAD_SVGS = Object.freeze({
  logo: 'logos/kvbc-awana-two-line-ink.svg',
  sparkle: 'doodles/sparkle-4pt.svg',
  ring: 'doodles/ring.svg',
  wave: 'shapes/wave-tnt.svg',
});

/** Body type size: where it starts, the floor, the step (points). */
export const FIT = Object.freeze({ startPt: 11, minPt: 9.5, stepPt: 0.25 });

/** Longest text taken (characters); more is cut, never sent to a printer. */
export const MAX_TEXT = 20000;

/**
 * The ministry's five words, one a year, in order (owner 2026-10-28; on the
 * page as the words alone, never named as a plan). PLAN_NOW is this year's,
 * drawn as the hot pill: move it on when the year turns.
 */
export const PLAN_WORDS = Object.freeze(['Belong', 'Believe', 'Become', 'Protect', 'Grow']);
export const PLAN_NOW = 'Believe';

const CLUBS = ['puggles', 'cubbies', 'sparks', 'tnt', 'trek', 'journey'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTH_WORD = /^(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sept?(ember)?|oct(ober)?|nov(ember)?|dec(ember)?)\.?$/i;

/** @param {string} s */
export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Escaped text with web addresses and email addresses as links. A link shows
 * without its https:// (it is printed, so the shorter the better).
 * @param {string} s
 */
export function linkify(s) {
  return escapeHtml(s)
    .replace(/https?:\/\/([^\s<]+?)([.,;:!?)]*)(?=\s|$)/g, (_, rest, tail) =>
      `<a href="https://${rest}">${rest.replace(/\/$/, '')}</a>${tail}`)
    .replace(/(^|[\s(])([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g, '$1<a href="mailto:$2">$2</a>');
}

/**
 * An event line's date, as {month: 'NOV', day: '4'}, or null.
 * @param {string} line
 */
export function eventOf(line) {
  let m = line.match(/^(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\s*[-–—:]\s*(.+)$/);
  if (m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31) {
    return { month: MONTHS[+m[1] - 1], day: String(+m[2]), text: m[3] };
  }
  m = line.match(/^([A-Za-z]{3,9}\.?)\s+(\d{1,2})(?:st|nd|rd|th)?\s*[-–—:]\s*(.+)$/);
  if (m && MONTH_WORD.test(m[1]) && +m[2] >= 1 && +m[2] <= 31) {
    return { month: m[1].slice(0, 3).toUpperCase(), day: String(+m[2]), text: m[3] };
  }
  return null;
}

/** @param {string} line */
function isHeading(line) {
  if (/^#{1,3}\s+\S/.test(line)) return true;
  return line.length <= 40 && !/[.!?:,;)]$/.test(line) && !/https?:\/\/|@/.test(line);
}

/** @param {string[]} block */
function isSignature(block) {
  return block.length >= 2 && block.length <= 5 && block.every((l) => l.length <= 70)
    && !/[.!?]$/.test(block[0]) && block[0].split(/\s+/).length <= 5;
}

/**
 * @typedef {{kind: 'lead'|'item'|'heading'|'note', text: string}
 *   | {kind: 'event', month: string, day: string, text: string}} Part
 * @typedef {{title: string, parts: Part[], signature: string[]}} Letter
 */

/**
 * Plain text to the letter's parts.
 * @param {string} text
 * @returns {Letter}
 */
export function parseLetter(text) {
  const clean = String(text || '').slice(0, MAX_TEXT)
    .replace(/\r\n?/g, '\n').replace(/[\u00a0\u2007\u202f]/g, ' ').replace(/[ \t]+$/gm, '');
  const blocks = clean.split(/\n\s*\n/)
    .map((b) => b.split('\n').map((l) => l.trim()).filter(Boolean))
    .filter((b) => b.length);
  /** @type {Letter} */
  const letter = { title: '', parts: [], signature: [] };
  if (!blocks.length) return letter;
  const first = /** @type {string[]} */ (blocks.shift());
  letter.title = first.shift()?.replace(/^#{1,3}\s+/, '') || '';
  if (first.length) blocks.unshift(first);
  if (blocks.length && isSignature(blocks[blocks.length - 1])) {
    letter.signature = /** @type {string[]} */ (blocks.pop());
  }
  let inSection = false;
  let sectionEvents = 0;
  for (const block of blocks) {
    // Lines of one block are one paragraph, unless they are bullets, events
    // or a heading line on top.
    /** @type {string[]} */
    let para = [];
    const flush = () => {
      if (!para.length) return;
      const text = para.join(' ');
      para = [];
      if (!letter.parts.length) letter.parts.push({ kind: 'lead', text });
      else if (inSection && sectionEvents) letter.parts.push({ kind: 'note', text });
      else letter.parts.push({ kind: 'item', text });
    };
    for (const line of block) {
      const event = eventOf(line);
      const bullet = line.match(/^[-•*]\s+(.+)$/);
      if (event) {
        flush();
        letter.parts.push({ kind: 'event', ...event });
        sectionEvents += 1;
      } else if (bullet) {
        flush();
        letter.parts.push({ kind: letter.parts.length ? 'item' : 'lead', text: bullet[1] });
      } else if (block.length === 1 && isHeading(line) && letter.parts.length) {
        letter.parts.push({ kind: 'heading', text: line.replace(/^#{1,3}\s+/, '') });
        inSection = true;
        sectionEvents = 0;
      } else if (/^#{1,3}\s+/.test(line)) {
        flush();
        letter.parts.push({ kind: 'heading', text: line.replace(/^#{1,3}\s+/, '') });
        inSection = true;
        sectionEvents = 0;
      } else {
        para.push(line);
      }
    }
    flush();
  }
  return letter;
}

/**
 * The chip's month: the title's own month word ("November Update" = NOV),
 * else the given date's.
 * @param {string} title
 * @param {Date} date
 */
export function issueLabel(title, date) {
  const word = title.split(/\s+/).find((w) => MONTH_WORD.test(w) && w.length >= 3);
  const month = word ? word.slice(0, 3).toUpperCase() : MONTHS[date.getMonth()];
  let year = date.getFullYear();
  if (word && MONTHS.indexOf(month) < date.getMonth() - 6) year += 1;
  return `${month} ${year}`;
}

/** @param {string} svg */
function cleanSvg(svg) {
  return String(svg || '').replace(/<\?xml[^>]*>/, '').replace(/<title>[\s\S]*?<\/title>/, '').trim();
}

/**
 * The whole page as an HTML document. It fits itself to one sheet once its
 * fonts are in, then sets `data-fit` on <html>: "one-page", or "flow" when
 * the type reached FIT.minPt and the text runs onto a second page.
 * @param {Letter} letter
 * @param {{kitUrl: string, svgs: Record<keyof typeof LETTERHEAD_SVGS, string>,
 *   date?: Date, kicker?: string, planNow?: string}} opts
 */
export function letterHtml(letter, opts) {
  const kit = opts.kitUrl.replace(/\/$/, '');
  const svg = Object.fromEntries(Object.entries(opts.svgs).map(([k, v]) => [k, cleanSvg(v)]));
  const date = opts.date || new Date();
  let bullet = 0;
  const body = letter.parts.map((p) => {
    if (p.kind === 'lead') return `<p class="lead">${linkify(p.text)}</p>`;
    if (p.kind === 'heading') return `<h2><span>${escapeHtml(p.text)}</span></h2>`;
    if (p.kind === 'note') return `<div class="note">${linkify(p.text)}</div>`;
    if (p.kind === 'event') {
      return `<div class="event"><div class="date"><small>${p.month}</small><b>${p.day}</b></div><p>${linkify(p.text)}</p></div>`;
    }
    const club = CLUBS[bullet++ % CLUBS.length];
    return `<p class="item" style="--c:var(--brand-${club})"><i>${svg.sparkle}</i>${linkify(p.text)}</p>`;
  }).join('\n');
  const [name, role, ...contact] = letter.signature;
  const sig = name
    ? `<div class="sig"><b>${escapeHtml(name)}</b>${role ? `<em>${escapeHtml(role)}</em>` : ''}${contact.map(linkify).join('<br>')}</div>`
    : '';
  const now = opts.planNow || PLAN_NOW;
  const plan = PLAN_WORDS.map((w) => (w === now
    ? `<b class="now">${escapeHtml(w)}</b>`
    : `<b>${escapeHtml(w)}</b>`)).join(`<i>${svg.sparkle}</i>`);
  const title = escapeHtml(letter.title || 'Awana News');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<link rel="stylesheet" href="${kit}/tokens.css"><link rel="stylesheet" href="${kit}/fonts.css">
<style>
@font-face{font-family:'Figtree';font-style:normal;font-weight:300 900;src:url('${kit}/fonts/figtree-latin-wght-normal.woff2') format('woff2'),url('${kit}/fonts/Figtree-Variable.ttf') format('truetype')}
@page{size:Letter;margin:0}
*{box-sizing:border-box;margin:0}
html{--lh-size:${FIT.startPt}pt}
html,body{width:8.5in;height:11in}
body{position:relative;overflow:hidden;background:#fff;color:var(--brand-ink);font:400 var(--lh-size)/1.48 var(--brand-font-body);-webkit-print-color-adjust:exact;print-color-adjust:exact}
a{color:var(--brand-blue-deep);font-weight:700;text-decoration:none}
header{display:flex;align-items:flex-end;justify-content:space-between;padding:.5in .6in .16in}
header .logo svg{width:2.95in;height:auto;display:block}
.chip small{display:inline-block;font:400 10pt/1 var(--brand-font-label);letter-spacing:.06em;color:#fff;background:var(--brand-hot);padding:4px 9px 3px;border-radius:7px 7px 0 0;margin-left:2px}
.chip b{display:block;font:400 21pt/1 var(--brand-font-display);color:#fff;background:var(--brand-blue);padding:6px 13px 7px;border-radius:0 9px 9px 9px;box-shadow:3px 3px 0 var(--brand-ink);white-space:nowrap}
.stripe{display:flex;height:7px}
.stripe span{flex:1}
main{padding:.26in .75in 0}
h1{font:400 3em/1.02 var(--brand-font-display);margin-bottom:.12in;display:flex;align-items:center;gap:.14in}
h1 .doodles{flex:none;display:flex;gap:5px;align-items:flex-start;color:var(--brand-hot)}
h1 .doodles svg{width:15px;height:15px;display:block}
h1 .doodles svg:nth-child(2){width:9px;height:9px;margin-top:-6px;color:var(--brand-sun)}
h1 .doodles svg:nth-child(3){width:11px;height:11px;margin-top:10px;color:var(--brand-cubbies)}
.lead{font-size:1.16em;font-weight:600;margin-bottom:.1in}
.item{position:relative;padding-left:.27in;margin-bottom:.1in}
.item i{position:absolute;left:0;top:.02in;width:.17in;height:.17in;color:var(--c)}
.item i svg{width:100%;height:100%;display:block}
h2{margin:.18in 0 .1in}
h2 span{display:inline-block;font:400 15pt/1 var(--brand-font-label);letter-spacing:.07em;text-transform:uppercase;color:#fff;background:var(--brand-trek);padding:6px 14px 5px;border-radius:4px 14px 4px 14px;box-shadow:3px 3px 0 var(--brand-trek-deep)}
.event{display:flex;gap:.16in;align-items:flex-start;margin-bottom:.1in;break-inside:avoid}
.date{flex:none;width:.62in;text-align:center;background:var(--brand-sun);border-radius:8px;box-shadow:3px 3px 0 var(--brand-ink);padding:4px 0 5px}
.date small{display:block;font:400 9pt/1 var(--brand-font-label);letter-spacing:.08em}
.date b{display:block;font:400 19pt/1 var(--brand-font-display)}
.event p{padding-top:.03in}
.note{margin-top:.14in;padding:.1in .16in;background:var(--brand-cream);border-radius:10px;outline:1.5px solid var(--brand-orange-deep);outline-offset:3px;break-inside:avoid}
.sig{margin-top:.22in;break-inside:avoid}
.sig b{display:block;font:400 15pt/1.1 var(--brand-font-display)}
.sig em{display:block;font:400 11pt/1.2 var(--brand-font-label);letter-spacing:.05em;text-transform:uppercase;color:var(--brand-sparks-deep);font-style:normal;margin:2px 0 3px}
footer{position:absolute;left:0;right:0;bottom:0;height:1.3in;overflow:hidden}
footer .w{position:absolute;width:5.4in;bottom:-1.55in}
footer .w svg{width:100%;height:auto;display:block}
footer .w1{right:-.5in;color:var(--brand-sky)}
footer .w2{right:-1.7in;bottom:-1.85in;color:var(--brand-blue)}
footer .plan{position:absolute;left:.75in;bottom:.5in;display:flex;align-items:center;gap:.07in}
footer .plan b{font:400 12pt/1 var(--brand-font-label);letter-spacing:.08em;text-transform:uppercase;color:var(--brand-blue-deep);padding:5px 0 4px}
footer .plan b.now{color:#fff;background:var(--brand-hot);padding:5px 11px 4px;border-radius:8px;box-shadow:2px 2px 0 var(--brand-ink)}
footer .plan i{width:9px;height:9px;color:var(--brand-sun);display:block}
footer .plan i svg{width:100%;height:100%;display:block}
html[data-fit=flow],html[data-fit=flow] body{height:auto;overflow:visible}
html[data-fit=flow] main{padding-bottom:.3in}
html[data-fit=flow] footer{position:relative;break-inside:avoid}
@media screen{html{background:#fff}}
</style></head><body>
<header><div class="logo">${svg.logo}</div>
<div class="chip"><small>${escapeHtml(opts.kicker || 'AWANA NEWS')}</small><b>${escapeHtml(issueLabel(letter.title, date))}</b></div></header>
<div class="stripe">${CLUBS.map((c) => `<span style="background:var(--brand-${c})"></span>`).join('')}</div>
<main>
<h1>${title}<span class="doodles">${svg.sparkle}${svg.ring}${svg.sparkle}</span></h1>
${body}
${sig}
</main>
<footer><div class="w w1">${svg.wave}</div><div class="w w2">${svg.wave}</div>
<div class="plan">${plan}</div></footer>
<script>
(async () => {
  const root = document.documentElement;
  try { await document.fonts.ready; } catch (e) {}
  const main = document.querySelector('main');
  const foot = document.querySelector('footer');
  const fits = () => main.getBoundingClientRect().bottom <= foot.getBoundingClientRect().top - 6;
  let pt = ${FIT.startPt};
  while (!fits() && pt > ${FIT.minPt}) {
    pt = Math.max(${FIT.minPt}, pt - ${FIT.stepPt});
    root.style.setProperty('--lh-size', pt + 'pt');
  }
  root.dataset.size = String(pt);
  root.dataset.fit = fits() ? 'one-page' : 'flow';
})();
</script>
</body></html>`;
}
