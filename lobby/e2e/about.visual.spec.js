import { expect, test } from '@playwright/test';

// public/about.html draws the screens as CSS recreations, in the kit's real
// faces, at container-relative sizes. A doodle is placed for the headline that
// was there when it was placed; change the face or the size and the same
// headline is wider or taller, and a word can land on a doodle. That is what
// happened when Galindo left (Paytone One's "Welcome to Awana!" ran its "!"
// into Fig. 1's zigzag at every width), and nothing else would notice: the page
// is a static file outside the Vite graph and its tests read source, not
// layout.
//
// So this measures what Chromium lays out: no line of text inside a
// recreation may touch a doodle's box, at the widths where the page reflows.
// It is a box test, stricter than an ink test (a text line's box carries the
// face's whole ascent and descent), which is the point: it needs no pixels, so
// it cannot flake on antialiasing. Its own project (visual, ci.yml only): a
// decoration nudged a few pixels must flag a PR, never stand between someone
// and a club-night deploy.

const WIDTHS = [1920, 1440, 1280, 1100, 1024, 960, 768, 600, 430, 390, 360, 320];

test.use({ reducedMotion: 'reduce' });

test('no text in a screen recreation runs into a doodle, at any width', async ({ page }) => {
  // Nothing on the recreations may depend on the network: the editorial faces
  // are Google's, the recreations draw only with the kit's own files.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto('/about.html');
  // Paytone One is the shout: if it had not loaded, every width below would be
  // measuring a fallback face and the test would prove nothing.
  await page.evaluate(() => document.fonts.load('16px "Paytone One"'));
  expect(await page.evaluate(() => document.fonts.check('16px "Paytone One"'))).toBe(true);

  const collisions = [];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => document.fonts.ready);
    const found = await page.evaluate(() => {
      const hits = [];
      let doodles = 0;
      let lines = 0;
      document.querySelectorAll('.cid-scr').forEach((screen, index) => {
        const zs = [...screen.querySelectorAll('.cid-dz')];
        doodles += zs.length;
        const walker = document.createTreeWalker(screen, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          // Chip text sits inside its own SVG plate, which the chip draws to fit.
          if (!node.textContent.trim() || node.parentElement.closest('svg')) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const r of range.getClientRects()) {
            if (r.width < 1 || r.height < 1) continue;
            lines += 1;
            for (const z of zs) {
              const d = z.getBoundingClientRect();
              if (r.left < d.right && d.left < r.right && r.top < d.bottom && d.top < r.bottom) {
                hits.push(`screen ${index}: "${node.textContent.trim().slice(0, 30)}" touches the doodle at ${z.style.left},${z.style.top}`);
              }
            }
          }
        }
      });
      return { hits, doodles, lines };
    });
    // A page with no recreations, or none with doodles, must not pass by measuring nothing.
    expect(found.doodles, `doodles at ${width}px`).toBeGreaterThanOrEqual(8);
    expect(found.lines, `text lines at ${width}px`).toBeGreaterThanOrEqual(30);
    collisions.push(...found.hits.map((hit) => `${width}px ${hit}`));
  }
  expect(collisions).toEqual([]);
});
