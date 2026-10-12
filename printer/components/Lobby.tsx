import React from 'react';

/**
 * The lobby signage and the projector (was lobby/public/about.html). Screens
 * here are CSS/SVG recreations of the current signage look, drawn fresh: no
 * Awana logos, club wordmarks or club art, generic first names only, and every
 * brand face comes from the kit's own fonts.css (styles/lobby.css, "cid-").
 * Generated once from the static page; edit it here now.
 */
export const LobbySection: React.FC = () => (
  <section id="lobby" className="lbl-product" data-accent="checkin" aria-labelledby="lobby-hero-title">
    <section className="fam-hero" aria-labelledby="lobby-hero-title">
    <div className="fam-wrap fam-hero__inner">
    <div><p className="fam-kicker">For the lobby and the main room</p><h2 className="fam-hero__title" id="lobby-hero-title">Every arrival,{' '}<em>a&nbsp;small celebration.</em></h2><p className="fam-hero__lede">The moment a child is checked in, their club’s colors sweep across the lobby TV and carry their first name. On the projector, the same app counts down to club night and keeps game time on schedule, so leaders can keep their eyes on the kids.</p>
    <div className="fam-actions"><a className="fam-btn" href="#welcome">See how it works<svg aria-hidden="true"><use href="#i-arrow" /></svg></a>{' '}<a className="fam-btn fam-btn--ghost" href="#family">The whole club night</a>
    </div>
    <ul className="fam-hero__facts">
    <li><svg aria-hidden="true"><use href="#i-check" /></svg>Runs in a web browser
    </li>
    <li><svg aria-hidden="true"><use href="#i-check" /></svg>First names only, always
    </li>
    <li><svg aria-hidden="true"><use href="#i-check" /></svg>Made at Kennebec Valley Baptist Church
    </li>
    </ul>
    </div>
    <figure className="fam-frame fam-frame--tv">
    <div className="fam-frame__stage">
    <div className="fam-frame__screen cid-scr cid-scr--night" role="img" aria-label="Recreation of the lobby TV mid-welcome. A bright red Sparks wave, with a deeper red wave behind it, has risen across the lower half of the screen. It carries the word Welcome and, in big white letters, the name MICAH, with the club's name, Sparks, in a small label at its left end. The evening slide behind it, Welcome to Awana!, has faded back. A small stepped sticker in the top corner reads Clear skies, 58 degrees.">
    <div aria-hidden="true"><span className="cid-blob cid-blob--a"></span><span className="cid-blob cid-blob--b"></span><svg className="cid-dz" style={{ left: "7%", top: "13%", width: "7cqi", height: "3.5cqi" }} viewBox="0 0 40 20"><use href="#i-dz-arc" /></svg><svg className="cid-dz" style={{ left: "88%", top: "51%", width: "7cqi", height: "3.5cqi" }} viewBox="0 0 40 20"><use href="#i-dz-zig" /></svg><svg className="cid-dz" style={{ left: "30%", top: "9%", width: "2.4cqi", height: "2.4cqi" }} viewBox="0 0 20 20"><use href="#i-dz-ring" /></svg>
    </div>
    <div className="cid-slide cid-slide--back" aria-hidden="true"><span className="cid-slide__eyebrow">Tonight</span><span className="cid-slide__text">Welcome to Awana!</span>
    </div>
    <div className="cid-corner cid-corner--top" aria-hidden="true"><svg className="cid-step" viewBox="-0.04 -0.04 5.113 2.570" style={{ width: "5.113em", height: "2.570em" }}><path className="cid-step__plate" d="M0.575,0 L3.838,0 A0.575,0.575 0 0 1 4.413,0.575 L4.413,1.05 L4.913,1.05 L4.913,2.04 A0.39,0.39 0 0 1 4.523,2.43 L1.11,2.43 A0.27,0.27 0 0 1 0.84,2.16 L0.84,1.15 L0.575,1.15 A0.575,0.575 0 0 1 0,0.575 A0.575,0.575 0 0 1 0.575,0 Z" transform="translate(0.12 0.07)" /><path className="cid-step__line" d="M0.575,0 L3.838,0 A0.575,0.575 0 0 1 4.413,0.575 L4.413,1.05 L4.913,1.05 L4.913,2.04 A0.39,0.39 0 0 1 4.523,2.43 L1.11,2.43 A0.27,0.27 0 0 1 0.84,2.16 L0.84,1.15 L0.575,1.15 A0.575,0.575 0 0 1 0,0.575 A0.575,0.575 0 0 1 0.575,0 Z" /><text x="2.207" y="0.595" fontSize="0.59" textLength="3.573" lengthAdjust="spacingAndGlyphs">CLEAR SKIES</text><text x="2.877" y="1.770" fontSize="1.06" textLength="1.681" lengthAdjust="spacingAndGlyphs">58°</text></svg>
    </div>
    <div className="cid-moment" style={{ "--primary": "#f04a4b", "--deep": "#b82b32", "--tint": "#fddacf" }} aria-hidden="true"><svg className="cid-moment__wave cid-moment__wave--back" viewBox="0 0 1600 468" preserveAspectRatio="none"><path d="M0,150 C250,90 520,120 760,190 C900,230 1100,250 1600,240 V468 H0 Z" fill="#b82b32" /></svg><svg className="cid-moment__wave" viewBox="0 0 1600 468" preserveAspectRatio="none"><path d="M0,300 C160,270 300,254 520,252 C700,250 800,200 960,150 C1120,100 1350,96 1600,110 V468 H0 Z" fill="#f04a4b" /></svg>
    <div className="cid-moment__doodles"><svg style={{ left: "74cqi", top: "10.6cqi", width: "2.6cqi", height: "2.6cqi" }} viewBox="0 0 24 24"><use href="#i-spark" /></svg><svg style={{ left: "78.6cqi", top: "9.4cqi", width: "1.1cqi", height: "1.1cqi" }} viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="currentColor" /></svg><svg style={{ left: "77.4cqi", top: "14.2cqi", width: "1.7cqi", height: "1.7cqi", rotate: "57deg" }} viewBox="0 0 24 24"><use href="#i-spark" /></svg>
    </div><span className="cid-moment__club">Sparks</span>
    <div className="cid-moment__copy"><span className="cid-moment__kicker">Welcome</span>{' '}<span className="cid-moment__name">MICAH</span>
    </div>
    </div>
    </div>
    </div><figcaption className="fam-frame__caption"><b>Fig. 1</b>{' '}Micah from Sparks, moments after checking in: his club’s wave rises and carries his name, and the slide behind steps back. On the real screen the club’s mark rides the wave; here its name stands in for it.<span className="fam-frame__recreated">Recreated for illustration. Names and numbers are examples.</span></figcaption>
    </figure>
    </div>
    </section>
    <section className="fam-stats" aria-label="At a glance">
    <div className="fam-wrap">
    <ul className="fam-stats__list">
    <li className="fam-stat">
    <div className="fam-stat__num">6<span className="fam-stat__unit">clubs</span>
    </div><p className="fam-stat__label">each greeted in its own color, even when the check-in system spells the name a little differently.</p>
    </li>
    <li className="fam-stat">
    <div className="fam-stat__num">0<span className="fam-stat__unit">last names</span>
    </div><p className="fam-stat__label">can reach the screen. A first name and a club, never a last name, birth year, allergy or photo.</p>
    </li>
    <li className="fam-stat">
    <div className="fam-stat__num">1<span className="fam-stat__unit">passphrase</span>
    </div><p className="fam-stat__label">logs in a new lobby screen, once display login is set up.</p>
    </li>
    <li className="fam-stat">
    <div className="fam-stat__num">3<span className="fam-stat__unit">minutes</span>
    </div><p className="fam-stat__label">between checks for a new version, installed only when no one is being greeted.</p>
    </li>
    </ul>
    </div>
    </section>
    <div className="fam-wrap cid-index">
    <nav aria-label="Chapters">
    <ol className="fam-chapters">
    <li><a href="#welcome"><b>01</b>A welcome for every child</a>
    </li>
    <li><a href="#projector"><b>02</b>The projector, run for you</a>
    </li>
    <li><a href="#runs-itself"><b>03</b>Runs itself</a>
    </li>
    <li><a href="#safe"><b>04</b>Safe by design</a>
    </li>
    </ol>
    </nav>
    </div>
    <section className="fam-chapter" id="welcome" aria-labelledby="welcome-title">
    <div className="fam-wrap">
    <div className="fam-chapter__head">
    <div>
    <div className="fam-chapter__num" aria-hidden="true">01
    </div><p className="fam-kicker">Chapter one</p><h2 className="fam-chapter__title" id="welcome-title">A welcome for every child</h2>
    </div>
    <div><p className="fam-standfirst">Walking into club should feel like being expected. A child’s own name on the big screen says exactly that.</p><p className="fam-chapter__intro">The lobby TV is the first thing a family sees. Every check-in becomes a short, joyful moment on it, and none of it needs a volunteer standing by the screen.</p>
    </div>
    </div>
    <div className="cid-show">
    <figure className="fam-frame fam-frame--tv">
    <div className="fam-frame__stage">
    <div className="fam-frame__screen cid-scr" role="img" aria-label="Recreation of a birthday welcome on a pale-blue sky. A teal Trek wave, with a deeper teal wave behind it, carries the words Happy birthday, the name AVA in big white letters, and the line Hip hip hooray, it's your special day! Above the wave on the right, a bright orange starburst sticker reads Happy birthday! and confetti scatters around it. No age is shown anywhere.">
    <div aria-hidden="true"><span className="cid-blob cid-blob--a"></span><span className="cid-blob cid-blob--b"></span><svg className="cid-dz" style={{ left: "6%", top: "15%", width: "7cqi", height: "3.5cqi" }} viewBox="0 0 40 20"><use href="#i-dz-arc" /></svg><svg className="cid-dz" style={{ left: "44%", top: "12%", width: "7cqi", height: "3.5cqi" }} viewBox="0 0 40 20"><use href="#i-dz-zig" /></svg><svg className="cid-dz" style={{ left: "26%", top: "30%", width: "2.4cqi", height: "2.4cqi" }} viewBox="0 0 20 20"><use href="#i-dz-ring" /></svg>
    </div>
    <div className="cid-moment" style={{ "--primary": "#047e71", "--deep": "#02554c", "--tint": "#cceaec" }} aria-hidden="true"><svg className="cid-moment__wave cid-moment__wave--back" viewBox="0 0 1600 468" preserveAspectRatio="none"><path d="M0,110 C240,60 520,80 760,140 C920,180 1150,200 1600,190 V468 H0 Z" fill="#02554c" /></svg><svg className="cid-moment__wave" viewBox="0 0 1600 468" preserveAspectRatio="none"><path d="M0,250 C170,222 320,204 560,202 C700,201 760,198 820,180 C900,150 1000,100 1150,84 C1300,70 1450,70 1600,78 V468 H0 Z" fill="#047e71" /></svg>
    <div className="cid-moment__doodles"><svg style={{ left: "74cqi", top: "10.6cqi", width: "2.6cqi", height: "2.6cqi" }} viewBox="0 0 24 24"><use href="#i-spark" /></svg><svg style={{ left: "78.6cqi", top: "9.4cqi", width: "1.1cqi", height: "1.1cqi" }} viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="currentColor" /></svg><svg style={{ left: "77.4cqi", top: "14.2cqi", width: "1.7cqi", height: "1.7cqi", rotate: "57deg" }} viewBox="0 0 24 24"><use href="#i-spark" /></svg>
    </div><i className="cid-bit" style={{ right: "26cqi", bottom: "31cqi", background: "#fcb614", rotate: "24deg" }}></i>{' '}<i className="cid-bit" style={{ right: "22cqi", bottom: "37cqi", background: "#fff", rotate: "-30deg" }}></i>{' '}<i className="cid-bit" style={{ right: "3cqi", bottom: "36cqi", background: "#ffe8c2", rotate: "50deg" }}></i>{' '}<i className="cid-bit" style={{ right: "1.6cqi", bottom: "25cqi", background: "#fcb614", rotate: "-12deg" }}></i>{' '}<i className="cid-bit" style={{ right: "21cqi", bottom: "24cqi", background: "#cceaec", rotate: "70deg" }}></i><svg className="cid-spark" style={{ right: "24cqi", bottom: "28.5cqi", color: "#fff" }} viewBox="0 0 24 24"><use href="#i-spark" /></svg><svg className="cid-spark" style={{ right: ".6cqi", bottom: "31cqi", color: "#fcb614", width: "1.6cqi", height: "1.6cqi" }} viewBox="0 0 24 24"><use href="#i-spark" /></svg><span className="cid-burst"><svg viewBox="0 0 100 100"><use href="#i-burst" /></svg><span><b>Happy</b><b>birthday!</b></span></span>{' '}<span className="cid-moment__club">Trek</span>
    <div className="cid-moment__copy"><span className="cid-moment__kicker">Happy birthday</span>{' '}<span className="cid-moment__name">AVA</span>{' '}<span className="cid-moment__line">Hip hip hooray — it’s your special day!</span>
    </div>
    </div>
    </div>
    </div><figcaption className="fam-frame__caption"><b>Fig. 2</b>{' '}A birthday week: the words around the name change, and the one bright sticker comes out. It never shows a number, because the screen never learns a child’s age.<span className="fam-frame__recreated">Recreated for illustration. Names are examples.</span></figcaption>
    </figure>
    <div className="cid-show__note"><h3>Small moments, every single week</h3><p>Birthdays, first visits, a child back for a new season: each gets its own words above and below the name, and a birthday or a very first visit gets the one bright sticker, so the room learns to cheer along.</p><p>The celebrations are for everyone in the lobby, and the screen still never learns a last name, an age or anything about a family.</p>
    <ul className="fam-pills">
    <li className="fam-pill">Birthday weeks
    </li>
    <li className="fam-pill">First-time welcomes
    </li>
    <li className="fam-pill">Welcome back
    </li>
    <li className="fam-pill">Milestone cheers
    </li>
    </ul>
    </div>
    </div>
    <ul className="fam-cards">
    <li className="fam-card"><span className="fam-card__icon"><svg aria-hidden="true"><use href="#i-hello" /></svg></span><h3 className="fam-card__title">Their name, on their club’s wave</h3><p className="fam-card__body">Their club’s wave rises from the bottom of the screen and carries their first name, in the club’s own colors. Each name also flies in its own way, the same every week, so a child comes to recognize their entrance.</p>
    <div className="fam-card__demo" aria-hidden="true">
    <ul className="cid-demo-clubs">
    <li><svg viewBox="0 0 38 21"><rect width="38" height="21" fill="#1a627c" /><path d="M0 12C9 6 22 16 38 8V21H0Z" fill="#1db6d9" /></svg>Puggles
    </li>
    <li><svg viewBox="0 0 38 21"><rect width="38" height="21" fill="#2f4f8a" /><path d="M0 12C9 6 22 16 38 8V21H0Z" fill="#4c72b8" /></svg>Cubbies
    </li>
    <li><svg viewBox="0 0 38 21"><rect width="38" height="21" fill="#b82b32" /><path d="M0 12C9 6 22 16 38 8V21H0Z" fill="#f04a4b" /></svg>Sparks
    </li>
    <li><svg viewBox="0 0 38 21"><rect width="38" height="21" fill="#2f8a4e" /><path d="M0 12C9 6 22 16 38 8V21H0Z" fill="#58bd79" /></svg>T&amp;T
    </li>
    <li><svg viewBox="0 0 38 21"><rect width="38" height="21" fill="#02554c" /><path d="M0 12C9 6 22 16 38 8V21H0Z" fill="#047e71" /></svg>Trek
    </li>
    <li><svg viewBox="0 0 38 21"><rect width="38" height="21" fill="#56467f" /><path d="M0 12C9 6 22 16 38 8V21H0Z" fill="#8a649d" /></svg>Journey
    </li>
    </ul>
    </div>
    <details className="fam-hood"><summary><svg className="fam-hood__chev" aria-hidden="true"><use href="#i-chev" /></svg>Peek under the hood<span className="fam-sr">: Their name, on their club’s wave</span></summary>
    <div className="fam-hood__body">The colors are the 2026-27 club palette, kept in one shared kit that every screen in the family reads. The entrance (one of three ways the letters arrive) is seeded from the name itself, so it is the same on every screen, every week. Each name is measured to fit on one line and never breaks between letters. Common spellings such as “Truth and Training” or “TnT” land on the right club, and an unknown club still gets a cheerful warm-orange wave.
    </div>
    </details>
    </li>
    <li className="fam-card"><span className="fam-card__icon"><svg aria-hidden="true"><use href="#i-cake" /></svg></span><h3 className="fam-card__title">Birthdays get the bright sticker</h3><p className="fam-card__body">During a child’s birthday week the words above their name say “Happy birthday,” a bright starburst sticker lands beside it, and confetti in warm colors and their club’s own pops out of the sticker. No age is ever shown.</p>
    <details className="fam-hood"><summary><svg className="fam-hood__chev" aria-hidden="true"><use href="#i-chev" /></svg>Peek under the hood<span className="fam-sr">: Birthdays get the bright sticker</span></summary>
    <div className="fam-hood__body">The check-in feed carries a yes-or-no birthday flag and never a birth year, so the sticker says “Happy birthday!” and never a number. When the birthday falls later in the week, a “Birthday this Friday!” style line replaces “it’s your special day,” which would be wrong on a Wednesday. Once the church sets its display key, that week’s birthday list travels sealed, so only screens holding the key can show that line.
    </div>
    </details>
    </li>
    <li className="fam-card"><span className="fam-card__icon"><svg aria-hidden="true"><use href="#i-star" /></svg></span><h3 className="fam-card__title">First night, and welcome back</h3><p className="fam-card__body">A child’s very first night says “Welcome to Awana Clubs” above their name and gets a bright “New!” sticker. A child returning for a new season is greeted “Welcome back” instead.</p>
    <div className="fam-card__demo" aria-hidden="true">
    <div className="cid-demo-first"><p><small>Welcome to Awana Clubs</small>NORA</p><span className="cid-burst"><svg viewBox="0 0 100 100"><use href="#i-burst" /></svg><span>New!</span></span>
    </div>
    </div>
    <details className="fam-hood"><summary><svg className="fam-hood__chev" aria-hidden="true"><use href="#i-chev" /></svg>Peek under the hood<span className="fam-sr">: First night, and welcome back</span></summary>
    <div className="fam-hood__body">Both come from the check-in system, which marks a first visit and a first night of the season separately and never sends both for the same child. Welcome back is deliberately quieter, with no sticker: the one bright sticker is kept for what is new or special, so it keeps meaning something.
    </div>
    </details>
    </li>
    <li className="fam-card"><span className="fam-card__icon"><svg aria-hidden="true"><use href="#i-queue" /></svg></span><h3 className="fam-card__title">Never a pile-up at the door</h3><p className="fam-card__body">When a whole carpool arrives at once, every child still gets their full moment. The wave stays up and the next name flips in, like a scoreboard, and a “+3 more coming” note lets the room know.</p>
    <div className="fam-card__demo" aria-hidden="true">
    <div className="cid-demo-queue"><span style={{ "--c": "#f04a4b" }}>Eli</span><span style={{ "--c": "#58bd79" }}>Grace</span><span style={{ "--c": "#4c72b8" }}>Leo</span><b>+3 more coming</b>
    </div>
    </div>
    <details className="fam-hood"><summary><svg className="fam-hood__chev" aria-hidden="true"><use href="#i-chev" /></svg>Peek under the hood<span className="fam-sr">: Never a pile-up at the door</span></summary>
    <div className="fam-hood__body">Nobody’s time is ever shortened. Each child holds the screen for the full time set in Settings (6 seconds, or 8 for a birthday or a first visit, by default), however long the line. Arrivals wait their turn in order, and when the next child is from another club, that club’s wave sweeps in over the last one.
    </div>
    </details>
    </li>
    <li className="fam-card"><span className="fam-card__icon"><svg aria-hidden="true"><use href="#i-trophy" /></svg></span><h3 className="fam-card__title">Big numbers get a cheer</h3><p className="fam-card__body">The 50th, the 100th, the 200th child of the evening each bring a room-wide moment, and so do handbooks finished and awards earned tonight.</p>
    <div className="fam-card__demo" aria-hidden="true">
    <div className="cid-demo-milestone"><span>Triple digits</span><b>100 kids tonight!</b>
    </div>
    </div>
    <details className="fam-hood"><summary><svg className="fam-hood__chev" aria-hidden="true"><use href="#i-chev" /></svg>Peek under the hood<span className="fam-sr">: Big numbers get a cheer</span></summary>
    <div className="fam-hood__body">The big ones (every 50th, from the 50th up to the 300th) come from the check-in desk’s own total, not from each screen’s count, so every screen in the building cheers at the same moment. Each is celebrated once, in order, even when the count jumps past it. Each screen also cheers every 25th check-in it sees, by its own count.
    </div>
    </details>
    </li>
    <li className="fam-card"><span className="fam-card__icon"><svg aria-hidden="true"><use href="#i-moon" /></svg></span><h3 className="fam-card__title">Quieter once the program starts</h3><p className="fam-card__body">Children who arrive once the opening has begun still get their welcome, just a calmer one: no confetti, and the chime turned down, so the room isn’t pulled away from what’s happening.</p>
    <details className="fam-hood"><summary><svg className="fam-hood__chev" aria-hidden="true"><use href="#i-chev" /></svg>Peek under the hood<span className="fam-sr">: Quieter once the program starts</span></summary>
    <div className="fam-hood__body">The display reads the same shared schedule file as the projector, so it knows when the program has begun. The chime itself is off until a church turns it on in Settings.
    </div>
    </details>
    </li>
    </ul>
    </div>
    </section>
    <section className="fam-chapter" id="projector" aria-labelledby="projector-title">
    <div className="fam-wrap">
    <div className="fam-chapter__head">
    <div>
    <div className="fam-chapter__num" aria-hidden="true">02
    </div><p className="fam-kicker">Chapter two</p><h2 className="fam-chapter__title" id="projector-title">The projector, run for you</h2>
    </div>
    <div><p className="fam-standfirst">The best club nights keep moving. The projector keeps time, so the leaders can keep the kids.</p><p className="fam-chapter__intro">A second page of the same app runs on the main-room projector. It counts down all week, opens the night, times each club’s game slot and signs off, all from the church’s posted schedule. Nobody has to click through slides during the meeting.</p>
    </div>
    </div>
    <div className="cid-pair">
    <figure className="fam-frame fam-frame--projector">
    <div className="fam-frame__stage">
    <div className="fam-frame__screen cid-scr cid-proj" role="img" aria-label="Recreation of the projector's week-long countdown on a pure black screen: Awana begins in 2 days, 4 hours, 12 minutes. Beneath it: Next meeting, Wednesday, 6:00 PM, and a small chip for an upcoming church event, Parents' Night. A crescent moon and a few stars glow quietly in the background.">
    <div className="cid-stars" aria-hidden="true"><span className="cid-moon"></span>{' '}<i style={{ left: "12%", top: "18%" }}></i><i style={{ left: "24%", top: "72%" }}></i><i style={{ left: "40%", top: "10%" }}></i><i style={{ left: "71%", top: "78%" }}></i><i style={{ left: "86%", top: "52%" }}></i><i style={{ left: "6%", top: "48%" }}></i><svg style={{ left: "18%", top: "30%" }} viewBox="0 0 24 24"><use href="#i-spark" /></svg><svg style={{ left: "80%", top: "30%", width: "1.8cqi", height: "1.8cqi" }} viewBox="0 0 24 24"><use href="#i-spark" /></svg><svg style={{ left: "60%", top: "84%", width: "2cqi", height: "2cqi" }} viewBox="0 0 24 24"><use href="#i-spark" /></svg>
    </div>
    <div className="cid-proj__center" aria-hidden="true">
    <div className="cid-proj__kicker cid-glow">Awana begins in
    </div>
    <div className="cid-timer cid-glow">2<small>d</small>{' '}04<small>h</small>{' '}12<small>m</small>
    </div>
    <div className="cid-proj__meta">Next meeting · Wednesday · 6:00 PM
    </div>
    <div className="cid-proj__chips"><span className="cid-proj__chip">Parents’ Night</span>
    </div>
    </div>
    </div>
    </div><figcaption className="fam-frame__caption"><b>Fig. 3</b>{' '}All week, the projector counts down to the next club night.<span className="fam-frame__recreated">Recreated for illustration.</span></figcaption>
    </figure>
    <figure className="fam-frame fam-frame--projector">
    <div className="fam-frame__stage">
    <div className="fam-frame__screen cid-scr cid-proj" role="img" aria-label="Recreation of T and T game time on the projector: green waves across the top and bottom of a black screen, a T and T badge, Game Time! in glowing green, and an amber timer at 1:47 with a Two minutes badge beside it. A small note reads 12 checked in."><svg className="cid-gwave cid-gwave--top" viewBox="0 0 1600 200" preserveAspectRatio="none" aria-hidden="true"><path d="M0 0H1600V90C1300 150 1100 40 800 100S250 150 0 80Z" fill="#2f8a4e" opacity=".75" /><path d="M0 0H1600V50C1300 100 1100 10 800 60S250 100 0 40Z" fill="#58bd79" /></svg><svg className="cid-gwave cid-gwave--bot" viewBox="0 0 1600 300" preserveAspectRatio="none" aria-hidden="true"><path d="M0 90C300 10 600 160 900 80S1400 30 1600 90V300H0Z" fill="#58bd79" /><path d="M0 160C320 100 640 220 960 160S1400 120 1600 160V300H0Z" fill="#2f8a4e" /></svg>
    <div className="cid-proj__center" aria-hidden="true" style={{ paddingBottom: "12cqi" }}><span className="cid-game__badge">T&amp;T</span>
    <div className="cid-game__title">GAME TIME!
    </div>
    <div className="cid-game__row"><span className="cid-timer">1:47</span><span className="cid-warn">TWO MINUTES</span>
    </div><span className="cid-game__count"><b>12</b>{' '}checked in</span>
    </div>
    </div>
    </div><figcaption className="fam-frame__caption"><b>Fig. 4</b>{' '}Game time for one club, two minutes from the handoff, so the timer has turned amber. The real screen shows the club’s mark; a plain badge stands in for it here.<span className="fam-frame__recreated">Recreated for illustration. Numbers are examples.</span></figcaption>
    </figure>
    </div>
    <ul className="fam-cards fam-cards--2">
    <li className="fam-card"><span className="fam-card__icon"><svg aria-hidden="true"><use href="#i-clock" /></svg></span><h3 className="fam-card__title">A countdown all week long</h3><p className="fam-card__body">Between club nights the projector counts down to the next meeting in big, glowing digits, with the day’s weather playing quietly behind it and upcoming church events listed underneath.</p>
    <details className="fam-hood"><summary><svg className="fam-hood__chev" aria-hidden="true"><use href="#i-chev" /></svg>Peek under the hood<span className="fam-sr">: A countdown all week long</span></summary>
    <div className="fam-hood__body">The countdown comes from one small schedule engine reading{' '}<code>shared/schedule.json</code>, the same file the lobby screen follows. Its tests check every hand-off of the evening, and every deploy replays those moments in a real browser before it goes live.
    </div>
    </details>
    </li>
    <li className="fam-card"><span className="fam-card__icon"><svg aria-hidden="true"><use href="#i-flag" /></svg></span><h3 className="fam-card__title">The opening, on cue</h3><p className="fam-card__body">At start time the welcome slide and the pledges come up on their own, then the screen hands the room to the first game slot. At the end of the night it closes and signs off.</p>
    <details className="fam-hood"><summary><svg className="fam-hood__chev" aria-hidden="true"><use href="#i-chev" /></svg>Peek under the hood<span className="fam-sr">: The opening, on cue</span></summary>
    <div className="fam-hood__body">Each part of the evening (opening, each club’s game slot, closing, shutdown) is one line in the schedule file, so retiming the night is an edit to one file, not to the app.
    </div>
    </details>
    </li>
    <li className="fam-card"><span className="fam-card__icon"><svg aria-hidden="true"><use href="#i-whistle" /></svg></span><h3 className="fam-card__title">Game time for each club</h3><p className="fam-card__body">Each game slot gets its own screen in its club’s colors, with a big timer counting to the next handoff and a quiet count of how many of its kids have checked in tonight.</p>
    <div className="fam-card__demo" aria-hidden="true">
    <ol className="cid-demo-slots">
    <li><i style={{ "--c1": "#58bd79", "--c2": "#58bd79" }}></i>T&amp;T<span>6:05</span>
    </li>
    <li><i style={{ "--c1": "#f04a4b", "--c2": "#f04a4b" }}></i>Sparks<span>6:30</span>
    </li>
    <li><i style={{ "--c1": "#1db6d9", "--c2": "#4c72b8" }}></i>Puggles &amp; Cubbies<span>7:00</span>
    </li>
    </ol>
    </div>
    <details className="fam-hood"><summary><svg className="fam-hood__chev" aria-hidden="true"><use href="#i-chev" /></svg>Peek under the hood<span className="fam-sr">: Game time for each club</span></summary>
    <div className="fam-hood__body">The per-club count arrives through the same checked, first-names-only connection the lobby uses; the projector never opens a second one. If the check-in desk goes quiet for ten minutes, the count hides rather than showing a stale number.
    </div>
    </details>
    </li>
    <li className="fam-card"><span className="fam-card__icon"><svg aria-hidden="true"><use href="#i-bell" /></svg></span><h3 className="fam-card__title">A calm heads-up</h3><p className="fam-card__body">Two minutes before a handoff the timer turns amber, and red for the last thirty seconds. No pop-ups, just a color a leader can read across the gym.</p>
    <div className="fam-card__demo" aria-hidden="true">
    <div className="cid-demo-times"><span className="is-amber">1:47</span><span className="is-red">0:24</span><small>two minutes, then the final call</small>
    </div>
    </div><span className="fam-card__tag">Chime off by default</span>
    <details className="fam-hood"><summary><svg className="fam-hood__chev" aria-hidden="true"><use href="#i-chev" /></svg>Peek under the hood<span className="fam-sr">: A calm heads-up</span></summary>
    <div className="fam-hood__body">An optional chime can be armed from the projector’s hidden menu. Until someone does, the projector never makes a sound on its own.
    </div>
    </details>
    </li>
    </ul>
    </div>
    </section>
    <section className="fam-chapter" id="runs-itself" aria-labelledby="runs-title">
    <div className="fam-wrap">
    <div className="fam-chapter__head">
    <div>
    <div className="fam-chapter__num" aria-hidden="true">03
    </div><p className="fam-kicker">Chapter three</p><h2 className="fam-chapter__title" id="runs-title">Runs itself</h2>
    </div>
    <div><p className="fam-standfirst">The volunteers who set this up won’t always be in the room. So it was built to look after itself, night after night.</p><p className="fam-chapter__intro">New screens log themselves in, announcements reach every display at once and take turns with the welcomes, updates install on their own, and a quiet night never looks like a broken one.</p>
    </div>
    </div>
    <div className="cid-show cid-show--flip">
    <figure className="fam-frame">
    <div className="cid-fleet" role="img" aria-label="Recreation of one announcement shown on three lobby screens at once: a large TV and two smaller ones all show the same deep-blue slide reading Bring a friend next week!">
    <div>
    <div className="cid-tv" aria-hidden="true">
    <div className="cid-screen cid-scr cid-scr--night"><span className="cid-blob cid-blob--a"></span><span className="cid-blob cid-blob--b"></span><svg className="cid-wave" viewBox="0 0 1600 440" preserveAspectRatio="none"><path d="M0,200 C260,40 520,60 820,170 S1360,210 1600,70 V440 H0 Z" fill="#ffb81c" opacity=".4" /><path d="M0,250 C280,110 560,120 860,210 S1380,230 1600,120 V440 H0 Z" fill="#f7931e" /></svg>
    <div className="cid-slide"><span className="cid-slide__eyebrow">Next Wednesday</span><span className="cid-slide__text">Bring a friend next week!</span>
    </div>
    </div>
    </div><p className="cid-fleet__tag" aria-hidden="true">Lobby</p>
    </div>
    <div className="cid-fleet__side">
    <div>
    <div className="cid-tv cid-tv--sm" aria-hidden="true">
    <div className="cid-screen cid-scr cid-scr--night"><span className="cid-blob cid-blob--a"></span><span className="cid-blob cid-blob--b"></span><svg className="cid-wave" viewBox="0 0 1600 440" preserveAspectRatio="none"><path d="M0,200 C260,40 520,60 820,170 S1360,210 1600,70 V440 H0 Z" fill="#ffb81c" opacity=".4" /><path d="M0,250 C280,110 560,120 860,210 S1380,230 1600,120 V440 H0 Z" fill="#f7931e" /></svg>
    <div className="cid-slide"><span className="cid-slide__eyebrow">Next Wednesday</span><span className="cid-slide__text">Bring a friend next week!</span>
    </div>
    </div>
    </div><p className="cid-fleet__tag" aria-hidden="true">Hallway</p>
    </div>
    <div>
    <div className="cid-tv cid-tv--sm" aria-hidden="true">
    <div className="cid-screen cid-scr cid-scr--night"><span className="cid-blob cid-blob--a"></span><span className="cid-blob cid-blob--b"></span><svg className="cid-wave" viewBox="0 0 1600 440" preserveAspectRatio="none"><path d="M0,200 C260,40 520,60 820,170 S1360,210 1600,70 V440 H0 Z" fill="#ffb81c" opacity=".4" /><path d="M0,250 C280,110 560,120 860,210 S1380,230 1600,120 V440 H0 Z" fill="#f7931e" /></svg>
    <div className="cid-slide"><span className="cid-slide__eyebrow">Next Wednesday</span><span className="cid-slide__text">Bring a friend next week!</span>
    </div>
    </div>
    </div><p className="cid-fleet__tag" aria-hidden="true">Check-in table</p>
    </div>
    </div>
    </div><figcaption className="fam-frame__caption"><b>Fig. 5</b>{' '}One announcement, typed once and published, on every lobby screen.<span className="fam-frame__recreated">Recreated for illustration.</span></figcaption>
    </figure>
    <div className="cid-show__note"><h3>Set up once, then left alone</h3><p>Most of the careful work here is making sure nobody has to babysit a screen. A church sets it up before the first family walks in, and after that it takes care of itself.</p>
    <ul className="fam-pills">
    <li className="fam-pill">One passphrase
    </li>
    <li className="fam-pill">Publish once
    </li>
    <li className="fam-pill">Updates itself
    </li>
    <li className="fam-pill">Rides out Wi-Fi drops
    </li>
    </ul>
    </div>
    </div>
    <div className="cid-show">
    <figure className="fam-frame fam-frame--tv">
    <div className="fam-frame__stage">
    <div className="fam-frame__screen cid-scr cid-scr--night" role="img" aria-label="Recreation of a lobby slide marked Hold check-ins, on a deep-blue evening sky. It reads A note for families, and in big letters, Please check your child out at the desk. No welcome covers it. Instead, a small stepped sticker in the top corner reads Waiting, 3.">
    <div aria-hidden="true"><span className="cid-blob cid-blob--a"></span><span className="cid-blob cid-blob--b"></span><svg className="cid-dz" style={{ left: "6%", top: "12%", width: "7cqi", height: "3.5cqi" }} viewBox="0 0 40 20"><use href="#i-dz-zig" /></svg><svg className="cid-dz" style={{ left: "91.5%", top: "58%", width: "2.4cqi", height: "2.4cqi" }} viewBox="0 0 20 20"><use href="#i-dz-ring" /></svg><svg className="cid-wave" viewBox="0 0 1600 440" preserveAspectRatio="none"><path d="M0,200 C260,40 520,60 820,170 S1360,210 1600,70 V440 H0 Z" fill="#ffb81c" opacity=".4" /><path d="M0,250 C280,110 560,120 860,210 S1380,230 1600,120 V440 H0 Z" fill="#f7931e" /></svg>
    </div>
    <div className="cid-slide" aria-hidden="true"><span className="cid-slide__eyebrow">A note for families</span><span className="cid-slide__text">Please check your child out at the desk</span>
    </div>
    <div className="cid-corner cid-corner--top" aria-hidden="true"><svg className="cid-step" viewBox="-0.04 -0.04 4.086 2.570" style={{ width: "4.086em", height: "2.570em" }}><path className="cid-step__plate" d="M0.575,0 L2.811,0 A0.575,0.575 0 0 1 3.386,0.575 L3.386,1.05 L3.886,1.05 L3.886,2.04 A0.39,0.39 0 0 1 3.496,2.43 L1.11,2.43 A0.27,0.27 0 0 1 0.84,2.16 L0.84,1.15 L0.575,1.15 A0.575,0.575 0 0 1 0,0.575 A0.575,0.575 0 0 1 0.575,0 Z" transform="translate(0.12 0.07)" /><path className="cid-step__line" d="M0.575,0 L2.811,0 A0.575,0.575 0 0 1 3.386,0.575 L3.386,1.05 L3.886,1.05 L3.886,2.04 A0.39,0.39 0 0 1 3.496,2.43 L1.11,2.43 A0.27,0.27 0 0 1 0.84,2.16 L0.84,1.15 L0.575,1.15 A0.575,0.575 0 0 1 0,0.575 A0.575,0.575 0 0 1 0.575,0 Z" /><text x="1.693" y="0.595" fontSize="0.59" textLength="2.546" lengthAdjust="spacingAndGlyphs">WAITING</text><text x="2.363" y="1.770" fontSize="1.06" textLength="0.546" lengthAdjust="spacingAndGlyphs">3</text></svg>
    </div>
    </div>
    </div><figcaption className="fam-frame__caption"><b>Fig. 6</b>{' '}A slide marked “Hold check-ins” gets the room to itself. Three children have arrived meanwhile; the sticker counts them, and each gets a full welcome as soon as the slide moves on.<span className="fam-frame__recreated">Recreated for illustration. The slide’s wording is an example.</span></figcaption>
    </figure>
    <div className="cid-show__note"><h3>Announcements and welcomes take turns</h3><p>A slide the room needs to read can be marked “Hold check-ins.” While it is up, arriving names wait behind a small “Waiting” count instead of covering it, then each child gets their full welcome on the next slide. The fall event promos and the winter snow-alerts slide always hold the line this way.</p><p>It works the other way too. While names are on screen the slideshow pauses, keeping the time a slide has already had, so a rush never skips or restarts one. A sweeping wave carries the lobby into and out of each held slide.</p><span className="fam-card__tag">Opt-in, slide by slide</span>
    </div>
    </div>
    <ul className="fam-cards">
    <li className="fam-card"><span className="fam-card__icon"><svg aria-hidden="true"><use href="#i-key" /></svg></span><h3 className="fam-card__title">One passphrase logs in every screen</h3><p className="fam-card__body">A new or replacement TV needs only the church’s passphrase, typed once. The screen receives its keys and starts following whatever has been published.</p><span className="fam-card__tag">Opt-in</span>
    <details className="fam-hood"><summary><svg className="fam-hood__chev" aria-hidden="true"><use href="#i-chev" /></svg>Peek under the hood<span className="fam-sr">: One passphrase logs in every screen</span></summary>
    <div className="fam-hood__body">The passphrase derives a key (<code>PBKDF2-SHA256</code>, 600,000 rounds) that opens a sealed setup message from the printer app, which must be running while a screen logs in. The keys it delivers live apart from Settings, so they never leave in a settings export.
    </div>
    </details>
    </li>
    <li className="fam-card"><span className="fam-card__icon"><svg aria-hidden="true"><use href="#i-screens" /></svg></span><h3 className="fam-card__title">One slide deck, every screen</h3><p className="fam-card__body">Type an announcement once at the check-in computer and press Publish. Every lobby display shows it, and a screen that was switched off catches up within a few minutes of coming back, as long as the printer app is running.</p><p className="cid-setup">Set up once at the check-in computer</p>
    <details className="fam-hood"><summary><svg className="fam-hood__chev" aria-hidden="true"><use href="#i-chev" /></svg>Peek under the hood<span className="fam-sr">: One slide deck, every screen</span></summary>
    <div className="fam-hood__body">Once the church sets its display key, the deck travels sealed and reaches every screen that holds it. It arrives in ordered pieces, and each screen keeps the last one it received, so a reboot on club night shows it at once. A slide’s “Hold check-ins” mark travels with it (from Club Label Printer 6.16). Only typed slides travel; uploaded videos stay on their own device. Any screen can opt out and keep its own slides.
    </div>
    </details>
    </li>
    <li className="fam-card"><span className="fam-card__icon"><svg aria-hidden="true"><use href="#i-refresh" /></svg></span><h3 className="fam-card__title">Updates arrive on their own</h3><p className="fam-card__body">New versions install themselves within a few minutes, but never in the middle of a welcome, a celebration, or while someone is typing in Settings.</p>
    <div className="fam-card__demo" aria-hidden="true">
    <ol className="cid-demo-steps">
    <li><span><b>New version found</b></span>
    </li>
    <li><span>Waiting for Ava’s welcome to finish</span>
    </li>
    <li><span><b>Updated</b>{' '}while the room was quiet</span>
    </li>
    </ol>
    </div>
    <details className="fam-hood"><summary><svg className="fam-hood__chev" aria-hidden="true"><use href="#i-chev" /></svg>Peek under the hood<span className="fam-sr">: Updates arrive on their own</span></summary>
    <div className="fam-hood__body">Every 3 minutes a screen asks which build is current. It reloads only once the new page is really being served (so it can’t loop on an old copy), and only when no welcome, celebration, pick-up board or open panel is on screen and nobody is typing. A busy screen asks again every 15 seconds, for as long as it takes; there is no deadline that could interrupt a check-in rush.
    </div>
    </details>
    </li>
    <li className="fam-card"><span className="fam-card__icon"><svg aria-hidden="true"><use href="#i-wifi" /></svg></span><h3 className="fam-card__title">Steady through a shaky connection</h3><p className="fam-card__body">If the Wi-Fi drops, the screen keeps its clock, slides and schedule. When it reconnects, children who arrived during the gap get a quieter “Also joined us tonight” welcome.</p>
    <details className="fam-hood"><summary><svg className="fam-hood__chev" aria-hidden="true"><use href="#i-chev" /></svg>Peek under the hood<span className="fam-sr">: Steady through a shaky connection</span></summary>
    <div className="fam-hood__body">A small offline cache keeps the page itself available. The check-in desk regularly re-sends recent arrivals; the screen replays the ones from the last 20 minutes it hasn’t already shown, matched one by one, so nobody is greeted twice.
    </div>
    </details>
    </li>
    <li className="fam-card"><span className="fam-card__icon"><svg aria-hidden="true"><use href="#i-talk" /></svg></span><h3 className="fam-card__title">Honest when something is off</h3><p className="fam-card__body">When Club Label Printer runs a practice night, the screen wears a rehearsal watermark, so a test check-in is never mistaken for a real arrival. If names stop arriving, the screen says why in plain words instead of going silently still.</p>
    <div className="fam-card__demo" aria-hidden="true"><span className="cid-demo-pill">rehearsal — practice run, not real check-ins</span><br /><span className="cid-demo-pill cid-demo-pill--fault">Counts rising, no names — check the printer</span>
    </div>
    <details className="fam-hood"><summary><svg className="fam-hood__chev" aria-hidden="true"><use href="#i-chev" /></svg>Peek under the hood<span className="fam-sr">: Honest when something is off</span></summary>
    <div className="fam-hood__body">Counts and status messages travel unsealed on purpose. That is what lets a screen tell “the connection is down” from “I can’t read names” from “it’s just a quiet night.” A problem sticker shows whenever there is one, whatever slide is up. A test welcome fired from Settings wears a demo badge and never changes the evening’s count.
    </div>
    </details>
    </li>
    <li className="fam-card"><span className="fam-card__icon"><svg aria-hidden="true"><use href="#i-chip" /></svg></span><h3 className="fam-card__title">Gentle on the smallest screen</h3><p className="fam-card__body">Most of the day, Journey Display’s kiosk shows this display on a small Raspberry Pi computer. It opens it in a low-power mode with no confetti and no animation at all, so it stays smooth. Every other screen keeps its full celebrations.</p>
    <details className="fam-hood"><summary><svg className="fam-hood__chev" aria-hidden="true"><use href="#i-chev" /></svg>Peek under the hood<span className="fam-sr">: Gentle on the smallest screen</span></summary>
    <div className="fam-hood__body"><code>?lowPower=1</code>{' '}in that one embed’s address turns confetti off and freezes every animation, whatever the device’s saved settings say. Every animated part of the display goes through one shared helper, and every animation ends on its finished frame, so the frozen screen still shows the whole welcome, and anything added later is covered too.
    </div>
    </details>
    </li>
    </ul>
    </div>
    </section>
    <section className="fam-chapter" id="safe" aria-labelledby="safe-title">
    <div className="fam-wrap">
    <div className="fam-chapter__head">
    <div>
    <div className="fam-chapter__num" aria-hidden="true">04
    </div><p className="fam-kicker">Chapter four</p><h2 className="fam-chapter__title" id="safe-title">Safe by design</h2>
    </div>
    <div><p className="fam-standfirst">A screen in a room full of children has to be careful with what it knows. This one is built to know very little.</p><p className="fam-chapter__intro">It starts from the assumption that anything arriving could be watched by a stranger. So it checks every message before showing it, and once the church sets its display key, children’s names travel sealed.</p>
    </div>
    </div>
    <div className="cid-promises">
    <aside className="fam-safeguard" aria-labelledby="promises-title">
    <div className="fam-safeguard__head"><svg aria-hidden="true"><use href="#i-shield" /></svg><h3 className="fam-safeguard__title" id="promises-title">The promises behind every screen</h3>
    </div>
    <ul className="fam-safeguard__list">
    <li><span className="fam-safeguard__check"><svg aria-hidden="true"><use href="#i-check" /></svg></span>
    <div><b>First names only, through a strict allowlist</b><span>Each kind of message is cut down to its approved fields before anything else sees it. Last names, allergies, contact details, birth years and photos can’t get through, even if they are sent.</span>
    </div>
    </li>
    <li><span className="fam-safeguard__check"><svg aria-hidden="true"><use href="#i-check" /></svg></span>
    <div><b>Names are sealed on the way</b><span>Once the church sets its display key, check-ins, birthdays, the pick-up list, the lobby slide deck and the screens’ shared settings are encrypted before they leave the check-in computer.</span>
    </div>
    </li>
    <li><span className="fam-safeguard__check"><svg aria-hidden="true"><use href="#i-check" /></svg></span>
    <div><b>No quiet downgrade</b><span>A screen that holds the key refuses an unsealed copy of those messages, so the protection can’t be switched off from outside.</span>
    </div>
    </li>
    <li><span className="fam-safeguard__check"><svg aria-hidden="true"><use href="#i-check" /></svg></span>
    <div><b>The key stays out of settings files</b><span>It lives in its own storage, so it is never included in a settings export and can’t be slipped in through a shared settings file.</span>
    </div>
    </li>
    <li><span className="fam-safeguard__check"><svg aria-hidden="true"><use href="#i-check" /></svg></span>
    <div><b>No age on screen</b><span>A birthday arrives as a yes-or-no flag, and this week’s birthday list carries only the month and day. No birth year ever reaches the display.</span>
    </div>
    </li>
    <li><span className="fam-safeguard__check"><svg aria-hidden="true"><use href="#i-check" /></svg></span>
    <div><b>Checked before every update</b><span>Each change must pass lint, a type check, the tests, a build and a browser smoke test before it can reach a screen. The tests include messages stuffed with extra personal details, which must come out clean, and every pick-up board rule, case by case. If one fails, the working version stays live.</span>
    </div>
    </li>
    </ul>
    </aside>
    </div>
    <ul className="fam-cards cid-limits">
    <li className="fam-card"><span className="fam-card__icon"><svg aria-hidden="true"><use href="#i-eye" /></svg></span><h3 className="fam-card__title">Plain about the limits</h3><p className="fam-card__body">Encryption hides{' '}<em>who</em>{' '}arrived, not{' '}<em>that</em>{' '}someone did. Someone with the public connection details could still see when messages are sent and how many, and the project’s security notes say so plainly.</p>
    <details className="fam-hood"><summary><svg className="fam-hood__chev" aria-hidden="true"><use href="#i-chev" /></svg>Peek under the hood<span className="fam-sr">: Plain about the limits</span></summary>
    <div className="fam-hood__body">Sealed messages use{' '}<code>AES-256-GCM</code>, with every check-in padded to the same length so a message’s size can’t hint at a name, and the screen and the printer app are pinned to one shared test file so the two sides can’t drift apart. Channel and event names stay readable so the service can deliver them. Counts, the schedule and notices are unsealed on purpose, since none of them names a child. There is no forward secrecy, so the notes advise changing the key between program years.
    </div>
    </details>
    </li>
    </ul>
    <section className="cid-sub" aria-labelledby="board-title">
    <div className="cid-sub__head">
    <div><p className="fam-kicker">The pick-up board</p><h3 className="cid-sub__title" id="board-title">A list that protects the children on it</h3>
    </div>
    <div><p className="cid-sub__text">At pickup time a strip along the bottom of the lobby screen lists which children haven’t been checked out yet, each club’s names after its own plate, so a parent or volunteer can see at a glance whose pickup hasn’t been recorded. The slides and announcements above it carry on as normal.</p><p className="cid-sub__text">It comes on by itself from 7:30 pm on club nights (which clubs are on the list is set on the check-in laptop’s dashboard), says “Ava has checked out” there for a few seconds as each child leaves the list, and says so once everyone has been checked out. While it lists names, the corner counter can count down as children are checked out. It is most careful at exactly the moment that matters: when only a few children are left.</p>
    </div>
    </div>
    <div className="cid-pair">
    <figure className="fam-frame fam-frame--tv">
    <div className="fam-frame__stage">
    <div className="fam-frame__screen cid-scr" role="img" aria-label="Recreation of the lobby TV at pickup time: the slide above still reads This week, Bring a friend next week! Along the bottom, a white strip titled Still to be picked up lists each club's names after its plate: Cubbies, 2 waiting: Ava and Leo. Sparks, 3 waiting: Eli, Micah and Nora. T and T, 2 waiting: Grace and Noah. A stepped sticker in the corner shows the time, Right now, 8:05.">
    <div aria-hidden="true"><span className="cid-blob cid-blob--a"></span><span className="cid-blob cid-blob--b"></span><svg className="cid-dz" style={{ left: "6%", top: "14%", width: "7cqi", height: "3.5cqi" }} viewBox="0 0 40 20"><use href="#i-dz-arc" /></svg><svg className="cid-dz" style={{ left: "84%", top: "24%", width: "7cqi", height: "3.5cqi" }} viewBox="0 0 40 20"><use href="#i-dz-zig" /></svg><svg className="cid-wave" viewBox="0 0 1600 440" preserveAspectRatio="none"><path d="M0,200 C260,40 520,60 820,170 S1360,210 1600,70 V440 H0 Z" fill="#ffb81c" opacity=".4" /><path d="M0,250 C280,110 560,120 860,210 S1380,230 1600,120 V440 H0 Z" fill="#f7931e" /></svg>
    </div>
    <div className="cid-corner cid-corner--bottom" aria-hidden="true"><svg className="cid-step" viewBox="-0.04 -0.04 4.913 2.570" style={{ width: "4.913em", height: "2.570em" }}><path className="cid-step__plate" d="M0.575,0 L3.638,0 A0.575,0.575 0 0 1 4.213,0.575 L4.213,1.05 L4.713,1.05 L4.713,2.04 A0.39,0.39 0 0 1 4.323,2.43 L1.11,2.43 A0.27,0.27 0 0 1 0.84,2.16 L0.84,1.15 L0.575,1.15 A0.575,0.575 0 0 1 0,0.575 A0.575,0.575 0 0 1 0.575,0 Z" transform="translate(0.12 0.07)" /><path className="cid-step__line" d="M0.575,0 L3.638,0 A0.575,0.575 0 0 1 4.213,0.575 L4.213,1.05 L4.713,1.05 L4.713,2.04 A0.39,0.39 0 0 1 4.323,2.43 L1.11,2.43 A0.27,0.27 0 0 1 0.84,2.16 L0.84,1.15 L0.575,1.15 A0.575,0.575 0 0 1 0,0.575 A0.575,0.575 0 0 1 0.575,0 Z" /><text x="2.107" y="0.595" fontSize="0.59" textLength="3.373" lengthAdjust="spacingAndGlyphs">RIGHT NOW</text><text x="2.777" y="1.770" fontSize="1.06" textLength="2.238" lengthAdjust="spacingAndGlyphs">8:05</text></svg>
    </div>
    <div className="cid-slide" aria-hidden="true" style={{ bottom: "30%" }}><span className="cid-slide__eyebrow">This week</span><span className="cid-slide__text">Bring a friend next week!</span>
    </div>
    <div className="cid-board cid-board--strip" aria-hidden="true"><span className="cid-board__tab">Still to be picked up</span>
    <ul className="cid-board__run">
    <li style={{ "--club": "#2F4F8A" }}><span className="cid-board__plate"><span className="cid-board__club">Cubbies</span><span className="cid-board__count">2 waiting</span></span><span className="cid-board__name">Ava</span><span className="cid-board__name">Leo</span>
    </li>
    <li style={{ "--club": "#B82B32" }}><span className="cid-board__plate"><span className="cid-board__club">Sparks</span><span className="cid-board__count">3 waiting</span></span><span className="cid-board__name">Eli</span><span className="cid-board__name">Micah</span><span className="cid-board__name">Nora</span>
    </li>
    <li style={{ "--club": "#2F7A47" }}><span className="cid-board__plate"><span className="cid-board__club">T&amp;T</span><span className="cid-board__count">2 waiting</span></span><span className="cid-board__name">Grace</span><span className="cid-board__name">Noah</span>
    </li>
    </ul>
    </div>
    </div>
    </div><figcaption className="fam-frame__caption"><b>Fig. 7</b>{' '}With plenty of children still waiting, first names stand after their club’s plate along the bottom of the screen, and the slide carries on above.<span className="fam-frame__recreated">Recreated for illustration. Names are examples.</span></figcaption>
    </figure>
    <figure className="fam-frame fam-frame--tv">
    <div className="fam-frame__stage">
    <div className="fam-frame__screen cid-scr" role="img" aria-label="Recreation of the same board once three or fewer children are left. Along the bottom of the screen, a one-line white card titled Still to be picked up shows no names and no number, only: Almost everyone has been picked up. Please see the check-in desk. The corner sticker shows Right now, 8:05.">
    <div aria-hidden="true"><span className="cid-blob cid-blob--a"></span><span className="cid-blob cid-blob--b"></span><svg className="cid-dz" style={{ left: "6%", top: "14%", width: "7cqi", height: "3.5cqi" }} viewBox="0 0 40 20"><use href="#i-dz-arc" /></svg><svg className="cid-dz" style={{ left: "84%", top: "24%", width: "7cqi", height: "3.5cqi" }} viewBox="0 0 40 20"><use href="#i-dz-zig" /></svg><svg className="cid-wave" viewBox="0 0 1600 440" preserveAspectRatio="none"><path d="M0,200 C260,40 520,60 820,170 S1360,210 1600,70 V440 H0 Z" fill="#ffb81c" opacity=".4" /><path d="M0,250 C280,110 560,120 860,210 S1380,230 1600,120 V440 H0 Z" fill="#f7931e" /></svg>
    </div>
    <div className="cid-corner cid-corner--bottom" aria-hidden="true"><svg className="cid-step" viewBox="-0.04 -0.04 4.913 2.570" style={{ width: "4.913em", height: "2.570em" }}><path className="cid-step__plate" d="M0.575,0 L3.638,0 A0.575,0.575 0 0 1 4.213,0.575 L4.213,1.05 L4.713,1.05 L4.713,2.04 A0.39,0.39 0 0 1 4.323,2.43 L1.11,2.43 A0.27,0.27 0 0 1 0.84,2.16 L0.84,1.15 L0.575,1.15 A0.575,0.575 0 0 1 0,0.575 A0.575,0.575 0 0 1 0.575,0 Z" transform="translate(0.12 0.07)" /><path className="cid-step__line" d="M0.575,0 L3.638,0 A0.575,0.575 0 0 1 4.213,0.575 L4.213,1.05 L4.713,1.05 L4.713,2.04 A0.39,0.39 0 0 1 4.323,2.43 L1.11,2.43 A0.27,0.27 0 0 1 0.84,2.16 L0.84,1.15 L0.575,1.15 A0.575,0.575 0 0 1 0,0.575 A0.575,0.575 0 0 1 0.575,0 Z" /><text x="2.107" y="0.595" fontSize="0.59" textLength="3.373" lengthAdjust="spacingAndGlyphs">RIGHT NOW</text><text x="2.777" y="1.770" fontSize="1.06" textLength="2.238" lengthAdjust="spacingAndGlyphs">8:05</text></svg>
    </div>
    <div className="cid-board cid-board--line" aria-hidden="true"><span className="cid-board__tab">Still to be picked up</span><p className="cid-board__line">Almost everyone has been picked up. Please see the check-in desk.</p>
    </div>
    </div>
    </div><figcaption className="fam-frame__caption"><b>Fig. 8</b>{' '}Once three or fewer are left (the default), the board names no one and gives no number.<span className="fam-frame__recreated">Recreated for illustration.</span></figcaption>
    </figure>
    </div>
    <aside className="fam-safeguard" aria-labelledby="sg-board">
    <div className="fam-safeguard__head"><svg aria-hidden="true"><use href="#i-shield" /></svg><h4 className="fam-safeguard__title" id="sg-board">How the pick-up board is kept safe</h4>
    </div>
    <ul className="fam-safeguard__list">
    <li><span className="fam-safeguard__check"><svg aria-hidden="true"><use href="#i-check" /></svg></span>
    <div><b>Only at pickup time</b><span>It comes on by itself from 7:30 pm on club nights, never while children are arriving, and the check-in laptop’s dashboard decides which clubs are on it. With no pick-up information yet, it shows nothing at all.</span>
    </div>
    </li>
    <li><span className="fam-safeguard__check"><svg aria-hidden="true"><use href="#i-check" /></svg></span>
    <div><b>Stops naming anyone when only a few are left</b><span>At three children or fewer by default, it names no one, gives no number (the corner counter stops counting too), says “a child has checked out” rather than a name, and points people to the check-in desk. Two names late in the evening would single out two specific children.</span>
    </div>
    </li>
    <li><span className="fam-safeguard__check"><svg aria-hidden="true"><use href="#i-check" /></svg></span>
    <div><b>First names only, always</b><span>A first name under each club, and nothing else. No last names, allergies or contact details ever reach a screen.</span>
    </div>
    </li>
    <li><span className="fam-safeguard__check"><svg aria-hidden="true"><use href="#i-check" /></svg></span>
    <div><b>“Not checked out yet,” never “still in the building”</b><span>It shows what volunteers recorded at the desk, not a headcount, and every line says so. If the list stops updating, the board says that too.</span>
    </div>
    </li>
    </ul>
    </aside>
    </section>
    </div>
    </section>
    <section className="cid-also-wrap" aria-labelledby="lobby-also-title">
    <div className="fam-wrap">
    <div className="fam-also"><h2 className="fam-also__title" id="lobby-also-title">Smaller things worth knowing</h2>
    <ul className="fam-also__list">
    <li><b>One thing in the corner at a time:</b>{' '}the time, tonight’s count or the weather (from a free service, refreshed every 15 minutes, no account needed), changing only when a new slide loads and stepping aside for a slide that holds check-ins
    </li>
    <li><b>A “Doors are open” moment</b>{' '}for the first child checked in each night
    </li>
    <li><b>Seasonal looks</b>{' '}such as autumn, Christmas, snow day, Easter and VBS, picked by hand or chosen from the church calendar
    </li>
    <li><b>Animated promos</b>{' '}for the church’s own fall events, 15 seconds each and ending on a finished poster, counting down the club nights to each one and retiring themselves the morning after
    </li>
    <li><b>A snow-alerts slide</b>{' '}from November to March: a QR code for the church’s cancellation texts, held still long enough to scan, shown about once in six passes and every other pass when snow is forecast for club night, saying which night
    </li>
    <li><b>The church’s own PowerPoint,</b>{' '}uploaded and played right on the screen, or a looping video behind the welcomes
    </li>
    <li><b>Simplified mode:</b>{' '}one keyboard shortcut strips the screen to its reliable core mid-club, and welcomes keep working
    </li>
    <li><b>Overlay mode</b>{' '}for streaming software: welcomes and confetti over a live video feed
    </li>
    <li><b>A club-color wash</b>{' '}across the whole screen during a welcome, off by default
    </li>
    <li><b>A chime with each welcome,</b>{' '}off until a church turns it on
    </li>
    <li><b>Keeps the TV awake</b>{' '}during club, and a double-click makes it full screen
    </li>
    <li><b>The projector hands itself back:</b>{' '}after a leader jumps to another screen, it returns to the schedule unless they tap Stay
    </li>
    <li><b>A low-power switch</b>{' '}on the projector for an older laptop, off unless chosen or the computer asks for reduced motion
    </li>
    <li><b>Holiday weeks</b>{' '}can be marked as no club right on the projector
    </li>
    <li><b>A running tally</b>{' '}of books finished, awards earned and friends brought tonight, from the check-in desk’s own report
    </li>
    </ul>
    </div>
    </div>
    </section>
  </section>
);
