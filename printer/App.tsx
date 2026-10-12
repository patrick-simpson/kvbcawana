import React from 'react';
import { IconSprite } from './components/family/Icons';
import { ScreenSprite } from './components/family/ScreenIcons';
import { FamilyFooter, FamilyHeader } from './components/family/Family';
import { Hero, Stats } from './components/Hero';
import { Showcase } from './components/Showcase';
import { FamilyBand, HowItWorks } from './components/Features';
import { Simulator } from './components/Simulator';
import { InstallGuide } from './components/InstallGuide';
import { Faq } from './components/Faq';
import { LobbySection } from './components/Lobby';
import { JourneySection } from './components/Journey';

// Section order (leadership first, then the people who run it):
// hero → stats → showcase (#features: chapter index + four chapters) →
// the whole club night (#family) → #how-it-works → #simulator → #install →
// #faq, then the other two tools of the family: the lobby signage and
// projector (#lobby) and the Journey kiosk (#journey). The two former static
// about pages (/lobby/about.html, /journey/about.html) redirect to those two
// sections (site/lib/redirects.js). The #how-it-works, #features, #install,
// #simulator and #faq anchors must keep resolving.
const SUB_LINKS = [
  { href: '#features', label: 'Showcase' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#simulator', label: 'Try it' },
  { href: '#install', label: 'Install' },
  { href: '#faq', label: 'FAQ' },
  { href: '#lobby', label: 'Lobby signage' },
  { href: '#journey', label: 'Journey kiosk' },
  { href: './capabilities.html', label: 'TwoTimTwo reference' },
];

const App: React.FC = () => (
  <>
    <a className="fam-skip" href="#main">Skip to the content</a>
    <IconSprite />
    <ScreenSprite />
    <FamilyHeader subLinks={SUB_LINKS} subLabel="On this page" />
    <main id="main">
      <Hero />
      <Stats />
      <Showcase />
      <FamilyBand />
      <HowItWorks />
      <Simulator />
      <InstallGuide />
      <Faq />
      <LobbySection />
      <JourneySection />
    </main>
    <FamilyFooter />
  </>
);

export default App;
