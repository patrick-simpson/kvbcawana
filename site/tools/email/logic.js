// Club email: the page's pure rules (no DOM, no network), tested by
// site/test/email.test.mjs. The Worker cleans everything again and builds the
// email's real HTML itself, with the same file the preview here uses
// (mailhtml.js), so `previewHtml` shows the director the email itself.

import { linked, mailHtml } from './mailhtml.js';

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

/**
 * The sign-in link's code: `#code=XXXX-XXXX-XXXX` in the address (the emailed link),
 * or '' when the fragment is anything else. A fragment is never sent to a server.
 * @param {string} hash `location.hash`
 */
export function codeFromHash(hash) {
  const m = /^#code=([A-Za-z0-9]{4})-?([A-Za-z0-9]{4})-?([A-Za-z0-9]{4})$/.exec(String(hash || '').trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}`.toUpperCase() : '';
}

/**
 * A director's use of the page, for the owner's list: when they last signed in and sent.
 * @param {{ lastLogin?: string|null, lastSent?: string|null }} p @param {number} now
 */
export function activityWords(p, now) {
  const ago = (iso) => {
    const days = Math.floor((now - Date.parse(iso)) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    return days < 60 ? `${days} days ago` : `on ${new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  };
  if (!p.lastLogin && !p.lastSent) return 'Has not signed in yet';
  return `${p.lastLogin ? `Signed in ${ago(p.lastLogin)}` : 'Signed in before this was kept'} · ${p.lastSent ? `last sent ${ago(p.lastSent)}` : 'has not sent yet'}`;
}

/** The mail that came back, in words ('' when none or not known). @param {number|null} n @param {string} mailbox */
export function bounceWords(n, mailbox) {
  if (!n) return '';
  return `${n} came back undelivered (see the ${mailbox} inbox)`;
}

/**
 * The owner's notice about the Microsoft secret ('' when there is nothing to say).
 * @param {number|null|undefined} days whole days left; negative once it has ended
 */
export function secretWords(days) {
  if (days === null || days === undefined) return '';
  const how = 'Make a new one and save it (worker/README.md, "Club email").';
  if (days < 0) return `Sending has stopped: the Microsoft secret this page sends with has ended. ${how}`;
  return `The Microsoft secret this page sends with ends ${days === 0 ? 'today' : `in ${days} ${days === 1 ? 'day' : 'days'}`}. After that nobody can send. ${how}`;
}

/** Send later: the soonest and furthest time the Worker takes. */
export const LATER_MIN_MS = 5 * 60 * 1000;
export const LATER_MAX_MS = 28 * 24 * 60 * 60 * 1000;

/**
 * Send later: the time typed into the page's date-and-time box (the device's own
 * time), as a moment, or the words for why it will not do.
 * @param {string} typed `2026-11-18T09:00` @param {number} now
 * @returns {{ at: number, problem: string }}
 */
export function laterTime(typed, now) {
  const at = typed ? new Date(typed).getTime() : NaN;
  if (!Number.isFinite(at)) return { at: 0, problem: 'Pick a day and time first.' };
  if (at < now + LATER_MIN_MS) return { at: 0, problem: 'Pick a time at least five minutes from now.' };
  if (at > now + LATER_MAX_MS) return { at: 0, problem: 'Pick a time within the next four weeks.' };
  return { at, problem: '' };
}

/** "Wed, Nov 18, 9:00 AM" in the device's own time. @param {number|string} at */
export const whenWords = (at) => new Date(at).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Does the message say anything (pictures alone are not a message)? */
export const hasWords = (blocks) => blocks.some((b) => b.t !== 'img');

/** A paragraph's text as HTML: the email's own rule (mailhtml.js `linked`). */
export const inlineHtml = linked;

// The message box shows formatting as it is typed (owner 2026-11-14: "Formatting you can
// see while typing"): bold is bold, a heading is a heading, a picture is the picture. The
// box is the browser's own editing; what is SENT is still read back out of it as the same
// plain text as ever (`domToText`), so the Worker's blocks and the saved draft do not change.

const BLOCK_TAG = /^(?:DIV|P|H[1-6]|UL|OL|LI|BLOCKQUOTE|SECTION|ARTICLE|PRE|TABLE|TBODY|TR|TD)$/;

/**
 * The editing box's content as the message's text: a line per line, a blank line between
 * paragraphs, `# ` headings, `- ` lists, `**bold**`, `[words](address)` links, and a
 * `[picture: name]` line for a picture (an element with `data-picture`). Anything else a
 * browser or a paste put there (colours, sizes, italics) is dropped. Takes a real element
 * or anything shaped like one (nodeType, tagName, childNodes, nodeValue, getAttribute).
 * @param {any} root
 */
export function domToText(root) {
  const kids = (n) => Array.from((n && n.childNodes) || []);
  const tag = (n) => (n.nodeType === 1 ? String(n.tagName || '').toUpperCase() : '');
  const pic = (n) => (n.nodeType === 1 && n.getAttribute ? n.getAttribute('data-picture') : null);
  const inline = (n, marks) => {
    if (n.nodeType === 3) return String(n.nodeValue || '').replace(/\u00a0/g, ' ').replace(/[\r\n]+/g, ' ');
    if (n.nodeType !== 1) return '';
    const t = tag(n);
    if (t === 'BR') return '\n';
    const inner = kids(n).map((k) => inline(k, marks)).join('');
    if (!marks || !inner.trim()) return inner;
    const lead = inner.length - inner.trimStart().length, tail = inner.length - inner.trimEnd().length;
    const around = (made) => `${inner.slice(0, lead)}${made}${tail ? inner.slice(-tail) : ''}`;
    if (t === 'B' || t === 'STRONG') return inner.includes('\n') ? inner : around(`**${inner.trim()}**`);
    if (t === 'A') {
      const href = String((n.getAttribute && n.getAttribute('href')) || '');
      if (/^https?:\/\/[^\s<>"()]+$/.test(href)) return around(inner.trim() === href ? href : `[${inner.trim().replace(/[[\]\n]/g, ' ')}](${href})`);
    }
    return inner;
  };
  const lines = [];
  let loose = '';
  const flush = () => { if (loose) { lines.push(...loose.replace(/\n$/, '').split('\n')); loose = ''; } };
  const walk = (n) => {
    const t = tag(n), p = pic(n);
    if (p) { flush(); lines.push('', pictureLine(p), ''); return; }
    if (/^H[1-6]$/.test(t)) { flush(); const h = inline(n, false).replace(/\s+/g, ' ').trim(); if (h) lines.push('', `# ${h}`, ''); return; }
    if (t === 'UL' || t === 'OL') {
      flush(); lines.push('');
      for (const li of kids(n)) { const s = inline(li, true).replace(/\s*\n\s*/g, ' ').trim(); if (s) lines.push(`- ${s}`); }
      lines.push('');
      return;
    }
    if (BLOCK_TAG.test(t)) {
      flush();
      if (kids(n).some((k) => BLOCK_TAG.test(tag(k)) || pic(k))) { kids(n).forEach(walk); flush(); return; }
      lines.push(...inline(n, true).replace(/\n$/, '').split('\n'));
      if (t === 'P') lines.push('');
      return;
    }
    loose += inline(n, true);
  };
  kids(root).forEach(walk);
  flush();
  return lines.map((l) => l.replace(/[ \t]+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * The message's blocks as what the editing box should show: one entry per line or
 * block (`line` '' = the blank line between two paragraphs).
 * @param {any[]} blocks
 * @returns {({ line: string } | { heading: string } | { items: string[] } | { picture: number })[]}
 */
export function richModel(blocks) {
  const out = [];
  let last = '';
  for (const b of blocks) {
    if (b.t === 'p') { if (last === 'p') out.push({ line: '' }); for (const l of b.text.split('\n')) out.push({ line: l }); }
    else if (b.t === 'h') out.push({ heading: b.text });
    else if (b.t === 'ul') out.push({ items: b.items.slice() });
    else if (b.t === 'img') out.push({ picture: b.file });
    last = b.t;
  }
  return out;
}

/** A web address as typed, made whole (`https://` when it has none), or '' when it is not one. */
export function cleanLink(typed) {
  const t = String(typed || '').trim();
  if (!t || /\s|[<>"()]/.test(t)) return '';
  const url = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  return /^https?:\/\/[^/.]+\.[^/]+/.test(url) ? url : '';
}

/**
 * What the email will look like: the email's own HTML (mailhtml.js, the file the Worker
 * builds the real one with), with the pictures from this page and the header picture
 * from beside it.
 * @param {any[]} blocks @param {{ name: string, url?: string }[]} files
 * @param {{ sender: string, club: string, style?: any, art?: string }} who `style` null = the plain look
 */
export function previewHtml(blocks, files, who) {
  return mailHtml({
    blocks, files: files.map((f) => ({ name: f.name, inline: Boolean(f.url) })),
    foot: `Sent by ${who.sender} for ${who.club}, Kennebec Valley Baptist Church Awana. Reply to this email to reach ${who.sender}.`,
    style: who.style || null, src: (i) => (files[i] && files[i].url) || '', art: who.art,
  });
}

/**
 * The designs a message may wear, in words, for the chosen club: the club's own (not
 * for "all clubs"), the Awana one, or none.
 * @param {string[]} looks the Worker's list @param {{ id: string, name: string }} club
 * @returns {{ id: string, name: string }[]}
 */
export function lookChoices(looks, club) {
  const words = { club: `${club.name} design`, awana: 'Awana design', plain: 'No design (plain email)' };
  return (Array.isArray(looks) ? looks : []).filter((l) => words[l] && !(l === 'club' && club.id === 'all')).map((l) => ({ id: l, name: words[l] }));
}

/** The colours and picture of the chosen design (null = plain). @param {string} look @param {any} club @param {any} awana */
export const lookStyle = (look, club, awana) => (look === 'plain' ? null : (look === 'club' && club && club.style) || awana || null);

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
