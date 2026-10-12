import React, { useEffect, useState } from 'react';
import { Ico, IcoName } from './Icons';
import { AWANA_WHITE, CLUBS, Club, Doodle, Shape, StepChip } from './Kit';

/*
 * Small recreations of the real screens, drawn in HTML and CSS (styles/home.css,
 * `kv-scr-*`), each sized in container units so it scales as one picture. Each
 * is role="img" with a full description. They follow the CURRENT looks (the
 * lobby's check-in moment and pick-up board, the projector, the Journey start
 * screen, the phone page, the label generateLabel() draws, the KVBC Awana
 * setup wizard), with generic first names only. When a screen's look changes,
 * redraw its recreation in the same commit.
 */

const club = (id: Club['id']) => CLUBS.find((c) => c.id === id)!;

/** Cycles 0..n-1 every `ms` while `on` (the card is in view and motion is allowed). */
export function useCycle(n: number, ms: number, on: boolean): number {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!on || n < 2) return;
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = window.setInterval(() => setI((x) => (x + 1) % n), ms);
    return () => window.clearInterval(t);
  }, [n, ms, on]);
  return i;
}

/* ── The label and the printer ────────────────────────────────────────────── */

export interface LabelSpec {
  first: string;
  club: Club;
  icons?: { icon: IcoName; words?: string }[];
}

/** The 4×2 label as generateLabel() lays it out: club art panel (the club's mark sideways, T&T upright), motif, name, club, icons; a black bar for no photos. */
export const Label: React.FC<{ spec: LabelSpec; noPhotos?: boolean }> = ({ spec, noPhotos }) => (
  <div className={`kv-label${noPhotos ? ' kv-label--nophoto' : ''}`}>
    {/* The printed mark runs sideways (counter-clockwise) for every club but T&T: brand.MARK_ROTATE. */}
    <div className={`kv-label__art${spec.club.id === 'tnt' ? '' : ' kv-label__art--turn'}`}><img src={spec.club.black} alt="" /></div>
    <div className="kv-label__main">
      <Ico name="leaf" className="kv-label__motif" />
      <span className="kv-label__name">{spec.first}</span>
      <span className="kv-label__club">{spec.club.name}</span>
      <span className="kv-label__icons">
        <Ico name="rocket" />
        {(spec.icons || []).map((g, i) => (
          <span key={i} className="kv-label__glyph"><Ico name={g.icon} />{g.words && <b>{g.words}</b>}</span>
        ))}
      </span>
    </div>
  </div>
);

/** A thermal printer feeding a label out of its top. `run` replays the feed when it changes. */
export const PrinterArt: React.FC<{ spec: LabelSpec; noPhotos?: boolean; run?: number | string; idle?: boolean; wait?: string; label: string }> = ({ spec, noPhotos, run, idle, wait, label }) => (
  <div className="kv-scr kv-scr-printer" role="img" aria-label={label}>
    <div className="kv-scr-printer__feed">
      {!idle && <div className="kv-scr-printer__paper" key={String(run)}><Label spec={spec} noPhotos={noPhotos} /></div>}
      {idle && wait && <span className="kv-scr-printer__wait">{wait}</span>}
    </div>
    <div className="kv-scr-printer__body">
      <span className="kv-scr-printer__slot" />
      <span className="kv-scr-printer__lid" />
      <span className="kv-scr-printer__led" />
      <span className="kv-scr-printer__btn" />
    </div>
    <div className="kv-scr-printer__shadow" />
  </div>
);

/* ── The lobby TV ─────────────────────────────────────────────────────────── */

const fitClass = (name: string) => (name.length <= 4 ? 'is-short' : name.length <= 6 ? 'is-mid' : 'is-long');

/** The check-in moment: the child's club wave rises and carries the first name, the club's white mark rides the low side. */
export const Moment: React.FC<{ name: string; club: Club; kicker?: string; run?: number | string }> = ({ name, club: c, kicker = 'Welcome', run }) => (
  <div className="kv-moment" data-club={c.id} key={String(run)}>
    <Shape name="wave-sparks" stretch className="kv-moment__wave" />
    <div className="kv-moment__copy">
      <span className="kv-moment__kicker">{kicker}</span>
      <span className={`kv-moment__name ${fitClass(name)}`}>{name}</span>
    </div>
    <img className="kv-moment__mark" src={c.white} alt="" />
    <Doodle name="sparkle-4pt" className="kv-moment__d1" />
    <Doodle name="ring" className="kv-moment__d2" />
    <Doodle name="sparkle-4pt-x" className="kv-moment__d3" />
  </div>
);

