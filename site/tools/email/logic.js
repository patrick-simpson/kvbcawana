// Club email: the page's pure rules (no DOM, no network), tested by
// site/test/email.test.mjs. The Worker cleans everything again and builds the
// email's real HTML itself (worker/src/clubmail.js); `previewHtml` here only
// shows the director what that will look like.

/** A picture placed in the text is a line of its own: [picture: name.jpg] */
export const PICTURE_LINE = /^\[picture:\s*(.+?)\s*\]$/i;
export const pictureLine = (name) => `[picture: ${name}]`;

/** Pictures the email can show in the message itself; anything else is attached. */
export const INLINE_TYPES = ['image/jpeg', 'image/png', 'image/gif'];
/** What the page lets a director choose (the Worker refuses anything else). */
export const FILE_ACCEPT = 'image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.ics';
/** A picture wider than this is made smaller before it is sent. */
export const PICTURE_MAX_PX = 1600;
/** A picture at most this big and this wide is sent as it is. */
export const PICTURE_KEEP_BYTES = 600 * 1024;

/**
 * The typed message as the Worker's blocks. Blank lines part paragraphs; a part
 * whose lines all start "- " is a list; a single line starting "# " is a
 * heading; a line `[picture: name]` is that picture, when a picture by that
 * name was added. Pictures nobody placed go at the end.
 * @param {string} text
 * @param {{ name: string, inline: boolean }[]} files in upload order
 */
