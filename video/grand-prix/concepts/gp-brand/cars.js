// Vector side-profile cars matching the official Awana Grand Prix kit blocks
// (catalog p.5: C truck, D stock car, E Indy car; the white/blue "Awana car" from the kit box art)
// plus a long low "grown-up" car. Nose points right. Units: car length 400, ground at y=0.
// car(kind, paint) returns an SVG <g> string; place it with a transform.
(function () {
  const WR = 33, AX = -33;            // wheel radius, axle height
  const REAR = 74, FRONT = 330;       // axle x positions
  let uid = 0;

  // body outlines (closed paths), bottom of body at y = -20
  const B = -20;
  const BODY = {
    // C: long flat block with the raised cab in the middle
    truck: `M4 ${B} L4 -66 Q4 -70 8 -70 L150 -70 L150 -118 Q150 -124 156 -124 L228 -124 Q234 -124 236 -119 L262 -80 L388 -78 Q398 -77 398 -66 L398 ${B} Z`,
    // D: curvy stock car
    stock: `M4 ${B} L4 -70 Q6 -82 22 -84 L100 -88 Q132 -90 156 -112 Q176 -128 212 -128 Q246 -128 268 -104 Q284 -88 316 -84 L376 -76 Q398 -72 398 -50 L398 ${B} Z`,
    // E: Indy wedge with the cockpit notch
    indy: `M4 ${B} L4 -62 L18 -66 L18 -100 Q18 -106 24 -106 L74 -106 L74 -96 L44 -94 L44 -70 L148 -66 Q160 -98 190 -98 Q206 -98 212 -86 L218 -66 L390 -40 Q400 -38 400 -28 L400 ${B} Z`,
    // Awana car: the white wedge with stripes from the kit box
    awana: `M4 ${B} L4 -82 Q4 -92 16 -92 Q150 -96 236 -78 Q330 -58 386 -42 Q400 -38 400 -28 L400 ${B} Z`,
    // grown-up car: long, low and sleek, with a canopy
    sleek: `M0 ${B} L0 -60 Q0 -70 12 -72 L60 -74 Q120 -78 150 -92 Q178 -104 214 -100 Q246 -96 270 -76 Q320 -56 388 -44 Q404 -40 404 -30 L404 ${B} Z`,
  };
  // windows / cockpits (dark glass), optional
  const GLASS = {
    truck: `M206 -120 L228 -120 Q231 -120 233 -117 L254 -84 L206 -84 Z`,
    stock: `M176 -118 Q190 -124 212 -124 Q240 -124 258 -104 L262 -98 L176 -98 Z`,
    indy: `M162 -84 Q170 -94 188 -94 Q200 -94 204 -84 Z`,
    sleek: `M168 -96 Q188 -102 212 -98 Q238 -94 256 -80 L172 -80 Z`,
  };

  window.CARKIT = { BODY, GLASS, WR, AX, REAR, FRONT,
    DEC: { truck: [242, -50], stock: [236, -60], indy: [250, -48], awana: [206, -52], sleek: [236, -52] } };

  function wheel(x) {
    return `<g transform="translate(${x} ${AX})">
      <circle r="${WR}" fill="#111114"/>
      <circle r="${WR * 0.64}" fill="#2B2B31"/>
      <circle r="${WR * 0.44}" fill="#111114"/>
      <circle r="${WR * 0.16}" fill="#C9C9D0"/>
    </g>`;
  }

  function decal(x, y, r, num, bg, fg) {
    return `<g transform="translate(${x} ${y})">
      <circle r="${r}" fill="${bg}"/>
      <text y="${r * 0.36}" text-anchor="middle" font-family="Figtree" font-weight="900" font-size="${r * 1.05}" fill="${fg}" letter-spacing="-1">${num}</text>
    </g>`;
  }

  // paint: {body, stripes, glass, num, numBg, numFg, decalX, decalY, decalR}
  window.car = function (kind, p) {
    const id = 'cb' + (uid++);
    const body = BODY[kind];
    // stripes: [[y, h, color], ...] horizontal bands along the flank, clipped to the body
    const stripes = (p.stripes || []).length ? `<g clip-path="url(#${id})">${p.stripes.map(([y, h, c]) =>
      `<rect x="-10" y="${y}" width="430" height="${h}" fill="${c}"/>`).join('')}</g>` : '';
    const glass = GLASS[kind] ? `<path d="${GLASS[kind]}" fill="${p.glass || '#1A1A1F'}"/>` : '';
    const DEC = { truck: [242, -50], stock: [236, -60], indy: [250, -48], awana: [206, -52], sleek: [236, -52] }[kind];
    const dx = p.decalX || DEC[0], dy = p.decalY || DEC[1], dr = p.decalR || 22;
    return `<g>
      <defs><clipPath id="${id}"><path d="${body}"/></clipPath></defs>
      <path d="${body}" fill="${p.body}"/>
      ${stripes}
      ${glass}
      ${p.num != null ? decal(dx, dy, dr, p.num, p.numBg || '#FFFFFF', p.numFg || '#232328') : ''}
      ${wheel(REAR)}${wheel(FRONT)}
    </g>`;
  };

  // motion streaks behind a car (in the car's local units). spec: [[y, len, w, color, x0offset], ...]
  window.streaks = function (lines) {
    return lines.map(([y, len, w, c, off = 0]) =>
      `<line x1="${-off}" y1="${y}" x2="${-off - len}" y2="${y}" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`).join('');
  };
})();
