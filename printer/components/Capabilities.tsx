import React from 'react';
import { IconSprite, Icon, IconName } from './family/Icons';
import { URLS, SubLink } from './family/Family';

// ─────────────────────────────────────────────────────────────────────────────
// TwoTimTwo reference page (capabilities.html).
//
// Two jobs:
//  1. Document what TwoTimTwo.com offers (so nobody re-scrapes the site) and
//     which parts KVBC Awana uses today ('Used today' / 'Partly used' /
//     'Available'). Checked against the app's code on 2026-10-13 (9.4.0).
//  2. Keep a record of the v5.2 roadmap, every item of which shipped. It is a
//     historical record, not a current plan: later work lives in changes.md
//     and in the showcase on the home page.
//
// The developer-level contract (selectors, CSV columns, endpoints) lives in
// docs/TWOTIMTWO.md; this page is the human-readable companion.
// ─────────────────────────────────────────────────────────────────────────────

type Use = 'used' | 'partial' | 'unused';

const USE_BADGE: Record<Use, { label: string; cls: string }> = {
  used:    { label: 'Used today',   cls: 'lbl-badge lbl-badge--used' },
  partial: { label: 'Partly used',  cls: 'lbl-badge lbl-badge--partial' },
  unused:  { label: 'Available',    cls: 'lbl-badge' },
};

interface Capability { name: string; body: string; use: Use; where?: string; }
interface Group { icon: IconName; title: string; caps: Capability[]; }

