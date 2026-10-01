import { useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { PLATE, plateOutline } from '../../lib/brand.js';

/**
 * The stepped chip's silhouette (StepChip) around content of any size: a
 * Londrina label on the pill tier, whatever the caller renders on the block
 * that steps out beneath it, and the plate printed slightly out of register
 * with its white keyline. It carries every overlay on the lobby that says
 * more than one value (the status sticker, a notice, a milestone toast), so
 * the whole screen speaks the corner chips' one shape.
 *
 * The outline is measured off the real boxes, not guessed: CSS lays the
 * label and the block out (app.css `.step-plate`, sized by `--plate-label`,
 * the label's font size), and a layout effect reads their sizes and draws
 * the path behind them before the first paint. A ResizeObserver redraws it
 * when a font lands or the content changes ("connected" becoming
 * "disconnected · retry 3 in ~10s"), and it redraws SYNCHRONOUSLY
 * (flushSync): the observer runs after layout and before paint, so the new
 * outline is in the same frame as the new words, never a frame late with
 * the text running off the old plate. Nothing runs per frame or per render,
 * and a transform on an ancestor (a toast popping in) never changes the
 * reading.
 *
 * `plate` is the fill (a CSS colour or var); the default is the kit's chip
 * charcoal at 50%. Static by design: the caller animates the whole plate.
 *
 * @param {{
 *   label?: import('react').ReactNode,
 *   plate?: string,
 *   className?: string,
 *   labelClassName?: string,
 *   bodyClassName?: string,
 *   labelProps?: Record<string, any>,
 *   style?: import('react').CSSProperties,
 *   children?: import('react').ReactNode,
 * }} props
 */
export default function StepPlate({
  label, plate, className = '', labelClassName = '', bodyClassName = '', labelProps, style, children,
}) {
  const root = useRef(/** @type {HTMLDivElement | null} */ (null));
  const pill = useRef(/** @type {HTMLSpanElement | null} */ (null));
  const body = useRef(/** @type {HTMLDivElement | null} */ (null));
  const [box, setBox] = useState(/** @type {null | { pillW: number, pillH: number, left: number, top: number, width: number, height: number }} */ (null));

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return undefined;
    const measure = () => {
      const p = pill.current;
      const b = body.current;
      const next = {
        pillW: p ? p.offsetWidth : 0,
        pillH: p ? p.offsetHeight : 0,
        left: b ? b.offsetLeft : 0,
        top: b ? b.offsetTop : 0,
        width: el.offsetWidth,
        height: el.offsetHeight,
      };
      setBox((prev) => (prev && Object.keys(next).every((k) => prev[k] === next[k]) ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => flushSync(measure));
    ro.observe(el);
    if (pill.current) ro.observe(pill.current);
    if (body.current) ro.observe(body.current);
    return () => ro.disconnect();
  }, []);

  const drawn = box && box.width > 0 && box.height > 0;
  const unit = box && box.pillH > 0 ? box.pillH : (box ? box.height / 2.4 : 0);
  const d = drawn ? plateOutline(box) : '';

  return (
    <div
      ref={root}
      className={`step-plate${label ? '' : ' step-plate--bare'} ${className}`.trim()}
      style={style}
    >
      {drawn && (
        <svg
          className="step-plate__shape"
          width={box.width}
          height={box.height}
          viewBox={`0 0 ${box.width} ${box.height}`}
          aria-hidden="true"
          focusable="false"
        >
          {/* A seasonal echo (app.css paints it in the skin's colour when the
              room wears one); hidden otherwise. */}
          <path className="step-plate__echo" d={d} transform={`translate(${(unit * PLATE.offsetX * 4.2).toFixed(2)} ${(unit * PLATE.offsetY * 4.2).toFixed(2)})`} />
          <path
            className="step-plate__fill"
            d={d}
            style={plate ? { fill: plate } : undefined}
            transform={`translate(${(unit * PLATE.offsetX).toFixed(2)} ${(unit * PLATE.offsetY).toFixed(2)})`}
          />
          <path className="step-plate__keyline" d={d} fill="none" strokeWidth={(unit * PLATE.keyline).toFixed(2)} />
        </svg>
      )}
      {label ? (
        <span ref={pill} className={`step-plate__label ${labelClassName}`.trim()} {...labelProps}>{label}</span>
      ) : null}
      <div ref={body} className={`step-plate__body ${bodyClassName}`.trim()}>{children}</div>
    </div>
  );
}
