// A stand-in for the check-in laptop behind awana.kvbchurch.org/checkin: the
// page relays every call through /api/v1/relay and collects the answer from
// /api/v1/relay/result (printer/print-server/public/phone.html, relayCall),
// so these answer the way the laptop's print server would, from a made-up
// roster. A check-in is "done" on its first status poll.
const KIDS = [
  ['Ava Linden', 'Puggles', true], ['Mia Rourke', 'Puggles'], ['Ella Marchetti', 'Puggles'],
  ['Leo Castellan', 'Cubbies', true], ['Ezra Holloway', 'Cubbies'], ['Ruby Ashford', 'Cubbies'],
  ['Maya Brightwater', 'Sparks', true], ['Owen Pemberly', 'Sparks'], ['Ivy Calloway', 'Sparks'], ['Jude Winslow', 'Sparks'],
  ['Noah Fairbanks', 'T&T', true], ['Lucy Ambrose', 'T&T'], ['Eli Thornbury', 'T&T'], ['Nora Whitcombe', 'T&T'],
  ['Sophia Hartwell', 'Trek'], ['Caleb Moreland', 'Trek'],
];

export async function phoneApi(page, { checkedIn = 41 } = {}) {
  const kids = KIDS.map(([name, club, done]) => ({ name, club, checkedIn: !!done }));
  let count = checkedIn;
  const queue = new Map();
  let next = 1;
  const answer = (path, body) => {
    if (path === '/phone/roster') {
      return { kids, households: [], items: { bible: ['Puggles', 'Cubbies', 'Sparks', 'T&T'], friend: ['Puggles', 'Cubbies', 'Sparks', 'T&T', 'Trek', 'Journey'] }, recent: { ready: false } };
    }
    if (path === '/phone/tonight') {
      return { checkedIn: count, visitors: 2, byClub: { Puggles: 6, Cubbies: 9, Sparks: 12, 'T&T': 14 }, entries: [], features: ['checkout'] };
    }
    if (path === '/clubs') return { clubs: ['Puggles', 'Cubbies', 'Sparks', 'T&T', 'Trek', 'Journey'] };
    if (path === '/leaders') return { leaders: [], hidden: 0 };
    if (path === '/reconcile') return {};
    if (path === '/phone/checkin') {
      const kid = kids.find((k) => k.name === body.name);
      return { ok: true, id: `job-${body.name}`, kid };
    }
    if (path.startsWith('/phone/status/')) {
      const name = decodeURIComponent(path.slice('/phone/status/job-'.length));
      const kid = kids.find((k) => k.name === name);
      if (kid && !kid.checkedIn) { kid.checkedIn = true; count += 1; }
      return { status: 'done' };
    }
    return {};
  };
  await page.addInitScript(() => { try { sessionStorage.setItem('awanaCheckinSession', 'reel-session'); } catch { /* */ } });
  await page.route(/\/api\/v1\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    let out = {};
    if (url.pathname.endsWith('/v1/relay')) {
      const { method, path, body } = req.postDataJSON();
      const id = `q${next++}`;
      queue.set(id, answer(path, body || {}, method));
      out = { id };
    } else if (url.pathname.endsWith('/v1/relay/result')) {
      const id = url.searchParams.get('id');
      out = { done: true, status: 200, body: queue.get(id) || {} };
      queue.delete(id);
    } else if (url.pathname.endsWith('/v1/login')) {
      out = { session: 'reel-session' };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) });
  });
}