const CATALOG: Group[] = [
  {
    icon: 'check',
    title: 'Check-in',
    caps: [
      { name: 'Tap-to-check-in roster', use: 'used', where: '/clubber/checkin',
        body: 'The station’s main page: a list of children not yet checked in. Tapping one opens that meeting’s check-in items (Bible, Attendance, Brought a friend…), and the row leaves the list once checked in. The extension watches rows leave this list to notice check-ins, including ones made on other devices.' },
      { name: 'Last-check-in banner + undo', use: 'used', where: '#lastCheckin',
        body: 'A live “Last checked in: …” banner with an undo link. The extension watches it to catch check-ins made at the station itself.' },
      { name: 'Clubber id + club id on every row', use: 'used', where: 'recid / club_id',
        body: 'Each roster row carries TwoTimTwo’s own clubber id and club id. Since v5.1 KVBC Awana matches children on these, so two children with the same name never get each other’s allergy or photo details.' },
      { name: 'Check-in Report (who’s in tonight)', use: 'used', where: '/clubber/checkin_report',
        body: 'The per-club table of who is checked in tonight, with counts and per-row undo. While it is fresh it is the source for tonight’s count; the app’s own history is the fallback. During club the app reads it to confirm check-ins, catch any the page watcher missed, and notice undos.' },
      { name: 'Five documented check-in modes', use: 'partial',
        body: 'TwoTimTwo documents five ways to check in: a central station, per-group leader phones, a hybrid, paper forms keyed in later, and CSV import (including from KidCheck). KVBC Awana uses the central-station style: the desk and the check-in page on phones check children in, and the app prints the labels. TwoTimTwo allows third-party label printing at check-in, which is what this app does.' },
      { name: 'CSV check-in import (official write-path)', use: 'partial', where: '/clubber/checkin_csv',
        body: 'Upload a check-in CSV and TwoTimTwo records attendance, matching names loosely. KVBC Awana can export tonight’s check-ins in this format (/checkin-csv-export), so a night lost to an outage can be imported by hand. The app does not upload the file itself.' },
      { name: 'Checkout with pickup security', use: 'partial', where: '/clubber/checkout',
        body: 'Lists checked-in children with guardians, authorized pickup names, a security code entered at check-in, and a photo. KVBC Awana uses only its check-out call: the sync service checks Trek and Journey children out on their own from 7:15 pm on club nights, and a phone’s Check out does one child. The pickup-security details are not used.' },
      { name: 'Walk-in visitor registration', use: 'partial', where: '/clubber/register',
        body: 'A walk-in gets a name tag at the desk. The child is listed in Tonight as “not registered yet” and is never counted. The older extension form that also registers the visitor on TwoTimTwo is not used on the check-in page.' },
    ],
  },
  {
    icon: 'family',
    title: 'Roster & households',
    caps: [
      { name: 'Full roster CSV export', use: 'used', where: '/clubber/csv',
        body: 'The full roster export the app builds labels from: name, club, grade, group, birthdate, notes (allergies), media release answers, guardians and phones. The extension sends it to the print server each time the page loads.' },
      { name: 'Household database', use: 'partial', where: '/household/csv',
        body: 'All households with the children in each. The extension’s touch check-in screen reads it to group a family’s children together, and only the children’s names are passed on. The old “Also here tonight?” sibling suggestions are retired.' },
      { name: 'Clubber quick-search API', use: 'unused', where: '/clubber/ajaxSearch',
        body: 'A name-substring lookup returning matching kids with links carrying their ids. Doubles as a cheap session-health probe (“Login Required” when logged out).' },
      { name: 'Custom-view CSV exports', use: 'unused', where: '/clubber/admin?cview=…&print=csv',
        body: 'Saved column views (Birthdays, Contact Info, Game Groupings, Special Notes…) each exportable as a narrow, purpose-built CSV — a cleaner feed than the full roster export.' },
      { name: 'Merge / move / history / mailing labels', use: 'unused',
        body: 'Dedupe clubbers, move between households, per-clubber completion history, and printable mailing-label PDF sheets.' },
      { name: 'Grades → club/book mapping', use: 'unused', where: '/grade/admin',
        body: 'The grade-to-club taxonomy. KVBC Awana works out Step Up Night from the Grade column of the roster export and its own grade rules, not from this map. The map could later give club names one shared source across the apps.' },
    ],
  },
  {
    icon: 'ledger',
    title: 'Meetings, awards & tracking',
    caps: [
      { name: 'Record handbook activity', use: 'unused', where: '/meeting/record',
        body: 'Batch entry of completed handbook sections per group, feeding every downstream report.' },
      { name: 'Meeting report — who earned what', use: 'used', where: '/meeting/report?output=csv',
        body: 'Per-meeting CSV of each child’s check-in items and awards earned tonight. It drives the award slips printed for earned awards and the lobby’s tonight ticker.' },
      { name: 'Awards distribution + worksheets', use: 'unused', where: '/meeting/Awards_undistributed',
        body: 'Track earned vs handed-out awards, and print undistributed-award worksheets (PDF). KVBC Awana does not read these yet.' },
      { name: 'Shares (shekels) & points economy', use: 'partial', where: '/report/shekelBalance',
        body: 'On Store Night each club’s share balance report sets the shekel badge on its labels. The rest of the points economy is not used.' },
      { name: 'Color-group points race', use: 'partial', where: '/meeting/colorGroup',
        body: 'KVBC Awana reads each meeting’s team points race. No screen shows it yet.' },
      { name: 'Book Tracks / Blue Jewel / book-count awards', use: 'unused',
        body: 'Full curriculum structure (Track→Book→Unit→Section) and automatic attendance/completion award rules.' },
      { name: 'Printable handbook agendas', use: 'used', where: '/meeting/handbook',
        body: 'Each club’s handbook agenda is printed as a letter-size PDF for its leaders when club night starts, if the church has turned that on.' },
    ],
  },
  {
    icon: 'chart',
    title: 'Calendar, messaging & the rest',
    caps: [
      { name: 'Meeting calendar + calendar_id', use: 'partial', where: '/calendar/index',
        body: 'Every meeting has an id (the check-in form’s calendar_id) and a date; meetings can be marked “No Awana this week”. KVBC Awana reads the calendar_id from the check-in page for its reports.' },
      { name: 'iCal subscription feed', use: 'used', where: '/calendar/iCal',
        body: 'A standard calendar feed of all meetings. The projector’s countdown takes the next meeting date and theme from it as a correction to its own schedule. Only the date and title are read, never attendee data.' },
      { name: 'Announcement / cancellation messages', use: 'used', where: '/msg/admin',
        body: 'Church notices written in TwoTimTwo are sent to the lobby screens. A cancellation shows as a full-width alert on them.' },
      { name: 'CSV report suite', use: 'partial', where: '/report/*?output=csv',
        body: 'Attendance grid, club counts, completed books, quarter points, distributed awards, unpaid — nearly every report exports CSV. KVBC Awana reads the attendance grid for the attendance audit and the completed books for the lobby’s trophy band.' },
      { name: 'Payments, inventory, mass email, profiles/roles', use: 'unused',
        body: 'Registration rates & ledgers, prize inventory with POs, mass email to staff/leaders/parents, and role-based leader logins. Out of scope for label printing but documented for completeness.' },
      { name: 'Built-in label settings & vendor docs', use: 'unused', where: '/setting?tab=Labels',
        body: 'TwoTimTwo has its own label layout settings and an extensive doc/FAQ/guide corpus (250+ entries) — a reference for expected behavior. KVBC Awana uses its own label layouts.' },
    ],
  },
];

