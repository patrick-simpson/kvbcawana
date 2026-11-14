import { describe, expect, it } from 'vitest';
import { SyncCore } from '../src/sync.js';
import {
  CODE_FAILS_IP, MAIL_PART, MAIL_SENDS_PER_DAY, MAIL_SMALL_BYTES, MAIL_STEP_PARTS,
  cleanBlocks, cleanClubs, clubMailboxes, newCode, normalCode, recipientsByClub, renderMail,
} from '../src/clubmail.js';
import { memoryStore, signInV2 } from './helpers.js';

// Club email (src/routes.md 10.19): a director's own login, the club's parents read
// from TwoTimTwo's roster at the moment of sending, one message through Microsoft
// Graph from the Awana mailbox. Every name and address here is made up.

const ROSTER = {
  header: ['Clubber ID', 'First Name', 'Last Name', 'Club', 'Inactive', 'Email', 'Alt Email'],
  rows: [
    ['1', 'Ava', 'Stone', 'Sparks ', '', 'Stone@Example.com', 'dad.stone@example.com'],
    ['2', 'Ben', 'Stone', 'Sparks', '', 'stone@example.com', ''],
    ['3', 'Cara', 'Reed', 'Sparks', '', '', ''],
    ['4', 'Dan', 'Gone', 'Sparks', 'Y', 'gone@example.com', ''],
    ['5', 'Eli', 'Pike', 'Trek', '', 'pike@example.com; not-an-address', ''],
    ['6', 'Fay', 'Hill', 'T&T ', '', 'hill@example.com', ''],
    ['7', 'Gus', 'Lane', 'Puggles', '', 'lane@example.com', ''],
  ],
};
const OWNER = 'owner-code-1234';
const MS = { MS_TENANT_ID: 'tenant', MS_CLIENT_ID: 'client', MS_CLIENT_SECRET: 'secret', MAIL_OWNER_CODE: OWNER };

async function setup(env = MS) {
  const storage = memoryStore();
  let t = Date.parse('2026-11-13T15:00:00Z');
  /** @type {any[]} */
  const calls = [];
  const answers = { send: 202, tokenStatus: 200, sendThrows: false };
  const fetchFn = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://login.microsoftonline.com/')) {
      calls.push({ kind: 'token', url: u });
      return answers.tokenStatus === 200 ? Response.json({ access_token: 'app-token', expires_in: 3600 }) : new Response('{}', { status: answers.tokenStatus });
    }
    if (u.startsWith('https://upload.test/')) {
      calls.push({ kind: 'put', range: init.headers['Content-Range'], bytes: init.body.length, auth: init.headers.Authorization });
      return Response.json({}, { status: 200 });
    }
    const box = /^https:\/\/graph\.microsoft\.com\/v1\.0\/users\/((?:awana|puggles)%40kvbchurch\.org)(\/.*)$/.exec(u);
    if (box) {
      const path = box[2];
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ kind: 'graph', mailbox: decodeURIComponent(box[1]), method: init.method, path, body, auth: init.headers.Authorization });
      if (path === '/sendMail') return new Response(null, { status: 202 });
      if (path === '/messages') return Response.json({ id: 'MSG1' }, { status: 201 });
      if (path.endsWith('/attachments')) return Response.json({ id: 'ATT' }, { status: 201 });
      if (path.endsWith('/createUploadSession')) return Response.json({ uploadUrl: 'https://upload.test/session' }, { status: 201 });
      if (path.endsWith('/send')) {
        if (answers.sendThrows) throw new Error('network');
        return new Response(answers.send === 202 ? null : '{}', { status: answers.send });
      }
    }
    throw new Error(`unexpected fetch ${u}`);
  };
  const core = new SyncCore({ storage, fetchFn, env: { INITIAL_PASSPHRASE: 'kennebec', ...env }, now: () => t, broadcast: () => 1, liveScreens: () => new Set() });
  let rosterReads = 0;
  let rosterAnswer = { ok: true, roster: ROSTER };
  core.clubMail.client = () => ({ rosterCsv: async () => { rosterReads += 1; return rosterAnswer; } });
  const session = (await signInV2(core)).body.session;
  const call = async (method, path, body, auth = { session, owner: OWNER }, ip = '10.0.0.1') => {
    const raw = typeof body === 'string' || body instanceof Uint8Array;
    const res = await core.handle(new Request(`https://sync.test${path}`, {
      method,
      headers: { ...(raw ? {} : { 'Content-Type': 'application/json' }), ...(auth.session ? { Authorization: `Bearer ${auth.session}` } : {}), ...(auth.token ? { 'X-Mail-Token': auth.token } : {}), ...(auth.owner ? { 'X-Mail-Owner': auth.owner } : {}) },
      body: body === undefined ? undefined : (raw ? body : JSON.stringify(body)),
    }), ip);
    return { status: res.status, body: await res.json() };
  };
  /** Add a director and sign them in with the code the Worker mailed. */
  const director = async (d = { name: 'Dana Cole', replyTo: 'dana@example.com', clubs: ['sparks'] }) => {
    const added = await call('POST', '/v1/mail/directors', d);
    expect(added.status).toBe(200);
    const mail = calls.filter((c) => c.path === '/sendMail' && c.body.message.toRecipients[0].emailAddress.address === d.replyTo).pop();
    const code = /Your code: (\S+)/.exec(mail.body.message.body.content)[1];
    const login = await call('POST', '/v1/mail/login', { code }, {});
    expect(login.status).toBe(200);
    return { id: added.body.director.id, code, auth: { token: login.body.token } };
  };
  return {
    core, storage, call, calls, answers, director, session,
    tick: (ms) => { t += ms; }, rosterReads: () => rosterReads, setRoster: (a) => { rosterAnswer = a; },
    graph: () => calls.filter((c) => c.kind === 'graph'),
  };
}

