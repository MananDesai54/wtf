import { describe, it, expect } from 'vitest';
import { computeLayout, COL_GAP, ROW_GAP } from '../src/layout.js';

const size = (w = 100, h = 50) => ({ width: w, height: h });

describe('computeLayout', () => {
  it('places a linear chain left to right', () => {
    const sizes = new Map([['a', size()], ['b', size(200)], ['c', size()]]);
    const p = computeLayout(['a', 'b', 'c'], [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }], sizes);
    expect(p.get('a')).toEqual({ x: 0, y: 0, depth: 0 });
    expect(p.get('b')).toEqual({ x: 100 + COL_GAP, y: 0, depth: 1 });
    expect(p.get('c')).toEqual({ x: 100 + COL_GAP + 200 + COL_GAP, y: 0, depth: 2 });
  });

  it('stacks same-depth nodes with ROW_GAP', () => {
    const sizes = new Map([['a', size()], ['b', size(100, 80)], ['c', size()]]);
    const p = computeLayout(['a', 'b', 'c'], [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }], sizes);
    expect(p.get('b')!.y).toBe(0);
    expect(p.get('c')!.y).toBe(80 + ROW_GAP);
    expect(p.get('b')!.x).toBe(p.get('c')!.x);
  });

  it('puts unreachable nodes in a final column', () => {
    const sizes = new Map([['a', size()], ['z', size()]]);
    const p = computeLayout(['a', 'z'], [], sizes);
    expect(p.get('a')!.depth).toBe(0);
    expect(p.get('z')!.depth).toBe(1);
    expect(p.get('z')!.x).toBe(100 + COL_GAP);
  });

  it('ignores cycles', () => {
    const sizes = new Map([['a', size()], ['b', size()]]);
    const p = computeLayout(['a', 'b'], [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }], sizes);
    expect(p.get('a')!.depth).toBe(0);
    expect(p.get('b')!.depth).toBe(1);
  });
});
