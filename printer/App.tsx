import React, { useEffect, useState } from 'react';
import { Footer, Header } from './components/home/Chrome';
import { IconSprite } from './components/home/Icons';
import { Night, NightClock, useNightTime } from './components/home/Night';
import { Reel } from './components/home/Reel';

/*
 * The home page of awana.kvbchurch.org (owner, 2026-10-16): a showcase that
 * plays ONE club night on the real screens (CLAUDE.md, "Public website").
 *
 *   #reel    the film, first (owner, 2026-10-16: "get the video to the top")
 *   #top     the opening: the time, and what this is
 *   #night   the night (components/home/Night.tsx): #doors (#phone, #labels,
 *            #lobby), #promos, #projector, #journey (#remote), #pickup (#app)
 *   #end     8:00: that's a club night, and the Lights out switch
 *   footer   the practical links, quietly
 *
 * /help keeps the install guide and the FAQ; index.html sends old /#install,
 * /#how-it-works and /#faq links there.
 */

/** The time of night, always in sight: big at the opening, a chip after. */
const Clock: React.FC = () => {
  const { hm, ampm } = useNightTime();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    // Only while the night itself is on screen.
    const night = document.getElementById('night');
    if (!night || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setShown(e.isIntersecting));
    io.observe(night);
    return () => io.disconnect();
  }, []);
  return (
    <p className={`kv-clock${shown ? ' is-shown' : ''}`} aria-hidden="true">
      <span className="kv-clock__day">Wed</span>
      <span className="kv-clock__hm">{hm}</span>
      <span className="kv-clock__ampm">{ampm}</span>
    </p>
  );
};

/** The evening's program, as the printed sheet on the welcome table has it. */
const PROGRAM: [string, string, string][] = [
  ['6:00', 'Doors open', '#doors'],
  ['6:02', 'Coming up', '#promos'],
  ['6:05', 'Game time', '#projector'],
  ['6:30', 'Journey', '#journey'],
  ['7:30', 'Pickup', '#pickup'],
  ['8:00', 'Lights out', '#end'],
];

const Opening: React.FC = () => {
  const { hm } = useNightTime();
  return (
    <section id="top" className="kv-open" aria-labelledby="open-title">
      <div className="kv-wrap kv-open__inner">
        <p className="kv-open__kicker">Wednesday night · Kennebec Valley Baptist Church</p>
        <p className="kv-open__clock" aria-hidden="true"><span>{hm}</span><small>PM</small></p>
        <h1 className="kv-open__title" id="open-title">One club night, on the real screens.</h1>
        <p className="kv-open__line">
          Every screen below is the software our Awana<sup>®</sup> club runs on, playing a made-up night. Scroll to
          open the doors; tap a name when you get there.
        </p>
        <a className="kv-open__go" href="#doors">Open the doors</a>
        <nav className="kv-program" aria-label="Tonight">
          <p className="kv-program__head">Tonight</p>
          <ol className="kv-program__list">
            {PROGRAM.map(([t, what, href]) => (
              <li key={href}><a href={href}><span className="kv-program__t">{t}</span><span className="kv-program__what">{what}</span></a></li>
            ))}
          </ol>
        </nav>
      </div>
    </section>
  );
};

/**
 * Past 8:00 a switch appears (the owner's easter egg): Lights out puts the whole
 * page in the dark except the Journey room's screen, and a mop crosses the floor.
 */
const LightsOut: React.FC = () => {
  const [off, setOff] = useState(false);
  useEffect(() => {
    document.documentElement.classList.toggle('is-lights-out', off);
    return () => document.documentElement.classList.remove('is-lights-out');
  }, [off]);
  return (
    <div className="kv-lights">
      <button type="button" className={`kv-switch${off ? ' is-off' : ''}`} aria-pressed={off} onClick={() => setOff((v) => !v)}>
        <span className="kv-switch__plate" aria-hidden="true"><span className="kv-switch__toggle" /></span>
        <span className="kv-switch__word">{off ? 'Lights on' : 'Lights out'}</span>
      </button>
      <p className="kv-lights__note" aria-live="polite">{off ? 'Somebody left the Journey PC on again.' : ''}</p>
    </div>
  );
};

/** The film, first: ninety seconds, every screen at once. */
const Film: React.FC = () => (
  <section id="reel" className="kv-film" aria-label="The film: one club night in ninety seconds">
    <div className="kv-wrap"><Reel /></div>
  </section>
);

const Finale: React.FC = () => (
  <section id="end" className="kv-finale" aria-labelledby="finale-title">
    <div className="kv-wrap">
      <p className="kv-scene__time" aria-hidden="true"><span>8:00</span><small>PM</small></p>
      <h2 className="kv-finale__title" id="finale-title">That's a club night.</h2>
      <p className="kv-finale__line">The last car pulls out. Somebody should get the lights.</p>
      <LightsOut />
    </div>
  </section>
);

const App: React.FC = () => (
  <NightClock>
    <a className="kv-skip" href="#main">Skip to the content</a>
    <IconSprite />
    <Header page="home" />
    <Clock />
    <main id="main">
      <Film />
      <Opening />
      <Night />
      <Finale />
    </main>
    <Footer />
  </NightClock>
);

export default App;
