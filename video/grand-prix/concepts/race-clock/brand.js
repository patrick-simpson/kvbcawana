// Shared brand helpers for the 2D Grand Prix concept previews (canvas, 960x540).
// Everything is a pure function of time T (seconds) so frames capture deterministically.
const W = 960, H = 540;
const BRAND = '../../../../shared/brand/';
const C = {
  ink: '#231F20', hot: '#F15A28', hotDeep: '#9E3512', sun: '#FCB614', cream: '#FFE8C2',
  blue: '#4C72B8', blueDeep: '#34569A', sky: '#B3D0E7', cloud: '#D6EFF8', white: '#FFFFFF',
  orange: '#FAA41D',
  puggles: ['#1DB6D9', '#1A627C'], cubbies: ['#4C72B8', '#2F4F8A'], sparks: ['#F04A4B', '#B82B32'],
  tnt: ['#58BD79', '#2F8A4E'], trek: ['#047E71', '#02554C'], journey: ['#8A649D', '#56467F'],
};

function bez(x1, y1, x2, y2) {
  return function (t) {
    if (t <= 0) return 0; if (t >= 1) return 1;
    let u = t;
    for (let i = 0; i < 12; i++) {
      const x = 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u - t;
      const dx = 3 * (1 - u) * (1 - u) * x1 + 6 * (1 - u) * u * (x2 - x1) + 3 * u * u * (1 - x2);
      if (Math.abs(dx) < 1e-6) break; u -= x / dx; u = Math.min(1, Math.max(0, u));
    }
    return 3 * (1 - u) * (1 - u) * u * y1 + 3 * (1 - u) * u * u * y2 + u * u * u;
  };
}
const E = { wipe: bez(0.76, 0, 0.24, 1), settle: bez(0.16, 1, 0.3, 1), pop: bez(0.34, 1.56, 0.64, 1), exit: bez(0.7, 0, 0.84, 0) };
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const prog = (T, a, d) => clamp((T - a) / d);
const lerp = (a, b, t) => a + (b - a) * t;

function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

// Text with a hard offset shadow (flat, no blur).
function shoutText(ctx, txt, x, y, size, fill, shadow, off, font = 'Paytone One', align = 'center') {
  ctx.font = `${size}px "${font}"`; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  if (shadow) { ctx.fillStyle = shadow; ctx.fillText(txt, x + off, y + off); }
  ctx.fillStyle = fill; ctx.fillText(txt, x, y);
}
function fitSize(ctx, txt, size, maxW, font = 'Paytone One') {
  ctx.font = `${size}px "${font}"`; const w = ctx.measureText(txt).width;
  return w > maxW ? size * maxW / w : size;
}

const IMGS = {};
function loadImg(key, src) { return new Promise(r => { const i = new Image(); i.onload = () => { IMGS[key] = i; r(); }; i.onerror = () => { console.error('img fail', src); r(); }; i.src = src; }); }

async function brandReady() {
  const faces = [
    new FontFace('Paytone One', `url(${BRAND}fonts/PaytoneOne-Regular.ttf)`),
    new FontFace('Londrina Solid', `url(${BRAND}fonts/LondrinaSolid-Black.ttf)`),
    new FontFace('Figtree', `url(${BRAND}fonts/Figtree-Variable.ttf)`, { weight: '300 900' }),
  ];
  for (const f of faces) { await f.load(); document.fonts.add(f); }
  await loadImg('logoW', BRAND + 'logos/kvbc-awana-two-line-white.svg');
  await loadImg('logoI', BRAND + 'logos/kvbc-awana-two-line-ink.svg');
}

// A colour field that wipes across as a slanted panel. p: 0 = off right, 1 = covering, 2 = off left.
function wipePanel(ctx, p, color, edge) {
  const sl = 140, span = W + sl * 2 + 40;
  let x0; // left edge position of the panel
  if (p <= 1) x0 = lerp(W + sl, -sl, E.wipe(p)); else x0 = -sl;
  let x1 = p <= 1 ? W + sl * 2 : lerp(W + sl * 2, -sl - 40, E.wipe(p - 1));
  if (p >= 2) return;
  ctx.save();
  const poly = (a, b, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(a + sl, 0); ctx.lineTo(b + sl, 0); ctx.lineTo(b, H); ctx.lineTo(a, H); ctx.closePath(); ctx.fill(); };
  if (edge) poly(x0 - 22, x1 + 22, edge);
  poly(x0, x1, color);
  ctx.restore();
  return span;
}

