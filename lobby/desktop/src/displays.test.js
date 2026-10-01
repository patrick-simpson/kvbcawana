import { describe, it, expect } from 'vitest';
import { findDisplay, rememberDisplay } from './displays.js';

const laptop = { id: 1, label: 'Built-in Display', bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
const tv = { id: 2, label: 'SAMSUNG', bounds: { x: 1920, y: 0, width: 1920, height: 1080 } };
const booth = { id: 3, label: 'DELL P2419H', bounds: { x: -1920, y: 0, width: 1920, height: 1080 } };

describe('findDisplay', () => {
  it('finds the same monitor by id and name', () => {
    expect(findDisplay([laptop, tv, booth], rememberDisplay(tv))).toBe(tv);
  });

  it('follows the name when Windows renumbers the id', () => {
    const moved = { ...tv, id: 9, bounds: { ...tv.bounds, x: 3840 } };
    expect(findDisplay([laptop, moved, booth], rememberDisplay(tv))).toBe(moved);
  });

  it('never takes a different monitor that inherited the id', () => {
    const other = { ...booth, id: 2 };
    expect(findDisplay([laptop, other], rememberDisplay(tv))).toBeNull();
  });

  it('tells two same-named monitors apart by where they are', () => {
    const a = { id: 5, label: 'Generic PnP Monitor', bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
    const b = { id: 6, label: 'Generic PnP Monitor', bounds: { x: 1920, y: 0, width: 1920, height: 1080 } };
    const saved = rememberDisplay(b);
    expect(findDisplay([a, { ...b, id: 7 }], saved)).toEqual({ ...b, id: 7 });
    expect(findDisplay([a, { ...b, id: 7, bounds: { ...b.bounds, x: 99 } }], saved)).toBeNull();
  });

  it('falls back to id, then to position and size, when there are no names', () => {
    const noName = (d) => ({ id: d.id, bounds: d.bounds });
    expect(findDisplay([noName(laptop), noName(tv)], rememberDisplay(noName(tv)))).toEqual(noName(tv));
    expect(findDisplay([noName(laptop), { ...noName(tv), id: 8 }], rememberDisplay(noName(tv)))).toEqual({ ...noName(tv), id: 8 });
  });

  it('is not found when unplugged, or with nothing saved', () => {
    expect(findDisplay([laptop, booth], rememberDisplay(tv))).toBeNull();
    expect(findDisplay([laptop], null)).toBeNull();
    expect(findDisplay([], rememberDisplay(tv))).toBeNull();
  });
});