// What the app does today, in plain words. Keep each line true of the release.
const TODAY: { icon: IconName; title: string; body: string }[] = [
  { icon: 'tag', title: 'Labels print by themselves',
    body: 'A check-in prints the child’s label with the club’s own logo and lettering, plus allergy and birthday icons.' },
  { icon: 'phone', title: 'Check in from any phone',
    body: 'Leaders and the desk check children in at awana.kvbchurch.org/checkin, on a phone, tablet or computer.' },
  { icon: 'reprint', title: 'Undo and check out',
    body: 'Made a mistake? Undo a check-in. On club nights, Trek and Journey children are checked out on their own from 7:15 pm.' },
  { icon: 'tv', title: 'Lobby TV',
    body: 'Check-in moments with first names, a pick-up board and tonight’s count, on the lobby screen.' },
  { icon: 'screens', title: 'Projector countdown',
    body: 'A countdown to club time, then the game-time screen, on the projector.' },
  { icon: 'ledger', title: 'Journey screen',
    body: 'A lesson screen for the youth room that plays curriculum the church already licenses.' },
  { icon: 'key', title: 'Settings from your phone',
    body: 'Every screen and printer is set up at awana.kvbchurch.org/settings, from any phone or computer.' },
  { icon: 'leaf', title: 'Everything runs on free plans',
    body: 'Every part, from this website to the sync service, runs on a free plan.' },
];

interface Idea {
  id: string; title: string; body: string;
  benefits: 'Printer' | 'Display' | 'Both';
  effort: 'S' | 'M' | 'L'; impact: 'High' | 'Med' | 'Low';
  status?: 'shipped' | 'planned';
  shippedIn?: string;
  retired?: string;   // what changed after it shipped (a record, not a rewrite)
}

