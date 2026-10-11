// @ts-check
// The label printer's release notes (printer/changes.md, published by the site
// build at /release-notes/printer.md), for Settings → Setup → Release notes
// (owner, 2026-10-11). Pure: the markdown becomes sections of paragraphs made
// of plain and bold runs, which the card renders as text. Nothing is ever put
// in as HTML.

/** Where the site publishes them (site/build.mjs). */
export const RELEASE_NOTES_URL = '/release-notes/printer.md';

/**
 * @typedef {{ text: string, bold: boolean }} Run
 * @typedef {{ title: string, paragraphs: Run[][] }} Section
 */

/** "**New:** a thing" → runs. Unpaired ** stays as text. @param {string} line @returns {Run[]} */
export function inlineRuns(line) {
  const parts = String(line).split('**');
  if (parts.length % 2 === 0) return [{ text: String(line), bold: false }];
  return parts.map((text, i) => ({ text: text.replace(/`/g, ''), bold: i % 2 === 1 })).filter((r) => r.text);
}

/**
 * @param {string} text the whole changes.md
 * @returns {Section[]} newest first, as the file has them
 */
export function parseReleaseNotes(text) {
  /** @type {Section[]} */
  const out = [];
  /** @type {Section|null} */
  let cur = null;
  /** @type {string[]} */
  let para = [];
  const flush = () => {
    if (cur && para.length) cur.paragraphs.push(inlineRuns(para.join(' ')));
    para = [];
  };
  for (const raw of String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    const h = /^##\s+(.*)$/.exec(line);
    if (h) {
      flush();
      cur = { title: h[1].replace(/^\[([^\]]+)\]/, 'Version $1').trim(), paragraphs: [] };
      out.push(cur);
    } else if (!line) {
      flush();
    } else if (cur) {
      para.push(line.replace(/^[-*]\s+/, '• '));
    }
  }
  flush();
  return out;
}
