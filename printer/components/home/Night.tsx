import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Twin, TwinHandle } from './Twin';

/*
 * The club night (owner, 2026-10-16: "Club night, live"). The page is one
 * Wednesday evening at Kennebec Valley Baptist Church, played on the REAL
 * screens (Twin.tsx), with the time of night as its spine:
 *
 *   #doors     6:00  the check-in page on a phone (the reader taps names, or it
 *                    taps on its own), the label each tap prints, the lobby TV
 *   #projector 6:05  the projector wall: game time
 *   #journey   6:30  the Journey room's PC: the lesson starts
 *   #pickup    7:30  the lobby's pickup board, and /settings on a laptop
 *
 * Every name is made up (site/showcase/stub.js has the club). The screens'
 * clocks are wall-clock time on the night of 2026-10-14, a Wednesday.
 */
const NIGHT = '2026-10-14';
const wall = (hms: string) => `${NIGHT}T${hms}`;

/** Wall-clock ISO for `hms` plus `ms` (no offset: the twins read it as local time). */
const isoAfter = (hms: string, ms: number) => {
  const [h, m, s] = hms.split(':').map(Number);
  const d = new Date(2026, 9, 14, h, m, s);
  return new Date(d.getTime() + ms).toISOString();
};

const reduced = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── The clock on the page ────────────────────────────────────────────────────
interface ClockState { at: string; since: number }
const ClockCtx = createContext<{ clock: ClockState; enter: (at: string) => void }>({
  clock: { at: '17:59:00', since: 0 }, enter: () => {},
});

export const NightClock: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [clock, setClock] = useState<ClockState>({ at: '17:59:00', since: Date.now() });
  const enter = useCallback((at: string) => setClock((c) => (c.at === at ? c : { at, since: Date.now() })), []);
  return <ClockCtx.Provider value={{ clock, enter }}>{children}</ClockCtx.Provider>;
};

/** "6:04" and "PM" for the scene in view, ticking in real seconds. */
export function useNightTime(): { hm: string; ampm: string; minutes: number } {
  const { clock } = useContext(ClockCtx);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  const [h, m, s] = clock.at.split(':').map(Number);
  const total = h * 3600 + m * 60 + s + Math.floor((Date.now() - clock.since) / 1000);
  const hh = Math.floor(total / 3600) % 24;
  const mm = Math.floor(total / 60) % 60;
  return { hm: `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')}`, ampm: hh < 12 ? 'AM' : 'PM', minutes: hh * 60 + mm };
}

/** Marks its scene as the one in view (the middle of the screen is inside it). */
function useScene(at: string): [React.RefObject<HTMLElement>, boolean] {
  const ref = useRef<HTMLElement>(null);
  const { enter } = useContext(ClockCtx);
  const [active, setActive] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setActive(true); return; }
    const io = new IntersectionObserver(([e]) => {
      setActive(e.isIntersecting);
      if (e.isIntersecting) enter(at);
    }, { rootMargin: '-50% 0px -50% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [at, enter]);
  return [ref, active];
}

/** setInterval that runs only while `on`. */
function useEvery(on: boolean, ms: number, fn: () => void) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    if (!on) return;
    const t = window.setInterval(() => saved.current(), ms);
    return () => window.clearInterval(t);
  }, [on, ms]);
}

const Time: React.FC<{ hm: string; ampm?: string }> = ({ hm, ampm = 'PM' }) => (
  <p className="kv-scene__time" aria-hidden="true"><span>{hm}</span><small>{ampm}</small></p>
);

const Tag: React.FC<{ children: React.ReactNode }> = ({ children }) => <p className="kv-tag">{children}</p>;

// ── 6:00 Doors open ──────────────────────────────────────────────────────────
// The showcase's club, in the order the check-in page taps them by itself.
const ARRIVALS = [
  'Maya Brightwater', 'Noah Fairbanks', 'Ella Marchetti', 'Leo Castellan', 'Owen Pemberly', 'Lucy Ambrose',
  'Ruby Ashford', 'Ivy Calloway', 'Ezra Holloway', 'Mia Rourke', 'Eli Thornbury', 'Jude Winslow',
  'Nora Whitcombe', 'Ava Linden', 'Sophia Hartwell', 'Caleb Moreland',
];
const COUNTS: Record<string, number> = { Puggles: 6, Cubbies: 9, Sparks: 11, 'T&T': 12, Trek: 0, Journey: 0 };

interface Printed { key: number; first: string; club: string }

const Printer: React.FC<{ printed: Printed[] }> = ({ printed }) => {
  const last = printed[printed.length - 1];
  return (
    <figure className="kv-printer" aria-label={last ? `The label printer has printed ${last.first}'s name tag` : 'The label printer, waiting'}>
      <div className="kv-printer__out">
        {last && (
          <img key={last.key} className="kv-printer__label" src={`/showcase/labels/${last.first.toLowerCase()}.png`}
            alt={`${last.first}'s name tag (${last.club}), printed by the real label renderer`} width="600" height="300" />
        )}
      </div>
      <div className="kv-printer__body" aria-hidden="true"><span className="kv-printer__slot" /><span className="kv-printer__led" /></div>
      <figcaption><Tag>Label printer</Tag></figcaption>
    </figure>
  );
};