/** Run /step until the message is sent (or the stage stops moving). */
async function run(s, id, auth) {
  let last;
  for (let i = 0; i < 200; i += 1) {
    last = await s.call('POST', `/v1/mail/drafts/${id}/step`, {}, auth);
    if (last.status !== 200 || last.body.done || last.body.stage === 'unknown') break;
  }
  return last;
}
const WORDS = [{ t: 'p', text: 'Bring a shoebox on Wednesday.\nSee https://example.org/list.' }];

describe('club email: the pure rules', () => {
  it('reads each club\'s parents once, active children only', () => {
    const by = recipientsByClub(ROSTER);
    expect(by.sparks).toEqual({ emails: ['dad.stone@example.com', 'stone@example.com'], kids: 3, noEmail: 1 });
    expect(by.trek.emails).toEqual(['pike@example.com']);
    expect(by['t&t'].emails).toEqual(['hill@example.com']);
    expect(by.cubbies).toEqual({ emails: [], kids: 0, noEmail: 0 });
  });

  it('cleans clubs, codes and blocks', () => {
    expect(cleanClubs(['Trek', 'tnt', 'nope', 'trek'])).toEqual(['t&t', 'trek']);
    expect(newCode()).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(normalCode(' abcd-efgh jkmn ')).toBe('ABCDEFGHJKMN');
    expect(cleanBlocks([{ t: 'p', text: ' hi ' }, { t: 'img', file: 3 }, { t: 'script', text: 'x' }, { t: 'ul', items: ['a', ''] }], 1)).toEqual([{ t: 'p', text: 'hi' }, { t: 'ul', items: ['a'] }]);
  });

  it('builds the HTML itself: a page\'s markup is only text', () => {
    const m = renderMail({ blocks: [{ t: 'p', text: '<script>x</script> https://example.org/a.' }, { t: 'img', file: 0 }], files: [{ name: 'a "b".png', inline: true }], club: 'sparks', sender: 'Dana <b>', replyTo: 'd@example.com', test: false });
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('&lt;script&gt;');
    expect(m.html).toContain('<a href="https://example.org/a"');
    expect(m.html).toContain('src="cid:f0"');
    expect(m.html).toContain('Dana &lt;b&gt; for Sparks');
    expect(m.text).toContain('Reply to this email to reach Dana <b>.');
  });
});

