import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { BarChart, LineChart } from './historyCharts.jsx';

// The History section's plain-SVG charts: a night from TwoTimTwo's attendance
// report is said so (tooltip, table, hollow dot named in the legend), and a
// missing number is no bar and an empty cell, never a zero.

afterEach(cleanup);

const NIGHTS = ['2019-10-02', '2026-10-07', '2026-10-14'];

describe('LineChart', () => {
  it('a live-only chart is as before: filled dots, no TwoTimTwo legend note, plain tooltips', () => {
    const { container } = render(<LineChart title="Attendance by club" summary="s" nights={NIGHTS} series={[{ label: 'Sparks', color: 'red', values: [1, 2, 3] }]} />);
    expect(container.querySelectorAll('circle[data-from]')).toHaveLength(0);
    expect(screen.queryByText(/Hollow dots/)).toBeNull();
    expect([...container.querySelectorAll('circle title')].map((t) => t.textContent)).toEqual(['Wed, Oct 2, Sparks: 1', 'Wed, Oct 7, Sparks: 2', 'Wed, Oct 14, Sparks: 3']);
  });

  it('a point from TwoTimTwo is hollow, says so in its tooltip and the table, and the legend names it', () => {
    const { container } = render(
      <LineChart title="Attendance by club" summary="s" nights={NIGHTS} nightNotes={[' (from TwoTimTwo)', ' (some clubs from TwoTimTwo)', '']}
        series={[
          { label: 'Sparks', color: 'red', values: [21, 10, 12], from: [true, false, false] },
          { label: 'T&T', color: 'blue', values: [30, 20, 7], from: [true, true, false] },
        ]} />,
    );
    expect(container.querySelectorAll('circle[data-from="twotimtwo"]')).toHaveLength(3);
    const tips = [...container.querySelectorAll('circle title')].map((t) => t.textContent);
    expect(tips).toContain('Wed, Oct 2, Sparks: 21 (from TwoTimTwo)');
    expect(tips).toContain('Wed, Oct 7, T&T: 20 (from TwoTimTwo)');
    expect(tips).toContain('Wed, Oct 7, Sparks: 10');
    expect(screen.getByText('Hollow dots: from TwoTimTwo')).toBeTruthy();
    expect(screen.getByRole('rowheader', { name: 'Wed, Oct 2 (from TwoTimTwo)' })).toBeTruthy();
    expect(screen.getByRole('rowheader', { name: 'Wed, Oct 7 (some clubs from TwoTimTwo)' })).toBeTruthy();
    expect(screen.getByRole('rowheader', { name: 'Wed, Oct 14' })).toBeTruthy();
  });
});

describe('BarChart', () => {
  it('a null value is no bar and an empty cell, never 0; tooltips carry the night note', () => {
    const { container } = render(<BarChart title="Checked out" summary="s" nights={NIGHTS} values={[null, 90, 0]} unit="%" max={100} color="blue" nightNotes={['', ' (desk clubs only)', '']} />);
    expect(container.querySelectorAll('rect')).toHaveLength(1);
    expect(container.querySelector('rect title').textContent).toBe('Wed, Oct 7 (desk clubs only): 90%');
    const cells = [...container.querySelectorAll('tbody td')].map((td) => td.textContent);
    expect(cells).toEqual(['', '90%', '0%']);
  });

  it('draws nothing at all with no nights', () => {
    const { container } = render(<BarChart title="Visitors" summary="s" nights={[]} values={[]} color="red" />);
    expect(container.innerHTML).toBe('');
  });
});
