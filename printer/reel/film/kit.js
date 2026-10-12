// The catalog's parts, drawn from the family's one brand kit
// (lobby/shared/brand, served at /shared/brand): the club waves, the corner
// tabs, the stepped chip (shared/chipGeometry.js, the same geometry every
// screen draws), the doodles, the starburst, and the plate a photo sits on.
import { chipGeometry, inkEm, measureEm } from '/shared/chipGeometry.js';
import { el } from './lib.js';

export const C = {
  puggles: '#1DB6D9', pugglesDeep: '#1A627C', pugglesTint: '#BCDCEE',
  cubbies: '#4C72B8', cubbiesDeep: '#2F4F8A', cubbiesTint: '#C4DDF3',
  sparks: '#F04A4B', sparksDeep: '#B82B32', sparksTint: '#FDDACF',
  tnt: '#58BD79', tntDeep: '#2F8A4E', tntTint: '#D0E9D5',
  trek: '#047E71', trekDeep: '#02554C', trekTint: '#CCEAEC',
  journey: '#8A649D', journeyDeep: '#56467F', journeyTint: '#DED5EA', journeyInk: '#403A77',
  sky: '#B3D0E7', cloud: '#D6EFF8', ink: '#231F20', hot: '#F15A28', hotDeep: '#9E3512',
  sun: '#FCB614', orange: '#FAA41D', orangeDeep: '#C97A08', cream: '#FFE8C2',
  blue: '#4C72B8', blueDeep: '#34569A', slate: '#3B4650',
};

export const CLUBS = ['puggles', 'cubbies', 'sparks', 'tnt', 'trek', 'journey'];

const SHAPES = ['wave-puggles', 'wave-cubbies', 'wave-sparks', 'wave-tnt', 'wave-trek', 'wave-journey',
  'tab-a-cubbies', 'tab-a-puggles', 'tab-b-sparks', 'tab-b-tnt', 'tab-c-journey', 'tab-c-trek', 'tab-awards',
  'starburst', 'tip-blob', 'corner-blob-trek', 'chip-plate', 'chip-keyline'];
const DOODLES = ['check', 'chevron', 'coil-line', 'coil-spiral', 'coil-spring', 'dash', 'dot', 'hook-arrow',
  'loop-stem', 'loop', 'pixel-heart', 'ring', 'smile-arc', 'sparkle-4pt-x', 'sparkle-4pt', 'squiggle-long',
  'squiggle-s', 'squiggle-wave', 'steps-block', 'zigzag-steps', 'zigzag'];

const ART = {};

/** Fetch every shape and doodle once; each keeps its own viewBox. */
export async function loadKit() {
  const get = async (dir, name) => {
    const text = await (await fetch(`/shared/brand/${dir}/${name}.svg`)).text();
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
    ART[name] = { viewBox: doc.getAttribute('viewBox'), inner: doc.innerHTML };
  };
  await Promise.all([...SHAPES.map((n) => get('shapes', n)), ...DOODLES.map((n) => get('doodles', n))]);
}

/** One kit drawing as an inline <svg>, painted in `color` (currentColor). */
export function art(name, parent, { color = '#fff', cls = '', width, height, preserve = 'xMidYMid meet', stroke } = {}) {
  const a = ART[name];
  if (!a) throw new Error(`no kit art ${name}`);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', a.viewBox);
  svg.setAttribute('preserveAspectRatio', preserve);
  svg.innerHTML = a.inner;
  svg.setAttribute('class', `art ${cls}`.trim());
  svg.style.color = color;
  if (width != null) svg.style.width = `${width}px`;
  if (height != null) svg.style.height = `${height}px`;
  if (stroke) svg.querySelectorAll('[stroke]').forEach((p) => p.setAttribute('stroke-width', stroke));
  if (parent) parent.appendChild(svg);
  return svg;
}

