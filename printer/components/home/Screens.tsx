import React, { useEffect, useState } from 'react';
import { Ico, IcoName } from './Icons';
import { CLUBS, LOGO, Club, Doodle, Shape, StepChip } from './Kit';

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
  /** The last name, printed under the first in the read voice (names on the page are made up). */
  last?: string;
  club: Club;
  /** The words beside the birthday cake ("Turning 7!"); a cake prints only with them here. */
  birthday?: string;
  /** Allergy icons, in the order the label prints them. */
  allergies?: IcoName[];
}

/*
 * The icon panel's right edge: generateLabel()'s wave (label-layout.js
 * ICON_WAVE, [fraction of the badge height, pt from DIVIDER_X], one smooth
 * Catmull-Rom curve), sampled into a polygon in % of a panel that runs from
 * the badge's left edge (6 pt) to 93 pt. The second edge is the hairline
 * the renderer traces over it, half a point further out.
 */
const ICON_WAVE: [number, number][] = [[0, -1.5], [0.13, 0.3], [0.30, -1.35], [0.48, 1.65], [0.70, -0.3], [0.86, 1.95], [1, -0.9]];
const waveEdge = (out: number): string => {
  const pts: string[] = [];
  for (let i = 0; i < ICON_WAVE.length - 1; i += 1) {
    const p0 = ICON_WAVE[Math.max(0, i - 1)], p1 = ICON_WAVE[i], p2 = ICON_WAVE[i + 1], p3 = ICON_WAVE[Math.min(ICON_WAVE.length - 1, i + 2)];
    for (let s = 0; s < 6; s += 1) {
      const t = s / 6;
      const cr = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
      const y = cr(p0[0], p1[0], p2[0], p3[0]);
      const dx = cr(p0[1], p1[1], p2[1], p3[1]);
      pts.push(`${((84 + dx + out) / 87 * 100).toFixed(2)}% ${(y * 100).toFixed(2)}%`);
    }
  }
  const [yEnd, dxEnd] = ICON_WAVE[ICON_WAVE.length - 1];
  pts.push(`${((84 + dxEnd + out) / 87 * 100).toFixed(2)}% ${yEnd * 100}%`);
  return `polygon(0 0, ${pts.join(', ')}, 0 100%)`;
};
const PANEL_FILL = { clipPath: waveEdge(0) };
const PANEL_LINE = { clipPath: waveEdge(0.5) };

/*
 * The voice a club's label prints in (brand.CLUB_FACES): Sparks, T&T and no
 * club print the kit's stock voices (Paytone One, Figtree), which this page
 * draws exactly. Puggles and Cubbies print Comic Neue, Trek and Journey
 * Playfair Display: label-only faces that no screen loads (never in
 * fonts.css), so their recreation sets the name in the read voice instead, a
 * stand-in that keeps them off the stock shout.
 */
const labelFace = (id: Club['id']) => (id === 'puggles' || id === 'cubbies' ? 'comic' : id === 'trek' || id === 'journey' ? 'serif' : 'stock');

/**
 * The 4×2 label as generateLabel() draws it: the pale icon panel with its wave
 * edge holding the club's one-colour mark (printed sideways, reading bottom to
 * top, for every club but T&T: brand.MARK_ROTATE), the first name shouted, the
 * last name beneath, and the icon row along the bottom (birthday cake and its
 * words, allergies, a crossed-out camera); a black bar down the right edge for
 * no photos. Sized in its own container units: 1cqw is 1% of the label's width
 * (2.88 pt of the 288 pt the renderer lays out).
 */
