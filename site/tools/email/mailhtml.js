// Club email: the email's HTML, from cleaned blocks. ONE copy: the Worker builds the
// real email with it (worker/src/clubmail.js imports this file) and the page draws its
// preview with it, so what a director sees is what parents get. Pure: no imports, no
// DOM, no network. Tests: site/test/email.test.mjs, worker/test/clubmail.test.js.
//
// The looks (owner 2026-11-14: "a generic awana template, or ... custom for each club
// based on the catalog"; "an option to not use a template and just have a blank email"):
//   club   the club's own colour, mark and wave (the default)
//   awana  the church's Awana Clubs look, for any club (and always for "all clubs")
//   plain  no design: the words alone
// A look's header is ONE picture (site/tools/email/art/<name>.png, drawn from the brand
// kit by scripts/email-art/make.mjs); with pictures off, the mail app shows its alt words
// in white on the club's colour. Everything else is tables and inline styles, which is
// what mail apps keep. Mail apps ignore web fonts: the font list ends in the device's own.

/** The looks a message may have; the first is the default. */
export const MAIL_LOOKS = ['club', 'awana', 'plain'];
/** Where the header pictures are served from (the real email needs the whole address). */
export const MAIL_ART = 'https://awana.kvbchurch.org/tools/email/art/';
/** The colours of the Awana look (shared/brand/tokens.json `house`, and the six clubs' primaries for its stripe). */
export const AWANA_STYLE = Object.freeze({
  art: 'awana', field: '#4C72B8', deep: '#34569A', tint: '#D6EFF8',
  stripe: Object.freeze(['#1DB6D9', '#4C72B8', '#F04A4B', '#58BD79', '#047E71', '#8A649D']),
  alt: 'Kennebec Valley Baptist Church Awana Clubs',
});

/**
 * A club's look from its row of shared/clubs.js (`mark` names its picture).
 * @param {{ name: string, mark: string, primary: string, deep: string, plate: string, accent: string }} club
 */
export function clubStyle(club) {
  return {
    art: club.mark, field: club.plate, deep: club.deep, tint: club.accent,
    stripe: [club.plate.toLowerCase() === club.primary.toLowerCase() ? club.deep : club.primary],
    alt: `${club.name} · KVBC Awana`,
  };
}

export const esc = (/** @type {unknown} */ s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A paragraph's text as HTML: escaped first, then `**bold**`, `[words](https://address)`
 * and bare web addresses as links. Only these three.
 * @param {string} text @param {string} [color] the links' colour
 */
export function linked(text, color = '#0B5CAD') {
  const a = (/** @type {string} */ href, /** @type {string} */ words) => `<a href="${href}" style="color:${color}">${words}</a>`;
  const bold = (/** @type {string} */ s) => s.replace(/\*\*([^*\n](?:[^\n]*?[^*\n])?)\*\*/g, '<b>$1</b>');
  const plain = (/** @type {string} */ s) => bold(s.replace(/\bhttps?:\/\/[^\s<>"]+[^\s<>".,;:!?)*]/g, (u) => a(u, u)));
  const e = esc(text);
  let out = '', last = 0;
  for (const m of e.matchAll(/\[([^\]\n]{1,200})\]\((https?:\/\/[^\s<>"()]+)\)/g)) {
    out += plain(e.slice(last, m.index)) + a(m[2], bold(m[1]));
    last = (m.index || 0) + m[0].length;
  }
  return (out + plain(e.slice(last))).replace(/\n/g, '<br>');
}

const FONT = "font-family:Figtree,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";

/**
 * The whole email.
 * @param {{
 *   blocks: any[], files: { name: string, inline?: boolean }[],
 *   foot: string, note?: string,
 *   style?: { art: string, field: string, deep: string, tint: string, stripe: readonly string[], alt: string } | null,
 *   src: (file: number) => string, art?: string,
 * }} m `style` null or absent = the plain look; `src` = where picture number n is (cid: in the email); `note` = the yellow line of a test
 */
export function mailHtml(m) {
  const s = m.style || null;
  const link = s ? s.deep : '#0B5CAD';
  const body = [];
  let first = true;
  for (const b of m.blocks) {
    if (b.t === 'h') body.push(`<h2 style="font-size:${s ? 20 : 18}px;line-height:1.25;margin:${first ? 0 : s ? 24 : 22}px 0 8px${s ? `;color:${s.deep}` : ''}">${esc(b.text)}</h2>`);
    else if (b.t === 'p') body.push(`<p style="margin:0 0 14px">${linked(b.text, link)}</p>`);
    else if (b.t === 'ul') body.push(`<ul style="margin:0 0 14px;padding-left:22px">${b.items.map((/** @type {string} */ i) => `<li style="margin:0 0 4px">${linked(i, link)}</li>`).join('')}</ul>`);
    else if (b.t === 'img' && m.files[b.file] && m.files[b.file].inline !== false && m.src(b.file)) body.push(`<p style="margin:0 0 14px"><img src="${esc(m.src(b.file))}" alt="${esc(m.files[b.file].name)}" style="max-width:100%;height:auto;border:0"></p>`);
    else continue;
    first = false;
  }
  const note = m.note ? `<p style="margin:0 0 14px;padding:8px 12px;background:#FFF3C4">${esc(m.note)}</p>` : '';
  if (!s) {
    return `<div style="${FONT.replace('Figtree,', '')};color:#231F20;font-size:16px;line-height:1.5;max-width:640px">${note}${body.join('')}`
      + `<p style="margin:26px 0 0;padding-top:12px;border-top:1px solid #D9D4CC;font-size:13px;color:#6B655E">${esc(m.foot)}</p></div>`;
  }
  const stripe = s.stripe.length > 1
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${s.stripe.map((c) => `<td height="6" style="height:6px;line-height:6px;font-size:0;background:${c}">&nbsp;</td>`).join('')}</tr></table>`
    : `<div style="height:6px;line-height:6px;font-size:0;background:${s.stripe[0]}">&nbsp;</div>`;
  return `<div style="margin:0;padding:24px 12px;background:#F6F4EF">`
    + `<table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;border-collapse:separate;background:#FFFFFF;border-radius:14px;overflow:hidden;${FONT};color:#231F20;font-size:16px;line-height:1.5">`
    + `<tr><td bgcolor="${s.field}" style="background:${s.field};font-size:0;line-height:0"><img src="${esc((m.art || MAIL_ART) + s.art)}.png" width="600" alt="${esc(s.alt)}" style="display:block;width:100%;max-width:600px;height:auto;border:0;color:#FFFFFF;font:700 22px/120px Arial,sans-serif;text-align:center"></td></tr>`
    + `<tr><td style="padding:0">${stripe}</td></tr>`
    + `<tr><td style="padding:26px 32px 8px">${note}${body.join('')}</td></tr>`
    + `<tr><td style="padding:8px 32px 26px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:12px 16px;background:${s.tint};border-radius:10px;font-size:13px;line-height:1.45;color:#231F20">${esc(m.foot)}</td></tr></table></td></tr>`
    + `</table></div>`;
}
