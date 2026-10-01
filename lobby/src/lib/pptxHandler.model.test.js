import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { PARSER_VERSION, parsePptxToModel } from './pptxHandler.js';

// A 1×1 transparent PNG.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const LAYOUT_REL = `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`;

// Build a minimal deck in memory: no binary fixture to maintain, and
// the test exercises the exact zip/rels/theme paths the parser walks.
// `slides` is a list of { xml, rels } — rels are extra <Relationship>
// strings appended after the layout rel every slide gets.
async function buildDeck(slides) {
  const zip = new JSZip();

  const sldIds = slides
    .map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`)
    .join('\n    ');
  zip.file('ppt/presentation.xml', `<?xml version="1.0"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>
    ${sldIds}
  </p:sldIdLst>
  <p:sldSz cx="12192000" cy="6858000"/>
</p:presentation>`);

  const presRels = slides
    .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`)
    .join('\n  ');
  zip.file('ppt/_rels/presentation.xml.rels', `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${presRels}
</Relationships>`);

  slides.forEach((slide, i) => {
    zip.file(`ppt/slides/slide${i + 1}.xml`, slide.xml);
    zip.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`, `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${LAYOUT_REL}
  ${slide.rels || ''}
</Relationships>`);
  });

  zip.file('ppt/slideLayouts/slideLayout1.xml', `<?xml version="1.0"?>
<p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree/></p:cSld></p:sldLayout>`);
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`);

  zip.file('ppt/slideMasters/slideMaster1.xml', `<?xml version="1.0"?>
<p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree/></p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2"/>
</p:sldMaster>`);
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`);

  zip.file('ppt/theme/theme1.xml', `<?xml version="1.0"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <a:themeElements>
    <a:clrScheme name="Test">
      <a:dk1><a:srgbClr val="000000"/></a:dk1>
      <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="222222"/></a:dk2>
      <a:lt2><a:srgbClr val="EEEEEE"/></a:lt2>
      <a:accent1><a:srgbClr val="4CAF50"/></a:accent1>
      <a:accent2><a:srgbClr val="E14B4B"/></a:accent2>
    </a:clrScheme>
  </a:themeElements>
</a:theme>`);

  zip.file('ppt/media/image1.png', PNG_B64, { base64: true });

  return zip.generateAsync({ type: 'blob' });
}

// Slide 1: solid background, one centered title run, advTm=3000.
const SLIDE_TITLE = `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:bg><p:bgPr><a:solidFill><a:srgbClr val="112233"/></a:solidFill></p:bgPr></p:bg>
    <p:spTree>
      <p:sp>
        <p:spPr>
          <a:xfrm><a:off x="1219200" y="685800"/><a:ext cx="9753600" cy="1371600"/></a:xfrm>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/>
          <a:p>
            <a:pPr algn="ctr"/>
            <a:r>
              <a:rPr b="1" sz="4400"><a:solidFill><a:srgbClr val="FFCC00"/></a:solidFill></a:rPr>
              <a:t>Welcome to Awana!</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:transition advTm="3000"/>
</p:sld>`;

// Slide 2: schemeClr background via layout→master→theme chain + a picture.
const SLIDE_PICTURE = `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld>
    <p:bg><p:bgPr><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></p:bgPr></p:bg>
    <p:spTree>
      <p:pic>
        <p:blipFill><a:blip r:embed="rId5"/></p:blipFill>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="6096000" cy="3429000"/></a:xfrm>
        </p:spPr>
      </p:pic>
    </p:spTree>
  </p:cSld>
</p:sld>`;

const IMAGE_REL = `<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>`;

const wrapSlide = (spTree, bg = '') => `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld>
    ${bg}
    <p:spTree>${spTree}</p:spTree>
  </p:cSld>
</p:sld>`;

const SOLID_BG = '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="112233"/></a:solidFill></p:bgPr></p:bg>';

const fillSp = (prst, fill, xfrmAttrs = '') => `
      <p:sp>
        <p:spPr>
          <a:xfrm ${xfrmAttrs}><a:off x="914400" y="457200"/><a:ext cx="1828800" cy="914400"/></a:xfrm>
          <a:prstGeom prst="${prst}"/>
          ${fill}
        </p:spPr>
      </p:sp>`;

const RED_FILL = '<a:solidFill><a:srgbClr val="E14B4B"/></a:solidFill>';

describe('parsePptxToModel', () => {
  it('exports a bumped PARSER_VERSION for the model cache', () => {
    expect(PARSER_VERSION).toBe(2);
  });

  it('parses geometry, text, colors, images and timing from a real zip', async () => {
    const blob = await buildDeck([
      { xml: SLIDE_TITLE },
      { xml: SLIDE_PICTURE, rels: IMAGE_REL },
    ]);
    const model = await parsePptxToModel(blob);

    expect(model.widthEmu).toBe(12192000);
    expect(model.heightEmu).toBe(6858000);
    expect(model.slides).toHaveLength(2);

    const [s1, s2] = model.slides;

    // Slide 1 — solid bg, one bold centered 44pt yellow run, advTm honored
    // (the old stub always returned 5000).
    expect(s1.background).toEqual({ type: 'solid', color: '#112233' });
    expect(s1.durationMs).toBe(3000);
    expect(s1.error).toBeUndefined();
    expect(s1.shapes).toHaveLength(1);
    const text = s1.shapes[0];
    expect(text.type).toBe('text');
    expect(text.x).toBe(1219200);
    expect(text.w).toBe(9753600);
    expect(text.rot).toBe(0);
    expect(text.flipH).toBe(false);
    expect(text.anchor).toBe('ctr'); // bodyPr with no anchor → centered
    expect(text.paragraphs[0].align).toBe('ctr');
    const run = text.paragraphs[0].runs[0];
    expect(run.text).toBe('Welcome to Awana!');
    expect(run.bold).toBe(true);
    expect(run.underline).toBe(false);
    expect(run.sizePt).toBe(44);
    expect(run.color).toBe('#ffcc00');

    // Slide 2 — schemeClr resolved through layout → master → theme; the
    // picture is extracted into the images map.
    expect(s2.background).toEqual({ type: 'solid', color: '#4caf50' });
    expect(s2.durationMs).toBeNull();
    expect(s2.shapes).toHaveLength(1);
    expect(s2.shapes[0].type).toBe('image');
    expect(s2.shapes[0].imageKey).toBe('ppt/media/image1.png');
    expect(model.images['ppt/media/image1.png']).toBeInstanceOf(Blob);
  });

  it('parses fill-only shapes with geometry presets (unknown → rect)', async () => {
    const spTree = [
      fillSp('rect', RED_FILL),
      fillSp('roundRect', RED_FILL),
      fillSp('ellipse', RED_FILL),
      fillSp('star5', RED_FILL), // unsupported preset degrades to rect
      fillSp('rect', `<a:gradFill><a:gsLst>
          <a:gs pos="0"><a:srgbClr val="000000"/></a:gs>
          <a:gs pos="100000"><a:srgbClr val="FFFFFF"/></a:gs>
        </a:gsLst><a:lin ang="0"/></a:gradFill>`),
    ].join('');
    const model = await parsePptxToModel(await buildDeck([{ xml: wrapSlide(spTree, SOLID_BG) }]));

    const shapes = model.slides[0].shapes;
    expect(shapes).toHaveLength(5);
    expect(shapes.every((s) => s.type === 'shape')).toBe(true);
    expect(shapes.map((s) => s.geom)).toEqual(['rect', 'roundRect', 'ellipse', 'rect', 'rect']);
    expect(shapes[0]).toMatchObject({
      x: 914400, y: 457200, w: 1828800, h: 914400,
      fill: { type: 'solid', color: '#e14b4b' },
      rot: 0, flipH: false, flipV: false,
    });
    expect(shapes[4].fill.type).toBe('gradient');
    expect(shapes[4].fill.stops).toHaveLength(2);
  });

  it('reads rotation and flips off the xfrm (1/60000-degree units)', async () => {
    const spTree = fillSp('rect', RED_FILL, 'rot="5400000" flipH="1" flipV="1"');
    const model = await parsePptxToModel(await buildDeck([{ xml: wrapSlide(spTree, SOLID_BG) }]));
    expect(model.slides[0].shapes[0]).toMatchObject({ rot: 90, flipH: true, flipV: true });
  });

  it('flattens group shapes through the chOff/chExt → off/ext transform', async () => {
    // Group occupies (914400, 685800)+(3657600×1828800) in slide space;
    // child space is (0,0)+(1828800×914400) → scale ×2 both axes.
    const spTree = `
      <p:grpSp>
        <p:grpSpPr>
          <a:xfrm>
            <a:off x="914400" y="685800"/><a:ext cx="3657600" cy="1828800"/>
            <a:chOff x="0" y="0"/><a:chExt cx="1828800" cy="914400"/>
          </a:xfrm>
        </p:grpSpPr>
        <p:pic>
          <p:blipFill><a:blip r:embed="rId5"/></p:blipFill>
          <p:spPr>
            <a:xfrm><a:off x="457200" y="228600"/><a:ext cx="914400" cy="457200"/></a:xfrm>
          </p:spPr>
        </p:pic>
      </p:grpSp>`;
    const model = await parsePptxToModel(
      await buildDeck([{ xml: wrapSlide(spTree, SOLID_BG), rels: IMAGE_REL }]),
    );
    const [pic] = model.slides[0].shapes;
    expect(pic.type).toBe('image');
    expect(pic.imageKey).toBe('ppt/media/image1.png');
    // x = 914400 + 457200×2, y = 685800 + 228600×2, w/h doubled.
    expect(pic).toMatchObject({ x: 1828800, y: 1143000, w: 1828800, h: 914400 });
  });

  it('handles line breaks, blank paragraphs, anchor, underline and autofit scaling', async () => {
    const spTree = `
      <p:sp>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="6096000" cy="3429000"/></a:xfrm>
        </p:spPr>
        <p:txBody>
          <a:bodyPr anchor="b"><a:normAutofit fontScale="62500"/></a:bodyPr>
          <a:p>
            <a:r><a:rPr sz="4400" u="sng"/><a:t>Line one</a:t></a:r>
            <a:br/>
            <a:r><a:t>Line two</a:t></a:r>
          </a:p>
          <a:p/>
          <a:p>
            <a:r><a:t>After the gap</a:t></a:r>
          </a:p>
        </p:txBody>
      </p:sp>`;
    const model = await parsePptxToModel(await buildDeck([{ xml: wrapSlide(spTree, SOLID_BG) }]));

    const [shape] = model.slides[0].shapes;
    expect(shape.type).toBe('text');
    expect(shape.anchor).toBe('b');
    expect(shape.paragraphs).toHaveLength(3);

    const [p1, p2, p3] = shape.paragraphs;
    expect(p1.runs).toHaveLength(3);
    expect(p1.runs[0].text).toBe('Line one');
    expect(p1.runs[0].underline).toBe(true);
    // normAutofit fontScale=62500 → 44pt × 0.625 = 27.5pt.
    expect(p1.runs[0].sizePt).toBe(27.5);
    expect(p1.runs[1]).toEqual({ br: true });
    expect(p1.runs[2].text).toBe('Line two');
    expect(p1.runs[2].underline).toBe(false);
    // Empty <a:p> preserved for vertical rhythm.
    expect(p2.runs).toEqual([]);
    expect(p3.runs[0].text).toBe('After the gap');
  });

  it('marks a slide with no background and nothing renderable as error', async () => {
    // SmartArt/charts arrive as graphicFrame, which the parser skips.
    const spTree = '<p:graphicFrame/>';
    const model = await parsePptxToModel(await buildDeck([
      { xml: wrapSlide(spTree) },
      { xml: SLIDE_TITLE },
    ]));
    expect(model.slides).toHaveLength(2);
    expect(model.slides[0]).toMatchObject({ error: true, background: null, shapes: [] });
    expect(model.slides[1].error).toBeUndefined();
  });

  it('treats a text-less txBody as a fill-only shape, not a text shape', async () => {
    const spTree = `
      <p:sp>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>
          <a:prstGeom prst="ellipse"/>
          ${RED_FILL}
        </p:spPr>
        <p:txBody><a:bodyPr/><a:p/></p:txBody>
      </p:sp>`;
    const model = await parsePptxToModel(await buildDeck([{ xml: wrapSlide(spTree, SOLID_BG) }]));
    expect(model.slides[0].shapes[0]).toMatchObject({ type: 'shape', geom: 'ellipse' });
  });

  it('rejects a zip with no slides', async () => {
    const zip = new JSZip();
    zip.file('ppt/presentation.xml', '<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>');
    zip.file('ppt/_rels/presentation.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
    const blob = await zip.generateAsync({ type: 'blob' });
    await expect(parsePptxToModel(blob)).rejects.toThrow(/No slides/);
  });
});