export const Label: React.FC<{ spec: LabelSpec; noPhotos?: boolean }> = ({ spec, noPhotos }) => {
  const icons: { icon: IcoName; words?: string }[] = [
    ...(spec.birthday ? [{ icon: 'cake' as IcoName, words: spec.birthday }] : []),
    ...(spec.allergies || []).map((icon) => ({ icon })),
    ...(noPhotos ? [{ icon: 'nocam' as IcoName }] : []),
  ];
  return (
    <div className={`kv-label${noPhotos ? ' kv-label--nophoto' : ''}`} data-face={labelFace(spec.club.id)}
      style={{ '--n': Math.max(3, [...spec.first].length) } as React.CSSProperties}>
      <div className="kv-label__art">
        <span className="kv-label__line" style={PANEL_LINE} />
        <span className="kv-label__fill" style={PANEL_FILL} />
        <img className={`kv-label__mark${spec.club.id === 'tnt' ? '' : ' kv-label__mark--turn'}`} src={spec.club.black} alt="" />
      </div>
      <div className={`kv-label__text${icons.length ? ' has-icons' : ''}`}>
        <span className="kv-label__name">{spec.first}</span>
        {spec.last && <span className="kv-label__last">{spec.last}</span>}
      </div>
      {icons.length > 0 && (
        <span className="kv-label__icons">
          {icons.map((g, i) => (
            <span key={i} className="kv-label__glyph"><Ico name={g.icon} />{g.words && <b>{g.words}</b>}</span>
          ))}
        </span>
      )}
    </div>
  );
};

/** A thermal printer feeding a label out of its top. `run` replays the feed when it changes. */
export const PrinterArt: React.FC<{ spec: LabelSpec; noPhotos?: boolean; run?: number | string; idle?: boolean; wait?: string; label: string }> = ({ spec, noPhotos, run, idle, wait, label }) => (
  <div className="kv-scr kv-scr-printer" role="img" aria-label={label}>
    <div className="kv-scr-printer__feed">
      {!idle && <div className="kv-scr-printer__paper" key={`${String(run)}-${spec.first}`}><Label spec={spec} noPhotos={noPhotos} /></div>}
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

/** The showcase: two labels in turn, a Sparks label (mark sideways) and a T&T one (mark upright). Names are the page's made-up roster. */
export const LabelsArt: React.FC<{ on: boolean }> = ({ on }) => {
  const step = useCycle(2, 5200, on);
  const labels: { spec: LabelSpec; noPhotos?: boolean }[] = [
    { spec: { first: 'Sophia', last: 'Stone', club: club('sparks'), birthday: 'Turning 7!', allergies: ['peanut'] }, noPhotos: true },
    { spec: { first: 'Micah', last: 'Mills', club: club('tnt'), allergies: ['milk'] } },
  ];
  const shown = labels[step];
  return (
    <PrinterArt run={on ? `in-${step}` : 'out'} idle={!on} spec={shown.spec} noPhotos={shown.noPhotos}
      label="Recreation of 4 by 2 inch name labels coming out of a thermal printer. First a Sparks label: a pale panel on the left holds the Sparks mark printed sideways, reading bottom to top; the first name Sophia in big bold type with the last name Stone beneath it; along the bottom a birthday cake with the words Turning 7!, a peanut for a nut allergy and a crossed-out camera for no photos, and a black bar down the right edge, also meaning no photos. Then a T&T label, its mark upright, for Micah Mills, with a glass of milk for a dairy allergy." />
  );
};

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

/*
 * The projector's weather (lobby WeatherScene.jsx: flat shapes, a hard offset
 * shadow, a label chip top-right level with the mark). The cloud's path is the
 * real one, in its 120 x 60 box: four bumps on a flat base. The chip is a
 * sample reading, not real data.
 */
const WX_CLOUD = 'M14 56 A15 15 0 0 1 20 30 A19 19 0 0 1 52 14 A22 22 0 0 1 92 22 A19 19 0 0 1 106 56 Z';

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
    <div className="kv-scr kv-proj" role="img" aria-label="Recreation of the main-room projector. All week it counts down to the next club night on black, Awana begins in 2 days 4 hours 12 minutes. A small weather chip, Cloudy 54 degrees, sits top right, and one flat cartoon cloud drifts slowly behind the numbers. On club night each club's game slot gets its own screen: GAME TIME for T&T in green, with a timer at 1:47 that has turned amber two minutes before the handoff and a chip that says Wrap it up.">
      <span className="kv-proj__roller" />
      <div className="kv-proj__screen">
        {/* The church's logo, top left over every view, as on the wall. */}
        <img className="kv-proj__mark" src={LOGO.twoLineWhite} alt="" />
        {view === 0 ? (
          <div className="kv-proj__view kv-proj__count" key="count">
            <svg className="kv-proj__cloud" viewBox="0 0 120 60" aria-hidden="true" focusable="false">
              <g opacity=".7">
                <path d={WX_CLOUD} transform="translate(4 5)" fill="var(--brand-blue-deep)" />
                <path d={WX_CLOUD} fill="var(--sky)" />
              </g>
            </svg>
            <span className="kv-proj__wx" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false"><path d={WX_CLOUD} transform="translate(0 4) scale(.2)" fill="var(--cloud)" /></svg>
              Cloudy · 54°F
            </span>
            <span className="kv-proj__kicker">Awana begins in</span>
            <span className="kv-proj__digits"><b>2</b><i>d</i><b>04</b><i>h</i><b>12</b><i>m</i></span>
            <StepChip className="kv-proj__chip" label="Wednesday" value="6:00 pm" />
            <span className="kv-proj__star kv-proj__star--a" /><span className="kv-proj__star kv-proj__star--b" /><span className="kv-proj__star kv-proj__star--c" />
          </div>
        ) : (
          <div className="kv-proj__view kv-proj__game" data-club="tnt" key="game">
            <img className="kv-proj__club" src={club('tnt').white} alt="" />
            <span className="kv-proj__game-title">Game time</span>
            <span className="kv-proj__timer">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</span>
            <StepChip className="kv-proj__chip kv-proj__chip--amber" label="Game ends 6:30 pm" value="Wrap it up" />
          </div>
        )}
      </div>
    </div>
  );
};

