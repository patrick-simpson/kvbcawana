import { describe, expect, it } from 'vitest';
import { SyncCore } from '../src/sync.js';
import {
  CODE_FAILS_IP, LATER_PER_SENDER, LATER_STEP_MS, LATER_TRIES, MAIL_PART, MAIL_RECIPIENTS_MAX, MAIL_SENDS_PER_DAY, MAIL_SMALL_BYTES, MAIL_STEP_PARTS,
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
  const answers = { send: 202, tokenStatus: 200, sendThrows: false, inbox: /** @type {any} */ ([]) };
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
      if (path.startsWith('/mailFolders/inbox/messages?')) return answers.inbox ? Response.json({ value: answers.inbox }) : new Response('{}', { status: 503 });
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

describe('club email: the Microsoft secret\'s end', () => {
  it('warns the Awana mailbox weekly in the last month, and the owner on the page', async () => {
    // The tests' clock is 2026-11-13 15:00 UTC.
    const far = await setup({ ...MS, MS_SECRET_ENDS: '2028-11-12' });
    expect(far.core.clubMail.secretDaysLeft()).toBe(730);
    expect(await far.core.clubMail.secretCheck()).toBe(false);
    expect((await far.call('GET', '/v1/mail/me')).body.secretDaysLeft).toBe(null);
    expect((await setup()).core.clubMail.secretDaysLeft()).toBe(null);   // not named: nothing is said

    const s = await setup({ ...MS, MS_SECRET_ENDS: '2026-12-01' });
    const d = await s.director();
    const before = s.graph().length;
    expect(s.core.clubMail.secretDaysLeft()).toBe(18);
    expect(await s.core.clubMail.secretCheck()).toBe(true);
    const note = s.graph().slice(before);
    expect(note).toHaveLength(1);
    expect(note[0].body.message.subject).toBe('Club email stops in 18 days unless its Microsoft secret is renewed');
    expect(note[0].body.message.toRecipients).toEqual([{ emailAddress: { address: 'awana@kvbchurch.org' } }]);
    expect(note[0].body.message.body.content).toContain('2026-12-01');
    // Once a week, not at every cron.
    s.tick(6 * 60 * 60 * 1000);
    expect(await s.core.clubMail.secretCheck()).toBe(false);
    s.tick(7 * 24 * 60 * 60 * 1000);
    expect(await s.core.clubMail.secretCheck()).toBe(true);
    // The owner sees it on the page; a director does not.
    expect((await s.call('GET', '/v1/mail/me')).body.secretDaysLeft).toBe(11);
    expect((await s.call('GET', '/v1/mail/me', undefined, d.auth)).body.secretDaysLeft).toBe(null);
    // Once it has ended nothing can be mailed: no try.
    s.tick(30 * 24 * 60 * 60 * 1000);
    const count = s.graph().length;
    expect(await s.core.clubMail.secretCheck()).toBe(false);
    expect(s.graph()).toHaveLength(count);
    expect((await s.call('GET', '/v1/mail/me')).body.secretDaysLeft).toBeLessThan(0);
  });
});

describe('club email: send later', () => {
  const AT = '2026-11-18T14:00:00.000Z';   // five days after the tests' clock
  /** A director's finished draft, given a time. */
  async function waiting(s, d, at = AT, subject = 'Tonight') {
    const id = (await s.call('POST', '/v1/mail/drafts', { club: 'sparks', subject, blocks: WORDS, files: [] }, d.auth)).body.id;
    return { id, res: await s.call('POST', `/v1/mail/drafts/${id}/later`, { at }, d.auth) };
  }
  /** The alarm, until nothing is due (the clock moves on between its steps). */
  async function alarms(s) {
    let n = 0;
    while (n < 60 && await s.core.clubMail.tick()) { n += 1; s.tick(LATER_STEP_MS); }
    return n;
  }

  it('waits for its time, then goes out by the alarm with the parents read at that moment', async () => {
    const s = await setup();
    const set = [];
    s.core.clubMail.alarms = () => ({ get: () => set.at(-1) ?? null, set: (at) => { set.push(at); } });
    const d = await s.director();
    expect((await waiting(s, d, '2026-11-13T15:02:00.000Z')).res.body.reason).toBe('too-soon');
    expect((await waiting(s, d, '2027-01-13T15:00:00.000Z')).res.body.reason).toBe('too-far');
    expect((await waiting(s, d, 'soon')).res.body.reason).toBe('too-soon');
    const { id, res } = await waiting(s, d);
    expect(res.body).toEqual({ ok: true, id, at: AT });
    expect(set).toEqual([Date.parse(AT)]);   // the alarm is pulled to its time
    expect(s.rosterReads()).toBe(0);
    // It left the draft slot: nothing to send by hand, and a new message can be written.
    expect((await s.call('POST', `/v1/mail/drafts/${id}/send`, {}, d.auth)).status).toBe(404);
    const list = await s.call('GET', '/v1/mail/later', undefined, d.auth);
    expect(list.body.later).toEqual([{ id, at: AT, name: 'Dana Cole', club: 'sparks', clubName: 'Sparks', subject: 'Tonight', files: 0, state: 'waiting', problem: '' }]);
    expect((await s.call('GET', '/v1/mail/later')).body.later).toHaveLength(1);   // the office sees it too
    // Before its time the alarm does nothing.
    expect(await s.core.clubMail.tick()).toBe(false);
    expect(s.graph().filter((c) => c.path === '/messages')).toHaveLength(0);
    s.tick(Date.parse(AT) - Date.parse('2026-11-13T15:00:00Z'));
    s.setRoster({ ok: true, roster: { header: ROSTER.header, rows: [['9', 'Zed', 'New', 'Sparks', '', 'new@example.com', '']] } });
    expect(await alarms(s)).toBe(2);   // its draft, its send
    const made = s.graph().filter((c) => c.path === '/messages');
    expect(made).toHaveLength(1);
    expect(made[0].body.bccRecipients.map((r) => r.emailAddress.address)).toEqual(['new@example.com', 'awana@kvbchurch.org']);
    expect(s.graph().filter((c) => c.path === '/messages/MSG1/send')).toHaveLength(1);
    expect((await s.call('GET', '/v1/mail/later', undefined, d.auth)).body.later).toEqual([]);
    expect((await s.call('GET', '/v1/mail/log', undefined, d.auth)).body.sends[0]).toMatchObject({ id, subject: 'Tonight', recipients: 1 });
    expect(await s.storage.get(`mail:later:${id}`)).toBeUndefined();
    expect(await s.core.clubMail.tick()).toBe(false);   // never twice
    expect(await s.core.clubMail.wake()).toBe(null);
  });

  it('can be cancelled, is limited, and goes with its director', async () => {
    const s = await setup();
    const d = await s.director();
    const other = await s.director({ name: 'Eve', replyTo: 'eve@example.com', clubs: ['sparks'] });
    const first = await waiting(s, d);
    expect((await s.call('DELETE', `/v1/mail/later/${first.id}`, undefined, other.auth)).body.reason).toBe('no-later');
    expect((await s.call('DELETE', `/v1/mail/later/${first.id}`, undefined, d.auth)).status).toBe(200);
    expect((await s.call('GET', '/v1/mail/later', undefined, d.auth)).body.later).toEqual([]);
    for (let i = 0; i < LATER_PER_SENDER; i += 1) expect((await waiting(s, d, AT, `No ${i}`)).res.status).toBe(200);
    expect((await waiting(s, d)).res.body.reason).toBe('later-full');
    expect((await waiting(s, other)).res.status).toBe(200);
    expect((await s.call('DELETE', `/v1/mail/directors/${d.id}`)).status).toBe(200);
    expect((await s.call('GET', '/v1/mail/later')).body.later.map((x) => x.name)).toEqual(['Eve']);
    s.tick(6 * 24 * 60 * 60 * 1000);
    await alarms(s);
    expect(s.graph().filter((c) => c.path === '/messages')).toHaveLength(1);   // only Eve's
  });

  it('tries again when the parents cannot be read, then gives up and tells the sender', async () => {
    const s = await setup();
    const d = await s.director();
    const { id } = await waiting(s, d);
    s.tick(6 * 24 * 60 * 60 * 1000);
    s.setRoster({ ok: false, error: 'roster' });
    expect(await s.core.clubMail.tick()).toBe(true);
    expect(await s.core.clubMail.tick()).toBe(false);   // it waits before the next try
    expect((await s.call('GET', '/v1/mail/later', undefined, d.auth)).body.later[0]).toMatchObject({ state: 'waiting' });
    // The parents can be read again: it goes out.
    s.tick(3 * 60 * 1000);
    s.setRoster({ ok: true, roster: ROSTER });
    await alarms(s);
    expect(s.graph().filter((c) => c.path === '/messages/MSG1/send')).toHaveLength(1);

    const again = await waiting(s, d, new Date(Date.parse(AT) + 8 * 24 * 60 * 60 * 1000).toISOString(), 'Never');
    expect(again.res.status).toBe(200);
    s.tick(8 * 24 * 60 * 60 * 1000);
    s.setRoster({ ok: false, error: 'roster' });
    for (let i = 0; i < LATER_TRIES; i += 1) { expect(await s.core.clubMail.tick()).toBe(true); s.tick(16 * 60 * 1000); }
    expect(await s.core.clubMail.tick()).toBe(false);
    const line = (await s.call('GET', '/v1/mail/later', undefined, d.auth)).body.later[0];
    expect(line).toMatchObject({ id: again.id, state: 'failed' });
    expect(line.problem).toContain(`tried ${LATER_TRIES} times`);
    const note = s.graph().filter((c) => c.path === '/sendMail').pop();
    expect(note.body.message.subject).toBe('Not sent: Never');
    expect(note.body.message.toRecipients[0].emailAddress.address).toBe('dana@example.com');
    expect(await s.storage.get(`mail:later:${again.id}`)).toBeUndefined();
    expect(id).not.toBe(again.id);
    // The failed line is the sender's to clear.
    expect((await s.call('DELETE', `/v1/mail/later/${again.id}`, undefined, d.auth)).status).toBe(200);
  });

  it('never sends twice when Microsoft does not answer the send', async () => {
    const s = await setup();
    const d = await s.director();
    await waiting(s, d);
    s.tick(6 * 24 * 60 * 60 * 1000);
    s.answers.sendThrows = true;
    await alarms(s);
    s.answers.sendThrows = false;
    s.tick(60 * 60 * 1000);
    await alarms(s);
    expect(s.graph().filter((c) => c.path === '/messages/MSG1/send')).toHaveLength(1);
    expect((await s.call('GET', '/v1/mail/later', undefined, d.auth)).body.later[0].state).toBe('failed');
    expect(s.graph().filter((c) => c.path === '/sendMail').pop().body.message.subject).toBe('Check: Tonight');
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
    // The parents, then the Awana mailbox's own copy (never counted: `recipients: 2` above).
    expect(made.body.bccRecipients.map((r) => r.emailAddress.address)).toEqual(['dad.stone@example.com', 'stone@example.com', 'awana@kvbchurch.org']);
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
    expect(pug[0].body.bccRecipients.map((r) => r.emailAddress.address)).toEqual(['lane@example.com', 'awana@kvbchurch.org']);
    expect(pug[0].body.replyTo).toEqual([{ emailAddress: { address: 'puggles@kvbchurch.org', name: 'Pat Bean' } }]);
    const sparks = await send('sparks');
    expect(sparks.every((c) => c.mailbox === 'awana@kvbchurch.org')).toBe(true);
  });

  it('"all" goes to every one of the sender\'s clubs, each address once, from the Awana mailbox', async () => {
    const s = await setup({ ...MS, MAIL_FROM_CLUBS: 'puggles=puggles@kvbchurch.org' });
    const one = await s.director();
    expect((await s.call('GET', '/v1/mail/me', undefined, one.auth)).body.all).toBe(null);
    expect((await s.call('GET', '/v1/mail/recipients?club=all', undefined, one.auth)).body.reason).toBe('not-your-club');
    expect((await s.call('POST', '/v1/mail/drafts', { club: 'all', subject: 'x', blocks: WORDS, files: [] }, one.auth)).body.reason).toBe('not-your-club');
    const d = await s.director({ name: 'Pat Bean', replyTo: 'pat@example.com', clubs: ['puggles', 'sparks'] });
    expect((await s.call('GET', '/v1/mail/me', undefined, d.auth)).body.all).toEqual({ id: 'all', name: 'All my clubs', label: 'Puggles and Sparks', from: 'awana@kvbchurch.org' });
    expect((await s.call('GET', '/v1/mail/me')).body.all).toMatchObject({ name: 'All clubs', label: 'all clubs' });
    const count = await s.call('GET', '/v1/mail/recipients?club=all', undefined, d.auth);
    expect(count.body).toEqual({ ok: true, club: 'all', name: 'Puggles and Sparks', addresses: 3, kids: 4, kidsWithoutEmail: 1 });
    const id = (await s.call('POST', '/v1/mail/drafts', { club: 'all', subject: 'No club tonight', blocks: WORDS, files: [] }, d.auth)).body.id;
    const before = s.graph().length;
    await s.call('POST', `/v1/mail/drafts/${id}/send`, {}, d.auth);
    expect((await run(s, id, d.auth)).body).toMatchObject({ done: true, recipients: 3 });
    const sent = s.graph().slice(before);
    expect(sent.every((c) => c.mailbox === 'awana@kvbchurch.org')).toBe(true);
    expect(sent[0].body.bccRecipients.map((r) => r.emailAddress.address)).toEqual(['dad.stone@example.com', 'lane@example.com', 'stone@example.com', 'awana@kvbchurch.org']);
    expect(sent[0].body.body.content).toContain('Sent by Pat Bean for Puggles and Sparks,');
    expect((await s.call('GET', '/v1/mail/log', undefined, d.auth)).body.sends[0]).toMatchObject({ club: 'all', clubName: 'Puggles and Sparks', recipients: 3 });
  });

  it('a list longer than one message takes goes out as several, every address once', async () => {
    const s = await setup();
    const many = MAIL_RECIPIENTS_MAX + 10;
    s.setRoster({ ok: true, roster: { header: ROSTER.header, rows: Array.from({ length: many }, (_, i) => [String(i), 'Kid', `N${i}`, 'Sparks', '', `p${String(i).padStart(4, '0')}@example.com`, '']) } });
    const d = await s.director();
    const id = (await s.call('POST', '/v1/mail/drafts', { club: 'sparks', subject: 'Big', blocks: WORDS, files: [] }, d.auth)).body.id;
    await s.call('POST', `/v1/mail/drafts/${id}/send`, {}, d.auth);
    expect((await run(s, id, d.auth)).body).toMatchObject({ done: true, percent: 100, recipients: many });
    const made = s.graph().filter((c) => c.path === '/messages');
    expect(made.map((c) => c.body.bccRecipients.length)).toEqual([MAIL_RECIPIENTS_MAX + 1, 10]);   // + the Awana copy, once
    const all = made.flatMap((c) => c.body.bccRecipients.map((r) => r.emailAddress.address)).filter((a) => a !== 'awana@kvbchurch.org');
    expect(new Set(all).size).toBe(many);
    expect(s.graph().filter((c) => c.path === '/messages/MSG1/send')).toHaveLength(2);
    expect((await s.call('GET', '/v1/mail/log')).body.sends).toHaveLength(1);
  });

  it('a sent message can be started from again, by its sender or the office', async () => {
    const s = await setup();
    const d = await s.director();
    const other = await s.director({ name: 'Eve', replyTo: 'eve@example.com', clubs: ['sparks'] });
    const words = [{ t: 'h', text: 'Shoeboxes' }, { t: 'p', text: 'Bring **one** Wednesday.' }, { t: 'ul', items: ['cars', 'crayons'] }];
    const id = (await s.call('POST', '/v1/mail/drafts', { club: 'sparks', subject: 'Shoeboxes', blocks: words, files: [] }, d.auth)).body.id;
    expect((await s.call('GET', `/v1/mail/log/${id}`, undefined, d.auth)).status).toBe(404);   // not sent yet
    await s.call('POST', `/v1/mail/drafts/${id}/send`, {}, d.auth);
    await run(s, id, d.auth);
    const line = (await s.call('GET', '/v1/mail/log', undefined, d.auth)).body.sends[0];
    expect(line.id).toBe(id);
    expect((await s.call('GET', `/v1/mail/log/${id}`, undefined, d.auth)).body).toEqual({ ok: true, club: 'sparks', subject: 'Shoeboxes', blocks: words });
    expect((await s.call('GET', `/v1/mail/log/${id}`)).status).toBe(200);
    expect((await s.call('GET', `/v1/mail/log/${id}`, undefined, other.auth)).body.reason).toBe('no-send');
    expect((await s.call('GET', '/v1/mail/log/nope', undefined, d.auth)).status).toBe(404);
    // Kept with no address.
    expect(JSON.stringify(await s.storage.get(`mail:body:${id}`))).not.toContain('@');
  });

  it('counts the mail that came back, by subject, in the sending mailbox; never an address', async () => {
    const s = await setup();
    const d = await s.director();
    const id = (await s.call('POST', '/v1/mail/drafts', { club: 'sparks', subject: 'Shoeboxes', blocks: WORDS, files: [] }, d.auth)).body.id;
    await s.call('POST', `/v1/mail/drafts/${id}/send`, {}, d.auth);
    await run(s, id, d.auth);
    s.answers.inbox = [{ subject: 'Undeliverable: Shoeboxes' }, { subject: 'Undeliverable: Shoeboxes ' }, { subject: 'Undeliverable: Something else' }];
    const b = await s.call('GET', `/v1/mail/log/${id}/bounces`, undefined, d.auth);
    expect(b.body).toEqual({ ok: true, bounced: 2, mailbox: 'awana@kvbchurch.org' });
    const asked = s.graph().filter((c) => c.path.startsWith('/mailFolders/inbox/messages?'));
    expect(asked).toHaveLength(1);
    expect(decodeURIComponent(asked[0].path)).toContain("receivedDateTime ge 2026-11-13T15:00:00.000Z and startswith(subject,'Undeliverable')");
    // Kept ten minutes: a second look asks Microsoft nothing.
    s.answers.inbox = [];
    expect((await s.call('GET', `/v1/mail/log/${id}/bounces`, undefined, d.auth)).body.bounced).toBe(2);
    s.tick(11 * 60 * 1000);
    expect((await s.call('GET', `/v1/mail/log/${id}/bounces`, undefined, d.auth)).body.bounced).toBe(0);
    // Microsoft not answering, or a send older than a week: not known, never a guess.
    s.tick(11 * 60 * 1000);
    s.answers.inbox = null;
    expect((await s.call('GET', `/v1/mail/log/${id}/bounces`, undefined, d.auth)).body.bounced).toBe(null);
    s.tick(8 * 24 * 60 * 60 * 1000);
    s.answers.inbox = [{ subject: 'Undeliverable: Shoeboxes' }];
    expect((await s.call('GET', `/v1/mail/log/${id}/bounces`, undefined, d.auth)).body.bounced).toBe(null);
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