/** A club's white mark (the real Awana art, as the screens use it; film only). */
export function mark(club, parent, { height, width, tone = 'white', cls = '' } = {}) {
  const file = `${club}-${tone}`;
  const img = el('img', `mark ${cls}`.trim(), parent);
  img.src = `/shared/brand/logos/${file}.svg`;
  if (height != null) img.style.height = `${height}px`;
  if (width != null) img.style.width = `${width}px`;
  return img;
}

/**
 * The stepped chip: a label on a pill over a value on a block that steps out
 * beneath it, the plate printed out of register with its white keyline.
 * `size` is the value's font size in px.
 */
export function chip(parent, label, value, { size = 64, plate = 'rgba(3,4,4,0.5)', cls = '' } = {}) {
  const g = chipGeometry(measureEm(label), measureEm(value), 0, inkEm(value));
  const wrap = el('div', `chip ${cls}`.trim(), parent);
  wrap.style.width = `${(g.width * size).toFixed(1)}px`;
  wrap.style.height = `${(g.height * size).toFixed(1)}px`;
  wrap.innerHTML = `<svg viewBox="-0.04 -0.04 ${g.width.toFixed(3)} ${g.height.toFixed(3)}" width="100%" height="100%">
    <path d="${g.d}" fill="${plate}" transform="translate(0.12 0.07)"/>
    <path d="${g.d}" fill="none" stroke="#fff" stroke-width="0.045"/>
  </svg>`;
  // The texts are HTML over the plate, each centred where the chip's SVG
  // text hangs on its central baseline on the screens: with the screens'
  // Paytone metrics (film.css) and a line height of 1, half an em above the
  // line box's top.
  for (const [text, at] of [[label, g.label], [value, g.value]]) {
    const px = at.size * size;
    const span = el('span', 'chip__text', wrap, text);
    span.style.cssText = `position:absolute;left:${((at.x + 0.04) * size).toFixed(1)}px;top:${((at.y + 0.04) * size - px / 2).toFixed(1)}px;`
      + `font:400 ${px.toFixed(2)}px/1 'Paytone One';color:#fff;white-space:nowrap;transform:translateX(-50%)`;
  }
  return wrap;
}

/** A headline whose words (or letters) can move on their own. */
export function words(parent, text, { cls = '', letters = false } = {}) {
  const box = el('div', `words ${cls}`.trim(), parent);
  const lines = text.split('\n');
  const parts = [];
  for (const line of lines) {
    const row = el('div', 'words__row', box);
    for (const w of line.split(' ')) {
      if (letters) {
        const word = el('span', 'words__word', row);
        for (const ch of w) parts.push(el('span', 'words__piece', word, ch === ' ' ? '&nbsp;' : ch));
      } else {
        parts.push(el('span', 'words__piece', row, w));
      }
      el('span', 'words__gap', row, ' ');
    }
  }
  return { box, parts };
}

/**
 * A footage clip recorded by record.mjs: frame i of /work/footage/<name>/,
 * described by the meta.json it wrote (fps, frames, viewport, taps).
 */
export class Footage {
  constructor(name) {
    this.name = name;
    this.meta = null;
  }
  async load() {
    const r = await fetch(`/work/footage/${this.name}/meta.json`);
    if (!r.ok) throw new Error(`no footage for ${this.name}: run reel/record.mjs first`);
    this.meta = await r.json();
    return this;
  }
  url(i) { return `/work/footage/${this.name}/${String(i).padStart(5, '0')}.jpg`; }
  /** The frame for `seconds` into the clip, held at both ends. */
  frameAt(seconds) {
    const i = Math.round(seconds * this.meta.fps);
    return Math.max(0, Math.min(this.meta.frames - 1, i));
  }
}

/** An <img> showing one footage clip; set(t) picks the frame. */
export class Screen {
  constructor(parent, footage, cls = '') {
    this.footage = footage;
    this.img = el('img', `screen ${cls}`.trim(), parent);
    this.img.decoding = 'sync';
    this.current = -1;
  }
  set(seconds) {
    const i = this.footage.frameAt(seconds);
    if (i === this.current) return null;
    this.current = i;
    this.img.src = this.footage.url(i);
    return this.img.decode().catch(() => {});
  }
}
