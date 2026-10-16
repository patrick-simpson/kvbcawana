import React from 'react';
import { Footer, Header, LINKS } from './components/home/Chrome';
import { Ico, IconSprite } from './components/home/Icons';
import { Doodle, Shape, StepChip, Sticker } from './components/home/Kit';
import { ClubStrip, Parts } from './components/home/Parts';
import { Reel } from './components/home/Reel';
import { Simulator } from './components/Simulator';

/*
 * The home page of awana.kvbchurch.org: a demo reel page in the look of the
 * Awana Clubs 2026-27 catalog (CLAUDE.md, "Public website").
 *
 *   #reel       the film, framed, and one line saying what this is
 *               (then the six clubs' marks)
 *   #features   the six parts of a club night (#labels, #lobby, #projector,
 *               #journey, #phone, #app)
 *   #simulator  the TwoTimTwo replica, with a lobby TV and a printer acting out
 *               each check-in
 *
 * The install guide and the FAQ are on /help; index.html sends old /#install,
 * /#how-it-works and /#faq links there.
 */
const Hero: React.FC = () => (
  <section id="reel" className="kv-hero" aria-labelledby="hero-title">
    <div className="kv-hero__tab" aria-hidden="true">
      <Shape name="tab-b-sparks" className="kv-hero__tabshape" />
      <span className="kv-hero__tabtext">Club night<br />tools</span>
    </div>
    <div className="kv-hero__doodles" aria-hidden="true">
      <Doodle name="sparkle-4pt" className="kv-hero__d kv-hero__d--1" />
      <Doodle name="loop" className="kv-hero__d kv-hero__d--2" />
      <Doodle name="dot" className="kv-hero__d kv-hero__d--3" />
      <Doodle name="sparkle-4pt-x" className="kv-hero__d kv-hero__d--4" />
      <Doodle name="squiggle-s" className="kv-hero__d kv-hero__d--5" />
      <Doodle name="ring" className="kv-hero__d kv-hero__d--6" />
    </div>
    <div className="kv-wrap kv-hero__inner">
      <div className="kv-hero__frame">
        <Reel />
        <StepChip className="kv-hero__chip" label="Watch" value="Club night" as="span" />
        <Sticker className="kv-hero__sticker">Free for<br />any church</Sticker>
      </div>
      <div className="kv-hero__copy">
        <h1 className="kv-hero__title" id="hero-title">Every child, welcomed by name.</h1>
        <p className="kv-hero__line">
          Free tools a church built for its Awana<sup>®</sup> club nights: labels that print at check-in, a lobby TV
          that greets every child, and screens that keep the whole night on time.
        </p>
        <div className="kv-hero__actions">
          <a className="kv-btn kv-btn--hot" href="#simulator">Try a check-in<Ico name="arrow" /></a>
          <a className="kv-btn kv-btn--line" href="/help"><Ico name="download" />Install and help</a>
        </div>
      </div>
    </div>
    <div className="kv-hero__edge" aria-hidden="true">
      <Shape name="wave-tnt" stretch className="kv-hero__wave kv-hero__wave--back" />
      <Shape name="wave-sparks" stretch className="kv-hero__wave kv-hero__wave--front" />
    </div>
  </section>
);

const App: React.FC = () => (
  <>
    <a className="kv-skip" href="#main">Skip to the content</a>
    <IconSprite />
    <Header page="home" />
    <main id="main">
      <Hero />
      <ClubStrip />
      <Parts />
      <Simulator />
      <section className="kv-next" aria-labelledby="next-title">
        <div className="kv-wrap kv-next__inner">
          <h2 className="kv-next__title" id="next-title">Ready for your club night?</h2>
          <p className="kv-next__line">One Windows app and any 4×2 thermal label printer. The install guide walks you through it.</p>
          <div className="kv-next__actions">
            <a className="kv-btn kv-btn--hot" href="/help#install">Install guide<Ico name="arrow" /></a>
            <a className="kv-btn kv-btn--line" href={LINKS.download}><Ico name="download" />Download for Windows</a>
          </div>
        </div>
      </section>
    </main>
    <Footer />
  </>
);

export default App;