/* ── The Journey kiosk ────────────────────────────────────────────────────── */

/*
 * The Journey screen on the youth room's PC (journey/CLAUDE.md, "Motion" and
 * "Lesson intro"): the 6:30 start screen; on Begin the title cards (Journey,
 * Advocates, the lesson, Large Group Time), each wiping in over the one
 * before; then the carry (one striped band, hot / ink / deep / purple, with
 * the old picture hung on its square leading edge) takes the last card off to
 * the lesson, which plays with a caption and the control bar; the teaching
 * slides follow on their 4:3 stage. The week, the lesson, the caption and the
 * slide are placeholders: the page never shows curriculum. Under reduced
 * motion it stays on the start screen.
 */
type JourneyStep = 'splash' | 'journey' | 'advocates' | 'lesson' | 'lgt' | 'play' | 'slides';
const JOURNEY_STEPS: { step: JourneyStep; ms: number; via: 'cut' | 'wipe' | 'carry' }[] = [
  { step: 'splash', ms: 3400, via: 'carry' },
  { step: 'journey', ms: 1300, via: 'cut' },
  { step: 'advocates', ms: 1300, via: 'wipe' },
  { step: 'lesson', ms: 1300, via: 'wipe' },
  { step: 'lgt', ms: 1700, via: 'wipe' },
  { step: 'play', ms: 3400, via: 'carry' },
  { step: 'slides', ms: 3000, via: 'carry' },
];

/** Steps through `durations` (ms each) while `on` and motion is allowed; otherwise holds step 0. */
function useSequence(durations: number[], on: boolean): number {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!on) return;
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = window.setTimeout(() => setI((x) => (x + 1) % durations.length), durations[i]);
    return () => window.clearTimeout(t);
  }, [i, on, durations]);
  return i;
}
const JOURNEY_MS = JOURNEY_STEPS.map((s) => s.ms);

const JourneyWave: React.FC = () => (
  <>
    <Shape name="wave-journey" stretch className="kv-jv__wave kv-jv__wave--back" />
    <Shape name="wave-journey" stretch className="kv-jv__wave kv-jv__wave--front" />
  </>
);

