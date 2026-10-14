import { useContext, useEffect, useRef, useState } from 'react';
import { M, ZeroAnimationContext } from '../lib/motion.jsx';
import { DOODLES, EASE } from '../lib/brand.js';
import { keyframes, landsAt, EASE_OUT } from './promos/kit.jsx';
import { ARRIVAL, squishLand, withSquish } from '../lib/squish.js';
import { fireWelcome } from '../lib/confetti.js';
import {
  FLAGSHIP_LINES, flagshipLabel, nextFlagshipPick,
} from '../lib/flagship.js';
import { LOGO_ARRIVAL, LOGO_INK, LOGO_WHITE, logoLetters, parseChurchLogo } from '../../shared/churchLogo.js';
import fullSvg from '../../shared/brand/logos/kvbc-awana-full.svg?raw';
import twoLineSvg from '../../shared/brand/logos/kvbc-awana-two-line.svg?raw';

// ─────────────────────────────────────────────────────────────
// The flagship slide: the church's own logo, huge in the middle of the
// screen, arriving in one joyful moment and then perfectly still (owner
// 2026-10-13: "a super fun, joyful animation of the logo. Super big in the
// center of the screen"). First slide of every pass through the deck, 10 s.
//
// The logo is the FULL version (church line, Awana Clubs, tagline), ONE
// solid colour: ink on the sky, white while a club colour is behind it
// (never two colours, an outline, a shadow or a stretch; shared/churchLogo.js).
// Where the full logo cannot be 520px wide inside the slide's box (a 16:9
// screen under 722px wide) the two-line logo stands in (flagship.css).
//
// Each showing takes the next STYLE and the next WORDING (src/lib/flagship.js
// nextFlagshipPick; tests pass `pick`):
//   glad     logo, then "We're so glad you're here!" under it
//   welcome  "Welcome to" over the logo, nothing under it
//
// Beat sheets, seconds into the 10 s hold. L (the logo's cue) is 0.35, or
// 0.85 after "Welcome to" has landed (it lands at 0.25, in the style's way):
//   bounce  L      Awana Clubs bounces in a letter at a time (A w a n a,
//                  a breath, C l u b s): each hops up past its line and drops
//                  back, squashing onto its baseline (the soft squish)
//           L+0.95 the church line slides down into place above it
//           L+1.15 six doodles pop round it, one per club colour, in two
//                  clusters of three (high left, low right)
//           L+1.4  the tagline lands last; L+1.95 the glad line hops in
//   pop     L      the whole logo pops up from small, overshoots and settles
//                  on a gentle spring; L+0.22 confetti in the six club colours
//                  bursts from behind it (confetti level, a name on screen
//                  and zero animation all hold it back)
//           L+1.0  the tagline lands; L+1.45 the glad line pops in
//   parade  L      the logo lands line by line (the logo sheet's arrival)
//           L+1.25 the six club colours march up behind it, youngest first,
//                  each filling the screen for a beat, the logo white on
//                  them, then the last one leaves and the sky is back, the
//                  logo ink again (each flip a 0.18 s crossfade as the
//                  wave's edge crosses the logo's middle)
//           after  the glad line lands
// Nothing moves after the last landing: about 3 s in (bounce, pop), 6.2 s (parade).
//
// Rules (CLAUDE.md, "Flagship welcome slide", the M rule): every animated
// element is M.*, every beat is a keyframe list that holds and then lands,
// never `initial` plus a long delay, the LAST keyframe of everything is the
// finished slide (?lowPower=1 freezes on it: the logo settled, the line in
// place, no confetti), and whatever is passing through (the parade) ends off
// the frame. Check-ins play OVER this slide and it steps back for them.
// ─────────────────────────────────────────────────────────────

const LOGOS = {
  full: parseChurchLogo(fullSvg),
  'two-line': parseChurchLogo(twoLineSvg),
};
/** Awana Clubs, letter by letter (the two files draw it identically). */
const LETTERS = {
  full: logoLetters(LOGOS.full.parts.find((p) => p.part === 'awana').d),
  'two-line': logoLetters(LOGOS['two-line'].parts.find((p) => p.part === 'awana').d),
};

/** The six clubs, youngest first, as the brand tokens name their colours. */
const CLUBS = ['puggles', 'cubbies', 'sparks', 'tnt', 'trek', 'journey'];

/** When "Welcome to" lands, and the logo's cue for each wording. */
const WELCOME_AT = 0.25;
const LEAD = Object.freeze({ glad: 0.35, welcome: 0.85 });

