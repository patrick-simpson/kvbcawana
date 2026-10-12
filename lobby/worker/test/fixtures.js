// Stand-in TwoTimTwo pages and a stand-in site for the cloud check-in tests,
// built from the selectors in printer/docs/TWOTIMTWO.md: made-up names only.

// One club table in the live layout ([edit] Name [undo], then a summary cell)
// or the older one (links alone, the name in the next cell). Same builder as
// printer/scripts/test-report-parse.cjs.
export function table(club, kids, { layout = 'live', count = kids.length, footer = true } = {}) {
  // A club with a Brought a friend column: its kids say `friend: true` (YES) or `false` (No).
  const withFriend = kids.some((k) => k.friend !== undefined);
  const rows = kids.map(({ id, name, summary, friend }) => {
    const edit = `<a class='noprint' href='/meeting/clubberCheckin/${id}?CAL=368'><i class='fa fa-pencil'></i></a>`;
    const undo = `<a href='#' class='noprint pull-right' onclick='undoCheckin(${id})'></a>`;
    const friendCell = withFriend ? `<td>${friend ? 'YES' : 'No'}</td>` : '';
    return layout === 'live'
      ? `<tbody><tr><td>${edit} ${name} ${undo}</td>${summary != null || withFriend ? `<td>${summary ?? ''}</td>` : ''}${friendCell}</tr>`
      : `<tbody><tr><td>${edit}${undo}</td><td>${name}</td>${friendCell}</tr>`;
  }).join('');
  return `<table class="table"><thead><tr><th colspan=4 class="title">` +
    `<img class="club-icon-30" src="/x.png" alt="${club}" /></th></tr>` +
    `<tr><th>2026-10-07</th><th>Clubber</th>${withFriend ? '<th>Brought a friend</th>' : ''}</tr></thead>${rows}` +
    (footer ? `<tfoot><tr class='totals'><td><i>Count: ${count}</i></td></tr></tfoot>` : '') + '</table>';
}
export const page = (...tables) =>
  `<html><body><table class="table"><tbody><tr><td>Title</td></tr></tbody></table>${tables.join('')}</body></html>`;
export const LOGIN_PAGE = '<html><body><form><input type="hidden" name="YII_CSRF_TOKEN" value="tok123">' +
  '<input name="LoginForm[username]"><input type="password" name="LoginForm[password]"></form></body></html>';

export const CHECKIN_PAGE = '<html><body><div class="clubbers">' +
  '<div class="clubber checkin-box boy" recid="662" club_id="2"><div class="name">Kit Tester</div>' +
  '<div class="club"><img class="club-icon-16" alt="Sparks "></div></div>' +
  '<div class="clubber checkin-box girl checked-in" recid="663" club_id="3"><div class="name">Lu Tester</div></div>' +
  '</div><form id="checkinForm" style="display:none"><input id="checkinClubberId" name="clubber_id" value="">' +
  '<input name="calendar_id" id="calendar_id" value="368">' +
  '<select name="date"><option value="2026-10-07">Oct 7</option><option value="2026-10-14" selected>Oct 14</option></select>' +
  '<input class="event" name="events[]" value="707" recid="707" clubs="2,3,6"><label> Bible</label>' +
  '<input class="event" name="events[]" value="40" automatic="1" clubs="4,1,2,3,6"><label>Attendance</label>' +
  '</form></body></html>';

/**
 * TwoTimTwo's Checkout page (printer/docs/TWOTIMTWO.md §2.1): the notices table first,
 * the meeting's date select, a row per child it lists, and the meeting id in its script.
 * @param {{ calendarId?: string, date?: string, rows?: {id: string, name: string, club: string}[], title?: string }} [o]
 */
