import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { M } from '../lib/motion.jsx';
import { downloadPptx, parsePptxToModel } from '../lib/pptxHandler.js';
import { getStoredDeckModel } from '../lib/pptxModel.js';
import CatalogScene from './CatalogScene.jsx';
import { ErrorBoundary } from './ErrorBoundary.jsx';

/**
 * Renders a .pptx deck as positioned DOM — no Office Online iframe.
 * Input priority: the uploaded deck in IndexedDB (source='store',
 * served through the pptxModel cache so boots skip re-parsing),
 * else download from the OneDrive URL (often CORS-blocked; accepted).
 *
 * Geometry: OOXML positions are EMUs in the slide's own coordinate
 * space (sldSz). Shapes are laid out in percentages of that space and
 * font sizes in cqw (container-query width units), so one slide model
 * renders correctly at any screen size with zero resize JS.
 *
 * Failure ladder: a bad shape is skipped at parse time; a slide that
 * failed to parse (or crashes at render time — each slide sits in its
 * own ErrorBoundary) shows the CatalogScene placeholder for its turn
 * while the advance timer keeps ticking; a deck that can't load at all
 * renders `fallback` (the iframe embed).
 */
export default function PptxSlideshow({ url, source = 'url', slideshowDelaySec = 5, fallback = null }) {
  const [result, setResult] = useState({ key: null, status: 'loading', model: null });
  const key = `${source}:${url || ''}`;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        let model;
        if (source === 'store') {
          model = await getStoredDeckModel();
        } else {
          model = await parsePptxToModel(await downloadPptx(url));
        }
        if (!cancelled) setResult({ key, status: 'ready', model });
      } catch (err) {
        console.error('PptxSlideshow falling back:', err);
        if (!cancelled) setResult({ key, status: 'failed', model: null });
      }
    })();

    return () => { cancelled = true; };
  }, [key, source, url]);

  const { status, model } = result.key === key ? result : { status: 'loading', model: null };

  if (status === 'failed') return fallback;

  if (status === 'loading') {
    return (
      <div className="background-iframe" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
        Loading presentation…
      </div>
    );
  }

  return <DeckView key={key} model={model} slideshowDelaySec={slideshowDelaySec} />;
}

function DeckView({ model, slideshowDelaySec }) {
  const [index, setIndex] = useState(0);
  const { slides, widthEmu, heightEmu } = model;

  // Blob → object URL map, revoked when the deck unmounts/changes.
  const imageUrls = useMemo(() => {
    const urls = {};
    for (const [k, blob] of Object.entries(model.images || {})) {
      if (blob) urls[k] = URL.createObjectURL(blob);
    }
    return urls;
  }, [model]);
  useEffect(() => () => {
    for (const u of Object.values(imageUrls)) URL.revokeObjectURL(u);
  }, [imageUrls]);

  // Auto-advance: the slide's own advTm when it has one, else config.
  // Lives OUTSIDE the per-slide ErrorBoundary so a crashing slide still
  // yields the stage to the next one.
  useEffect(() => {
    const fallbackMs = Math.max(1000, (Number(slideshowDelaySec) || 5) * 1000);
    const duration = slides[index]?.durationMs || fallbackMs;
    const timer = setTimeout(() => {
      setIndex((prev) => (prev + 1) % slides.length);
    }, duration);
    return () => clearTimeout(timer);
  }, [slides, index, slideshowDelaySec]);

  const slide = slides[index];

  return (
    <div className="background-iframe pptx-stage" style={{ background: '#000' }}>
      <AnimatePresence mode="wait">
        <M.div
          key={index}
          className="pptx-slide-wrap"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.6 } }}
          exit={{ opacity: 0, transition: { duration: 0.4 } }}
        >
          <ErrorBoundary
            label={`pptx slide ${index + 1}`}
            eventKey={index}
            fallback={<CatalogScene theme="sky" />}
          >
            {slide.error
              ? <CatalogScene theme="sky" />
              : <SlideView slide={slide} widthEmu={widthEmu} heightEmu={heightEmu} imageUrls={imageUrls} />}
          </ErrorBoundary>
        </M.div>
      </AnimatePresence>
    </div>
  );
}