/** The lobby's idle scene: the slide behind every welcome. */
const LobbyScene: React.FC<{ title: string; dim?: boolean }> = ({ title, dim }) => (
  <div className={`kv-scene${dim ? ' is-dim' : ''}`}>
    <span className="kv-scene__blob kv-scene__blob--a" />
    <span className="kv-scene__blob kv-scene__blob--b" />
    <Doodle name="smile-arc" className="kv-scene__d1" />
    <Doodle name="zigzag" className="kv-scene__d2" />
    <span className="kv-scene__kicker">Tonight</span>
    <span className="kv-scene__title">{title}</span>
  </div>
);

/** The pick-up board in the lobby's foot: a club plate, then the first names not checked out yet. */
const Pickup: React.FC = () => (
  <div className="kv-pickup">
    <span className="kv-pickup__head">Not checked out yet</span>
    <div className="kv-pickup__run">
      <span className="kv-pickup__plate" data-club="sparks"><img src={club('sparks').white} alt="" /><b>3 waiting</b></span>
      {['Eli', 'Grace', 'Leo'].map((n) => <span key={n} className="kv-pickup__chip">{n}</span>)}
      <span className="kv-pickup__plate" data-club="tnt"><img src={club('tnt').white} alt="" /><b>2 waiting</b></span>
      {['Ana', 'Sam'].map((n) => <span key={n} className="kv-pickup__chip">{n}</span>)}
    </div>
  </div>
);

export const Tv: React.FC<{ children: React.ReactNode; label: string; className?: string }> = ({ children, label, className = '' }) => (
  <div className={`kv-scr kv-tv ${className}`} role="img" aria-label={label}>
    <div className="kv-tv__bezel"><div className="kv-tv__screen">{children}</div></div>
    <span className="kv-tv__stand" />
  </div>
);

/** The lobby TV for the showcase: a welcome, then (in turn) the pick-up board. */
export const LobbyArt: React.FC<{ on: boolean }> = ({ on }) => {
  const step = useCycle(3, 3600, on);
  const names = [{ n: 'Ava', c: club('sparks') }, { n: 'Mateo', c: club('tnt') }];
  return (
    <Tv label="Recreation of the lobby TV. A child's club wave rises from the bottom of the screen and carries their first name, AVA, under the word Welcome, with the Sparks mark on the wave. In turn the same screen shows the pick-up board along its foot: the first names of children not checked out yet, grouped by club.">
      <LobbyScene title={step === 2 ? 'See you next week!' : 'Welcome to Awana!'} dim={step < 2} />
      {step < 2 && <Moment name={names[step].n} club={names[step].c} kicker={step ? 'Welcome back' : 'Welcome'} run={step} />}
      {step === 2 && <Pickup />}
      <StepChip className="kv-tv__chip" label="Clear" value="58°" />
    </Tv>
  );
};

/* ── The projector ────────────────────────────────────────────────────────── */

export const ProjectorArt: React.FC<{ on: boolean }> = ({ on }) => {
  const view = useCycle(2, 5200, on);
  const [secs, setSecs] = useState(107);
  useEffect(() => {
    if (!on || view !== 1) return;
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setSecs(107);
    const t = window.setInterval(() => setSecs((s) => (s > 100 ? s - 1 : 107)), 1000);
    return () => window.clearInterval(t);
  }, [on, view]);
  return (
    <div className="kv-scr kv-proj" role="img" aria-label="Recreation of the main-room projector. All week it counts down to the next club night on black, Awana begins in 2 days 4 hours 12 minutes. On club night each club's game slot gets its own screen: GAME TIME for T&T in green, with a timer at 1:47 that has turned amber two minutes before the handoff.">
      <span className="kv-proj__roller" />
      <div className="kv-proj__screen">
        {view === 0 ? (
          <div className="kv-proj__view kv-proj__count" key="count">
            <img className="kv-proj__mark" src={AWANA_WHITE} alt="" />
            <span className="kv-proj__kicker">Awana begins in</span>
            <span className="kv-proj__digits"><b>2</b><i>d</i><b>04</b><i>h</i><b>12</b><i>m</i></span>
            <StepChip className="kv-proj__chip" label="Wednesday" value="6:00 pm" />
            <span className="kv-proj__star kv-proj__star--a" /><span className="kv-proj__star kv-proj__star--b" /><span className="kv-proj__star kv-proj__star--c" />
          </div>
        ) : (
          <div className="kv-proj__view kv-proj__game" data-club="tnt" key="game">
            <Shape name="wave-tnt" stretch className="kv-proj__wave kv-proj__wave--top" />
            <Shape name="wave-tnt" stretch className="kv-proj__wave kv-proj__wave--bottom" />
            <img className="kv-proj__club" src={club('tnt').white} alt="" />
            <span className="kv-proj__game-title">Game time!</span>
            <span className="kv-proj__timer">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</span>
            <StepChip className="kv-proj__chip kv-proj__chip--amber" label="Handoff in" value="2 min" />
          </div>
        )}
      </div>
    </div>
  );
};

