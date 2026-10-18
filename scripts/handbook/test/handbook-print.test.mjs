// The 4 pm handbook sheets job (handbook-print.mjs, smtp.mjs): what a Worker
// answer is, the message's shape, the SMTP talk, and one whole try against a
// stand-in Worker (PDF and HTML answers). Every name here is made up.
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import { test } from 'node:test';
import { CLUBS, attempt, classify, easternDate, fileNameFor, withBase } from '../handbook-print.mjs';
import { buildMessage, sendMail } from '../smtp.mjs';

const enc = (s) => new TextEncoder().encode(s);
const PDF = new Uint8Array([...enc('%PDF-1.4\n'), 0, 255, 128, ...enc('\n%%EOF\n')]);

test('classify: PDF, HTML, no club, busy, and plain reasons', () => {
  assert.equal(classify({ status: 200, contentType: 'application/pdf', bytes: PDF }).kind, 'pdf');
  assert.equal(classify({ status: 200, contentType: 'application/octet-stream', bytes: PDF }).kind, 'pdf');
  assert.equal(classify({ status: 200, contentType: 'text/html; charset=UTF-8', bytes: enc('<p>x</p>') }).kind, 'html');
  assert.equal(classify({ status: 200, contentType: 'application/json', bytes: enc('{"ok":true,"noClub":true}') }).kind, 'noClub');
  assert.deepEqual(classify({ status: 429, contentType: 'application/json', bytes: enc('{"retryAfterMs":9000}') }), { kind: 'busy', waitMs: 9000 });
  const r401 = classify({ status: 401, contentType: 'application/json', bytes: enc('{}') });
  assert.equal(r401.kind, 'error'); assert.equal(r401.fatal, true);
  assert.equal(classify({ status: 503, contentType: 'application/json', bytes: enc('{"reason":"not-configured"}') }).fatal, true);
  const down = classify({ status: 502, contentType: 'application/json', bytes: enc('{"reason":"twotimtwo-down"}') });
  assert.equal(down.fatal, false); assert.match(down.reason, /not answering/);
});

test('withBase puts one <base> in the head', () => {
  assert.equal(withBase('<html><head><title>x</title></head></html>', 'https://t.example/'), '<html><head><base href="https://t.example/"><title>x</title></head></html>');
  assert.match(withBase('<table></table>', 'https://t.example/'), /^<!doctype html><html><head><base href="https:\/\/t\.example\/"><\/head><body><table>/);
  assert.equal(withBase('<head><base href="/a"></head>', 'https://t.example/'), '<head><base href="/a"></head>');
});

test('the file names and the Eastern date', () => {
  assert.equal(easternDate(new Date('2026-10-22T02:00:00Z')), '2026-10-21');
  assert.equal(fileNameFor('T&T', '2026-10-21'), 'T&T handbook 2026-10-21.pdf');
  assert.deepEqual(CLUBS.map((c) => c[0]), ['cubbies', 'sparks', 'tnt']);
});

test('the message: attachments only, no text part', () => {
  const m = buildMessage({ from: 'owner@gmail.com', to: 'printer@print.epsonconnect.com', subject: 'Handbook sheets', attachments: [{ name: 'Sparks handbook 2026-10-21.pdf', bytes: PDF }, { name: 'T&T handbook 2026-10-21.pdf', bytes: PDF }] });
  assert.match(m, /^From: owner@gmail\.com\r\nTo: printer@print\.epsonconnect\.com\r\nSubject: Handbook sheets\r\n/);
  assert.equal((m.match(/Content-Disposition: attachment; filename="/g) || []).length, 2);
  assert.doesNotMatch(m, /text\/plain|text\/html/);
  assert.ok(m.includes(Buffer.from(PDF).toString('base64')));
  assert.throws(() => buildMessage({ from: 'a@b.co\r\nBcc: x@y.z', to: 'p@q.rs', subject: 's', attachments: [{ name: 'a', bytes: PDF }] }), /bad-address/);
});

/** A stand-in SMTP server: answers each step, keeps what it was sent. */
function fakeSmtp({ authCode = 235 } = {}) {
  const got = { lines: [], data: '' };
  const server = net.createServer((sock) => {
    sock.setEncoding('utf8');
    let inData = false;
    let buf = '';
    sock.write('220 ready\r\n');
    sock.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') { inData = false; sock.write('250 queued\r\n'); } else got.data += `${line}\n`;
          continue;
        }
        got.lines.push(line);
        if (line.startsWith('EHLO')) sock.write('250-hello\r\n250-AUTH PLAIN\r\n250 OK\r\n');
        else if (line.startsWith('AUTH')) sock.write(`${authCode} auth\r\n`);
        else if (line.startsWith('MAIL') || line.startsWith('RCPT')) sock.write('250 ok\r\n');
        else if (line === 'DATA') { inData = true; sock.write('354 go\r\n'); } else if (line === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, got, port: server.address().port })));
}

test('sendMail speaks SMTP: auth, envelope, dot-stuffed data', async () => {
  const s = await fakeSmtp();
  try {
    await sendMail({ user: 'owner@gmail.com', pass: 'app pass', from: 'owner@gmail.com', to: 'p@print.epsonconnect.com', message: 'Subject: x\r\n\r\n.dot line\r\nend', connect: () => net.connect(s.port, '127.0.0.1') });
    assert.equal(s.got.lines[0], 'EHLO gmail.com');
    assert.equal(s.got.lines[1], `AUTH PLAIN ${Buffer.from('\0owner@gmail.com\0app pass').toString('base64')}`);
    assert.equal(s.got.lines[2], 'MAIL FROM:<owner@gmail.com>');
    assert.equal(s.got.lines[3], 'RCPT TO:<p@print.epsonconnect.com>');
    assert.match(s.got.data, /\n\.\.dot line\n/);
  } finally { s.server.close(); }
  const bad = await fakeSmtp({ authCode: 535 });
  try {
    await assert.rejects(sendMail({ user: 'a@b.co', pass: 'x', from: 'a@b.co', to: 'c@d.co', message: 'x', connect: () => net.connect(bad.port, '127.0.0.1') }), /smtp auth 535/);
  } finally { bad.server.close(); }
});

/** A stand-in sync Worker answering /api/v1/print/handbook. */
function fakeWorker(answer) {
  const asked = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    asked.push({ club: u.searchParams.get('club'), auth: req.headers.authorization });
    const a = answer(u.searchParams.get('club'));
    res.writeHead(a.status, { 'Content-Type': a.type });
    res.end(Buffer.from(a.body));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, asked, site: `http://127.0.0.1:${server.address().port}` })));
}
const ENV = { HANDBOOK_TOKEN: 'tok', GMAIL_USER: 'owner@gmail.com', GMAIL_APP_PASSWORD: 'abcd efgh' };

