// flat-brand (30 s): flat brand animation in the house style, ending in the lobby.
//  0.0- 6.1  the six club lanes build, slide apart (full thickness) to open a
//            clean sky field; card 1 lands (two lines, one size), holds, leaves
//  6.1- 7.8  the lanes slide back together with the cars already rolling in to
//            the gate; the gate drops in; anticipation
//  7.8- 9.6  the pin drops, launch (wide); the camera picks up car 7 and closes in
//  9.6-11.0  close-up: car 7 at speed, axle nails and stripe readable
// 11.0-12.6  whip-by: three lanes, cars whip across
// 12.6-15.0  wide finish: close and uneven; the cars brake and stop
// 14.9-17.0  card 2, first beat: the lanes slide apart, the headline lands
// 17.0-20.6  card 2, second beat: two-shot, car 7 and the grown-up's coupe
//            side by side; the read lines beneath
// 20.6-21.65 the lobby's waves sweep the race into the lobby plate
// 21.55-28.45 end card words land and hold (at rest from about 22.4)
// 28.45-28.95 the words leave; 29.0-30.0 the bare lobby plate
const ctx = document.getElementById('c').getContext('2d');
const WAVE_AT = 20.6, EXIT_AT = 28.45;
window.ready = loadKit();
function race(T) {
  if (T < 9.6) sOpenFlat(ctx, T);
  else if (T < 11.0) sCloseUp(ctx, T - 9.6);
  else if (T < 12.6) sWhip(ctx, T - 11.0);
  else if (T < 17.0) sFinish(ctx, T - 12.6, 0.9, { at: 2.3, out: 4.15 });
  else sTwoShot(ctx, T - 17.0, 1.0);
}
window.renderFrame = async (T) => {
  beginFrame(ctx);
  if (T < WAVE_AT) race(T);
  else lobbyEnd(ctx, T - WAVE_AT, EXIT_AT - WAVE_AT, () => race(T));
};