/**
 * A letter's hop: up past its line, then back down onto it. On the logo's
 * paths a y share is of the WHOLE logo's height (its viewBox: framer-motion
 * draws SVG transforms in view-box space), so `from` is about a letter's
 * height below and `apex` a quarter of one above.
 */
export const HOP = Object.freeze({ up: 0.26, down: 0.18, stagger: 0.075, wordGap: 0.12, from: '58%', apex: '-14%' });
/** How far the church line and the tagline travel, in the same view-box shares. */
const LINE_FROM = Object.freeze({ church: '-11%', below: '9%' });

/** The parade: each club's move up, the beat it holds the screen, its wave's crest (share of screen height). */
export const PARADE = Object.freeze({ move: 0.42, hold: 0.16, crest: 0.12 });
/** Where the logo's middle sits, as a share of the screen's height, per wording (16:9). */
const LOGO_MIDDLE = Object.freeze({ glad: 0.5, welcome: 0.62 });

/** framer-motion's cubic-bezier, solved for progress at time share x. */
function bezier([x1, y1, x2, y2], x) {
  const f = (t, a, b) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (f(mid, x1, x2) < x) lo = mid; else hi = mid;
  }
  return f((lo + hi) / 2, y1, y2);
}
/** The time share at which a bezier's progress reaches p. */
function bezierTimeFor(curve, p) {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (bezier(curve, mid) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * When each piece lands, for a style and wording, in seconds: the pure beat
 * sheet the component draws from (and the tests read).
 * @param {'bounce' | 'pop' | 'parade'} style
 * @param {'glad' | 'welcome'} version
 */
export function beatSheet(style, version) {
  const L = LEAD[version];
  const welcomeAt = version === 'welcome' ? WELCOME_AT : null;
  if (style === 'bounce') {
    const letterAt = (i) => L + i * HOP.stagger + (i >= 5 ? HOP.wordGap : 0);
    const last = letterAt(9) + HOP.up + HOP.down;
    const doodleAt = (k) => L + 1.15 + k * 0.09;
    const gladAt = version === 'glad' ? L + 1.95 : null;
    return {
      style, version, lead: L, welcomeAt, churchAt: L + 0.95, letterAt, doodleAt, taglineAt: L + 1.4, gladAt,
      still: Math.max(last, doodleAt(5) + 0.46, L + 1.4 + 0.52, gladAt != null ? gladAt + 0.6 : 0) + 0.55,
    };
  }
  if (style === 'pop') {
    const gladAt = version === 'glad' ? L + 1.45 : null;
    return {
      style, version, lead: L, welcomeAt, popAt: L, confettiAt: L + 0.22, taglineAt: L + 1.0, gladAt,
      still: Math.max(L + 1.0 + 0.52, gladAt != null ? gladAt + 0.6 : 0) + 0.55,
    };
  }
  // parade
  const start = L + 1.25;
  const step = PARADE.move + PARADE.hold;
  const P = 1 + PARADE.crest;
  const c = PARADE.crest;
  const yc = LOGO_MIDDLE[version];
  // The first wave's crest crosses the logo's middle on the way up; the last
  // one's tail crosses it on the way out (seven moves: six clubs, then out).
  const inShare = (1 + c - yc - c / 2) / (1 + c);
  const outShare = (P - yc + c / 2) / (P + c);
  const flipIn = start + PARADE.move * bezierTimeFor(EASE.wipe, inShare);
  const outStart = start + 6 * step;
  const flipOut = outStart + PARADE.move * bezierTimeFor(EASE.wipe, outShare);
  const end = outStart + PARADE.move;
  const gladAt = version === 'glad' ? end + 0.1 : null;
  return {
    style, version, lead: L, welcomeAt, arriveAt: L, taglineAt: L + LOGO_ARRIVAL.tagline.at,
    parade: { start, step, end, flipIn, flipOut }, gladAt,
    still: Math.max(end, gladAt != null ? gladAt + 0.6 : 0) + 0.55,
  };
}

// ── The pieces' beats ───────────────────────────────────────────────────

/** A hop: rise past the line, drop back onto it, squash onto the baseline. */
function hop(at, tilt, from = HOP.from, apex = HOP.apex) {
  return withSquish(keyframes([
    [0, { y: from, rotate: tilt, opacity: 0 }],
    [at, { y: from, rotate: tilt, opacity: 0 }],
    [at + HOP.up, { y: apex, rotate: -tilt * 0.35, opacity: 1 }],
    [at + HOP.up + HOP.down, { y: '0%', rotate: 0, opacity: 1 }],
  ], ['linear', [0.22, 0.8, 0.4, 1], [0.6, 0, 0.9, 0.5]]), squishLand(at, 'text', HOP.up + HOP.down, 1));
}

/** A settle: up from just below, onto its foot, with a whisper of a squish. */
function settle(at, dur = 0.52, from = LINE_FROM.below, kind = /** @type {'kicker' | 'text'} */ ('kicker')) {
  return withSquish(
    landsAt(at, dur, { opacity: [0, 1], y: [from, '0%'] }, EASE.settle),
    squishLand(at, kind, dur, ARRIVAL),
  );
}

/** A pop: from small, past full size, back (the kit's pop curve). */
function popIn(at, dur = 0.46, from = 0.4) {
  return landsAt(at, dur, { opacity: [0, 1], scale: [from, 1] }, EASE.pop);
}

/** The line a wording adds, landing in the style's own way. */
function lineBeat(style, at) {
  if (style === 'bounce') return hop(at, 0, '60%', '-14%');
  if (style === 'pop') return popIn(at, 0.5, 0.5);
  return settle(at, 0.52, '40%', 'text');
}

/** The whole logo's pop: from small, overshoot, a gentle spring to rest. */
function logoPop(at) {
  return keyframes([
    [0, { scale: 0.12, opacity: 0, rotate: -8 }],
    [at, { scale: 0.12, opacity: 0, rotate: -8 }],
    [at + 0.36, { scale: 1.12, opacity: 1, rotate: 2 }],
    [at + 0.6, { scale: 0.95, rotate: -1 }],
    [at + 0.8, { scale: 1.025, rotate: 0 }],
    [at + 1.0, { scale: 1 }],
  ], ['linear', [0.2, 0.9, 0.3, 1], 'easeInOut', 'easeInOut', 'easeInOut']);
}

/**
 * The parade's strip: six club bands, each a screen and a crest tall, the
 * last with a tail, marching up a band at a time and then off the top.
 * y is a share of the strip's own height.
 */
function paradeBeat(sheet) {
  const { start, step } = sheet.parade;
  const P = 1 + PARADE.crest;
  const H = 6 * P + PARADE.crest;
  const pct = (top) => `${Math.round((top / H) * 1e5) / 1e3}%`;
  const frames = [[0, { y: pct(1 + PARADE.crest) }], [start, { y: pct(1 + PARADE.crest) }]];
  const ease = ['linear'];
  for (let k = 0; k < 6; k += 1) {
    const t = start + k * step;
    frames.push([t + PARADE.move, { y: pct(-k * P) }]);
    ease.push(EASE.wipe);
    frames.push([t + step, { y: pct(-k * P) }]);
    ease.push('linear');
  }
  frames.push([start + 6 * step + PARADE.move, { y: pct(-H) }]);
  ease.push(EASE.wipe);
  return keyframes(/** @type {any} */ (frames), ease);
}

/** The logo's (and its line's) one colour through the parade. */
function inkBeat(sheet) {
  const { flipIn, flipOut } = sheet.parade;
  // Each flip is a short crossfade through grey (one colour at every
  // instant), centred a beat after the computed crossing: the wave's move is
  // composited and can paint a frame or two behind the page's own clock.
  const f = 0.09;
  const lag = 0.03;
  return keyframes([
    [0, { color: LOGO_INK }],
    [flipIn + lag - f, { color: LOGO_INK }],
    [flipIn + lag + f, { color: LOGO_WHITE }],
    [flipOut + lag - f, { color: LOGO_WHITE }],
    [flipOut + lag + f, { color: LOGO_INK }],
  ], 'linear');
}

// ── Drawing ─────────────────────────────────────────────────────────────

/** The beats for each piece of the logo (church line, letters or Awana Clubs, tagline). */
function logoBeats(sheet) {
  if (sheet.style === 'bounce') {
    return {
      church: settle(sheet.churchAt, 0.5, LINE_FROM.church),
      letters: LETTERS.full.map((_, i) => hop(sheet.letterAt(i), i % 2 ? -10 : 10)),
      tagline: settle(sheet.taglineAt),
    };
  }
  if (sheet.style === 'pop') {
    return { church: null, awana: null, tagline: settle(sheet.taglineAt) };
  }
  const at = (part) => sheet.arriveAt + LOGO_ARRIVAL[part].at;
  return {
    church: settle(at('church'), LOGO_ARRIVAL.church.dur),
    awana: settle(at('awana'), LOGO_ARRIVAL.awana.dur),
    tagline: settle(at('tagline'), LOGO_ARRIVAL.tagline.dur),
  };
}

const BASELINE = { originX: 0.5, originY: 1 };

/**
 * One version of the logo, drawn inline in currentColor. `still` (zero
 * animation) draws plain paths: every beat's last keyframe is the logo at
 * rest, so that IS the finished frame, with nothing for a frame loop to do.
 */
function Logo({ variant, beats, still }) {
  const logo = LOGOS[variant];
  return (
    <svg className={`flagship-logo flagship-logo--${variant}`} viewBox={logo.viewBox} focusable="false" aria-hidden="true">
      <g fill="currentColor" fillRule="evenodd">
        {logo.parts.map((p) => {
          if (p.part === 'awana' && beats.letters && !still) {
            return (
              <g key="awana" className="kvbc-awana">
                {LETTERS[variant].map((l, i) => (
                  <M.path key={l.x0} className="flagship-logo__letter" d={l.d} style={BASELINE} {...beats.letters[i]} />
                ))}
              </g>
            );
          }
          const beat = still ? null : beats[p.part];
          return beat
            ? <M.path key={p.part} className={`kvbc-${p.part}`} d={p.d} style={BASELINE} {...beat} />
            : <path key={p.part} className={`kvbc-${p.part}`} d={p.d} />;
        })}
      </g>
    </svg>
  );
}

// Two clusters of three around the logo, high left and low right (the
// diagonal, design review 2026-10-13), one doodle per club colour. Across, in
// u from the logo's own edge (so a 4:3 screen, where the logo takes 520px of
// 640, still has them inside its 9u margin); down, shares of its height.
const DOODLES_AROUND = [
  { kind: 'sparkle', club: 'puggles', x: 'calc(-7.2 * var(--u))', y: '-6%', size: 3.4, rotate: -8 },
  { kind: 'dot', club: 'sparks', x: 'calc(-3.8 * var(--u))', y: '18%', size: 1.1 },
  { kind: 'squiggle', club: 'tnt', x: 'calc(-6.6 * var(--u))', y: '38%', size: 4.2, rotate: 12 },
  { kind: 'ring', club: 'cubbies', x: 'calc(100% + 5.2 * var(--u))', y: '40%', size: 1.6 },
  { kind: 'sparkleX', club: 'journey', x: 'calc(100% + 3.4 * var(--u))', y: '62%', size: 3.2 },
  { kind: 'zigzag', club: 'trek', x: 'calc(100% + 5.8 * var(--u))', y: '88%', size: 4.4, rotate: -6 },
];

function Doodles({ beats }) {
  return (
    <div className="flagship-doodles" aria-hidden="true">
      {DOODLES_AROUND.map((d, k) => {
        const shape = DOODLES[d.kind];
        const [, , vw, vh] = shape.viewBox.split(/\s+/).map(Number);
        return (
          <M.span
            key={d.kind}
            className="flagship-doodle"
            style={{ left: d.x, top: d.y, width: `calc(${d.size} * var(--u))`, aspectRatio: `${vw} / ${vh}`, color: `var(--brand-${d.club})` }}
            {...beats[k]}
          >
            <svg viewBox={shape.viewBox} focusable="false">
              {shape.stroked
                ? <path d={shape.d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                : <path d={shape.d} fill="currentColor" />}
            </svg>
          </M.span>
        );
      })}
    </div>
  );
}

function Parade({ sheet }) {
  const [beat] = useState(() => paradeBeat(sheet));
  return (
    <div className="flagship-parade" aria-hidden="true">
      <M.div className="flagship-parade__strip" {...beat}>
        {CLUBS.map((club, k) => (
          <div key={club} className={`flagship-band flagship-band--${club}`} style={{ '--band': `var(--brand-${club})`, '--k': k }}>
            <svg className="flagship-band__crest" viewBox="0 0 100 10" preserveAspectRatio="none" focusable="false" style={k % 2 ? { transform: 'scaleX(-1)' } : undefined}>
              <path d="M0 10V6.2C14 0.6 27 0.4 41 4.6S70 10.4 84 5.4C90 3.3 95 2.2 100 2.4V10Z" fill="var(--band)" />
            </svg>
          </div>
        ))}
        <svg className="flagship-band__tail" viewBox="0 0 100 10" preserveAspectRatio="none" focusable="false">
          <path d="M0 0V3.8C14 9.4 27 9.6 41 5.4S70 -0.4 84 4.6C90 6.7 95 7.8 100 7.6V0Z" fill="var(--brand-journey)" />
        </svg>
      </M.div>
    </div>
  );
}

/**
 * The flagship welcome slide, full-bleed behind the check-in moment.
 * `pick` fixes the style and wording (tests); without it each showing takes
 * this screen's next turn.
 * @param {{ pick?: { style: 'bounce' | 'pop' | 'parade', version: 'glad' | 'welcome' } }} props
 */
export default function FlagshipSlide({ pick } = {}) {
  const zero = useContext(ZeroAnimationContext);
  // Fixed when the slide first appears: no re-render ever replays a beat.
  const [show] = useState(() => {
    const { style, version } = pick ?? nextFlagshipPick();
    const sheet = beatSheet(style, version);
    return {
      sheet,
      logo: logoBeats(sheet),
      ink: style === 'parade' ? inkBeat(sheet) : null,
      pop: style === 'pop' ? logoPop(sheet.popAt) : null,
      welcome: version === 'welcome' ? lineBeat(style, sheet.welcomeAt) : null,
      glad: version === 'glad' ? lineBeat(style, sheet.gladAt) : null,
      doodles: style === 'bounce' ? DOODLES_AROUND.map((d, k) => landsAt(sheet.doodleAt(k), 0.46, { opacity: [0, 1], scale: [0, 1], rotate: [(d.rotate ?? 0) - 45, d.rotate ?? 0] }, EASE.pop)) : null,
    };
  });
  const { sheet } = show;
  const { style, version } = sheet;
  const mark = useRef(/** @type {HTMLDivElement | null} */ (null));

  // The big pop's confetti, from behind the logo, once, at the pop's peak.
  useEffect(() => {
    if (zero || style !== 'pop') return undefined;
    const t = setTimeout(() => {
      const b = mark.current?.getBoundingClientRect?.();
      const w = typeof window !== 'undefined' ? window.innerWidth : 0;
      const h = typeof window !== 'undefined' ? window.innerHeight : 0;
      // No laid-out logo (a hidden page, or no layout at all), nothing to burst from;
      // a child's name on screen owns the moment (the logo has stepped aside).
      if (!b || b.width <= 0 || b.height <= 0 || !w || !h) return;
      if (mark.current?.closest?.('.stage.checkin-active')) return;
      fireWelcome({ x: (b.left + b.width / 2) / w, y: (b.top + b.height / 2) / h });
    }, sheet.confettiAt * 1000);
    return () => clearTimeout(t);
  }, [zero, style, sheet]);

  const Ink = show.ink ? M.div : 'div';
  const inkProps = show.ink ?? {};
  const popProps = show.pop;

  return (
    <div
      className={`flagship flagship--${style} flagship--${version}`}
      role="img"
      aria-label={flagshipLabel(version)}
      data-style={style}
      data-version={version}
    >
      <div className="flagship-clouds" aria-hidden="true">
        <M.i className="flagship-cloud flagship-cloud--a" {...landsAt(0, 1.4, { x: ['-30%', '0%'], opacity: [0, 1] }, EASE_OUT)} />
        <M.i className="flagship-cloud flagship-cloud--b" {...landsAt(0.15, 1.4, { x: ['30%', '0%'], opacity: [0, 1] }, EASE_OUT)} />
      </div>

      {style === 'parade' && <Parade sheet={sheet} />}

      <div className="flagship-copy" aria-hidden="true">
        <Ink className="flagship-ink" {...inkProps}>
          {version === 'welcome' && (
            <M.div className="flagship-line flagship-line--welcome" {...show.welcome}>
              {FLAGSHIP_LINES.welcome}
            </M.div>
          )}
          <div className="flagship-mark" ref={mark}>
            {popProps
              ? (
                <M.div className="flagship-pop" {...popProps}>
                  <Logo variant="full" beats={show.logo} still={zero} />
                  <Logo variant="two-line" beats={show.logo} still={zero} />
                </M.div>
              )
              : (
                <>
                  <Logo variant="full" beats={show.logo} still={zero} />
                  <Logo variant="two-line" beats={show.logo} still={zero} />
                </>
              )}
            {show.doodles && <Doodles beats={show.doodles} />}
          </div>
          {version === 'glad' && (
            <M.div className="flagship-line flagship-line--glad" {...show.glad}>
              {FLAGSHIP_LINES.glad}
            </M.div>
          )}
        </Ink>
      </div>
    </div>
  );
}
