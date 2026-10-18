// A tiny SMTP client for ONE message: Gmail's submission server over TLS
// (smtp.gmail.com:465), AUTH PLAIN with an app password, attachments only.
// Written here instead of a mail package so the job runs on Node alone
// (the one npm package, nodemailer, had open advisories on every version old
// enough to use, 2026-10-18). Nothing it sends or reads is logged: the
// attachments carry children's names.

import tls from 'node:tls';
import crypto from 'node:crypto';

/** An address we will put on an SMTP line: one plain address, no CR/LF, no angle brackets. */
export const ADDRESS_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/** Base64 in 76-character lines (RFC 2045). @param {Uint8Array} bytes */
export function base64Lines(bytes) {
  const b64 = Buffer.from(bytes).toString('base64');
  return b64.match(/.{1,76}/g)?.join('\r\n') ?? '';
}

/** A header value with only printable ASCII; anything else becomes an RFC 2047 word. @param {string} s */
function headerText(s) {
  const clean = String(s).replace(/[\r\n]+/g, ' ');
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean).toString('base64')}?=`;
}

/** A quoted filename (ASCII only; quotes and backslashes dropped). @param {string} s */
function fileName(s) {
  return String(s).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
}

/**
 * The whole message: multipart/mixed with the attachments and NO text part
 * (the Epson prints a body as a page of its own).
 * @param {{ from: string, to: string, subject: string, attachments: { name: string, bytes: Uint8Array, type?: string }[], date?: Date }} m
 */
export function buildMessage({ from, to, subject, attachments, date = new Date() }) {
  if (!ADDRESS_RE.test(from) || !ADDRESS_RE.test(to)) throw new Error('bad-address');
  if (!attachments.length) throw new Error('no-attachments');
  const boundary = `=_handbook_${crypto.randomBytes(12).toString('hex')}`;
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${headerText(subject)}`,
    `Date: ${date.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomUUID()}@${from.split('@')[1]}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
  ];
  for (const a of attachments) {
    const name = fileName(a.name);
    lines.push(
      `--${boundary}`,
      `Content-Type: ${a.type || 'application/pdf'}; name="${name}"`,
      `Content-Disposition: attachment; filename="${name}"`,
      'Content-Transfer-Encoding: base64',
      '',
      base64Lines(a.bytes),
    );
  }
  lines.push(`--${boundary}--`, '');
  return lines.join('\r\n');
}

/**
 * Send one message. Resolves when the server accepted it (250 after DATA);
 * rejects with a plain reason (`smtp <step> <code>`) otherwise. The reason
 * carries the step and the reply code only, never the server's text.
 * `connect` is for the tests (a plain socket to a stand-in server).
 * @param {{ host?: string, port?: number, user: string, pass: string, from: string, to: string, message: string, timeoutMs?: number, connect?: () => import('node:net').Socket }} o
 */
export function sendMail({ host = 'smtp.gmail.com', port = 465, user, pass, from, to, message, timeoutMs = 60_000, connect }) {
  if (!ADDRESS_RE.test(from) || !ADDRESS_RE.test(to)) return Promise.reject(new Error('bad-address'));
  return new Promise((resolve, reject) => {
    const socket = connect ? connect() : tls.connect({ host, port, servername: host });
    let buf = '';
    /** @type {((code: number) => void)|null} */
    let waiting = null;
    let done = false;
    const finish = (/** @type {Error|null} */ err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.end();
      socket.destroy();
      if (err) reject(err); else resolve(undefined);
    };
    const timer = setTimeout(() => finish(new Error('smtp timeout')), timeoutMs);
    socket.on('error', (e) => finish(new Error(`smtp ${/** @type {any} */ (e).code || 'network'}`)));
    socket.on('close', () => finish(new Error('smtp closed')));
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buf += chunk;
      // A reply is complete at a line "NNN text" (a "NNN-" line continues).
      let m;
      while ((m = /^(\d{3})([ -])[^\r\n]*\r?\n/m.exec(buf))) {
        buf = buf.slice(m.index + m[0].length);
        if (m[2] === ' ' && waiting) { const w = waiting; waiting = null; w(Number(m[1])); }
      }
    });
    /** @param {string|null} line @param {number[]} ok @param {string} step */
    const step = (line, ok, step) => new Promise((res, rej) => {
      waiting = (code) => (ok.includes(code) ? res(code) : rej(new Error(`smtp ${step} ${code}`)));
      if (line !== null) socket.write(`${line}\r\n`);
    });
    (async () => {
      await step(null, [220], 'greeting');
      await step(`EHLO ${from.split('@')[1]}`, [250], 'ehlo');
      await step(`AUTH PLAIN ${Buffer.from(`\0${user}\0${pass}`).toString('base64')}`, [235], 'auth');
      await step(`MAIL FROM:<${from}>`, [250], 'mail-from');
      await step(`RCPT TO:<${to}>`, [250, 251], 'rcpt-to');
      await step('DATA', [354], 'data');
      // Dot-stuffing: a line starting with "." gets one more.
      const body = message.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
      await step(`${body}${body.endsWith('\r\n') ? '' : '\r\n'}.`, [250], 'send');
      socket.write('QUIT\r\n');
      finish(null);
    })().catch((e) => finish(e));
  });
}