export function checkoutPage({ calendarId = '368', date = '2026-10-14', rows = [], title = 'KVBC Awana - Checkout Clubber' } = {}) {
  const trs = rows.map((r) => `<tr class="clubber-row"><td><a href="#" class="checkout" clubber_id="${r.id}">Check out</a></td>` +
    `<td class="clubber name M">${r.name}</td><td class="center"><img class="club-icon-20" src="/images/clubs/x.png" alt="${r.club} "></td><td></td><td></td><td></td></tr>`).join('');
  return `<html><head><title>${title}</title></head><body><table class="items table"><tr><th>Title</th></tr></table>` +
    `<form><select id="date" name="date"><option value="2026-10-07">Oct 7</option><option value="${date}" selected>Tonight</option></select></form>` +
    `<table class="table"><thead><tr><th></th><th>Clubber</th><th></th><th>Parent/Guardian</th><th>Other</th></tr></thead><tbody>` +
    `${trs || '<tr><td class="empty"><span class="empty">No results found.</span></td></tr>'}</tbody></table>` +
    `<script>$('a.checkout').click(function(){ $.post('/clubber/checkout', { calendar_id: ${calendarId}, clubber_id: $(this).attr('clubber_id') }); });</script></body></html>`;
}

/**
 * A stand-in TwoTimTwo: /site/login with a CSRF token and a session cookie,
 * a signed-in report, and the login form for anything without the cookie.
 */
export function fakeTwoTimTwo({ password = 'right-pass', report = () => page(table('Sparks ', [{ id: 1, name: 'Ada Tester' }])), checkin = () => CHECKIN_PAGE, checkout = () => checkoutPage(), households = null } = {}) {
  const calls = [];
  let session = 0;
  const live = new Set();
  const state = { expire() { live.clear(); }, calls, down: false, offsite: false, checkins: [] };
  state.fetchFn = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body ? new URLSearchParams(init.body) : null;
    calls.push({ host: u.host, path: u.pathname + u.search, method: init.method || 'GET', cookie: init.headers?.Cookie || '', body, redirect: init.redirect });
    if (state.down) return new Response('down', { status: 503 });
    const cookie = /PHPSESSID=(\w+)/.exec(init.headers?.Cookie || '')?.[1];
    const signedIn = cookie && live.has(cookie);
    if (u.pathname === '/site/login' && init.method === 'POST') {
      if (body.get('YII_CSRF_TOKEN') === 'tok123' && body.get('LoginForm[password]') === password && body.get('Login') === '1') {
        const id = `s${++session}`;
        live.add(id);
        return new Response(null, { status: 302, headers: { Location: state.offsite ? 'https://evil.example/' : '/site/index', 'Set-Cookie': `PHPSESSID=${id}; path=/; HttpOnly` } });
      }
      return new Response(LOGIN_PAGE, { status: 200 });
    }
    if (u.pathname === '/site/login') return new Response(LOGIN_PAGE, { status: 200, headers: { 'Set-Cookie': 'PHPSESSID=anon; path=/' } });
    if (!signedIn) return new Response(null, { status: 302, headers: { Location: '/site/login' } });
    if (u.pathname === '/site/index') return new Response('<html><body>Welcome</body></html>', { status: 200 });
    if (u.pathname === '/clubber/checkin_report') return new Response(report(u.searchParams.get('date')), { status: 200 });
    if (u.pathname === '/clubber/checkin') return new Response(checkin(), { status: 200 });
    if (u.pathname === '/clubber/checkout' && (init.method || 'GET') === 'GET') return new Response(checkout(), { status: 200 });
    if (u.pathname === '/household/csv' && households) {
      const h = households();
      if (h instanceof Response) return h;   // a refusal (403), as TwoTimTwo sends one
      return new Response(h, { status: 200, headers: { 'Content-Type': 'application/csv' } });
    }
    if (u.pathname === '/clubber/checkinclubber' && init.method === 'POST') {
      state.checkins.push(body);
      return new Response(state.checkinReply ?? `<b>${state.checkinName ?? 'Kit Tester'}</b> 6:02 pm`, { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };
  return state;
}

// TwoTimTwo's /household/csv shape (printer/docs/TWOTIMTWO.md §3.3): household fields
// denormalised, with addresses and phones, and the children in one column.
export const HOUSEHOLD_CSV = '\uFEFF"Household ID","Parent/Guardian#1","Address1","Primary Phone","Active Clubbers","Billing Notes"\r\n' +
  '"11","Pat Tester","1 Elm St","555-0101","Sophie Tester, Cal Tester",""\r\n' +
  '"12","Lee Other","2 Oak Ave","555-0102","Only Child",""\r\n' +
  '"13","Kim ""Q"" Smith","3 Pine Rd, Apt 4","555-0103","Ann Smith, Ben Smith, Cy Smith","note, with comma"\r\n' +
  '"14","No Kids","4 Ash Ln","555-0104","",""\r\n';