describe('club email: directors and signing in', () => {
  it('says not set up without the Microsoft secrets', async () => {
    const s = await setup({ MAIL_OWNER_CODE: OWNER });
    expect((await s.call('GET', '/v1/mail/directors')).body.ready).toBe(false);
    expect((await s.call('POST', '/v1/mail/directors', { name: 'A', replyTo: 'a@example.com', clubs: ['trek'] })).status).toBe(503);
  });

  it('only the owner manages directors: the church passphrase alone opens nothing', async () => {
    const s = await setup();
    const justSession = { session: s.session };
    expect((await s.call('GET', '/v1/mail/directors', undefined, justSession)).body.reason).toBe('not-owner');
    expect((await s.call('POST', '/v1/mail/directors', { name: 'A', replyTo: 'a@example.com', clubs: ['trek'] }, justSession)).status).toBe(403);
    expect((await s.call('GET', '/v1/mail/directors', undefined, { owner: OWNER })).status).toBe(401);
    expect((await s.call('GET', '/v1/mail/me', undefined, justSession)).status).toBe(401);
    expect((await s.call('POST', '/v1/mail/drafts', { club: 'trek', subject: 'x', blocks: WORDS, files: [] }, justSession)).status).toBe(401);
    expect(s.graph()).toEqual([]);
    for (let i = 0; i < CODE_FAILS_IP; i += 1) expect((await s.call('GET', '/v1/mail/directors', undefined, { session: s.session, owner: 'wrong-code-00000' })).status).toBe(403);
    expect((await s.call('GET', '/v1/mail/directors')).status).toBe(429);
    const unset = await setup({ MS_TENANT_ID: 't', MS_CLIENT_ID: 'c', MS_CLIENT_SECRET: 's', MAIL_OWNER_CODE: 'short' });
    expect((await unset.call('GET', '/v1/mail/directors')).body.reason).toBe('owner-not-set');
  });

  it('mails the code to the director and never answers it to the page', async () => {
    const s = await setup();
    const added = await s.call('POST', '/v1/mail/directors', { name: 'Dana Cole', replyTo: 'Dana@Example.com', clubs: ['Sparks', 'bogus'] });
    expect(added.body.director).toMatchObject({ name: 'Dana Cole', replyTo: 'dana@example.com', clubs: ['sparks'] });
    expect(JSON.stringify(added.body)).not.toMatch(/[A-Z2-9]{4}-[A-Z2-9]{4}/);
    const [toDirector, notice] = s.graph();
    expect(toDirector.body.saveToSentItems).toBe(false);
    expect(toDirector.body.message.body.content).toMatch(/Your code: [A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}/);
    expect(notice.body.message.toRecipients[0].emailAddress.address).toBe('awana@kvbchurch.org');
    expect(notice.body.message.body.content).not.toMatch(/[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}/);
    // Nothing stored holds the code itself.
    expect(JSON.stringify([...s.storage.map.values()])).not.toContain(/Your code: (\S+)/.exec(toDirector.body.message.body.content)[1]);
    expect((await s.call('GET', '/v1/mail/directors')).body.directors).toHaveLength(1);
    expect((await s.call('POST', '/v1/mail/directors', { name: 'Twin', replyTo: 'dana@example.com', clubs: ['trek'] })).body.reason).toBe('exists');
    expect((await s.call('POST', '/v1/mail/directors', { name: '', replyTo: 'x', clubs: [] })).status).toBe(400);
  });

  it('a director that could not be mailed is not added', async () => {
    const s = await setup();
    s.answers.tokenStatus = 401;
    expect((await s.call('POST', '/v1/mail/directors', { name: 'Dana', replyTo: 'dana@example.com', clubs: ['sparks'] })).body.reason).toBe('graph-auth');
    expect((await s.call('GET', '/v1/mail/directors')).body.directors).toEqual([]);
  });

  it('needs the session for the directors list, and a director sees only their clubs', async () => {
    const s = await setup();
    const d = await s.director();
    expect((await s.call('GET', '/v1/mail/directors', undefined, d.auth)).status).toBe(401);
    expect((await s.call('GET', '/v1/mail/me', undefined, {})).status).toBe(401);
    const me = await s.call('GET', '/v1/mail/me', undefined, d.auth);
    expect(me.body).toMatchObject({ name: 'Dana Cole', office: false, clubs: [{ id: 'sparks', name: 'Sparks', from: 'awana@kvbchurch.org' }], from: 'awana@kvbchurch.org' });
    expect((await s.call('GET', '/v1/mail/recipients?club=trek', undefined, d.auth)).body.reason).toBe('not-your-club');
    const r = await s.call('GET', '/v1/mail/recipients?club=sparks', undefined, d.auth);
    expect(r.body).toEqual({ ok: true, club: 'sparks', name: 'Sparks', addresses: 2, kids: 3, kidsWithoutEmail: 1 });
    expect(JSON.stringify(r.body)).not.toContain('@');
    const office = await s.call('GET', '/v1/mail/me');
    expect(office.body.office).toBe(true);
    expect(office.body.clubs).toHaveLength(6);
  });

  it('locks a network after too many wrong codes; a new code ends the old sign-in', async () => {
    const s = await setup();
    const d = await s.director();
    for (let i = 0; i < CODE_FAILS_IP; i += 1) expect((await s.call('POST', '/v1/mail/login', { code: 'AAAA-AAAA-AAAA' }, {}, '10.9.9.9')).status).toBe(401);
    expect((await s.call('POST', '/v1/mail/login', { code: d.code }, {}, '10.9.9.9')).status).toBe(429);
    expect((await s.call('POST', '/v1/mail/login', { code: d.code }, {}, '10.1.1.1')).status).toBe(200);
    expect((await s.call('POST', `/v1/mail/directors/${d.id}/code`, {})).status).toBe(200);
    expect((await s.call('GET', '/v1/mail/me', undefined, d.auth)).status).toBe(401);
    expect((await s.call('POST', '/v1/mail/login', { code: d.code }, {}, '10.1.1.1')).status).toBe(401);
    const again = await s.director({ name: 'Eve', replyTo: 'eve@example.com', clubs: ['trek'] });
    expect((await s.call('DELETE', `/v1/mail/directors/${again.id}`)).status).toBe(200);
    expect((await s.call('GET', '/v1/mail/me', undefined, again.auth)).status).toBe(401);
  });
});

