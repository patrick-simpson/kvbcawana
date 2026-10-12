import { useId } from 'react';
import { nightWords } from '../../lib/historyTrends.js';

// Plain-SVG charts for the History section: no library, nothing to pay for.
// Built to read first and look second: thin marks, a quiet grid, the series
// named in a legend beside swatches (never colour alone), a "show the
// numbers" table under each, and an aria-label that says what the chart says.

const W = 640;
const H = 220;
const PAD = { l: 38, r: 14, t: 12, b: 28 };

/** A round axis top: 5, 10, 20, 25, 50... @param {number} max */
function niceMax(max) {
  if (max <= 5) return 5;
  const mag = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * mag >= max) return step * mag;
  return max;
}

/** @param {number} n @param {number} total */
const xAt = (n, total) => PAD.l + (total <= 1 ? (W - PAD.l - PAD.r) / 2 : (n / (total - 1)) * (W - PAD.l - PAD.r));

function Grid({ top, unit }) {
  const ticks = [0, top / 2, top];
  return ticks.map((t) => {
    const y = PAD.t + (1 - t / top) * (H - PAD.t - PAD.b);
    return (
      <g key={t}>
        <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} className="hist-grid" />
        <text x={PAD.l - 6} y={y + 4} textAnchor="end" className="hist-axis">{t}{unit}</text>
      </g>
    );
  });
}

/** Sparse x labels so they never collide. */
function XLabels({ nights }) {
  const every = Math.max(1, Math.ceil(nights.length / 6));
  return nights.map((n, i) => (i % every === 0 || i === nights.length - 1) ? (
    <text key={n} x={xAt(i, nights.length)} y={H - 8} textAnchor="middle" className="hist-axis">{n.slice(5)}</text>
  ) : null);
}

function Table({ caption, nights, columns }) {
  return (
    <details className="hist-numbers">
      <summary>Show the numbers</summary>
      <div className="hist-table-wrap">
        <table className="hist-table">
          <caption>{caption}</caption>
          <thead><tr><th scope="col">Night</th>{columns.map((c) => <th scope="col" key={c.label}>{c.label}</th>)}</tr></thead>
          <tbody>
            {nights.map((n, i) => (
              <tr key={n}><th scope="row">{nightWords(n)}</th>{columns.map((c) => <td key={c.label}>{c.values[i] ?? ''}{c.unit && c.values[i] != null ? c.unit : ''}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/**
 * One line per series over the nights.
 * @param {{ title: string, summary: string, nights: string[], series: { label: string, color: string, values: number[] }[] }} p
 */
export function LineChart({ title, summary, nights, series }) {
  const id = useId();
  if (!nights.length) return null;
  const top = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const y = (/** @type {number} */ v) => PAD.t + (1 - v / top) * (H - PAD.t - PAD.b);
  return (
    <figure className="hist-chart">
      <figcaption id={`${id}-t`}>{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${id}-t ${id}-d`} className="hist-svg">
        <desc id={`${id}-d`}>{summary}</desc>
        <Grid top={top} unit="" />
        <XLabels nights={nights} />
        {series.map((s) => (
          <g key={s.label}>
            <polyline fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
              points={s.values.map((v, i) => `${xAt(i, nights.length)},${y(v)}`).join(' ')} />
            {s.values.map((v, i) => (
              <circle key={nights[i]} cx={xAt(i, nights.length)} cy={y(v)} r="4" fill={s.color} stroke="var(--panel-paper, #fff)" strokeWidth="2" />
            ))}
          </g>
        ))}
      </svg>
      <ul className="hist-legend" aria-label="Clubs">
        {series.map((s) => <li key={s.label}><span className="hist-swatch" style={{ background: s.color }} aria-hidden="true" />{s.label}</li>)}
      </ul>
      <Table caption={title} nights={nights} columns={series.map((s) => ({ label: s.label, values: s.values }))} />
    </figure>
  );
}

/**
 * One bar per night, one measure.
 * @param {{ title: string, summary: string, nights: string[], values: (number|null)[], color: string, unit?: string, max?: number }} p
 */
export function BarChart({ title, summary, nights, values, color, unit = '', max }) {
  const id = useId();
  if (!nights.length) return null;
  const top = max ?? niceMax(Math.max(1, ...values.map((v) => v ?? 0)));
  const slot = (W - PAD.l - PAD.r) / nights.length;
  const bar = Math.min(28, slot * 0.6);
  return (
    <figure className="hist-chart">
      <figcaption id={`${id}-t`}>{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${id}-t ${id}-d`} className="hist-svg">
        <desc id={`${id}-d`}>{summary}</desc>
        <Grid top={top} unit={unit} />
        {nights.map((n, i) => {
          const v = values[i];
          const cx = PAD.l + slot * (i + 0.5);
          const h = v == null ? 0 : (v / top) * (H - PAD.t - PAD.b);
          return (
            <g key={n}>
              {v != null && v > 0 ? <rect x={cx - bar / 2} y={H - PAD.b - h} width={bar} height={h} rx="3" fill={color} /> : null}
              {nights.length <= 12 || i % Math.ceil(nights.length / 6) === 0 ? <text x={cx} y={H - 8} textAnchor="middle" className="hist-axis">{n.slice(5)}</text> : null}
            </g>
          );
        })}
      </svg>
      <Table caption={title} nights={nights} columns={[{ label: title, values, unit }]} />
    </figure>
  );
}
