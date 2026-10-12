import React from 'react';
import { useInView } from './Chrome';
import { Ico, IcoName } from './Icons';
import { CLUBS, ClubId, Doodle, DoodleName, Shape, Sticker } from './Kit';
import { AppArt, KioskArt, LobbyArt, PhoneArt, PrinterArt, ProjectorArt } from './Screens';

/*
 * The six parts of one club night, each a catalog "club opener" card in one
 * club's colours (the colours are decoration here; the screens themselves
 * colour by each child's own club). #lobby and #journey are the cards the old
 * /lobby/about and /journey/about pages redirect to (site/lib/redirects.js).
 *
 * Claims track the code (printer/CLAUDE.md, "Public website").
 */
interface Part {
  id: string;
  club: ClubId;
  num: string;
  kicker: string;
  icon: IcoName;
  title: string;
  body: React.ReactNode;
  facts: string[];
  art: (on: boolean) => React.ReactNode;
  doodles: [DoodleName, DoodleName, DoodleName];
  sticker?: string;
}

const PARTS: Part[] = [
  {
    id: 'labels', club: 'puggles', num: '01', kicker: 'At the check-in table', icon: 'label',
    title: 'Labels print themselves',
    body: <>Check a child in on TwoTimTwo and a 4×2 name label prints by itself, with the allergy, the birthday and the photo wishes a leader needs to see at a glance.</>,
    facts: ['A new collectible icon every week', 'One label per child, even on a double tap'],
    art: (on) => (
      <PrinterArt run={on ? 'in' : 'out'} idle={!on}
        spec={{ first: 'Micah', club: CLUBS[2], icons: [{ icon: 'cake', words: 'Turning 7!' }, { icon: 'peanut' }, { icon: 'nocam' }] }} noPhotos
        label="Recreation of a 4 by 2 inch name label coming out of a thermal printer: the Sparks mark in a panel on the left, a small leaf for the season, the first name Micah in big bold type with Sparks beneath it, and along the bottom this week's rocket icon, a birthday cake that says Turning 7, a peanut for a nut allergy and a crossed-out camera for no photos, with a black bar down the right edge, also meaning no photos." />
    ),
    doodles: ['sparkle-4pt', 'dot', 'squiggle-s'],
  },
  {
    id: 'lobby', club: 'sparks', num: '02', kicker: 'On the lobby TV', icon: 'tv',
    title: 'Their name, on the big screen',
    body: <>The moment a child checks in, their club’s wave sweeps across the lobby TV and carries their first name. At pick-up, the same screen lists who hasn’t been checked out yet.</>,
    facts: ['First name and club only, never a last name or age', 'Stops naming children when only a few are left'],
    art: (on) => <LobbyArt on={on} />,
    doodles: ['ring', 'sparkle-4pt-x', 'zigzag'],
  },
  {
    id: 'projector', club: 'tnt', num: '03', kicker: 'On the main-room projector', icon: 'projector',
    title: 'The projector keeps time',
    body: <>All week it counts down to the next club night. Then it opens on cue and times each club’s game slot from the posted schedule, so leaders keep their eyes on the kids.</>,
    facts: ['Amber two minutes before a handoff', 'Nobody clicks through slides'],
    art: (on) => <ProjectorArt on={on} />,
    doodles: ['loop', 'dot', 'sparkle-4pt'],
  },
  {
    id: 'journey', club: 'journey', num: '04', kicker: 'In the youth room', icon: 'kiosk',
    title: 'The lesson, ready when the room is',
    body: <>A little kiosk shows the lobby welcome most of the evening. At 6:30 it turns to the week’s Journey lesson and waits for a leader to press Begin, with captions and teaching slides ready for the students.</>,
    facts: ['Built for a Raspberry Pi Zero', 'Curriculum the church already licenses through its own Awana Ministry Membership'],
    art: () => <KioskArt />,
    doodles: ['squiggle-wave', 'sparkle-4pt-x', 'ring'],
  },
  {
    id: 'phone', club: 'cubbies', num: '05', kicker: 'In a leader’s pocket', icon: 'phone',
    title: 'Any phone checks a child in',
    body: <>Signed in with the church passphrase, a volunteer’s phone on any network can check a child in, print a leader’s name tag and see exactly who is counted tonight.</>,
    facts: ['awana.kvbchurch.org/checkin', 'Behind the church passphrase'],
    art: (on) => <PhoneArt on={on} />,
    doodles: ['smile-arc', 'dot', 'sparkle-4pt'],
  },
  {
    id: 'app', club: 'trek', num: '06', kicker: 'On every club computer', icon: 'laptop',
    title: 'One app for every computer',
    body: <>KVBC Awana is one free Windows app: a print server, a display, or both, chosen when it’s set up. It updates itself, and every screen’s settings live in one place.</>,
    facts: ['Settings at awana.kvbchurch.org/settings', 'Installs updates by itself'],
    art: (on) => <AppArt on={on} />,
    doodles: ['coil-spiral', 'sparkle-4pt', 'dot'],
    sticker: 'Free!',
  },
];

const PartCard: React.FC<{ part: Part }> = ({ part }) => {
  const [ref, on] = useInView<HTMLLIElement>(0.35);
  return (
    <li ref={ref} id={part.id} className={`kv-part${on ? ' is-in' : ''}`} data-club={part.club} aria-labelledby={`${part.id}-title`}>
      <div className="kv-part__art">
        <Shape name="wave-cubbies" stretch className="kv-part__wave" />
        <Doodle name={part.doodles[0]} className="kv-part__d kv-part__d--1" />
        <Doodle name={part.doodles[1]} className="kv-part__d kv-part__d--2" />
        <Doodle name={part.doodles[2]} className="kv-part__d kv-part__d--3" />
        <span className="kv-part__num" aria-hidden="true">{part.num}</span>
        <div className="kv-part__stage">{part.art(on)}</div>
        {part.sticker && <Sticker className="kv-part__sticker">{part.sticker}</Sticker>}
      </div>
      <div className="kv-part__body">
        <p className="kv-part__kicker"><Ico name={part.icon} />{part.kicker}</p>
        <h3 className="kv-part__title" id={`${part.id}-title`}>{part.title}</h3>
        <p className="kv-part__text">{part.body}</p>
        <ul className="kv-part__facts">
          {part.facts.map((f) => <li key={f}><Ico name="check" />{f}</li>)}
        </ul>
      </div>
    </li>
  );
};

export const Parts: React.FC = () => (
  <section id="features" className="kv-parts" aria-labelledby="parts-title">
    <div className="kv-wrap">
      <div className="kv-head">
        <p className="kv-tabkicker">What it does</p>
        <h2 className="kv-h2" id="parts-title">Six parts, one club night</h2>
        <p className="kv-lede">From the first check-in to the last pick-up, six parts that each do one job well.</p>
      </div>
      <ul className="kv-parts__grid">
        {PARTS.map((p) => <PartCard key={p.id} part={p} />)}
      </ul>
    </div>
  </section>
);

/** Every club, in its own colours: the strip under the reel. */
export const ClubStrip: React.FC = () => (
  <section className="kv-clubs" aria-labelledby="clubs-title">
    <div className="kv-wrap kv-clubs__inner">
      <h2 className="kv-clubs__title" id="clubs-title">Made for every club, in its own colors</h2>
      <ul className="kv-clubs__list">
        {CLUBS.map((c) => (
          <li key={c.id} className="kv-clubs__item" data-club={c.id}>
            <img src={c.color} alt={c.name} loading="lazy" />
            <span>{c.ages}</span>
          </li>
        ))}
      </ul>
    </div>
  </section>
);