describe('club email: a message', () => {
  it('goes to the club\'s parents on BCC, replies to the director, once', async () => {
    const s = await setup();
    const d = await s.director();
    const st = await s.call('POST', '/v1/mail/drafts', { club: 'sparks', subject: ' Shoeboxes \n Wednesday ', blocks: WORDS, files: [] }, d.auth);
    expect(st.status).toBe(200);
    const id = st.body.id;
    expect((await s.call('POST', `/v1/mail/drafts/${id}/step`, {}, d.auth)).body.reason).toBe('no-run');
    expect((await s.call('POST', `/v1/mail/drafts/${id}/send`, {}, d.auth)).body.stage).toBe('draft');
    const done = await run(s, id, d.auth);
    expect(done.body).toMatchObject({ done: true, stage: 'sent', percent: 100, recipients: 2 });
    const made = s.graph().find((c) => c.path === '/messages');
    expect(made.body.subject).toBe('Shoeboxes Wednesday');
    expect(made.body.bccRecipients.map((r) => r.emailAddress.address)).toEqual(['dad.stone@example.com', 'stone@example.com']);
    expect(made.body.toRecipients).toEqual([{ emailAddress: { address: 'dana@example.com', name: 'Dana Cole' } }]);
    expect(made.body.replyTo).toEqual(made.body.toRecipients);
    expect(made.body.body.content).toContain('<a href="https://example.org/list"');
    expect(s.graph().filter((c) => c.path === '/messages/MSG1/send')).toHaveLength(1);
    // A second go is refused, and nothing is sent again.
    expect((await s.call('POST', `/v1/mail/drafts/${id}/send`, {}, d.auth)).body.reason).toBe('sent');
    await run(s, id, d.auth);
    expect(s.graph().filter((c) => c.path === '/messages/MSG1/send')).toHaveLength(1);
    // The log names the send, never an address; storage holds none either.
    const log = await s.call('GET', '/v1/mail/log');
    expect(log.body.sends[0]).toMatchObject({ name: 'Dana Cole', club: 'sparks', subject: 'Shoeboxes Wednesday', recipients: 2 });
    expect(JSON.stringify([...s.storage.map.values()])).not.toContain('stone@example.com');
  });

  it('a club with a mailbox of its own sends from it; the others and the login mails stay on the Awana one', async () => {
    expect(clubMailboxes(' Puggle = Puggles@KVBChurch.org , nope=x@example.com; sparks=not-an-address, trek ')).toEqual({ puggles: 'puggles@kvbchurch.org' });
    expect(clubMailboxes(undefined)).toEqual({});
    const s = await setup({ ...MS, MAIL_FROM_CLUBS: 'puggles=puggles@kvbchurch.org' });
    const d = await s.director({ name: 'Pat Bean', replyTo: 'puggles@kvbchurch.org', clubs: ['puggles', 'sparks'] });
    // The login code and the notice still come from the Awana mailbox.
    expect(s.graph().filter((c) => c.path === '/sendMail').map((c) => c.mailbox)).toEqual(['awana@kvbchurch.org', 'awana@kvbchurch.org']);
    const me = await s.call('GET', '/v1/mail/me', undefined, d.auth);
    expect(me.body.from).toBe('awana@kvbchurch.org');
    expect(me.body.clubs).toEqual([{ id: 'puggles', name: 'Puggles', from: 'puggles@kvbchurch.org' }, { id: 'sparks', name: 'Sparks', from: 'awana@kvbchurch.org' }]);
    const send = async (club) => {
      const id = (await s.call('POST', '/v1/mail/drafts', { club, subject: 'Hello', blocks: WORDS, files: [] }, d.auth)).body.id;
      const before = s.graph().length;
      await s.call('POST', `/v1/mail/drafts/${id}/send`, {}, d.auth);
      expect((await run(s, id, d.auth)).body).toMatchObject({ done: true, stage: 'sent' });
      return s.graph().slice(before);
    };
    const pug = await send('puggles');
    expect(pug.map((c) => c.path)).toEqual(['/messages', '/messages/MSG1/send']);
    expect(pug.every((c) => c.mailbox === 'puggles@kvbchurch.org')).toBe(true);
    expect(pug[0].body.bccRecipients.map((r) => r.emailAddress.address)).toEqual(['lane@example.com']);
    expect(pug[0].body.replyTo).toEqual([{ emailAddress: { address: 'puggles@kvbchurch.org', name: 'Pat Bean' } }]);
    const sparks = await send('sparks');
    expect(sparks.every((c) => c.mailbox === 'awana@kvbchurch.org')).toBe(true);
  });

  it('a test goes to the sender alone and leaves the message ready', async () => {
    const s = await setup();
    const d = await s.director();
    const id = (await s.call('POST', '/v1/mail/drafts', { club: 'sparks', subject: 'Hello', blocks: WORDS, files: [] }, d.auth)).body.id;
    await s.call('POST', `/v1/mail/drafts/${id}/send`, { test: true }, d.auth);
    expect((await run(s, id, d.auth)).body).toMatchObject({ done: true, test: true, recipients: 0 });
    const made = s.graph().find((c) => c.path === '/messages');
    expect(made.body.subject).toBe('[Test] Hello');
    expect(made.body.bccRecipients).toEqual([]);
    expect(s.rosterReads()).toBe(0);
    expect((await s.call('GET', '/v1/mail/log')).body.sends).toEqual([]);
    expect((await s.call('POST', `/v1/mail/drafts/${id}/send`, {}, d.auth)).status).toBe(200);
    expect((await run(s, id, d.auth)).body).toMatchObject({ done: true, test: false, recipients: 2 });
  });

  it('refuses another club, an empty message and a program', async () => {
    const s = await setup();
    const d = await s.director();
    expect((await s.call('POST', '/v1/mail/drafts', { club: 'trek', subject: 'x', blocks: WORDS, files: [] }, d.auth)).body.reason).toBe('not-your-club');
    expect((await s.call('POST', '/v1/mail/drafts', { club: 'sparks', subject: '', blocks: WORDS, files: [] }, d.auth)).body.reason).toBe('subject');
    expect((await s.call('POST', '/v1/mail/drafts', { club: 'sparks', subject: 'x', blocks: [], files: [] }, d.auth)).body.reason).toBe('empty');
    expect((await s.call('POST', '/v1/mail/drafts', { club: 'sparks', subject: 'x', blocks: WORDS, files: [{ name: 'a.exe', type: 'application/x-msdownload', size: 10 }] }, d.auth)).body.reason).toBe('file-type');
    expect((await s.call('POST', '/v1/mail/drafts', { club: 'sparks', subject: 'x', blocks: WORDS, files: [{ name: 'a.pdf', type: 'application/pdf', size: 30 * 1024 * 1024 }] }, d.auth)).body.reason).toBe('too-big');
  });

  it('attaches a small picture in one request and a big file in ranges', async () => {
    const s = await setup();
    const d = await s.director();
    const small = 'QUJD'.repeat(30000);   // 120,000 base64 chars = 90,000 bytes
    const bigSize = MAIL_SMALL_BYTES + MAIL_PART * MAIL_STEP_PARTS + 500;
    const big = new Uint8Array(bigSize).fill(7);
    const st = await s.call('POST', '/v1/mail/drafts', {
      club: 'sparks', subject: 'Flyer', blocks: [...WORDS, { t: 'img', file: 0 }],
      files: [{ name: 'photo.png', type: 'image/png', size: 90000, inline: true }, { name: 'flyer.pdf', type: 'application/pdf', size: bigSize, inline: true }],
    }, d.auth);
    expect(st.body.files[0]).toEqual({ enc: 'b64', parts: 2 });
    expect(st.body.files[1].enc).toBe('raw');
    const id = st.body.id;
    expect((await s.call('PUT', `/v1/mail/drafts/${id}/files/0/1`, small.slice(MAIL_PART), d.auth)).body.reason).toBe('order');
    for (let n = 0; n < 2; n += 1) expect((await s.call('PUT', `/v1/mail/drafts/${id}/files/0/${n}`, small.slice(n * MAIL_PART, (n + 1) * MAIL_PART), d.auth)).status).toBe(200);
    expect((await s.call('POST', `/v1/mail/drafts/${id}/send`, {}, d.auth)).body.reason).toBe('parts');
    for (let n = 0; n < st.body.files[1].parts; n += 1) expect((await s.call('PUT', `/v1/mail/drafts/${id}/files/1/${n}`, big.slice(n * MAIL_PART, (n + 1) * MAIL_PART), d.auth)).status).toBe(200);
    await s.call('POST', `/v1/mail/drafts/${id}/send`, {}, d.auth);
    expect((await run(s, id, d.auth)).body.done).toBe(true);
    const att = s.graph().find((c) => c.path === '/messages/MSG1/attachments');
    expect(att.body).toMatchObject({ name: 'photo.png', contentType: 'image/png', isInline: true, contentId: 'f0' });
    expect(att.body.contentBytes).toBe(small);
    const session = s.graph().find((c) => c.path.endsWith('/createUploadSession'));
    expect(session.body.AttachmentItem).toEqual({ attachmentType: 'file', size: bigSize, name: 'flyer.pdf', contentType: 'application/pdf', isInline: false });
    const puts = s.calls.filter((c) => c.kind === 'put');
    expect(puts.reduce((a, p) => a + p.bytes, 0)).toBe(bigSize);
    expect(puts[0].range).toBe(`bytes 0-${MAIL_PART * MAIL_STEP_PARTS - 1}/${bigSize}`);
    expect(puts.at(-1).range).toMatch(new RegExp(`-${bigSize - 1}/${bigSize}$`));
    expect(puts.every((p) => p.auth === undefined)).toBe(true);
    // The pieces are gone once it is sent.
    expect([...s.storage.map.keys()].filter((k) => k.startsWith('mail:part:'))).toEqual([]);
  });

  it('a refused send may be tried again; a send with no answer never is', async () => {
    const s = await setup();
    const d = await s.director();
    const id = (await s.call('POST', '/v1/mail/drafts', { club: 'sparks', subject: 'Hello', blocks: WORDS, files: [] }, d.auth)).body.id;
    await s.call('POST', `/v1/mail/drafts/${id}/send`, {}, d.auth);
    s.answers.send = 503;
    expect((await run(s, id, d.auth)).body.reason).toBe('graph');
    s.answers.send = 202;
    s.answers.sendThrows = true;
    expect((await run(s, id, d.auth)).body).toMatchObject({ stage: 'unknown', done: false });
    s.answers.sendThrows = false;
    expect((await run(s, id, d.auth)).body.stage).toBe('unknown');
    expect((await s.call('POST', `/v1/mail/drafts/${id}/send`, {}, d.auth)).body.reason).toBe('running');
    expect(s.graph().filter((c) => c.path === '/messages/MSG1/send')).toHaveLength(2);
  });

  it('says so when TwoTimTwo cannot be read or the club has no address, and stops at the day\'s limit', async () => {
    const s = await setup();
    const d = await s.director({ name: 'Cub Lead', replyTo: 'cub@example.com', clubs: ['cubbies', 'sparks'] });
    const draft = async (club) => (await s.call('POST', '/v1/mail/drafts', { club, subject: 'Hello', blocks: WORDS, files: [] }, d.auth)).body.id;
    let id = await draft('cubbies');
    await s.call('POST', `/v1/mail/drafts/${id}/send`, {}, d.auth);
    expect((await run(s, id, d.auth)).body.reason).toBe('no-recipients');
    s.tick(6 * 60 * 1000);
    s.setRoster({ ok: false, error: 'read-busy' });
    id = await draft('sparks');
    await s.call('POST', `/v1/mail/drafts/${id}/send`, {}, d.auth);
    expect((await run(s, id, d.auth)).status).toBe(503);
    s.setRoster({ ok: true, roster: ROSTER });
    expect((await run(s, id, d.auth)).body.done).toBe(true);
    for (let i = 1; i < MAIL_SENDS_PER_DAY; i += 1) {
      id = await draft('sparks');
      await s.call('POST', `/v1/mail/drafts/${id}/send`, {}, d.auth);
      expect((await run(s, id, d.auth)).body.done).toBe(true);
    }
    id = await draft('sparks');
    expect((await s.call('POST', `/v1/mail/drafts/${id}/send`, {}, d.auth)).body.reason).toBe('daily-limit');
    expect((await s.call('POST', `/v1/mail/drafts/${id}/send`, { test: true }, d.auth)).status).toBe(200);
  });
});
