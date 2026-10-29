// photo-parallax: "Your photo, brought to life" (20 s, 960x540, 30 fps).
//  0.0- 6.6  slow push-in on the real room; the projector screen carries the
//            brand title card; card 1 (1.0-5.3)
//  6.6- 8.6  wide on the whole track; the gate drops at 7.0
//  8.6-10.4  lower and closer: four cars run down the real track at you
// 10.4-13.9  gentle pan across the car board table; card 2 (10.6-13.4)
// 13.9-14.9  the lobby end card arrives; at rest 14.9-20.0
const ctx = document.getElementById('c').getContext('2d');
const RACE0 = 7.0;
const RUN = [
  { car: CARS[0], lane: 0, T: 3.0 }, { car: CARS[1], lane: 1, T: 3.12 },
  { car: CARS[2], lane: 2, T: 2.94 }, { car: CARS[5], lane: 3, T: 3.06 },
];
const rAt = (T) => (tt) => (tt <= RACE0 ? 0 : Math.pow((tt - RACE0) / T, 1.7));
const bgCache = {};
function bg(f) {
  if (!bgCache[f]) { const im = new Image(); im.src = GP.bgDir + `bg_${String(f).padStart(4, '0')}.png`; bgCache[f] = im.decode().then(() => im); }
  return bgCache[f];
}
window.ready = loadKit();
window.renderFrame = async (T) => {
  beginFrame(ctx);
  const f = Math.round(T * FPS);
  const cams = GP.cam.cams;
  ctx.fillStyle = H.sky; ctx.fillRect(0, 0, W, HGT);
  if (T < 14.9) {
    const fi = Math.min(f, cams.length - 1);
    ctx.drawImage(await bg(fi), 0, 0, W, HGT);
    const cam = cams[fi];
    // far cars first
    const order = RUN.map((c) => ({ c, r: rAt(c.T)(T) })).sort((a, b) => a.r - b.r);
    for (const { c } of order) trackCar(ctx, cam, c.car, c.lane, rAt(c.T), T);
  }
  shoutPlate(ctx, 'The Awana Grand Prix is back.', 48, 490, T, 1.0, 5.3, 38);
  shoutPlate(ctx, 'This year, grown-ups race too.', 48, 432, T, 10.6, 13.4, 38);
  readPlate(ctx, 'Kids race first. Then Trek, Journey and adults race together.', 62, 494, T, 11.15, 13.45, 20);
  endCard(ctx, T - 13.9);
};