const JourneyView: React.FC<{ step: JourneyStep; enter?: string }> = ({ step, enter = '' }) => {
  const cls = `kv-jv kv-jv--${step}${enter ? ` ${enter}` : ''}`;
  switch (step) {
    case 'splash':
      return (
        <div className={cls}>
          <JourneyWave />
          <Shape name="tab-c-journey" stretch className="kv-jv__tab" />
          <span className="kv-jv__tabtext">Large Group Time</span>
          <Doodle name="sparkle-4pt" className="kv-jv__d kv-jv__d--1" />
          <Doodle name="dot" className="kv-jv__d kv-jv__d--2" />
          <Doodle name="squiggle-long" className="kv-jv__d kv-jv__d--3" />
          <Doodle name="sparkle-4pt-x" className="kv-jv__d kv-jv__d--4" />
          <Doodle name="ring" className="kv-jv__d kv-jv__d--5" />
          <img className="kv-jv__mark" src={club('journey').white} alt="" />
          <span className="kv-jv__study">Advocates</span>
          <span className="kv-jv__week">Week 7</span>
          <span className="kv-jv__title">Lesson</span>
          <span className="kv-jv__actions">
            <span className="kv-jv__begin"><Ico name="play" />Begin Video</span>
            <span className="kv-jv__skip">Skip to slides</span>
          </span>
        </div>
      );
    case 'journey':
      return <div className={cls}><JourneyWave /><img className="kv-jv__bigmark" src={club('journey').white} alt="" /></div>;
    case 'advocates':
      return <div className={cls}><JourneyWave /><span className="kv-jv__kicker">This year’s study</span><span className="kv-jv__shout">Advocates</span></div>;
    case 'lesson':
      return <div className={cls}><JourneyWave /><span className="kv-jv__kicker">Week 7</span><span className="kv-jv__shout">Lesson</span></div>;
    case 'lgt':
      return <div className={cls}><JourneyWave /><span className="kv-jv__shout kv-jv__shout--lgt">Large Group Time</span><span className="kv-jv__rule" /></div>;
    case 'play':
      return (
        <div className={cls}>
          <img className="kv-jv__ghost" src={club('journey').white} alt="" />
          <span className="kv-jv__caption"><i /><i /></span>
          <span className="kv-jv__bar">
            <b>Back 15s</b><b>Pause</b><b>Skip 15s</b><b>Sound</b><b>CC</b>
            <span className="kv-jv__scrub"><span className="kv-jv__knob" /></span>
            <span className="kv-jv__time">12:45 / 15:02</span>
          </span>
        </div>
      );
    case 'slides':
      return (
        <div className={cls}>
          <span className="kv-jv__stage"><i className="kv-jv__head" /><i /><i /></span>
          <span className="kv-jv__slidebar"><b className="kv-jv__back">← Back</b><b className="kv-jv__next">Next →</b></span>
        </div>
      );
  }
};

export const KioskArt: React.FC<{ on: boolean }> = ({ on }) => {
  const i = useSequence(JOURNEY_MS, on);
  const [state, setState] = useState({ cur: i, prev: -1, n: 0 });
  useEffect(() => { setState((s) => (s.cur === i ? s : { cur: i, prev: s.cur, n: s.n + 1 })); }, [i]);
  const { step, via } = JOURNEY_STEPS[state.cur];
  const prev = state.prev >= 0 ? JOURNEY_STEPS[state.prev].step : null;
  return (
    <div className="kv-scr kv-kiosk" role="img" aria-label="Recreation of the Journey screen on the youth room's PC. At 6:30 its start screen waits on a deep indigo field: a purple corner tab reading Large Group Time, a small Journey wordmark over the word Advocates at the top, then the week and, largest of all, the lesson's name (placeholders here), an orange Begin Video button and Skip to slides. When a leader presses Begin, title cards follow one another, Journey, Advocates, the week's lesson and Large Group Time, then a striped band in Journey's colours sweeps across and carries the last card away to the lesson, which plays with a caption line and a control bar: back and skip 15 seconds, pause, sound, captions and a progress bar. The teaching slides follow on their own stage with Back and Next buttons. The lesson, its caption and the slides are left blank in this picture.">
      <div className="kv-kiosk__bezel">
        <div className="kv-kiosk__screen">
          {prev && via === 'wipe' && <JourneyView step={prev} key={`under-${state.n}`} />}
          <JourneyView step={step} key={`cur-${state.n}`} enter={prev ? `is-${via}` : ''} />
          {prev && via === 'carry' && (
            <div className="kv-kiosk__carry" key={`carry-${state.n}`}>
              <span className="kv-kiosk__band"><i /><i /><i /><i /></span>
              <span className="kv-kiosk__old"><JourneyView step={prev} /></span>
            </div>
          )}
          <span className="kv-kiosk__corner kv-kiosk__corner--gear"><Ico name="gear" /></span>
          <span className="kv-kiosk__corner kv-kiosk__corner--swap"><Ico name="swap" /></span>
        </div>
      </div>
      <span className="kv-kiosk__stand" />
    </div>
  );
};

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