const Doors: React.FC = () => {
  const [ref, active] = useScene('18:00:30');
  const phone = useRef<TwinHandle>(null);
  const tv = useRef<TwinHandle>(null);
  const [printed, setPrinted] = useState<Printed[]>([]);
  const done = useRef(new Set<string>());
  const lastAuto = useRef<{ name: string; t: number } | null>(null);
  const lastHuman = useRef(0);
  const n = useRef(0);
  const counts = useRef({ ...COUNTS });

  const onCheckin = useCallback((data: Record<string, unknown>) => {
    const first = String(data.firstName || '');
    const last = String(data.lastName || '');
    const club = String(data.club || '');
    const name = `${first} ${last}`;
    done.current.add(name);
    const auto = lastAuto.current && lastAuto.current.name === name && Date.now() - lastAuto.current.t < 4000;
    if (!auto) lastHuman.current = Date.now();
    const at = typeof data.at === 'string' ? data.at : new Date().toISOString();
    n.current += 1;
    tv.current?.send({ type: 'showcase:frame', e: 'checkin', d: { id: `showcase-${n.current}-${first}`, firstName: first, club, at } });
    counts.current[club] = (counts.current[club] || 0) + 1;
    tv.current?.send({ type: 'showcase:frame', e: 'tally', d: { counts: { ...counts.current }, at } });
    setPrinted((p) => [...p.slice(-3), { key: n.current, first, club }]);
  }, []);

  // While nobody is tapping, the phone checks the next child in by itself.
  useEvery(active, 4600, () => {
    if (!phone.current?.loaded() || !tv.current?.loaded()) return;
    if (Date.now() - lastHuman.current < 12000) return;
    const next = ARRIVALS.find((name) => !done.current.has(name));
    if (!next) return;
    lastAuto.current = { name: next, t: Date.now() };
    phone.current.send({ type: 'showcase:click', selector: `.fam[aria-label="${next}"]` });
  });

  return (
    <section ref={ref} id="doors" className="kv-scene kv-scene--doors" aria-labelledby="doors-title">
      <div className="kv-wrap kv-scene__grid">
        <div className="kv-scene__copy">
          <Time hm="6:00" />
          <h2 className="kv-scene__title" id="doors-title">Doors open.</h2>
          <p className="kv-scene__line">Tap a name on the phone. A label prints and the lobby says hello.</p>
        </div>
        <div className="kv-scene__stage kv-doors">
          <figure id="phone" className="kv-device kv-device--phone">
            <Twin ref={phone} kind="checkin" at={wall('18:00:30')} width={390} height={844} interactive
              title="The check-in page, awana.kvbchurch.org/checkin, with a made-up roster: tap a name to check that child in"
              onEvent={(what, data) => { if (what === 'checkin') onCheckin(data); }} />
            <figcaption><Tag>Check-in · any phone</Tag></figcaption>
          </figure>
          <div id="labels" className="kv-doors__printer"><Printer printed={printed} /></div>
          <figure id="lobby" className="kv-device kv-device--tv">
            <Twin ref={tv} kind="lobby" at={wall('18:00:30')} width={1600} height={900}
              title="The lobby TV, welcoming each child by first name" />
            <figcaption><Tag>Lobby TV</Tag></figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
};

// ── 6:05 Game time ───────────────────────────────────────────────────────────
const Games: React.FC = () => {
  const [ref] = useScene('18:04:56');
  return (
    <section ref={ref} id="projector" className="kv-scene kv-scene--projector" aria-labelledby="projector-title">
      <div className="kv-wrap kv-scene__grid">
        <div className="kv-scene__copy">
          <Time hm="6:05" />
          <h2 className="kv-scene__title" id="projector-title">Game time.</h2>
          <p className="kv-scene__line">The projector keeps the gym on the clock, club by club.</p>
        </div>
        <div className="kv-scene__stage">
          <figure className="kv-device kv-device--wall">
            <Twin kind="projector" at={wall('18:04:56')} width={1600} height={900}
              title="The projector wall: the night's countdown and game time" />
            <figcaption><Tag>Projector wall</Tag></figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
};

// ── 6:30 Journey ─────────────────────────────────────────────────────────────
// The lesson's first 15 seconds, then the teaching slides, one every 3 s (owner,
// 2026-10-16: "only play the first fifteen seconds", then "pop through the slides").
const LESSON_MS = 15000;
const SLIDE_MS = 3000;
const SLIDE_STEPS = 4; // a deck is 5 slides: stay on the last

const Journey: React.FC = () => {
  const [ref, active] = useScene('18:30:02');
  const pc = useRef<TwinHandle>(null);
  // When Begin is due, when it was pressed, when the video started, when the slides came up.
  const run = useRef<{ beginAt: number; begun: number; playing: number; slidesAt: number; steps: number } | null>(null);
  useEffect(() => { if (!active) run.current = null; }, [active]);
  const press = (action: string) => pc.current?.send({ type: 'showcase:journey', action });
  // A leader presses Begin; 15 s into the video they skip to the slides and step
  // through them (the kiosk's own remote commands, as the leader's phone sends them).
  useEvery(active, 500, () => {
    if (!pc.current?.loaded()) return;
    const now = Date.now();
    if (!run.current) { run.current = { beginAt: now + 2500, begun: 0, playing: 0, slidesAt: 0, steps: 0 }; return; }
    const r = run.current;
    if (!r.begun) { if (now >= r.beginAt) { r.begun = now; press('begin'); } return; }
    if (!r.slidesAt) {
      // 15 s of video; or, if the video never starts (no network), 25 s after Begin.
      const due = r.playing ? r.playing + LESSON_MS : r.begun + 25000;
      if (now >= due) { r.slidesAt = now; press('slides-start'); }
      return;
    }
    if (r.steps < SLIDE_STEPS && now - r.slidesAt >= (r.steps + 1) * SLIDE_MS) { r.steps += 1; press('slide-next'); }
  });
  const onEvent = (what: string) => {
    const r = run.current;
    if (what === 'video-playing' && r && !r.playing) r.playing = Date.now();
  };
  return (
    <section ref={ref} id="journey" className="kv-scene kv-scene--journey" aria-labelledby="journey-title">
      <div className="kv-wrap kv-scene__grid">
        <div className="kv-scene__copy">
          <Time hm="6:30" />
          <h2 className="kv-scene__title" id="journey-title">Journey.</h2>
          <p className="kv-scene__line">Down the hall, the students' lesson starts on time, captions and all.</p>
          <p className="kv-scene__note">Curriculum the church already licenses through its own Awana Ministry Membership.</p>
        </div>
        <div className="kv-scene__stage">
          <figure className="kv-device kv-device--monitor">
            <Twin ref={pc} kind="journey" at={wall('18:30:02')} width={1600} height={900} onEvent={onEvent}
              title="The Journey room's PC: the lesson's title cards, its first seconds, then the teaching slides" />
            <span className="kv-device__stand" aria-hidden="true" />
            <figcaption><Tag>Journey room PC</Tag></figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
};

// ── 7:30 Pickup ──────────────────────────────────────────────────────────────
const STILL_HERE: [string, string][] = [
  ['Ava', 'Puggles'], ['Mia', 'Puggles'], ['Leo', 'Cubbies'], ['Ezra', 'Cubbies'], ['Ruby', 'Cubbies'],
  ['Maya', 'Sparks'], ['Owen', 'Sparks'], ['Ivy', 'Sparks'], ['Jude', 'Sparks'], ['Noah', 'T&T'],
  ['Lucy', 'T&T'], ['Eli', 'T&T'], ['Nora', 'T&T'], ['Finn', 'T&T'],
];

const Pickup: React.FC = () => {
  const [ref, active] = useScene('19:31:00');
  const tv = useRef<TwinHandle>(null);
  const list = useRef(STILL_HERE.slice());
  const since = useRef(0);
  useEffect(() => { if (active) { list.current = STILL_HERE.slice(); since.current = Date.now(); } }, [active]);
  const board = () => tv.current?.send({
    type: 'showcase:frame', e: 'checkout',
    d: { entries: list.current.map(([firstName, club]) => ({ firstName, club })), printed: 54, at: isoAfter('19:31:00', Date.now() - since.current) },
  });
  // A fresh list every few seconds, one child fewer each time (a parent came).
  useEvery(active, 3800, () => {
    if (!tv.current?.loaded()) return;
    if (list.current.length > 3 && since.current && Date.now() - since.current > 5000) {
      list.current.splice(Math.floor((Date.now() / 1000) % list.current.length), 1);
    }
    board();
  });
  return (
    <section ref={ref} id="pickup" className="kv-scene kv-scene--pickup" aria-labelledby="pickup-title">
      <div className="kv-wrap kv-scene__grid">
        <div className="kv-scene__copy">
          <Time hm="7:30" />
          <h2 className="kv-scene__title" id="pickup-title">Pickup.</h2>
          <p className="kv-scene__line">Who's still here, club by club, until the last one heads home.</p>
        </div>
        <div className="kv-scene__stage kv-pickup">
          <figure className="kv-device kv-device--tv">
            <Twin ref={tv} kind="lobby" at={wall('19:31:00')} width={1600} height={900}
              title="The lobby TV at pickup: who is not checked out yet, by club" />
            <figcaption><Tag>Lobby TV</Tag></figcaption>
          </figure>
          <figure id="app" className="kv-device kv-device--laptop">
            <Twin kind="settings" at={wall('19:31:00')} width={1400} height={900}
              title="awana.kvbchurch.org/settings: tonight's count, the printers and every screen, from any phone or laptop" />
            <span className="kv-device__stand" aria-hidden="true" />
            <figcaption><Tag>Settings · every screen, one page</Tag></figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
};

/** The night, scene by scene. */
export const Night: React.FC = () => (
  <div id="night" className="kv-night">
    <Doors />
    <Games />
    <Journey />
    <Pickup />
  </div>
);

export { reduced };
