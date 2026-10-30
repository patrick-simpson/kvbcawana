// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { sceneAtRest } from './ambientRest.js';

// The Grand Prix's first frame is the lobby's sky screen at rest
// (GrandPrixPromo.jsx `enter`): it may appear only once the scene IS that
// picture. The rule, on a hand-built scene (jsdom plays no framer-motion: the
// real one is measured in e2e/grand-prix-promo.events.spec.js).

function scene({
  fields = ['sky'], leaving = false, fieldOpacity = '1', copy = false, media = 1, logoOpacity = '1',
  chrome = 'lobby-chrome lobby-chrome--home', loops = 'paused',
} = {}) {
  const root = document.createElement('div');
  root.className = 'catalog-scene';
  root.innerHTML = `
    <div class="lobby-fields">${fields.map((t, i) => `
      <div class="lobby-field lobby-field--${t}${leaving && i === 0 ? ' is-leaving' : ''}" style="opacity: ${fieldOpacity}">
        <span class="lobby-cloud lobby-ambient"></span><span class="lobby-doodle lobby-ambient"></span>
      </div>`).join('')}
    </div>
    <div class="lobby-content">
      <div class="lobby-stage manual-slide-copy">${copy ? '<div class="manual-slide">Words</div>' : ''}</div>
      ${Array.from({ length: media }, () => '<div class="manual-slide lobby-media"><video></video></div>').join('')}
    </div>
    <div class="${chrome}">
      <div class="lobby-waves"><div class="lobby-wave--sun lobby-ambient"></div></div>
      <svg class="lobby-tab__logo lobby-tab__logo--two-line" style="opacity: ${logoOpacity}"></svg>
    </div>`;
  for (const el of root.querySelectorAll('.lobby-ambient')) {
    const anim = { animationName: 'lobby-loop', playState: loops };
    el.getAnimations = () => [anim];
  }
  document.body.append(root);
  return { root, video: root.querySelector('video') };
}

describe('is the lobby its plain screen at rest?', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('yes: one sky field fully in, no words, only this picture, the logo drawn, every loop at rest', () => {
    const { root, video } = scene();
    expect(sceneAtRest(root, { theme: 'sky', media: video })).toBe(true);
  });

  it('no while any ambient loop still runs (the sunflower roll or the field\'s drift)', () => {
    const { root, video } = scene({ loops: 'running' });
    expect(sceneAtRest(root, { theme: 'sky', media: video })).toBe(false);
    root.querySelectorAll('.lobby-ambient').forEach((el, i) => { if (i < 2) el.getAnimations()[0].playState = 'paused'; });
    expect(sceneAtRest(root, { theme: 'sky', media: video })).toBe(false); // the roll still runs
    root.querySelector('.lobby-wave--sun').getAnimations()[0].playState = 'paused';
    expect(sceneAtRest(root, { theme: 'sky', media: video })).toBe(true);
  });

  it('no while the field is still crossfading, or is not the plate\'s theme', () => {
    expect(sceneAtRest(scene({ fields: ['night', 'sky'], leaving: true }).root, { theme: 'sky' })).toBe(false);
    document.body.innerHTML = '';
    expect(sceneAtRest(scene({ fieldOpacity: '0.6' }).root, { theme: 'sky' })).toBe(false);
    document.body.innerHTML = '';
    expect(sceneAtRest(scene({ fields: ['night'] }).root, { theme: 'sky' })).toBe(false);
  });

  it('no while the last slide\'s words or another picture are still on it', () => {
    const a = scene({ copy: true });
    expect(sceneAtRest(a.root, { theme: 'sky', media: a.video })).toBe(false);
    document.body.innerHTML = '';
    const b = scene({ media: 2 });
    expect(sceneAtRest(b.root, { theme: 'sky', media: b.video })).toBe(false);
    // ...and a picture that is not the one asking is not the plate either.
    expect(sceneAtRest(b.root, { theme: 'sky' })).toBe(false);
  });

  it('no while the tab\'s logo is still coming back (after the flagship), or the chrome is not home', () => {
    const a = scene({ logoOpacity: '0.4' });
    expect(sceneAtRest(a.root, { theme: 'sky', media: a.video })).toBe(false);
    document.body.innerHTML = '';
    const b = scene({ chrome: 'lobby-chrome lobby-chrome--home lobby-chrome--logo-away' });
    expect(sceneAtRest(b.root, { theme: 'sky', media: b.video })).toBe(false);
    document.body.innerHTML = '';
    const c = scene({ chrome: 'lobby-chrome lobby-chrome--aside lobby-chrome--away' });
    expect(sceneAtRest(c.root, { theme: 'sky', media: c.video })).toBe(false);
  });

  it('no scene, no answer', () => {
    expect(sceneAtRest(null, { theme: 'sky' })).toBe(false);
  });
});
