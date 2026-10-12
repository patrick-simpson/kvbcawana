import React from 'react';
import { Footer, Header } from './components/home/Chrome';
import { IconSprite } from './components/home/Icons';
import { Doodle, Shape } from './components/home/Kit';
import { InstallGuide } from './components/InstallGuide';
import { Faq } from './components/Faq';

/*
 * /help: the install guide (#install) and the FAQ (#faq), in the home page's
 * catalog look. The home page's old /#install, /#how-it-works and /#faq links
 * land here (index.html).
 */
const HelpPage: React.FC = () => (
  <>
    <a className="kv-skip" href="#main">Skip to the content</a>
    <IconSprite />
    <Header page="help" />
    <main id="main">
      <section className="kv-helphero" aria-labelledby="help-title">
        <div className="kv-hero__tab" aria-hidden="true">
          <Shape name="tab-b-sparks" className="kv-hero__tabshape" />
          <span className="kv-hero__tabtext">Install<br />and help</span>
        </div>
        <Doodle name="sparkle-4pt" className="kv-hero__d kv-hero__d--1" />
        <Doodle name="ring" className="kv-hero__d kv-hero__d--6" />
        <Doodle name="squiggle-s" className="kv-hero__d kv-hero__d--5" />
        <div className="kv-wrap kv-helphero__inner">
          <h1 className="kv-helphero__title" id="help-title">Up and running by club night.</h1>
          <p className="kv-helphero__line">Four steps to a label printer that runs itself, and the answers to the questions volunteers ask most.</p>
          <ul className="kv-helphero__jump">
            <li><a className="kv-btn kv-btn--hot" href="#install">The install guide</a></li>
            <li><a className="kv-btn kv-btn--line" href="#faq">Questions</a></li>
          </ul>
        </div>
        <div className="kv-hero__edge" aria-hidden="true">
          <Shape name="wave-tnt" stretch className="kv-hero__wave kv-hero__wave--back" />
          <Shape name="wave-sparks" stretch className="kv-hero__wave kv-hero__wave--front" />
        </div>
      </section>
      <InstallGuide />
      <Faq />
    </main>
    <Footer />
  </>
);

export default HelpPage;
