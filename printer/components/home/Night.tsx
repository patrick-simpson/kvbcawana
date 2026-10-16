import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Twin, TwinHandle } from './Twin';

/*
 * The club night (owner, 2026-10-16: "Club night, live"). The page is one
 * Wednesday evening at Kennebec Valley Baptist Church, played on the REAL
 * screens (Twin.tsx), with the time of night as its spine:
 *
 *   #doors     6:00  the check-in page on a phone (the reader taps names, or it
 *                    taps on its own), the label each tap prints, the lobby TV
 *   #promos    6:02  the lobby TV looping every season poster (the lobby's own list)
 *   #projector 6:05  the projector wall: game time
 *   #journey   6:30  the Journey room's PC: the lesson starts, run from the
 *                    leader's phone remote (#remote; the reader may press too)
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
    const now = Date.now();
    if (now - lastHuman.current < 12000) return;
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

// ── 6:02 Coming up: the season's posters ─────────────────────────────────────
// Every poster the lobby has, on a loop, on its own TV (owner, 2026-10-16: "a
// section for the promos that plays all of them on loop. Then any new ones can
// get added"). The list is the lobby's own (PREVIEW_PROMOS, handed up by the
// twin), so a new poster joins by itself; each plays to its end card, as the
// Settings window's Preview the promos plays it, then the next.
interface PromoItem { key: string; label: string }
const PROMO_GAP_MS = 900;
const PROMO_START_MS = 5000; // a poster that never comes up is skipped
const PROMO_MAX_MS = 40000; // and one that never ends is moved on from

const Promos: React.FC = () => {
  const [ref, active] = useScene('18:02:00');
  const tv = useRef<TwinHandle>(null);
  const [list, setList] = useState<PromoItem[]>([]);
  const [now, setNow] = useState<PromoItem | null>(null);
  const run = useRef({ next: 0, sentAt: 0, playing: false, endedAt: 0 });
  useEffect(() => {
    if (!active) { run.current = { next: 0, sentAt: 0, playing: false, endedAt: 0 }; setNow(null); }
  }, [active]);

  useEvery(active, 300, () => {
    if (!tv.current?.loaded() || !list.length) return;
    const r = run.current;
    const t = Date.now();
    const stuck = r.sentAt && ((!r.playing && t - r.sentAt > PROMO_START_MS) || t - r.sentAt > PROMO_MAX_MS);
    const ready = !r.sentAt || stuck || (!r.playing && r.endedAt && t - r.endedAt >= PROMO_GAP_MS);
    if (!ready) return;
    const item = list[r.next % list.length];
    r.next += 1;
    r.sentAt = t;
    r.playing = false;
    r.endedAt = 0;
    setNow(item);
    tv.current.send({ type: 'showcase:relay', screen: 'lobby', action: 'preview-promo', data: { key: item.key } });
  });

  const onEvent = (what: string, data: Record<string, unknown>) => {
    if (what === 'promos' && Array.isArray(data.list)) {
      setList((data.list as unknown[]).filter((p): p is PromoItem => !!p && typeof (p as PromoItem).key === 'string' && typeof (p as PromoItem).label === 'string'));
    } else if (what === 'promo') {
      const r = run.current;
      if (data.playing === true) r.playing = true;
      else if (r.playing) { r.playing = false; r.endedAt = Date.now(); }
    }
  };

  return (
    <section ref={ref} id="promos" className="kv-scene kv-scene--promos" aria-labelledby="promos-title">
      <div className="kv-wrap kv-scene__grid">
        <div className="kv-scene__copy">
          <Time hm="6:02" />
          <h2 className="kv-scene__title" id="promos-title">Coming up.</h2>
          <p className="kv-scene__line">Between arrivals, the lobby tells families what's next: every poster of the season, one after another.</p>
          {list.length > 0 && (
            <ol className="kv-promos__list" aria-label="The season's posters">
              {list.map((p) => <li key={p.key} className={now && now.key === p.key ? 'is-on' : undefined}>{p.label}</li>)}
            </ol>
          )}
        </div>
        <div className="kv-scene__stage">
          <figure className="kv-device kv-device--tv">
            <Twin ref={tv} kind="lobby" at={wall('18:02:00')} width={1600} height={900} onEvent={onEvent}
              title="The lobby TV playing the season's posters, one after another" />
            <figcaption><Tag>{now ? `Lobby TV · ${now.label}` : 'Lobby TV'}</Tag></figcaption>
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
// 2026-10-16: "only play the first fifteen seconds", then "pop through the slides"),
// pressed on the leader's phone remote beside it (owner, 2026-10-16: "show off the
// leader remote"). The remote twin's presses reach the PC twin as the Worker's
// doorbell carries them; the PC's report reaches the remote as its poll would.
// The reader may press too: the remote is the scene's one interactive screen,
// and a press of theirs holds the automatic leader off for a while.
const LESSON_MS = 15000;
const NO_VIDEO_MS = 25000; // the video never started (no network): on to the slides anyway
const SLIDE_MS = 3000;
const SPLASH_MS = 2500;
const HUMAN_HOLD_MS = 15000;

interface KioskNow { view?: string; slide?: { n?: number; of?: number } }

const Journey: React.FC = () => {
  const [ref, active] = useScene('18:30:02');
  const pc = useRef<TwinHandle>(null);
  const remote = useRef<TwinHandle>(null);
  // What the PC last reported, since when, and when the leader (us or the reader) last pressed.
  const kiosk = useRef<{ view: string; since: number; playing: number; slide: number; of: number }>({ view: '', since: 0, playing: 0, slide: 0, of: 0 });
  const autoAt = useRef(0);
  const humanAt = useRef(0);
  const lastPress = useRef(0);
  useEffect(() => {
    if (!active) { kiosk.current = { view: '', since: 0, playing: 0, slide: 0, of: 0 }; humanAt.current = 0; lastPress.current = 0; }
  }, [active]);

  /** Press a button on the remote, as a leader's thumb would (or straight to the PC if the remote is not up). */
  const tap = (selector: string, action: string) => {
    autoAt.current = Date.now();
    lastPress.current = Date.now();
    if (remote.current?.loaded()) remote.current.send({ type: 'showcase:click', selector });
    else pc.current?.send({ type: 'showcase:journey', action });
  };

  useEvery(active, 500, () => {
    if (!pc.current?.loaded()) return;
    const now = Date.now();
    if (now - humanAt.current < HUMAN_HOLD_MS) return;
    const k = kiosk.current;
    if (!k.view) return;
    if (k.view === 'splash') {
      if (now - k.since >= SPLASH_MS && now - lastPress.current > SPLASH_MS) tap('#btn-begin', 'begin');
    } else if (k.view === 'intro' || k.view === 'video') {
      const due = k.playing ? k.playing + LESSON_MS : k.since + NO_VIDEO_MS;
      // Over a video the remote's slides button takes a second tap (so a stray thumb never ends a lesson).
      if (now >= due && now - lastPress.current > 1500) {
        tap('#btn-slides', 'slides-start');
        window.setTimeout(() => { if (remote.current?.loaded()) remote.current.send({ type: 'showcase:click', selector: '#btn-slides' }); }, 700);
      }
    } else if (k.view === 'slides') {
      if (k.slide < k.of && now - lastPress.current >= SLIDE_MS) tap('#btn-next', 'slide-next');
    }
  });

  const onKiosk = (what: string, data: Record<string, unknown>) => {
    if (what === 'video-playing' && !kiosk.current.playing) kiosk.current.playing = Date.now();
    if (what !== 'now') return;
    remote.current?.send({ type: 'showcase:now', now: data });
    const n = data as KioskNow;
    const view = typeof n.view === 'string' ? n.view : '';
    const k = kiosk.current;
    // Intro then video is one stretch: the lesson's clock runs from the first of them.
    const lesson = (v: string) => v === 'intro' || v === 'video';
    if (view !== k.view && !(lesson(view) && lesson(k.view))) { k.since = Date.now(); if (!lesson(view)) k.playing = 0; }
    k.view = view;
    k.slide = n.slide && typeof n.slide.n === 'number' ? n.slide.n : 0;
    k.of = n.slide && typeof n.slide.of === 'number' ? n.slide.of : 0;
  };
  const onRemote = (what: string, data: Record<string, unknown>) => {
    if (what !== 'press' || typeof data.action !== 'string') return;
    if (Date.now() - autoAt.current > 1500) humanAt.current = Date.now();
    lastPress.current = Date.now();
    pc.current?.send({ type: 'showcase:journey', action: data.action, id: data.id, data: data.data });
  };

  return (
    <section ref={ref} id="journey" className="kv-scene kv-scene--journey" aria-labelledby="journey-title">
      <div className="kv-wrap kv-scene__grid">
        <div className="kv-scene__copy">
          <Time hm="6:30" />
          <h2 className="kv-scene__title" id="journey-title">Journey.</h2>
          <p className="kv-scene__line">Down the hall, the students' lesson starts on time, captions and all. The leader runs it from their own phone: press Next and the slide moves.</p>
          <p className="kv-scene__note">Curriculum the church already licenses through its own Awana Ministry Membership.</p>
        </div>
        <div className="kv-scene__stage kv-journey">
          <figure className="kv-device kv-device--monitor">
            <Twin ref={pc} kind="journey" at={wall('18:30:02')} width={1600} height={900} onEvent={onKiosk}
              title="The Journey room's PC: the lesson's title cards, its first seconds, then the teaching slides" />
            <span className="kv-device__stand" aria-hidden="true" />
            <figcaption><Tag>Journey room PC</Tag></figcaption>
          </figure>
          <figure id="remote" className="kv-device kv-device--phone kv-journey__remote">
            <Twin ref={remote} kind="remote" at={wall('18:30:02')} width={390} height={844} interactive onEvent={onRemote}
              title="The leader's phone remote: Begin, Back and Next for the Journey room's screen" />
            <figcaption><Tag>Leader's remote · any phone</Tag></figcaption>
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
    <Promos />
    <Games />
    <Journey />
    <Pickup />
  </div>
);

export { reduced };