const ROADMAP: Idea[] = [
  { id: 'R-1', title: 'Reconcile detection against the Check-in Report', benefits: 'Printer', effort: 'M', impact: 'High', status: 'shipped', shippedIn: '5.2.0',
    body: 'Before v5.2 the extension inferred remote check-ins purely by watching rows disappear from the roster, guarded by heuristics against filters and re-renders. Periodically polling /clubber/checkin_report (the authoritative “who’s in tonight” list) lets it confirm every detection and catch any it missed or phantom-fired — eliminating the whole class of phantom/missed-print bugs the guards exist to paper over.' },
  { id: 'F-1', title: 'Award-slip printing from the meeting report', benefits: 'Printer', effort: 'M', impact: 'High', status: 'shipped', shippedIn: '5.2.0',
    body: 'Pull /meeting/report?output=csv for tonight and print a small “🏅 earned: …” slip when a child completes a book or earns an award — a delight moment leaders currently track on paper.' },
  { id: 'D-1', title: 'Lobby “tonight” ticker', benefits: 'Display', effort: 'M', impact: 'High', status: 'shipped', shippedIn: '5.2.0',
    body: 'Feed the signage app a live ticker of tonight’s totals — kids checked in per club, books completed, awards earned, bring-a-friend count — sourced from the report CSVs via the print server (kept first-name-only per the privacy invariant).' },
  { id: 'R-3', title: 'Authoritative sibling map from household CSV', benefits: 'Printer', effort: 'S', impact: 'Med', status: 'shipped', shippedIn: '5.2.0',
    body: 'The roster CSV has no household id, so sibling grouping now falls back to phone/address heuristics. Syncing /household/csv (which lists each household’s children directly) would make “Also here tonight?” exact for blended families and split same-surname families correctly.',
    retired: 'Retired in v6.1.0, together with the sibling check-in feature it served.' },
  { id: 'D-2', title: 'Color-group points scoreboard', benefits: 'Display', effort: 'M', impact: 'Med', status: 'shipped', shippedIn: '5.2.0',
    body: 'Render the team points race (/meeting/colorGroup) as a rotating lobby scoreboard — a proven engagement driver for kids.' },
  { id: 'D-3', title: 'iCal-driven “next meeting” banner', benefits: 'Display', effort: 'S', impact: 'Med', status: 'shipped', shippedIn: '5.2.0',
    body: 'Subscribe to /calendar/iCal so the countdown/signage app always knows the next real meeting date (and can show “No Awana this week”) without any hard-coded schedule.' },
  { id: 'F-2', title: 'Direct check-in API for driven flows', benefits: 'Printer', effort: 'M', impact: 'Med', status: 'shipped', shippedIn: '5.2.0',
    body: 'Sibling / phone / Quick-Mode check-ins currently click the row and poll for the modal button — fragile if TwoTimTwo restyles the modal. The documented POST /clubber/checkinclubber (clubber_id + calendar_id + events[]) would let those flows check in directly and reliably, keeping the click path only as a fallback.',
    retired: 'Sibling check-in was removed in v6.1.0; the direct check-in path still serves phone check-in.' },
  { id: 'R-2', title: 'CSV write-back as a safety net', benefits: 'Both', effort: 'M', impact: 'Med', status: 'shipped', shippedIn: '5.2.0',
    body: 'If a station is offline from TwoTimTwo mid-event, queue the night’s check-ins and reconcile later via the official /clubber/checkin_csv import instead of hand-entry — no attendance ever lost.' },
  { id: 'F-3', title: 'One-step walk-in that also registers', benefits: 'Printer', effort: 'M', impact: 'Low', status: 'shipped', shippedIn: '5.2.0',
    body: 'The walk-in widget prints a guest label now; it could also submit /clubber/register so the visitor exists in TwoTimTwo immediately (with the required phone/birthdate prompted inline).',
    retired: 'The check-in page’s walk-in is a name tag only now (never counted); see the walk-in card above.' },
  { id: 'F-4', title: 'Auto-print leader worksheets at meeting start', benefits: 'Printer', effort: 'S', impact: 'Low', status: 'shipped', shippedIn: '5.2.0',
    body: 'Fetch the per-group handbook agenda PDF (/meeting/handbook) and print it for each leader when club night begins.' },
  { id: 'R-4', title: 'Full clubber-id identity through detection & siblings', benefits: 'Printer', effort: 'M', impact: 'Med', status: 'shipped', shippedIn: '5.2.0',
    body: 'v5.1 anchors the print/enrichment path to TwoTimTwo’s clubber id, but the extension’s roster cache, print-dedup, and GET /siblings are still keyed by lowercased name. Two children with an identical first+last name therefore still can’t be told apart for detection/dedup or sibling lookup. Key ROSTER_CACHE and the dedup sets by recid, and let /siblings accept a clubberId, to close the last gap.',
    retired: 'The sibling lookup was removed in v6.1.0; the clubber-id identity itself stays.' },
  { id: 'D-4', title: 'Trek & Journey included in the projector celebrations', benefits: 'Display', effort: 'S', impact: 'Med', status: 'shipped', shippedIn: '5.2.0',
    body: 'The presentation tool was scoped to four clubs in code, so a Trek or Journey child’s birthday was silently dropped and never celebrated. All six clubs are now recognised. The game-time roster stays schedule-driven, so teen clubs are not forced into a game window a church has not configured.' },
  { id: 'D-5', title: 'Cancellation / announcement alert on every screen', benefits: 'Display', effort: 'S', impact: 'High', status: 'shipped', shippedIn: '5.2.0',
    body: 'A church announcement written in TwoTimTwo is mirrored to the lobby TV. A cancellation renders as an unmissable full-width bar above every other layer, so “CLUB CANCELLED TONIGHT” reaches families walking in — and reaches an OBS/ProPresenter feed too.' },
  { id: 'R-5', title: 'Smarter allergy extraction from free-text Notes', benefits: 'Printer', effort: 'M', impact: 'Low', status: 'shipped', shippedIn: '5.2.0',
    body: 'The real export has no dedicated allergy column, so allergies are parsed from the free-text Notes field. Parsing stays deliberately permissive (an extra icon is safer than a missed allergy), which can surface false-positive icons (e.g. “loves coloring” → dye). A negation-aware parse, or asking the church for a dedicated allergy field/custom view, would cut the noise without risking a missed allergy.' },
];

