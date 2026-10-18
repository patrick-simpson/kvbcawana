// Stand-in TwoTimTwo pages and a stand-in site for the cloud check-in tests,
// built from the selectors in printer/docs/TWOTIMTWO.md: made-up names only.

// One club table in the live layout ([edit] Name [undo], then a summary cell)
// or the older one (links alone, the name in the next cell). Same builder as
// printer/scripts/test-report-parse.cjs.
export function table(club, kids, { layout = 'live', count = kids.length, footer = true } = {}) {
  // A club with a Brought a friend column: its kids say `friend: true` (YES) or `false` (No).
  const withFriend = kids.some((k) => k.friend !== undefined);
  // ...and a Bible column the same way (`bible: true` YES, `false` No).
  const withBible = kids.some((k) => k.bible !== undefined);
  const rows = kids.map(({ id, name, summary, friend, bible }) => {
    const edit = `<a class='noprint' href='/meeting/clubberCheckin/${id}?CAL=368'><i class='fa fa-pencil'></i></a>`;
    const undo = `<a href='#' class='noprint pull-right' onclick='undoCheckin(${id})'></a>`;
    const friendCell = (withBible ? `<td>${bible ? 'YES' : 'No'}</td>` : '') + (withFriend ? `<td>${friend ? 'YES' : 'No'}</td>` : '');
    return layout === 'live'
      ? `<tbody><tr><td>${edit} ${name} ${undo}</td>${summary != null || withFriend || withBible ? `<td>${summary ?? ''}</td>` : ''}${friendCell}</tr>`
      : `<tbody><tr><td>${edit}${undo}</td><td>${name}</td>${friendCell}</tr>`;
  }).join('');
  return `<table class="table"><thead><tr><th colspan=4 class="title">` +
    `<img class="club-icon-30" src="/x.png" alt="${club}" /></th></tr>` +
    `<tr><th>2026-10-07</th><th>Clubber</th>${withBible ? '<th>Bible</th>' : ''}${withFriend ? '<th>Brought a friend</th>' : ''}</tr></thead>${rows}` +
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
export function fakeTwoTimTwo({ password = 'right-pass', report = () => page(table('Sparks ', [{ id: 1, name: 'Ada Tester' }])), checkin = () => CHECKIN_PAGE, checkout = () => checkoutPage(), households = null, attendance = null, roster = null, books = null, meeting = null, handbook = null } = {}) {
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
    // The Attendance Summary CSV (trendsimport.js): `attendance(yearStart)` answers a CSV, or a Response.
    if (u.pathname === '/report/attendance_summary' && attendance) {
      const a = attendance(u.searchParams.get('year_start'), u.searchParams.get('output'));
      if (a instanceof Response) return a;
      return new Response(a, { status: 200, headers: { 'Content-Type': 'application/csv' } });
    }
    // The roster export, the completed-books report and the meeting report (stationfeeds.js):
    // each a CSV, or a Response (a refusal), or null for TwoTimTwo's 404.
    const csvOf = (/** @type {any} */ v) => (v instanceof Response ? v : v == null ? new Response('not found', { status: 404 }) : new Response(v, { status: 200, headers: { 'Content-Type': 'application/csv' } }));
    if (u.pathname === '/clubber/csv' && roster) return csvOf(roster());
    if (u.pathname === '/report/completed_books' && books) return csvOf(books(u.searchParams.get('club_id'), u.searchParams.get('from_date'), u.searchParams.get('to_date')));
    if (u.pathname === '/meeting/report' && meeting) return csvOf(meeting(u.searchParams.get('calendar_id')));
    // The handbook check-off page (handbook.js): `handbook()` answers its HTML, or a Response.
    if (u.pathname === '/meeting/handbook' && handbook) {
      const h = handbook();
      return h instanceof Response ? h : new Response(h, { status: 200 });
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

// The roster export's 66 columns in TwoTimTwo's order (printer/docs/TWOTIMTWO.md section 3),
// with a made-up child per row. `notes` is where the church records allergies.
export const ROSTER_HEADER = ['Clubber ID', 'Inactive', 'First Name', 'Last Name', 'Gender', 'Grade', 'Club', 'Group', 'Color',
  'Handbook Group', 'Birthdate', 'Shirt Size', 'New to Awana?', 'Has an Awana vest?', 'Invited by', 'Completed Handbooks', 'Notes',
  'Clubber Created', 'Clubber Last Updated', '# payments', 'Med Release?', 'Share Balance', 'Book', 'Doctor Name', 'Doctor Phone',
  'Payments total', 'Rate', 'Parent/Guardian#1', 'Parent/Guardian#2', 'Address1', 'Address2', 'City', 'State', 'Zip', 'Alt Address1',
  'Alt Address2', 'Alt City', 'Alt State', 'Alt Zip', 'Primary Phone', 'Primary Phone Type', 'Primary Phone SMS (Text)?', 'Alt Phone',
  'Alt Phone Type', 'Alt Phone SMS (Text)?', '3rd Phone', '3rd Phone Type', '3rd Phone SMS (Text)?', 'Alt Primary Phone',
  'Alt Primary Phone Type', 'Alt Primary Phone SMS (Te...', 'Alt Phone#2', 'Alt Phone#2 Type', 'Alt Phone#2 SMS (Text)?', 'Alt Phone#3',
  'Alt Phone#3 Type', 'Alt Phone#3 SMS (Text)?', 'Emergency Contact', 'Others Pickup', 'Church', 'Email', 'Alt Email', 'GrandPrix Type',
  'Photo Release?', 'Leader Notes', ''];

/**
 * TwoTimTwo's /clubber/csv: a BOM, the quoted header, a row per child, the
 * "Clubber Count=<n>" footer (`count` overrides it: a cut download), a blank
 * line and FILTER,VALUE. Every name and value is made up.
 * @param {{ id: string|number, first: string, last: string, club?: string, notes?: string, birthdate?: string, photo?: string }[]} kids
 * @param {{ count?: number }} [o]
 */
export function rosterCsv(kids, { count = kids.length } = {}) {
  const q = (/** @type {unknown} */ v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [ROSTER_HEADER.map(q).join(',')];
  for (const k of kids) {
    /** @type {Record<string, unknown>} */
    const values = {
      'Clubber ID': k.id, Inactive: 'N', 'First Name': k.first, 'Last Name': k.last, Gender: 'F', Grade: '2', Club: k.club || 'Sparks',
      Group: 'Red', 'Handbook Group': 'Group 1', Birthdate: k.birthdate || '3/3/2017', Notes: k.notes || '', 'Med Release?': 'Yes',
      'Photo Release?': k.photo || 'Yes', 'Parent/Guardian#1': `Pat ${k.last}`, Address1: '12 Elmwood Street', City: 'Augusta', Zip: '04330',
      'Primary Phone': '555-0100', Email: 'family@example.org', 'Emergency Contact': 'Grandma 555-0199', 'Doctor Name': 'Dr Example',
    };
    lines.push(ROSTER_HEADER.map((h) => q(values[h] ?? '')).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}\r\nClubber Count=${count}\r\n\r\nFILTER,VALUE\r\n`;
}

/** The completed-books report ("Name","Book","Date"), one club's. @param {{ name: string, book: string, date: string }[]} rows */
export const booksCsv = (rows) => `"Name","Book","Date"\r\n${rows.map((r) => `"${r.name}","${r.book}","${r.date}"`).join('\r\n')}\r\n`;
