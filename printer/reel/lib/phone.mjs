// A stand-in for the check-in service behind awana.kvbchurch.org/checkin: the
// page (printer/print-server/public/phone.html) checks children in through the
// sync Worker's desk routes (site/checkin/desk-transport.js), so these answer
// the way the Worker would, from a made-up roster. The page starts signed in
// (a session and a pinned history key in this browser, as a phone that has
// signed in once has), and the history key is a real one made here, so the page
// seals its rows exactly as it would on a club night. No print station is
// registered, so a check-in carries no label job.
import { generateKeyPair } from '../../../lobby/shared/cloud-crypto.js';

const KIDS = [
  ['Ava Linden', 'Puggles', true], ['Mia Rourke', 'Puggles'], ['Ella Marchetti', 'Puggles'],
  ['Leo Castellan', 'Cubbies', true], ['Ezra Holloway', 'Cubbies'], ['Ruby Ashford', 'Cubbies'],
  ['Maya Brightwater', 'Sparks', true], ['Owen Pemberly', 'Sparks'], ['Ivy Calloway', 'Sparks'], ['Jude Winslow', 'Sparks'],
  ['Noah Fairbanks', 'T&T', true], ['Lucy Ambrose', 'T&T'], ['Eli Thornbury', 'T&T'], ['Nora Whitcombe', 'T&T'],
  ['Sophia Hartwell', 'Trek'], ['Caleb Moreland', 'Trek'],
];
const SESSION = 'v1.1.1760000000.reelreelreelreelreelreel01';

export async function phoneApi(page, { checkedIn = 41 } = {}) {
  const kids = KIDS.map(([name, club, done], i) => {
    const [first, ...rest] = name.split(' ');
    return { clubberId: String(100 + i), first, last: rest.join(' '), club, clubId: '', checkedIn: !!done };
  });
  let count = checkedIn;
  const history = await generateKeyPair();
  const answer = (path, body) => {
    if (path === '/v1/desk/roster') {
      return { readAt: new Date().toISOString(), kids, items: { bible: ['Puggles', 'Cubbies', 'Sparks', 'T&T'], friend: ['Puggles', 'Cubbies', 'Sparks', 'T&T', 'Trek', 'Journey'] } };
    }
    if (path === '/v1/desk/families') return { households: [] };
    if (path === '/v1/desk/tonight') return { checkedIn: count, checkedOut: 0, byClub: { Puggles: 6, Cubbies: 9, Sparks: 12, 'T&T': 14 } };
    if (path === '/v1/stations') return [];
    if (path === '/v1/print/status') return { queued: 0, leased: 0, done: count, dead: 0, checkThePrinter: [], pendingToSeal: 0, claims: { printed: count }, stations: [{ stationId: 'reel', name: 'Check-in laptop', lastSeenAt: new Date().toISOString(), printer: { state: 'ok' } }] };
    if (path === '/v1/desk/checkin') {
      const kid = kids.find((k) => k.clubberId === body.clubberId);
      if (kid && !kid.checkedIn) { kid.checkedIn = true; count += 1; }
      return { ok: true, already: false, jobId: null, gen: 1, history: 'hooked' };
    }
    return null;
  };
  await page.addInitScript(([session, pin]) => {
    try { localStorage.setItem('awanaSyncSession.v1', session); localStorage.setItem('awanaDeskHistoryKey.v1', pin); } catch { /* */ }
  }, [SESSION, JSON.stringify({ pub: history.publicKey, kid: history.kid })]);
  await page.route(/\/api\/v1\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const body = req.method() === 'POST' ? req.postDataJSON() : null;
    const out = answer(url.pathname.replace(/^\/api/, ''), body);
    await route.fulfill({ status: out ? 200 : 404, contentType: 'application/json', body: JSON.stringify(out || { error: 'Not found.' }) });
  });
}