const EFFORT_LABEL = { S: 'Small', M: 'Medium', L: 'Large' } as const;

const SUB_LINKS: SubLink[] = [
  { href: './', label: 'Home' },
  { href: './#features', label: 'What it does' },
  { href: './help#install', label: 'Install' },
  { href: './help#faq', label: 'FAQ' },
  { href: './capabilities.html', label: 'TwoTimTwo reference', current: true },
];

// The family header, with this app's name. (components/family/Family.tsx still
// says "Club Label Printer" for the family's own markup; this page does not use it.)
const CapHeader: React.FC<{ subLinks: SubLink[] }> = ({ subLinks }) => (
  <header className="fam-header">
    <p className="fam-disclaimer" role="note">
      <strong>Not affiliated with or endorsed by Awana<sup>®</sup> Clubs International.</strong>{' '}
      <span className="fam-disclaimer__aside">Independent tools made by a local church for its own club nights.</span>
    </p>
    <nav className="fam-nav" aria-label="Club night tools">
      <div className="fam-wrap fam-nav__inner">
        <a className="fam-brand" href={URLS.labels}>
          <span className="fam-brand__mark"><Icon name="tag" /></span>
          <span><span className="fam-brand__name">KVBC Awana</span><span className="fam-brand__sub">One of three club-night tools</span></span>
        </a>
        <ul className="fam-nav__list">
          <li><a className="fam-nav__link" data-accent="labels" href={URLS.labels} aria-current="true"><span className="fam-swatch" aria-hidden="true"></span><span className="fam-nav__long">KVBC Awana</span><span className="fam-nav__short" aria-hidden="true">Awana</span></a></li>
          <li><a className="fam-nav__link" data-accent="checkin" href={URLS.checkin}><span className="fam-swatch" aria-hidden="true"></span><span className="fam-nav__long">Check-in Display</span><span className="fam-nav__short" aria-hidden="true">Check-in</span></a></li>
          <li><a className="fam-nav__link" data-accent="journey" href={URLS.journey}><span className="fam-swatch" aria-hidden="true"></span><span className="fam-nav__long">Journey Display</span><span className="fam-nav__short" aria-hidden="true">Journey</span></a></li>
        </ul>
      </div>
    </nav>
    <nav className="lbl-subnav" aria-label="KVBC Awana pages">
      <ul className="fam-wrap lbl-subnav__list">
        {subLinks.map(l => (
          <li key={l.href}>
            <a className="lbl-subnav__link" href={l.href} aria-current={l.current ? 'page' : undefined}>{l.label}</a>
          </li>
        ))}
      </ul>
    </nav>
  </header>
);

