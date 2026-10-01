import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePptxToModel } from './pptxHandler.js';

// __fixtures__/mini-deck.pptx is a REAL binary .pptx (30 KB), generated
// with python-pptx 1.0.2 — a producer built on PowerPoint's own default
// template, so the package carries the genuine content types, rels,
// theme, master and layout plumbing the in-memory JSZip builder only
// approximates. (LibreOffice was also considered but this environment's
// install ships without the Impress import/export filters.)
//
// Contents: slide 1 = solid #1E2F5C background + centered bold 44pt
// title; slide 2 = a stretched 1×1 PNG picture; slide 3 = fill-only
// rounded rectangle + ellipse. 16:9 at 12192000×6858000 EMU.
describe('parsePptxToModel on the binary mini-deck fixture', () => {
  const loadFixture = async () => {
    const buf = await readFile(join(__dirname, '__fixtures__', 'mini-deck.pptx'));
    return parsePptxToModel(new Blob([buf]));
  };

  it('parses the whole deck: dimensions, text, image, shapes', async () => {
    const model = await loadFixture();

    expect(model.widthEmu).toBe(12192000);
    expect(model.heightEmu).toBe(6858000);
    expect(model.slides).toHaveLength(3);
    const [s1, s2, s3] = model.slides;

    // Slide 1 — real-producer background + title run.
    expect(s1.background).toEqual({ type: 'solid', color: '#1e2f5c' });
    const title = s1.shapes.find((s) => s.type === 'text');
    expect(title).toBeTruthy();
    const run = title.paragraphs.flatMap((p) => p.runs).find((r) => r.text);
    expect(run.text).toBe('Welcome to Awana!');
    expect(run.bold).toBe(true);
    expect(run.sizePt).toBe(44);
    expect(run.color).toBe('#ffb81c');

    // Slide 2 — the embedded PNG lands in the images map.
    const pic = s2.shapes.find((s) => s.type === 'image');
    expect(pic).toBeTruthy();
    expect(pic.imageKey).toBe('ppt/media/image1.png');
    expect(pic).toMatchObject({ x: 3048000, y: 1714500, w: 6096000, h: 3429000 });
    expect(model.images['ppt/media/image1.png']).toBeInstanceOf(Blob);

    // Slide 3 — fill-only geometry presets survive a real producer.
    const geoms = s3.shapes.filter((s) => s.type === 'shape').map((s) => s.geom).sort();
    expect(geoms).toEqual(['ellipse', 'roundRect']);
    const ellipse = s3.shapes.find((s) => s.geom === 'ellipse');
    expect(ellipse.fill).toEqual({ type: 'solid', color: '#e14b4b' });

    // No slide degraded to the error placeholder.
    expect(model.slides.every((s) => !s.error)).toBe(true);
  });
});