// Shared fill-object → CSS background value (solid + gradient).
function fillCss(fill) {
  if (!fill) return null;
  if (fill.type === 'solid') return fill.color;
  if (fill.type === 'gradient') {
    const stops = fill.stops.map((s) => `${s.color} ${Math.round(s.pos * 100)}%`).join(', ');
    return `linear-gradient(${Math.round(fill.angle)}deg, ${stops})`;
  }
  return null;
}

function backgroundStyle(background, imageUrls) {
  const css = fillCss(background);
  if (css) return { background: css };
  if (background && background.type === 'image' && imageUrls[background.imageKey]) {
    return {
      backgroundImage: `url(${imageUrls[background.imageKey]})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    };
  }
  return { background: '#000' };
}

const ALIGN = { l: 'left', ctr: 'center', r: 'right', just: 'justify' };
const ANCHOR = { t: 'flex-start', ctr: 'center', b: 'flex-end' };
const GEOM_RADIUS = { rect: undefined, roundRect: '8%', ellipse: '50%' };

// xfrm rotation (degrees, clockwise) + mirror flips → CSS transform.
function shapeTransform(shape) {
  const parts = [];
  if (shape.rot) parts.push(`rotate(${shape.rot}deg)`);
  if (shape.flipH || shape.flipV) {
    parts.push(`scale(${shape.flipH ? -1 : 1}, ${shape.flipV ? -1 : 1})`);
  }
  return parts.length ? parts.join(' ') : undefined;
}

function SlideView({ slide, widthEmu, heightEmu, imageUrls }) {
  const pct = (v, total) => `${(v / total) * 100}%`;
  // Font size: sizePt → fraction of slide width → cqw. The wrapper has
  // container-type: size, so 1cqw = 1% of the rendered slide width.
  const ptToCqw = (pt) => ((pt * 12700) / widthEmu) * 100;

  return (
    <div
      className="pptx-slide"
      style={{ aspectRatio: `${widthEmu} / ${heightEmu}`, ...backgroundStyle(slide.background, imageUrls) }}
    >
      {slide.shapes.map((shape, i) => {
        const box = {
          position: 'absolute',
          left: pct(shape.x, widthEmu),
          top: pct(shape.y, heightEmu),
          width: pct(shape.w, widthEmu),
          height: pct(shape.h, heightEmu),
          transform: shapeTransform(shape),
        };
        if (shape.type === 'image') {
          return (
            <img
              key={i}
              src={imageUrls[shape.imageKey]}
              alt=""
              style={{ ...box, objectFit: 'contain' }}
              draggable={false}
            />
          );
        }
        if (shape.type === 'shape') {
          return (
            <div
              key={i}
              data-pptx-shape={shape.geom}
              style={{
                ...box,
                background: fillCss(shape.fill) || 'transparent',
                borderRadius: GEOM_RADIUS[shape.geom],
              }}
            />
          );
        }
        return (
          <div
            key={i}
            style={{
              ...box,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: ANCHOR[shape.anchor] || 'center',
              background: shape.fill || 'transparent',
              overflow: 'hidden',
            }}
          >
            {shape.paragraphs.map((p, j) => (
              <div key={j} style={{ textAlign: ALIGN[p.align] || 'left', lineHeight: 1.25, whiteSpace: 'pre-wrap' }}>
                {p.runs.length === 0
                  // Empty <a:p>: hold the line's height so vertical
                  // rhythm survives (pre-wrap + nbsp renders one blank line).
                  ? ' '
                  : p.runs.map((r, k) => (
                    r.br
                      ? '\n'
                      : (
                        <span
                          key={k}
                          style={{
                            fontSize: `${ptToCqw(r.sizePt || 18).toFixed(3)}cqw`,
                            fontWeight: r.bold ? 700 : 400,
                            fontStyle: r.italic ? 'italic' : 'normal',
                            textDecoration: r.underline ? 'underline' : 'none',
                            color: r.color || '#111',
                            fontFamily: "'Segoe UI', system-ui, sans-serif",
                          }}
                        >
                          {r.text}
                        </span>
                      )
                  ))}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