const CapFooter: React.FC = () => (
  <footer className="fam-footer">
    <div className="fam-wrap">
      <div className="fam-footer__grid">
        <p className="fam-footer__credit">Built by and for <em>Kennebec Valley Baptist Church</em>, so every child is welcomed by name.</p>
        <div>
          <h2 className="fam-footer__heading">The family</h2>
          <ul className="fam-footer__list">
            <li data-accent="labels"><a href={URLS.labels}><span className="fam-swatch" aria-hidden="true"></span>KVBC Awana</a></li>
            <li data-accent="checkin"><a href={URLS.checkin}><span className="fam-swatch" aria-hidden="true"></span>Check-in Display</a></li>
            <li data-accent="journey"><a href={URLS.journey}><span className="fam-swatch" aria-hidden="true"></span>Journey Display</a></li>
          </ul>
        </div>
        <div>
          <h2 className="fam-footer__heading">Source</h2>
          <ul className="fam-footer__list">
            <li><a href={URLS.srcLabels}>KVBC Awana on GitHub</a></li>
            <li><a href={URLS.srcCheckin}>Check-in Display on GitHub</a></li>
            <li><a href={URLS.srcJourney}>Journey Display on GitHub</a></li>
          </ul>
        </div>
      </div>
      <div className="fam-footer__legal">
        <p><strong>NOT AFFILIATED WITH OR ENDORSED BY AWANA CLUBS INTERNATIONAL.</strong></p>
        <p>Awana® and the names of its clubs and curricula are trademarks of Awana Clubs International, used here only to describe what these tools work alongside. KVBC Awana, Check-in Display and Journey Display are independent projects made by volunteers at Kennebec Valley Baptist Church; they are not sponsored, reviewed or approved by Awana Clubs International. No Awana logos or artwork appear on this page. TwoTimTwo is a separate service, named here only to describe compatibility.</p>
        <p>Screens and labels on this page are hand-drawn recreations. Children’s names are examples.</p>
      </div>
    </div>
  </footer>
);