export function parseMessage(text, files) {
  const blocks = [];
  const placed = new Set();
  const find = (name) => files.findIndex((f, i) => f.inline && !placed.has(i) && f.name.toLowerCase() === name.toLowerCase());
  for (const chunk of String(text || '').replace(/\r\n?/g, '\n').split(/\n[ \t]*\n+/)) {
    let para = [];
    const flush = () => {
      if (!para.length) return;
      const lines = para; para = [];
      if (lines.length === 1 && /^#\s+\S/.test(lines[0])) blocks.push({ t: 'h', text: lines[0].replace(/^#\s+/, '').trim() });
      else if (lines.every((l) => /^[-*]\s+\S/.test(l))) blocks.push({ t: 'ul', items: lines.map((l) => l.replace(/^[-*]\s+/, '').trim()) });
      else blocks.push({ t: 'p', text: lines.join('\n') });
    };
    for (const raw of chunk.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const m = PICTURE_LINE.exec(line);
      const at = m ? find(m[1]) : -1;
      if (at >= 0) { flush(); placed.add(at); blocks.push({ t: 'img', file: at }); } else para.push(line);
    }
    flush();
  }
  files.forEach((f, i) => { if (f.inline && !placed.has(i)) blocks.push({ t: 'img', file: i }); });
  return blocks;
}

/**
 * The Worker's blocks back as typed text (a sent message started from again): what
 * `parseMessage` reads back as the same blocks. Pictures are left out.
 * @param {any[]} blocks
 */
export function blocksToText(blocks) {
  return (Array.isArray(blocks) ? blocks : []).map((b) => {
    if (b.t === 'h') return `# ${b.text}`;
    if (b.t === 'ul') return b.items.map((i) => `- ${i}`).join('\n');
    return b.t === 'p' ? b.text : '';
  }).filter(Boolean).join('\n\n');
}

/** The mail that came back, in words ('' when none or not known). @param {number|null} n @param {string} mailbox */
export function bounceWords(n, mailbox) {
  if (!n) return '';
  return `${n} came back undelivered (see the ${mailbox} inbox)`;
}

/** Does the message say anything (pictures alone are not a message)? */
export const hasWords = (blocks) => blocks.some((b) => b.t !== 'img');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/**
 * A paragraph's text as HTML, as the Worker's `linked` makes it: escaped first, then
 * `**bold**`, `[words](https://address)` and bare web addresses as links.
 * @param {string} text
 */
export function inlineHtml(text) {
  const a = (href, words) => `<a href="${href}">${words}</a>`;
  const bold = (s) => s.replace(/\*\*([^*\n](?:[^\n]*?[^*\n])?)\*\*/g, '<b>$1</b>');
  const plain = (s) => bold(s.replace(/\bhttps?:\/\/[^\s<>"]+[^\s<>".,;:!?)*]/g, (u) => a(u, u)));
  const e = esc(text);
  let out = '', last = 0;
  for (const m of e.matchAll(/\[([^\]\n]{1,200})\]\((https?:\/\/[^\s<>"()]+)\)/g)) {
    out += plain(e.slice(last, m.index)) + a(m[2], bold(m[1]));
    last = m.index + m[0].length;
  }
  return (out + plain(e.slice(last))).replace(/\n/g, '<br>');
}
const linked = inlineHtml;

// The formatting buttons (owner 2026-11-14): each is a plain edit of the typed text, so
// what a button does and what a director types by hand are the same thing. Each takes
// the text and the selection and answers the new text and selection.

/** Bold: the selected words between `**`, or a placeholder to type over. */
export function boldEdit(value, start, end) {
  const words = value.slice(start, end) || 'bold words';
  const lead = words.length - words.trimStart().length, tail = words.length - words.trimEnd().length;
  const core = words.trim() || 'bold words';
  const next = `${value.slice(0, start)}${words.slice(0, lead)}**${core}**${tail ? words.slice(-tail) : ''}${value.slice(end)}`;
  const at = start + lead + 2;
  return { value: next, start: at, end: at + core.length };
}

/**
 * Heading or list: the selected lines become a part of their own (a blank line before
 * and after), a heading from its first line (`# `) or a list of every line (`- `).
 * @param {'heading'|'list'} kind
 */
export function linesEdit(value, start, end, kind) {
  const from = value.lastIndexOf('\n', start - 1) + 1;
  const stop = value.indexOf('\n', Math.max(end, start));
  const to = stop < 0 ? value.length : stop;
  const bare = (l) => l.replace(/^\s*(?:#|[-*])\s+/, '').trim();
  let lines = value.slice(from, to).split('\n').map(bare).filter(Boolean);
  if (!lines.length) lines = [kind === 'heading' ? 'Heading' : 'First thing'];
  const made = kind === 'heading' ? [`# ${lines[0]}`, ...(lines.length > 1 ? ['', lines.slice(1).join('\n')] : [])].join('\n') : lines.map((l) => `- ${l}`).join('\n');
  const before = value.slice(0, from).replace(/\s+$/, ''), after = value.slice(to).replace(/^\s+/, '');
  const head = before ? `${before}\n\n` : '';
  const next = `${head}${made}${after ? `\n\n${after}` : ''}`;
  const mark = kind === 'heading' ? 2 : 2;
  return { value: next, start: head.length + mark, end: head.length + (kind === 'heading' ? 2 + lines[0].length : made.length) };
}

/** A web address as typed, made whole (`https://` when it has none), or '' when it is not one. */
export function cleanLink(typed) {
  const t = String(typed || '').trim();
  if (!t || /\s|[<>"()]/.test(t)) return '';
  const url = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  return /^https?:\/\/[^/.]+\.[^/]+/.test(url) ? url : '';
}

/** Link: the selected words (or a placeholder) as `[words](address)`. */
export function linkEdit(value, start, end, url) {
  const words = value.slice(start, end).trim().replace(/[\[\]\n]/g, ' ') || 'link words';
  const next = `${value.slice(0, start)}[${words}](${url})${value.slice(end)}`;
  return { value: next, start: start + 1, end: start + 1 + words.length };
}

/**
 * What the email will look like (the Worker's renderMail, as a preview).
 * @param {any[]} blocks @param {{ name: string, url?: string }[]} files
 * @param {{ sender: string, club: string }} who
 */
export function previewHtml(blocks, files, who) {
  const out = blocks.map((b) => {
    if (b.t === 'h') return `<h2>${esc(b.text)}</h2>`;
    if (b.t === 'p') return `<p>${linked(b.text)}</p>`;
    if (b.t === 'ul') return `<ul>${b.items.map((i) => `<li>${linked(i)}</li>`).join('')}</ul>`;
    const f = files[b.file];
    return f && f.url ? `<p><img src="${esc(f.url)}" alt="${esc(f.name)}"></p>` : '';
  });
  out.push(`<p class="foot">Sent by ${esc(who.sender)} for ${esc(who.club)}, Kennebec Valley Baptist Church Awana. Reply to this email to reach ${esc(who.sender)}.</p>`);
  return out.join('');
}

/** "1.4 MB", "320 KB" @param {number} n */
export function sizeWords(n) {
  if (n >= 1048576) return `${(n / 1048576).toFixed(n >= 10485760 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/**
 * Who the email goes to, in words, from the Worker's counts.
 * `club: 'all'` is every club the sender has; its `name` is then "all clubs" or the clubs' names.
 * @param {{ club?: string, name: string, addresses: number, kids: number, kidsWithoutEmail: number }|null} r
 */
export function recipientWords(r) {
  if (!r) return '';
  if (!r.addresses) return `TwoTimTwo has no parent email address for ${r.name}.`;
  const kids = r.club === 'all' ? `${r.kids} ${r.kids === 1 ? 'child' : 'children'} in ${r.name}` : `${r.kids} ${r.name} ${r.kids === 1 ? 'child' : 'children'}`;
  const none = r.kidsWithoutEmail ? ` ${r.kidsWithoutEmail} ${r.kidsWithoutEmail === 1 ? 'child has' : 'children have'} no email on file, so their family will not get it.` : '';
  return `Goes to ${r.addresses} parent ${r.addresses === 1 ? 'address' : 'addresses'} for ${kids}.${none}`;
}

/** The words for a refusal the Worker named. @param {{ status: number, body: any }} res */
export function problemWords(res) {
  const reason = res.body && res.body.reason;
  if (res.status === 0) return 'Could not reach the service. Check the internet and try again.';
  if (reason === 'not-configured') return 'Sending is not set up yet: the Microsoft app for the Awana mailbox has not been added.';
  if (reason === 'owner-not-set') return 'The owner\'s code has not been set up yet (worker/README.md, "Club email").';
  if (reason === 'signed-out') return 'You are signed out. Sign in again.';
  return (res.body && res.body.error) || 'That did not work. Try again in a minute.';
}

/** May the page try this step again by itself? @param {{ status: number, body: any }} res */
export const stepRetryable = (res) => res.status === 0 || res.status === 429 || (res.status >= 500 && !['graph-auth', 'not-configured'].includes(res.body && res.body.reason));

/** How one file goes up: the Worker's answer for it. @param {number} units @param {number} part */
export const partsOf = (units, part) => Math.ceil(units / part);

/** The total of the chosen files against the limit. @param {{ size: number }[]} files @param {number} max */
export function totalWords(files, max) {
  const total = files.reduce((a, f) => a + f.size, 0);
  return { total, over: total > max, words: files.length ? `${sizeWords(total)} of ${sizeWords(max)}` : '' };
}
