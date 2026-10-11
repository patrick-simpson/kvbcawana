// Stand-in TwoTimTwo pages and a stand-in site for the cloud check-in tests,
// built from the selectors in printer/docs/TWOTIMTWO.md: made-up names only.

// One club table in the live layout ([edit] Name [undo], then a summary cell)
// or the older one (links alone, the name in the next cell). Same builder as
// printer/scripts/test-report-parse.cjs.
export function table(club, kids, { layout = 'live', count = kids.length, footer = true } = {}) {
  const rows = kids.map(({ id, name, summary }) => {
    const edit = `<a class='noprint' href='/meeting/clubberCheckin/${id}?CAL=368'><i class='fa fa-pencil'></i></a>`;
    const undo = `<a href='#' class='noprint pull-right' onclick='undoCheckin(${id})'></a>`;
    return layout === 'live'
      ? `<tbody><tr><td>${edit} ${name} ${undo}</td>${summary != null ? `<td>${summary}</td>` : ''}</tr>`
      : `<tbody><tr><td>${edit}${undo}</td><td>${name}</td></tr>`;
  }).join('');
  return `<table class="table"><thead><tr><th colspan=4 class="title">` +
    `<img class="club-icon-30" src="/x.png" alt="${club}" /></th></tr>` +
    `<tr><th>2026-10-07</th><th>Clubber</th></tr></thead>${rows}` +
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
  '<input class="event" name="events[]" value="707" recid="707" clubs="2,3,6"><label> Bible</label>' +
  '<input class="event" name="events[]" value="40" automatic="1" clubs="4,1,2,3,6"><label>Attendance</label>' +
  '</form></body></html>';

/**
 * A stand-in TwoTimTwo: /site/login with a CSRF token and a session cookie,
 * a signed-in report, and the login form for anything without the cookie.
 */
export function fakeTwoTimTwo({ password = 'right-pass', report = () => page(table('Sparks ', [{ id: 1, name: 'Ada Tester' }])), checkin = () => CHECKIN_PAGE } = {}) {
  const calls = [];
  let session = 0;
  const live = new Set();
  const state = { expire() { live.clear(); }, calls, down: false, offsite: false };
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
    return new Response('not found', { status: 404 });
  };
  return state;
}