test('one try: three PDFs in one message to the Epson', async () => {
  const w = await fakeWorker(() => ({ status: 200, type: 'application/pdf', body: PDF }));
  const sent = [];
  try {
    const r = await attempt({ ...ENV, SITE_ORIGIN: w.site }, { send: async (m) => { sent.push(m); } });
    assert.equal(r, 'sent');
    assert.deepEqual(w.asked, CLUBS.map(([club]) => ({ club, auth: 'Bearer tok' })));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'kvbcdownstairs@print.epsonconnect.com');
    assert.equal(sent[0].pass, 'abcdefgh');
    for (const name of ['Cubbies', 'Sparks', 'T&T']) assert.match(sent[0].message, new RegExp(`filename="${name} handbook \\d{4}-\\d\\d-\\d\\d\\.pdf"`));
  } finally { w.server.close(); }
});

test('a dry run goes to GMAIL_USER; no club sends nothing; a 401 is fatal', async () => {
  const w = await fakeWorker(() => ({ status: 200, type: 'application/pdf', body: PDF }));
  const sent = [];
  try {
    await attempt({ ...ENV, SITE_ORIGIN: w.site, DRY_RUN: 'true' }, { send: async (m) => { sent.push(m); } });
    assert.equal(sent[0].to, 'owner@gmail.com');
    assert.match(sent[0].message, /Subject: \[Dry run\] Handbook sheets/);
  } finally { w.server.close(); }
  const n = await fakeWorker(() => ({ status: 200, type: 'application/json', body: '{"ok":true,"noClub":true}' }));
  try {
    assert.equal(await attempt({ ...ENV, SITE_ORIGIN: n.site }, { send: async () => { throw new Error('no'); } }), 'no-club');
    assert.equal(n.asked.length, 1);
  } finally { n.server.close(); }
  const u = await fakeWorker(() => ({ status: 401, type: 'application/json', body: '{"reason":"signed-out"}' }));
  try {
    await assert.rejects(attempt({ ...ENV, SITE_ORIGIN: u.site }), /HANDBOOK_TOKEN/);
  } finally { u.server.close(); }
});

const CHROMIUM = (() => {
  const dir = process.env.PLAYWRIGHT_BROWSERS_PATH || `${process.env.HOME}/.cache/ms-playwright`;
  try { return fs.readdirSync(dir).some((d) => d.startsWith('chromium')); } catch { return false; }
})();

test('an HTML report is printed to a PDF', { skip: CHROMIUM ? false : 'no Playwright Chromium here' }, async () => {
  const page = '<html><head><title>Handbook</title></head><body><h1>Handbook Report</h1><table><tr><td>Zelda Fakename</td><td>1.2</td></tr></table><img src="/images/logo.png"></body></html>';
  const w = await fakeWorker(() => ({ status: 200, type: 'text/html; charset=UTF-8', body: page }));
  const sent = [];
  try {
    await attempt({ ...ENV, SITE_ORIGIN: w.site, TWOTIMTWO_ORIGIN: 'https://127.0.0.1:9/' }, { send: async (m) => { sent.push(m); } });
    const parts = sent[0].message.split(/--=_handbook_[0-9a-f]+/).filter((p) => p.includes('filename='));
    assert.equal(parts.length, 3);
    for (const p of parts) {
      const b64 = p.split('\r\n\r\n')[1].replace(/\s+/g, '');
      assert.equal(Buffer.from(b64, 'base64').subarray(0, 5).toString(), '%PDF-');
    }
  } finally { w.server.close(); }
});