/* ── The Journey kiosk ────────────────────────────────────────────────────── */

export const KioskArt: React.FC = () => (
  <div className="kv-scr kv-kiosk" role="img" aria-label="Recreation of the Journey kiosk's start screen at 6:30: a deep indigo field with a purple corner tab reading Large Group Time, the Journey wordmark, the week and lesson as placeholders, and an orange Begin Video button waiting for a leader.">
    <div className="kv-kiosk__bezel">
      <div className="kv-kiosk__screen">
        <Shape name="tab-b-sparks" className="kv-kiosk__tab" />
        <span className="kv-kiosk__tabtext">Large group time</span>
        <Shape name="wave-journey" stretch className="kv-kiosk__wave" />
        <Doodle name="sparkle-4pt" className="kv-kiosk__d1" />
        <Doodle name="squiggle-s" className="kv-kiosk__d2" />
        <img className="kv-kiosk__mark" src={club('journey').white} alt="" />
        <span className="kv-kiosk__week">Week 7</span>
        <span className="kv-kiosk__title">Lesson</span>
        <span className="kv-kiosk__actions">
          <span className="kv-kiosk__begin"><Ico name="play" />Begin video</span>
          <span className="kv-kiosk__skip">Skip to slides</span>
        </span>
      </div>
    </div>
    <span className="kv-kiosk__foot" />
  </div>
);

/* ── The phone page ───────────────────────────────────────────────────────── */

export const PhoneArt: React.FC<{ on: boolean }> = ({ on }) => {
  const step = useCycle(3, 1900, on);
  const rows: { n: string; c: Club }[] = [
    { n: 'Micah', c: club('sparks') }, { n: 'Mia', c: club('cubbies') }, { n: 'Miles', c: club('tnt') }, { n: 'Mira', c: club('trek') },
  ];
  return (
    <div className="kv-scr kv-phone" role="img" aria-label="Recreation of the phone check-in page: a search for Mi lists Micah, Mia, Miles and Mira, each with their club's colour. A tap checks Micah in, his row turns green with a check, and a note says his label is printing. A pill at the top counts 42 checked in tonight.">
      <div className="kv-phone__body">
        <span className="kv-phone__notch" />
        <div className="kv-phone__screen">
          <div className="kv-phone__top">
            <span className="kv-phone__title">Check-in</span>
            <span className="kv-phone__pill">{step === 2 ? 43 : 42} in</span>
            <span className="kv-phone__plus">+</span>
          </div>
          <div className="kv-phone__search"><Ico name="search" className="kv-phone__searchico" />Mi<span className="kv-phone__caret" /></div>
          <ul className="kv-phone__list">
            {rows.map((r, i) => (
              <li key={r.n} className={`kv-phone__row${i === 0 && step >= 1 ? ' is-tapped' : ''}${i === 0 && step === 2 ? ' is-done' : ''}`} data-club={r.c.id}>
                <span className="kv-phone__bar" />
                <b>{r.n}</b><span className="kv-phone__club">{r.c.name}</span>
                {i === 0 && step === 2 && <span className="kv-phone__tick"><Ico name="check" /></span>}
              </li>
            ))}
          </ul>
          <span className={`kv-phone__toast${step === 2 ? ' is-up' : ''}`}><Ico name="printer" />Micah’s label is printing</span>
        </div>
      </div>
    </div>
  );
};

/* ── The KVBC Awana app ───────────────────────────────────────────────────── */

export const AppArt: React.FC<{ on: boolean }> = ({ on }) => {
  const step = useCycle(2, 2600, on);
  return (
    <div className="kv-scr kv-app" role="img" aria-label="Recreation of the KVBC Awana setup window on a Windows laptop: What is this computer for? Two switches, Print server and Display, can be on together. In the corner of the taskbar the app's tray icon says it is up to date.">
      <div className="kv-app__lid">
        <div className="kv-app__desk">
          <div className="kv-app__win">
            <div className="kv-app__titlebar"><span className="kv-app__appico" /><b>KVBC Awana</b><i /><i /><i /></div>
            <div className="kv-app__body">
              <span className="kv-app__q">What is this computer for?</span>
              <span className="kv-app__opt is-on"><Ico name="printer" /><b>Print server</b><span className="kv-app__switch" /></span>
              <span className={`kv-app__opt${step ? ' is-on' : ''}`}><Ico name="tv" /><b>Display</b><span className="kv-app__switch" /></span>
              <span className="kv-app__next">Next<Ico name="arrow" /></span>
            </div>
          </div>
          <span className={`kv-app__toast${step ? ' is-up' : ''}`}><Ico name="check" />Up to date</span>
          <div className="kv-app__taskbar"><span /><span /><span /><span className="kv-app__tray" /></div>
        </div>
      </div>
      <div className="kv-app__base" />
    </div>
  );
};