// Card with inTime and outTime; returns true if the card fully covers the screen.
function card(ctx, T, tIn, tOut, kind) {
  const d = 0.55;
  if (T < tIn || T > tOut + d) return false;
  const p = T < tOut ? prog(T, tIn, d) : 1 + prog(T, tOut, d);
  const bg = kind === 1 ? C.hot : C.sun, edge = C.ink;
  wipePanel(ctx, p, bg, edge);
  // text rides with the panel during exit, lands with settle on entry
  const tin = prog(T, tIn + 0.38, 0.5);
  const shift = p > 1 ? -lerp(0, W + 300, E.wipe(p - 1)) : 0;
  if (tin <= 0) return p >= 1 && p < 2;
  ctx.save(); ctx.translate(shift, 0);
  const s = E.settle(tin);
  ctx.globalAlpha = clamp(tin * 6);
  if (kind === 1) {
    ctx.translate(lerp(80, 0, s), 0);
    shoutText(ctx, 'The Awana Grand Prix', W / 2, 250, fitSize(ctx, 'The Awana Grand Prix', 92, 860), C.white, C.ink, 7);
    shoutText(ctx, 'is back.', W / 2, 360, 104, C.white, C.ink, 8);
  } else {
    ctx.translate(lerp(80, 0, s), 0);
    shoutText(ctx, 'This year,', W / 2, 200, 84, C.ink, C.white, 6);
    shoutText(ctx, 'grown-ups race too.', W / 2, 300, fitSize(ctx, 'grown-ups race too.', 84, 860), C.ink, C.white, 6);
    const t2 = E.settle(prog(T, tIn + 0.6, 0.5));
    ctx.globalAlpha = clamp(prog(T, tIn + 0.6, 0.2));
    ctx.translate(0, lerp(20, 0, t2));
    const small = 'Kids race first. Then Trek, Journey and adults race together.';
    ctx.font = '700 25px "Figtree"'; const w = ctx.measureText(small).width + 44;
    ctx.fillStyle = C.ink; ctx.fillRect(W / 2 - w / 2 + 5, 365 + 5, w, 52);
    ctx.fillStyle = C.white; ctx.fillRect(W / 2 - w / 2, 365, w, 52);
    ctx.fillStyle = C.ink; ctx.textAlign = 'center'; ctx.fillText(small, W / 2, 400);
  }
  ctx.restore();
  return p >= 1 && p < 2 && tin >= 1;
}

// End card: house blue, logo, title, dates. Everything rests by tIn + 0.9 s.
function endCard(ctx, T, tIn) {
  if (T < tIn) return;
  const p = prog(T, tIn, 0.55);
  wipePanel(ctx, Math.min(p, 1), C.blue, C.ink);
  if (p < 1) return;
  ctx.save();
  // club lanes along the bottom
  const clubs = ['puggles', 'cubbies', 'sparks', 'tnt', 'trek', 'journey'];
  const sb = E.settle(prog(T, tIn + 0.3, 0.5));
  clubs.forEach((k, i) => { ctx.fillStyle = i === 1 ? C.blueDeep : C[k][0]; ctx.fillRect(i * W / 6, H - 26 * sb, W / 6 + 1, 26); });
  const el = (k, dt) => E.settle(prog(T, tIn + 0.15 + dt, 0.45));
  const a = el(0, 0);
  if (IMGS.logoW) { ctx.globalAlpha = clamp(a * 2); const lw = 330, lh = lw * 403 / 1910; ctx.drawImage(IMGS.logoW, W / 2 - lw / 2, lerp(10, 34, a), lw, lh); ctx.globalAlpha = 1; }
  const b = E.pop(prog(T, tIn + 0.25, 0.46));
  ctx.save(); ctx.translate(W / 2, 190); ctx.scale(b, b);
  shoutText(ctx, 'AWANA GRAND PRIX', 0, 0, fitSize(ctx, 'AWANA GRAND PRIX', 88, 880), C.white, C.ink, 7); ctx.restore();
  const c2 = el(0, 0.3);
  ctx.globalAlpha = clamp(c2 * 2);
  shoutText(ctx, 'Kids, Trek, Journey & Adults', W / 2, lerp(270, 248, c2), 42, C.sun, C.ink, 4, 'Londrina Solid');
  const lines = [['Register by Sunday, Feb 28', C.hot], ['Build day: Saturday, March 6 · 2:00 pm', C.white], ['Race day: Saturday, March 20 · 2:00 pm', C.white]];
  lines.forEach(([t, col], i) => {
    const q = el(0, 0.4 + i * 0.1);
    ctx.globalAlpha = clamp(q * 2);
    const y = 300 + i * 62 + lerp(18, 0, q);
    ctx.font = '800 27px "Figtree"'; const w = ctx.measureText(t).width + 40;
    ctx.fillStyle = C.ink; ctx.fillRect(W / 2 - w / 2 + 5, y + 5, w, 48);
    ctx.fillStyle = col; ctx.fillRect(W / 2 - w / 2, y, w, 48);
    ctx.fillStyle = col === C.white ? C.ink : C.white; ctx.textAlign = 'center'; ctx.fillText(t, W / 2, y + 34);
  });
  ctx.restore();
}