export const Capabilities: React.FC = () => (
  <>
    <a className="fam-skip" href="#main">Skip to the content</a>
    <IconSprite />
    <CapHeader subLinks={SUB_LINKS} />

    <main id="main">
      {/* Hero */}
      <section className="lbl-ref-hero" aria-labelledby="ref-title">
        <div className="fam-wrap">
          <p className="fam-kicker">TwoTimTwo reference</p>
          <h1 className="lbl-ref-hero__title" id="ref-title">What TwoTimTwo can do, <em>and what KVBC Awana uses</em></h1>
          <p className="lbl-ref-hero__lede">
            A map of what the TwoTimTwo check-in system offers, and which parts KVBC Awana uses today.
            Last reviewed on 2026-10-13, for KVBC Awana 9.4.0.
          </p>
          <div className="lbl-note lbl-ref-note">
            <Icon name="ledger" className="lbl-note__icon" />
            <span>
              <strong>A reference, kept current.</strong> This page lists what TwoTimTwo offers and marks what the app
              uses. It is not a full list of the app’s features (for those, see the{' '}
              <a href="./#features">showcase on the home page</a>). The roadmap at the end is a record of the fourteen
              items that shipped in v5.2.0, with notes where something changed later.
            </span>
          </div>
          <p className="lbl-small mt-4">
            The developer-level contract (selectors, CSV columns, endpoints) lives in{' '}
            <code className="lbl-code">docs/TWOTIMTWO.md</code>.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3 text-step--1 text-ink-2">
            <span>Legend:</span>
            {(Object.keys(USE_BADGE) as Use[]).map(u => (
              <span key={u} className={USE_BADGE[u].cls}>{USE_BADGE[u].label}</span>
            ))}
          </div>
        </div>
      </section>

      {/* What the app does today */}
      <section className="lbl-part" aria-labelledby="today-title">
        <div className="fam-wrap">
          <div className="lbl-part__head">
            <p className="fam-kicker">Today</p>
            <h2 className="lbl-part__title" id="today-title">What KVBC Awana does today</h2>
            <p className="lbl-part__lede">
              One Windows app, KVBC Awana, does the work on club nights. A computer can print labels, show a screen, or both.
            </p>
          </div>
          <ul className="lbl-today">
            {TODAY.map(t => (
              <li key={t.title} className="lbl-refcard lbl-today__item">
                <span className="fam-card__icon"><Icon name={t.icon} /></span>
                <h3 className="lbl-today__title">{t.title}</h3>
                <p>{t.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Catalog */}
      <section className="lbl-refband mt-0!" aria-labelledby="catalog-title">
        <div className="fam-wrap">
          <h2 className="text-step-3" id="catalog-title">Everything TwoTimTwo.com does</h2>
          <p className="lbl-catalog-lede text-ink-2 text-step--1">Grouped by area. The badge shows how much of each capability KVBC Awana uses.</p>
          <div className="mt-10 space-y-12">
            {CATALOG.map(group => (
              <div key={group.title}>
                <h3 className="lbl-group-title flex items-center gap-3 text-step-1">
                  <span className="fam-card__icon"><Icon name={group.icon} /></span>{group.title}
                </h3>
                <div className="mt-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {group.caps.map(c => (
                    <div key={c.name} className="lbl-refcard">
                      <div className="flex items-start justify-between gap-3">
                        <h4>{c.name}</h4>
                        <span className={`shrink-0 ${USE_BADGE[c.use].cls}`}>{USE_BADGE[c.use].label}</span>
                      </div>
                      <p className="flex-1">{c.body}</p>
                      {c.where && <code className="lbl-where">{c.where}</code>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Roadmap record */}
      <section className="lbl-part" aria-labelledby="roadmap-title">
        <div className="fam-wrap">
          <div className="lbl-part__head">
            <p className="fam-kicker">A record</p>
            <h2 className="lbl-part__title" id="roadmap-title">The v5.2 roadmap, all shipped</h2>
            <p className="lbl-part__lede">
              Every item below started as a &ldquo;future possibility&rdquo; found by mapping the live
              check-in system, and all fourteen shipped in v5.2.0. Each is grounded in a real endpoint
              from the catalog above. The codes (R-/F-/D-) are stable so they stay referenceable from
              issues and commits. The descriptions are kept as they were written, as a plan; the notes
              mark what changed later.
            </p>
          </div>
          <div className="mt-10 space-y-4">
            {ROADMAP.map(idea => (
              <div key={idea.id} className="lbl-refcard">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="font-code text-step--1 font-medium text-ink-3">{idea.id}</span>
                  <h3 className="flex-1 min-w-[12rem]">{idea.title}</h3>
                  {idea.status === 'shipped' && (
                    <span className="lbl-badge lbl-badge--shipped">Shipped{idea.shippedIn ? ` v${idea.shippedIn}` : ''}</span>
                  )}
                  <span className="lbl-badge">{idea.benefits}</span>
                  <span className="text-step--1 text-ink-2">Effort: <b className="text-ink">{EFFORT_LABEL[idea.effort]}</b></span>
                  <span className="text-step--1 text-ink-2">Impact: <b className="text-ink">{idea.impact}</b></span>
                </div>
                <p>{idea.body}</p>
                {idea.retired && (
                  <p className="lbl-later mt-3! flex flex-wrap items-center gap-2"><span className="lbl-badge lbl-badge--retired">Later</span><span>{idea.retired}</span></p>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lbl-refband" aria-labelledby="privacy-title">
        <div className="fam-wrap">
          <div className="max-w-3xl">
            <p className="fam-kicker">Privacy</p>
            <h2 className="mt-3 text-step-3" id="privacy-title">Privacy stays non-negotiable</h2>
            <p className="mt-4 text-ink-2">
              Every idea here keeps the project&rsquo;s core rule: a child&rsquo;s details stay with the church.
              Names reach the screens sealed end to end, and the screens show first names only. Allergy, contact,
              photo-release and household data are used on this computer to print a label and are never broadcast.
              Any feature touching photos must respect each child&rsquo;s release answers: an explicit &ldquo;no&rdquo;
              under either <b className="text-ink">Photo Release?</b> or <b className="text-ink">Med Release?</b> counts,
              since churches record the media release under either column.
            </p>
          </div>
        </div>
      </section>
    </main>

    <CapFooter />
  </>
);
