import React from 'react';

/**
 * The Journey kiosk (was journey/public/about.html). The page's licensing
 * wording is strict (journey/CLAUDE.md, "Licensing boundary"): it never links
 * to, names or advertises a lesson video, transcript, handout or slide image.
 * Screens are placeholder recreations, drawn fresh (styles/journey.css, "jd-").
 * Generated once from the static page; edit it here now.
 */
export const JourneySection: React.FC = () => (
  <section id="journey" className="lbl-product jd-page" data-accent="journey" aria-labelledby="journey-hero-title">
    <section className="fam-hero" aria-labelledby="journey-hero-title">
    <div className="fam-wrap fam-hero__inner">
    <div><p className="fam-kicker">For large group</p><h2 className="fam-hero__title" id="journey-hero-title">The lesson,{' '}<em>ready when the room&nbsp;is.</em></h2><p className="fam-hero__lede">Most of the day, a small kiosk screen shows the church’s Check-in Display. At 6:30 it turns to the week’s Journey: Advocates lesson and waits for a leader to begin, with captions, teaching slides and leader prep ready alongside it.</p>
    <div className="fam-actions"><a className="fam-btn" href="#journey-ch1">See how it works<svg aria-hidden="true"><use href="#i-arrow" /></svg></a>{' '}<a className="fam-btn fam-btn--ghost" href="#family">The whole club night</a>
    </div>
    <ul className="fam-hero__facts">
    <li><svg aria-hidden="true"><use href="#i-check" /></svg>Built for a 2017 Raspberry Pi Zero
    </li>
    <li><svg aria-hidden="true"><use href="#i-check" /></svg>Doubtful caption lines checked against the audio
    </li>
    <li><svg aria-hidden="true"><use href="#i-check" /></svg>Made at Kennebec Valley Baptist Church
    </li>
    </ul>
    </div>
    <figure className="fam-frame fam-frame--tv">
    <div className="fam-frame__stage">
    <div className="fam-frame__screen jd-ink" role="img" aria-label="Recreation of the 6:30 start screen on a TV: on a deep indigo field with a purple wave along the bottom edge and a purple tab in the top-left corner reading Large Group Time, the word Journey in large white type with Advocates under it in widely spaced pale-lavender capitals, then Week 7 and a placeholder lesson title in big white capitals, an orange Begin Video button with a play triangle, a quieter outlined Skip to slides button, and, on screens with a keyboard, a hint line: press Space or right arrow to begin, Shift plus right arrow for slides, S for settings.">
    <div className="jd-splash"><svg className="jd-art jd-wave" viewBox="0 0 1600 240" preserveAspectRatio="none" aria-hidden="true"><path d="M0,40 C220,22 520,20 820,34 C1100,46 1380,76 1600,86 V240 H0 Z" fill="#56467f" /><path d="M0,172 C260,152 520,140 800,120 C1080,100 1340,52 1600,58 V240 H0 Z" fill="#8a649d" /></svg><svg className="jd-art jd-doodles" viewBox="0 0 96 86" style={{ color: "#fff" }} fill="none" stroke="#fff" strokeLinecap="round" aria-hidden="true"><use href="#i-spark" x="0" y="14" width="24" height="24" stroke="none" /><circle cx="72" cy="6" r="4" fill="#fff" stroke="none" /><path d="M64,14 C74,20 60,30 70,40 S84,52 78,64 S86,76 88,82" strokeWidth="1.6" /></svg><svg className="jd-art jd-doodles jd-doodles--left" viewBox="0 0 48 52" style={{ color: "#fff" }} fill="none" stroke="#fff" strokeLinecap="round" aria-hidden="true"><use href="#i-spark" x="24" y="4" width="20" height="20" transform="rotate(45 34 14)" stroke="none" /><circle cx="10" cy="44" r="4.5" strokeWidth="1.4" /></svg>
    <div className="jd-splash__banner"><svg viewBox="0 0 228 148" preserveAspectRatio="none" aria-hidden="true"><path d="M0,0 H228 C222,22 210,36 196,50 C182,64 172,82 154,96 C136,110 110,104 88,110 C66,116 50,140 26,146 C16,148 8,147 0,144 Z" fill="#8a649d" /></svg><span>Large Group Time</span>
    </div>
    <div className="jd-splash__mark"><span className="jd-splash__journey">Journey</span><span className="jd-splash__advocates">Advocates</span>
    </div>
    <div className="jd-splash__lesson"><span className="jd-splash__week">Week 7</span><span className="jd-splash__title">Lesson</span>
    </div>
    <div className="jd-splash__actions"><span className="jd-kbtn"><span className="jd-kbtn__play" aria-hidden="true">▶</span>Begin Video</span>{' '}<span className="jd-kbtn jd-kbtn--line">Skip to slides</span>
    </div><p className="jd-splash__hint">or press{' '}<kbd>Space</kbd>{' '}/{' '}<kbd>→</kbd>{' '}begin ·{' '}<kbd>Shift</kbd>+<kbd>→</kbd>{' '}slides ·{' '}<kbd>S</kbd>{' '}settings</p>
    </div>
    </div>
    </div><figcaption className="fam-frame__caption"><b>Fig. 1</b>{' '}At 6:30 the screen names the week and waits. Nothing plays until a leader presses Begin.<span className="fam-frame__recreated">Recreated for illustration. The week and lesson title are placeholders, and the Journey wordmark is set here as plain text.</span></figcaption>
    </figure>
    </div>
    </section>
    <section className="fam-stats" aria-label="At a glance">
    <div className="fam-wrap">
    <ul className="fam-stats__list">
    <li className="fam-stat">
    <div className="fam-stat__num">32<span className="fam-stat__unit">lessons</span>
    </div><p className="fam-stat__label">in the Journey: Advocates course, one each week, any of them ready to preview.</p>
    </li>
    <li className="fam-stat">
    <div className="fam-stat__num">512<span className="fam-stat__unit">MB</span>
    </div><p className="fam-stat__label">of memory on the single-core 2017 Raspberry Pi Zero it was built for.</p>
    </li>
    <li className="fam-stat">
    <div className="fam-stat__num">6:30<span className="fam-stat__unit">pm</span>
    </div><p className="fam-stat__label">the lesson’s start screen appears on its own, then waits for a leader.</p>
    </li>
    <li className="fam-stat">
    <div className="fam-stat__num">63<span className="fam-stat__unit">videos</span>
    </div><p className="fam-stat__label">with captions: every Student Video and Leader Video in the course.</p>
    </li>
    </ul>
    </div>
    </section>
    <div className="fam-wrap">
    <nav aria-label="Chapters" style={{ marginTop: "clamp(2.5rem,5vw,4rem)" }}>
    <ol className="fam-chapters">
    <li><a href="#journey-ch1"><b>01</b>Runs the room, then steps aside</a>
    </li>
    <li><a href="#journey-ch2"><b>02</b>Built so the lesson lands</a>
    </li>
    <li><a href="#journey-ch3"><b>03</b>Prep made for a leader</a>
    </li>
    <li><a href="#journey-ch4"><b>04</b>Keeps working when the Wi-Fi doesn’t</a>
    </li>
    </ol>
    </nav>
    </div>
    <section className="fam-chapter" id="journey-ch1" aria-labelledby="journey-ch1-title">
    <div className="fam-wrap">
    <div className="fam-chapter__head">
    <div>
    <div className="fam-chapter__num" aria-hidden="true">01
    </div><p className="fam-kicker">Chapter one</p><h2 className="fam-chapter__title" id="journey-ch1-title">Runs the room, then steps aside</h2>
    </div>
    <div><p className="fam-standfirst">Most of the evening it simply shows the church’s Check-in Display. At the right moment it becomes the lesson, and then it hands the room back.</p><p className="fam-chapter__intro">No one has to remember to switch it over or update it. The kiosk keeps its own schedule, waits for a leader to press Begin, and never interrupts something the room is watching.</p>
    </div>
    </div>
    <figure className="jd-figure">
    <div className="jd-day">
    <div className="jd-day__strip" aria-hidden="true">
    <div className="jd-day__seg jd-day__seg--checkin" data-accent="checkin" data-short="Check-in"><span>Check-in Display</span>
    </div>
    <div className="jd-day__seg jd-day__seg--journey" data-short="Lesson"><span>Journey window</span>
    </div>
    <div className="jd-day__seg jd-day__seg--checkin" data-accent="checkin">
    </div>
    </div>
    <div className="jd-day__ticks" aria-hidden="true"><span style={{ left: "0" }}>6:00</span>{' '}<span style={{ left: "33.33%" }}>6:30</span>{' '}<span className="jd-day__tick--mid" style={{ left: "66.67%" }}>7:00</span>{' '}<span style={{ left: "83.33%" }}>7:15</span>{' '}<span className="jd-day__tick--end" style={{ left: "100%" }}>7:30</span>
    </div>
    <ol className="jd-day__steps">
    <li className="jd-day__step" data-accent="checkin"><span className="jd-day__when">All day</span><span className="jd-day__what">The Check-in Display</span><span className="jd-day__note">Live, welcoming children by first name.</span>
    </li>
    <li className="jd-day__step"><span className="jd-day__when">6:30 pm</span><span className="jd-day__what">Large Group Time</span><span className="jd-day__note">A calm start screen names the week and waits for a leader.</span>
    </li>
    <li className="jd-day__step"><span className="jd-day__when">Begin</span><span className="jd-day__what">The lesson video</span><span className="jd-day__note">With captions, if this screen was asked for them.</span>
    </li>
    <li className="jd-day__step"><span className="jd-day__when">Video ends</span><span className="jd-day__what">Teaching slides</span><span className="jd-day__note">A leader steps through them, then taps Finish.</span>
    </li>
    <li className="jd-day__step" data-accent="checkin"><span className="jd-day__when">Finish or 7:15</span><span className="jd-day__what">Back to{' '}<span className="jd-nowrap">check-in</span></span><span className="jd-day__note">Straight back to the Check-in Display, whichever comes first.</span>
    </li>
    </ol>
    </div><figcaption className="fam-frame__caption"><b>Fig. 2</b>{' '}One evening on the kiosk. The schedule comes from the kiosk’s own clock, every day of the week.<span className="fam-frame__recreated">Drawn for illustration.</span></figcaption>
    </figure>
    <ul className="fam-cards fam-cards--2">
    <li className="fam-card"><span className="fam-card__icon"><svg aria-hidden="true"><use href="#i-clock" /></svg></span><h3 className="fam-card__title">One screen, two jobs, no clock-watching</h3><p className="fam-card__body">It shows check-in until 6:30, turns to the lesson on its own, and goes back at 7:15. A leader can still switch it by hand at any time with one corner button.</p>
    <details className="fam-hood"><summary><svg className="fam-hood__chev" aria-hidden="true"><use href="#i-chev" /></svg>Peek under the hood<span className="fam-sr">: One screen, two jobs, no clock-watching</span></summary>
    <div className="fam-hood__body">The Pi’s own clock sets the switch (<code>18:30</code>{' '}and{' '}<code>19:15</code>). A check every 15 seconds only acts at those two moments, so a leader’s manual switch in between is never fought, and a reboot mid-evening comes back on the right screen.
    </div>
    </details>
    </li>
    <li className="fam-card"><span className="fam-card__icon"><svg aria-hidden="true"><use href="#i-play" /></svg></span><h3 className="fam-card__title">A start screen, not a surprise</h3><p className="fam-card__body">Instead of a video suddenly starting at 6:30, the room sees a title card with the week and the lesson. The video begins when a leader presses Begin Video, the space bar or the right arrow.</p>
    <details className="fam-hood"><summary><svg className="fam-hood__chev" aria-hidden="true"><use href="#i-chev" /></svg>Peek under the hood<span className="fam-sr">: A start screen, not a surprise</span></summary>
    <div className="fam-hood__body">That press is also the browser’s permission to play sound, so the lesson starts unmuted. The video is lined up in the background the whole time; only playback waits.
    </div>
    </details>
    </li>
    <li className="fam-card"><span className="fam-card__icon"><svg aria-hidden="true"><use href="#i-resume" /></svg></span><h3 className="fam-card__title">Picks up where the lesson stopped</h3><p className="fam-card__body">If a showing is cut short (a power cut, a reboot, a switch back to check-in), the start screen offers to resume where it left off, to within a few seconds, or to start over.</p>
    <div className="fam-card__demo jd-demo-splash" aria-hidden="true"><span className="jd-kbtn"><span className="jd-kbtn__play" aria-hidden="true">▶</span>Resume at 3:42</span>{' '}<span className="jd-kbtn jd-kbtn--soft">Start over</span>
    </div>
    <details className="fam-hood"><summary><svg className="fam-hood__chev" aria-hidden="true"><use href="#i-chev" /></svg>Peek under the hood<span className="fam-sr">: Picks up where the lesson stopped</span></summary>
    <div className="fam-hood__body">About every 5 seconds the kiosk notes its place on the device. The offer appears only for the same week’s lesson, at least 30 seconds in, more than 10 seconds from the end, and less than four hours old. Otherwise it is plain Begin Video, because resuming the wrong video would be worse than starting over.
    </div>
    </details>
    </li>
    <li className="fam-card"><span className="fam-card__icon"><svg aria-hidden="true"><use href="#i-refresh" /></svg></span><h3 className="fam-card__title">Updates itself, never mid-lesson</h3><p className="fam-card__body">When an improvement ships, the kiosk notices within a few minutes and reloads onto it by itself, with no one walking over to it. It never does this while a lesson, the slides or the settings are on screen.</p>
    <details className="fam-hood"><summary><svg className="fam-hood__chev" aria-hidden="true"><use href="#i-chev" /></svg>Peek under the hood<span className="fam-sr">: Updates itself, never mid-lesson</span></summary>
    <div className="fam-hood__body">Every 3 minutes it compares its own build with the site’s, and it checks that the new page is really being served before reloading, so it never lands back on the old one. A busy kiosk asks again every 15 seconds, with no deadline: an evening that never goes quiet simply updates tomorrow.
    </div>
    </details>
    </li>
    </ul>
    </div>
    </section>
    <section className="fam-chapter" id="journey-ch2" aria-labelledby="journey-ch2-title">
    <div className="fam-wrap">
    <div className="fam-chapter__head">
    <div>
    <div className="fam-chapter__num" aria-hidden="true">02
    </div><p className="fam-kicker">Chapter two</p><h2 className="fam-chapter__title" id="journey-ch2-title">Built so the lesson lands</h2>
    </div>
    <div><p className="fam-standfirst">The video is the easy part. The care is in making sure every student in the room can follow it.</p><p className="fam-chapter__intro">Captions a whole room can read, the teaching slides straight after, and small controls that keep a leader in charge of the pace.</p>
    </div>
    </div>
    <div className="jd-figs">
    <figure className="fam-frame fam-frame--tv">
    <div className="fam-frame__stage">
    <div className="fam-frame__screen jd-black" role="img" aria-label="Recreation of a lesson playing with captions on. The video area holds only soft, out-of-focus light. Near the bottom, a caption in white type on a translucent dark band reads: and that is a question worth asking out loud. Below it, a rounded control bar holds Back 15s, Pause, Skip 15s, Sound on, a red CC button showing captions are on, a seek bar about sixty percent along, and the time 3:42 of 6:05.">
    <div className="jd-video">
    </div>
    <div className="jd-playback">
    <div className="jd-cap"><span>and that is a question worth asking out loud.</span>
    </div>
    <div className="jd-bar"><span className="jd-bar__btn">Back 15s</span>{' '}<span className="jd-bar__btn">Pause</span>{' '}<span className="jd-bar__btn">Skip 15s</span>{' '}<span className="jd-bar__btn">Sound on</span>{' '}<span className="jd-bar__btn jd-bar__btn--on">CC</span>{' '}<span className="jd-bar__track"><span className="jd-bar__scrub"></span><span className="jd-bar__time">3:42 / 6:05</span></span>
    </div>
    </div>
    </div>
    </div><figcaption className="fam-frame__caption"><b>Fig. 3</b>{' '}Captions sit clear of the control bar, sized to the screen they are on.<span className="fam-frame__recreated">Recreated for illustration. The video area shows no picture, and the caption is an example line.</span></figcaption>
    </figure>
    <figure className="fam-frame fam-frame--tv">
    <div className="fam-frame__stage">
    <div className="fam-frame__screen jd-black" role="img" aria-label="Recreation of a closing teaching slide: a 4 by 3 slide centered on a black TV, with a plain blue textured background, the heading Talk About It, and three example bullets: What is one question tonight's video made you want to ask? Which idea would be hardest to explain to a friend? Where did you agree or disagree, and why? A control bar underneath reads Back, Slide 5 of 7, Next.">
    <div className="jd-slide">
    <div className="jd-slide__head">Talk About It
    </div>
    <ul className="jd-slide__list">
    <li>What is one question tonight’s video made you want to ask?
    </li>
    <li>Which idea would be hardest to explain to a friend?
    </li>
    <li>Where did you agree or disagree, and why?
    </li>
    </ul>
    </div>
    <div className="jd-slidebar"><span className="jd-bar__btn">← Back</span><span className="jd-slidebar__count">Slide 5 of 7</span><span className="jd-bar__btn">Next →</span>
    </div>
    </div>
    </div><figcaption className="fam-frame__caption"><b>Fig. 4</b>{' '}After the lesson’s own teaching slides, three filled-in closing slides follow.
    <ul className="jd-kinds" aria-label="The three closing slides">
    <li>Talk About It
    </li>
    <li>Remember This
    </li>
    <li>This Week
    </li>
    </ul><span className="fam-frame__recreated">Recreated for illustration. The background is a plain drawn texture, and the bullets are examples written for this page, not lesson content.</span></figcaption>
    </figure>
    </div>
    <ul className="fam-cards">
    <li className="fam-card"><span className="fam-card__icon"><svg aria-hidden="true"><use href="#i-cc" /></svg></span><h3 className="fam-card__title">Captions, screened for invented lines</h3><p className="fam-card__body">Every lesson video, Student and Leader, can show word-for-word captions. Lines that looked doubtful were checked against the actual audio, not just proofread.</p>
    <details className="fam-hood"><summary><svg className="fam-hood__chev" aria-hidden="true"><use href="#i-chev" /></svg>Peek under the hood<span className="fam-sr">: Captions, screened for invented lines</span></summary>
    <div className="fam-hood__body">Speech-to-text can invent a fluent sentence nobody said. A checker flags any line crammed in faster than anyone can speak (over 40 characters a second), or a near-copy of the line before it, and a week’s captions cannot be published until each of those is corrected or confirmed against a fresh, independent decode of that moment. Lines that are merely fast get a careful second read.
    </div>
    </details>
    </li>
    <li className="fam-card"><span className="fam-card__icon"><svg aria-hidden="true"><use href="#i-ask" /></svg></span><h3 className="fam-card__title">Asked once, then remembered</h3><p className="fam-card__body">The first time a lesson plays on a screen it asks “Show captions?” and remembers the answer, so club night is never interrupted by the question again.</p>
    <details className="fam-hood"><summary><svg className="fam-hood__chev" aria-hidden="true"><use href="#i-chev" /></svg>Peek under the hood<span className="fam-sr">: Asked once, then remembered</span></summary>
    <div className="fam-hood__body">The choice is kept on that one device. Afterwards the CC button on the control bar is the way to change it, which is why it is always visible and shows plainly whether captions are on.
    </div>
    </details>
    </li>
    <li className="fam-card"><span className="fam-card__icon"><svg aria-hidden="true"><use href="#i-size" /></svg></span><h3 className="fam-card__title">Sized for a TV or a phone</h3><p className="fam-card__body">Captions are large enough to read across a room and still fit a phone held sideways. Each screen can choose Small, Normal, Large or Extra large, and a solid dark band for bright scenes.</p>
    <details className="fam-hood"><summary><svg className="fam-hood__chev" aria-hidden="true"><use href="#i-chev" /></svg>Peek under the hood<span className="fam-sr">: Sized for a TV or a phone</span></summary>
    <div className="fam-hood__body">The page draws the captions itself rather than leaving it to the browser, so they can be measured, kept off the control bar and sized from the screen (<code>clamp(18px, 4.5vmin, 56px)</code>). The size choice multiplies that one rule, so every option still suits every screen.
    </div>
    </details>
    </li>
    <li className="fam-card"><span className="fam-card__icon"><svg aria-hidden="true"><use href="#i-slides" /></svg></span><h3 className="fam-card__title">Teaching slides follow the video</h3><p className="fam-card__body">When the lesson ends, the week’s teaching slides come up, followed by closing slides for discussion: Talk About It, Remember This and This Week, written from that week’s lesson.</p>
    <details className="fam-hood"><summary><svg className="fam-hood__chev" aria-hidden="true"><use href="#i-chev" /></svg>Peek under the hood<span className="fam-sr">: Teaching slides follow the video</span></summary>
    <div className="fam-hood__body">The closing slides are real text laid over the deck’s own background, so they stay crisp and editable. Space, the right arrow or a tap moves on. Settings chooses which closing slides to add, and a video that fails outright, or stalls in its final seconds, still hands over to the slides instead of freezing.
    </div>
    </details>
    </li>
    <li className="fam-card"><span className="fam-card__icon"><svg aria-hidden="true"><use href="#i-pencil" /></svg></span><h3 className="fam-card__title">Tonight’s bullets, in a leader’s own words</h3><p className="fam-card__body">A leader who wants different questions for their group can type new ones into Settings on the kiosk. One tap resets them to the written ones.</p>
    <details className="fam-hood"><summary><svg className="fam-hood__chev" aria-hidden="true"><use href="#i-chev" /></svg>Peek under the hood<span className="fam-sr">: Tonight’s bullets, in a leader’s own words</span></summary>
    <div className="fam-hood__body">Saved on that kiosk only, and only for the slides that were actually changed, so a later correction to the written bullets still reaches every slide the leader left alone. Up to three bullets of 80 characters each. Settings shows an “Edited on this device” badge, since the slide itself looks the same either way.
    </div>
    </details>
    </li>
    <li className="fam-card"><span className="fam-card__icon"><svg aria-hidden="true"><use href="#i-skip" /></svg></span><h3 className="fam-card__title">Straight to the slides</h3><p className="fam-card__body">Some nights the room has already seen the lesson, or there isn’t time for it. “Skip to slides” on the start screen goes straight to the discussion.</p>
    <details className="fam-hood"><summary><svg className="fam-hood__chev" aria-hidden="true"><use href="#i-chev" /></svg>Peek under the hood<span className="fam-sr">: Straight to the slides</span></summary>
    <div className="fam-hood__body">Shift plus the right arrow does the same. A plain right arrow still begins the video on purpose, so a reflexive key press can never skip a lesson.
    </div>
    </details>
    </li>
    </ul>
    <aside className="fam-safeguard" aria-labelledby="lic-title">
    <div className="fam-safeguard__head"><svg aria-hidden="true"><use href="#i-shield" /></svg><h3 className="fam-safeguard__title" id="lic-title">How the lesson content is treated</h3>
    </div>
    <ul className="fam-safeguard__list">
    <li><span className="fam-safeguard__check"><svg aria-hidden="true"><use href="#i-check" /></svg></span>
    <div><b>Curriculum the church already licenses</b><span>The kiosk plays curriculum the church already licenses through its own Awana Ministry Membership, used only within the church’s own program: its kiosk and its leaders.</span>
    </div>
    </li>
    <li><span className="fam-safeguard__check"><svg aria-hidden="true"><use href="#i-check" /></svg></span>
    <div><b>Plays smoothly, even on the little Pi</b><span>Each lesson is prepared so even the little Pi Zero plays it smoothly, at a quality it can manage. A more capable screen gets full quality.</span>
    </div>
    </li>
    <li><span className="fam-safeguard__check"><svg aria-hidden="true"><use href="#i-check" /></svg></span>
    <div><b>For the church’s own screens and leaders</b><span>The lesson videos, captions, handouts and slides are there for the kiosk and this church’s own leaders, and are never shared or offered anywhere else.</span>
    </div>
    </li>
    <li><span className="fam-safeguard__check"><svg aria-hidden="true"><use href="#i-check" /></svg></span>
    <div><b>No lesson pictures on this page</b><span>Every screen here is hand-drawn, with placeholders where the lesson’s own content would be.</span>
    </div>
    </li>
    </ul>
    </aside>
    </div>
    </section>
    <section className="fam-chapter" id="journey-ch3" aria-labelledby="journey-ch3-title">
    <div className="fam-wrap">
    <div className="fam-chapter__head">
    <div>
    <div className="fam-chapter__num" aria-hidden="true">03
    </div><p className="fam-kicker">Chapter three</p><h2 className="fam-chapter__title" id="journey-ch3-title">Prep made for a leader</h2>
    </div>
    <div><p className="fam-standfirst">A leader who has read ahead teaches with more confidence, so the kiosk doubles as a place to prepare.</p><p className="fam-chapter__intro">The settings button in the corner also opens each week’s written prep, the full transcript and the leader handout, on the TV, or on a leader’s own phone before club.</p>
    </div>
    </div>
    <div className="jd-split">
    <figure className="fam-frame fam-frame--phone">
    <div className="fam-frame__stage">
    <div className="fam-frame__screen" role="img" aria-label="Recreation of Read Prep on a phone: a dark reading screen with a header reading Week 7, Tonight's Lesson, Leader Prep, and a Close button. Rose-colored headings for Big Idea and Key Points from the Leader Video sit over grey placeholder lines. Below, the full transcript is open, with Version buttons for Edited, which is selected, and Exact words, then paragraphs of placeholder lines, each with a small timestamp button above it: 0:00, 1:24, which is highlighted as if tapped, and 2:51.">
    <div className="jd-prep">
    <div className="jd-prep__head"><span className="jd-prep__title">Week 7 — Tonight’s Lesson (Leader Prep)</span><span className="jd-prep__close">Close</span>
    </div>
    <div className="jd-prep__body">
    <div className="jd-prep__h">Big Idea
    </div>
    <div className="jd-lines"><i></i><i></i>
    </div>
    <div className="jd-prep__h">Key Points from the Leader Video
    </div>
    <div className="jd-lines jd-lines--bullets"><i></i><i></i><i></i>
    </div>
    <div className="jd-prep__toggle">Hide the full transcript
    </div>
    <div className="jd-prep__modes"><span className="jd-prep__label">Version</span><span className="jd-prep__mode jd-prep__mode--on">Edited</span><span className="jd-prep__mode">Exact words</span>
    </div>
    <div><span className="jd-prep__time">0:00</span>
    <div className="jd-lines"><i></i><i></i><i></i>
    </div>
    </div>
    <div><span className="jd-prep__time jd-prep__time--tap">1:24</span>
    <div className="jd-lines"><i></i><i></i><i></i>
    </div>
    </div>
    <div><span className="jd-prep__time">2:51</span>
    <div className="jd-lines"><i></i><i></i>
    </div>
    </div>
    </div>
    </div>
    </div>
    </div><figcaption className="fam-frame__caption"><b>Fig. 5</b>{' '}Read Prep on a phone. Tapping a timestamp starts that video right there.<span className="fam-frame__recreated">Recreated for illustration. Grey lines stand in for the lesson’s text.</span></figcaption>
    </figure>
    <ul className="fam-cards fam-cards--2">
    <li className="fam-card"><span className="fam-card__icon"><svg aria-hidden="true"><use href="#i-book" /></svg></span><h3 className="fam-card__title">Read Prep, on any screen</h3><p className="fam-card__body">Each week’s Leader Video has a short written prep: the big idea, key points, scripture and discussion questions, as real text that reads well on a phone, not a document stuck on the TV.</p>
    <details className="fam-hood"><summary><svg className="fam-hood__chev" aria-hidden="true"><use href="#i-chev" /></svg>Peek under the hood<span className="fam-sr">: Read Prep, on any screen</span></summary>
    <div className="fam-hood__body">Written from the same summaries as the printed handout, and kept on the device once loaded, so it opens even with the network down. The student side has no summary on purpose: the summaries were written from the Leader Video.
    </div>
    </details>
    </li>
    <li className="fam-card"><span className="fam-card__icon"><svg aria-hidden="true"><use href="#i-jump" /></svg></span><h3 className="fam-card__title">The full transcript, one tap from the video</h3><p className="fam-card__body">Under the summary sits the whole transcript, cleaned up for reading or in the exact spoken words. Tapping a paragraph’s timestamp plays the video from that moment.</p>
    <details className="fam-hood"><summary><svg className="fam-hood__chev" aria-hidden="true"><use href="#i-chev" /></svg>Peek under the hood<span className="fam-sr">: The full transcript, one tap from the video</span></summary>
    <div className="fam-hood__body">Both versions travel together, so switching fetches nothing. The edited version keeps every point, example and Scripture reference, and a check refuses to publish a week if a passage goes missing or a book of the Bible appears that the speaker never named.
    </div>
    </details>
    </li>
    <li className="fam-card"><span className="fam-card__icon"><svg aria-hidden="true"><use href="#i-doc" /></svg></span><h3 className="fam-card__title">Handouts that screen readers can follow</h3><p className="fam-card__body">Each week with a Leader Video has a printable handout, a summary page and the edited transcript, that opens full-screen right on the kiosk.</p>
    <details className="fam-hood"><summary><svg className="fam-hood__chev" aria-hidden="true"><use href="#i-chev" /></svg>Peek under the hood<span className="fam-sr">: Handouts that screen readers can follow</span></summary>
    <div className="fam-hood__body">A tagged PDF made from ordinary HTML, then stamped and checked for a title and a language setting, so assistive technology can move through it by heading.
    </div>
    </details>
    </li>
    <li className="fam-card"><span className="fam-card__icon"><svg aria-hidden="true"><use href="#i-list" /></svg></span><h3 className="fam-card__title">Preview any week</h3><p className="fam-card__body">Settings lists all 32 lessons, so a leader can watch an upcoming week, catch up after a missed night or open just the slides, without changing what plays at 6:30.</p>
    <details className="fam-hood"><summary><svg className="fam-hood__chev" aria-hidden="true"><use href="#i-chev" /></svg>Peek under the hood<span className="fam-sr">: Preview any week</span></summary>
    <div className="fam-hood__body">While a preview runs, the schedule and the hourly lesson check stand aside, so neither can interrupt it. It always asks which one first (Student Video, Leader Video or just the teaching slides), and ending it hands back to whatever the schedule says.
    </div>
    </details>
    </li>
    </ul>
    </div>
    </div>
    </section>
    <section className="fam-chapter" id="journey-ch4" aria-labelledby="journey-ch4-title">
    <div className="fam-wrap">
    <div className="fam-chapter__head">
    <div>
    <div className="fam-chapter__num" aria-hidden="true">04
    </div><p className="fam-kicker">Chapter four</p><h2 className="fam-chapter__title" id="journey-ch4-title">Keeps working when the{' '}<span className="jd-nowrap">Wi-Fi</span>{' '}doesn’t</h2>
    </div>
    <div><p className="fam-standfirst">A church connection on a club night is not a data center, and the room should never have to notice.</p><p className="fam-chapter__intro">Most of the engineering here exists for one reason: so that a weak signal, a small computer or a busy evening never costs the students their lesson.</p>
    </div>
    </div>
    <figure className="jd-figure">
    <div className="jd-net">
    <div className="jd-net__panel"><h3 className="jd-net__title">Saved ahead, well before 6:30</h3><p className="jd-net__sub">The current week, kept on the kiosk itself</p>
    <ul className="jd-net__list">
    <li><span className="jd-net__dot"><svg aria-hidden="true"><use href="#i-check" /></svg></span><span><b>The lesson video</b>, ready for this screen</span>
    </li>
    <li><span className="jd-net__dot"><svg aria-hidden="true"><use href="#i-check" /></svg></span><span><b>Both sets of captions</b>, Student and Leader</span>
    </li>
    <li><span className="jd-net__dot"><svg aria-hidden="true"><use href="#i-check" /></svg></span><span><b>Both transcripts</b>{' '}for Read Prep</span>
    </li>
    <li><span className="jd-net__dot"><svg aria-hidden="true"><use href="#i-check" /></svg></span><span><b>The leader handout</b>{' '}and the week’s teaching slides</span>
    </li>
    </ul>
    </div>
    <div className="jd-net__panel"><h3 className="jd-net__title">What happens when Begin is pressed</h3><p className="jd-net__sub">In order, and without waiting on a slow connection</p>
    <ol className="jd-flow">
    <li data-n="1"><b>The screen answers at once</b>The lesson layer and a loading note appear before anything is fetched.
    </li>
    <li data-n="2"><b>Stream if the network answers</b>One quick check, two and a half seconds at most, then the video plays from the network.
    </li>
    <li data-n="3"><b>Fall back to what was saved ahead</b>If the network can’t answer, it plays the lesson saved on the kiosk; if the stream stalls for 8 seconds, it switches to that saved lesson at the same spot.
    </li>
    </ol>
    </div>
    </div><figcaption className="fam-frame__caption"><b>Fig. 6</b>{' '}Saving ahead is the safety net, not the first choice. On a working evening the lesson streams.<span className="fam-frame__recreated">Drawn for illustration.</span></figcaption>
    </figure>
    <ul className="fam-cards">
    <li className="fam-card"><span className="fam-card__icon"><svg aria-hidden="true"><use href="#i-save" /></svg></span><h3 className="fam-card__title">The week’s lesson is saved ahead</h3><p className="fam-card__body">This week’s video, captions, prep transcripts, handout and slides are saved ahead on the kiosk itself, well before 6:30, so a bad connection that evening doesn’t cost the lesson.</p>
    <details className="fam-hood"><summary><svg className="fam-hood__chev" aria-hidden="true"><use href="#i-chev" /></svg>Peek under the hood<span className="fam-sr">: The week’s lesson is saved ahead</span></summary>
    <div className="fam-hood__body">On start-up, every hour, and whenever the connection comes back. Last week’s lesson is cleared only after every piece of this week’s is safely stored, so a failed update never leaves the kiosk with nothing.
    </div>
    </details>
    </li>
    <li className="fam-card"><span className="fam-card__icon"><svg aria-hidden="true"><use href="#i-jd-wifi" /></svg></span><h3 className="fam-card__title">Streams first, with a safety net</h3><p className="fam-card__body">The lesson plays from the network when it can, because on the little Pi that plays most smoothly. If the stream stalls, the kiosk switches to the lesson it saved ahead, without losing the place.</p>
    <details className="fam-hood"><summary><svg className="fam-hood__chev" aria-hidden="true"><use href="#i-chev" /></svg>Peek under the hood<span className="fam-sr">: Streams first, with a safety net</span></summary>
    <div className="fam-hood__body">A bounded check (<code>2.5s</code>) decides whether to stream. A stall of 8 seconds switches to the saved lesson, once per showing, remembering the position, and never in the final seconds, where the hand-off to the slides takes over.
    </div>
    </details>
    </li>
    <li className="fam-card"><span className="fam-card__icon"><svg aria-hidden="true"><use href="#i-tap" /></svg></span><h3 className="fam-card__title">No button ever feels dead</h3><p className="fam-card__body">Every button and key visibly responds the instant it is pressed, even on a crawling connection, so a leader is never left wondering whether it worked.</p>
    <details className="fam-hood"><summary><svg className="fam-hood__chev" aria-hidden="true"><use href="#i-chev" /></svg>Peek under the hood<span className="fam-sr">: No button ever feels dead</span></summary>
    <div className="fam-hood__body">A hard rule in the code: no click or key press may wait on the network before something on screen changes, and anything a leader is waiting on has a time limit. It was learned live, on flaky Wi-Fi.
    </div>
    </details>
    </li>
    <li className="fam-card"><span className="fam-card__icon"><svg aria-hidden="true"><use href="#i-sun" /></svg></span><h3 className="fam-card__title">Stays awake between lessons</h3><p className="fam-card__body">The screen won’t drift off to sleep in the long quiet stretch before 6:30.</p>
    <details className="fam-hood"><summary><svg className="fam-hood__chev" aria-hidden="true"><use href="#i-chev" /></svg>Peek under the hood<span className="fam-sr">: Stays awake between lessons</span></summary>
    <div className="fam-hood__body">The page asks the browser to keep the screen on, and asks again whenever it comes back into view. The Pi setup guide also turns off screen blanking, as a backstop.
    </div>
    </details>
    </li>
    <li className="fam-card"><span className="fam-card__icon"><svg aria-hidden="true"><use href="#i-jd-chip" /></svg></span><h3 className="fam-card__title">Right for a small Pi or a big screen</h3><p className="fam-card__body">The same page runs on the little Pi and on a laptop or TV elsewhere. On the Pi the lesson is tuned to play smoothly and the Check-in Display runs with its animations off. A capable computer gets full quality.</p>
    <details className="fam-hood"><summary><svg className="fam-hood__chev" aria-hidden="true"><use href="#i-chev" /></svg>Peek under the hood<span className="fam-sr">: Right for a small Pi or a big screen</span></summary>
    <div className="fam-hood__body">A Raspberry Pi, most phones and tablets, or a machine with two cores or fewer is treated as low power; the embedded display is opened with its{' '}<code>?lowPower=1</code>{' '}flag. Settings can choose Auto, Full quality or Low power for each device.
    </div>
    </details>
    </li>
    <li className="fam-card"><span className="fam-card__icon"><svg aria-hidden="true"><use href="#i-tv" /></svg></span><h3 className="fam-card__title">A loading screen that tells the truth</h3><p className="fam-card__body">If a video is still loading after about 12 seconds, the screen says the internet may be down and points to the way forward: on to the slides, or back to check-in.</p>
    <details className="fam-hood"><summary><svg className="fam-hood__chev" aria-hidden="true"><use href="#i-chev" /></svg>Peek under the hood<span className="fam-sr">: A loading screen that tells the truth</span></summary>
    <div className="fam-hood__body">A stalled connection sends no error, so an endless “Loading…” would look like progress. The switch-back button never waits on the network.
    </div>
    </details>
    </li>
    </ul>
    </div>
    </section>
    <section className="jd-also" aria-labelledby="journey-also-title">
    <div className="fam-wrap">
    <div className="fam-also"><h2 className="fam-also__title" id="journey-also-title">Smaller things worth knowing</h2>
    <ul className="fam-also__list">
    <li><b>Back or ahead 15 seconds</b>{' '}with two buttons or the comma and period keys, so replaying one sentence never overshoots
    </li>
    <li><b>Tap the video to pause</b>, or press the space bar; the controls stay up while paused
    </li>
    <li><b>The pointer and controls fade</b>{' '}during the lesson and return with any movement or tap
    </li>
    <li><b>Slides can turn themselves</b>{' '}if a leader sets it, every 15 seconds to 2 minutes; by default they stay in a leader’s hands
    </li>
    <li><b>One double-click goes fullscreen</b>, the whole page, so the corner buttons never disappear with it
    </li>
    <li><b>S opens Settings</b>{' '}from anywhere, and Escape closes it
    </li>
    <li><b>A finished lesson hands back early</b>: Finish on the last slide returns to the Check-in Display without waiting for 7:15
    </li>
    <li><b>A preview is always a one-off</b>{' '}and never changes tonight’s scheduled lesson
    </li>
    </ul>
    </div>
    </div>
    </section>
  </section>
);
