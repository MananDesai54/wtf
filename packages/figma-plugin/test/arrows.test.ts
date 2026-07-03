import { describe, it, expect } from 'vitest';
import { computeArrowPath } from '../src/arrows.js';

const src = { x: 0, y: 0, width: 400, height: 300 };
const dstRight = { x: 800, y: 100, width: 400, height: 300 };
const dstLeft = { x: -900, y: 0, width: 400, height: 300 };

describe('computeArrowPath', () => {
  it('routes forward edges as a 4-point elbow', () => {
    const start = { x: 400, y: 150 }; // src right edge
    const end = { x: 800, y: 140 };   // dst left edge
    const pts = computeArrowPath(start, end, src, dstRight);
    expect(pts).toHaveLength(4);
    expect(pts[0]).toEqual(start);
    expect(pts[3]).toEqual(end);
    // vertical segment sits between the frames
    expect(pts[1].x).toBe(600);
    expect(pts[1].y).toBe(150);
    expect(pts[2]).toEqual({ x: 600, y: 140 });
  });

  it('routes backward edges around the frames, ending horizontally into the target', () => {
    const start = { x: 400, y: 150 };
    const end = { x: -900, y: 40 };
    const pts = computeArrowPath(start, end, src, dstLeft);
    expect(pts[0]).toEqual(start);
    expect(pts[pts.length - 1]).toEqual(end);
    // detour goes below both frames
    const maxY = Math.max(...pts.map((p) => p.y));
    expect(maxY).toBeGreaterThan(300);
    // final approach is horizontal, from the left of the target
    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    expect(prev.y).toBe(last.y);
    expect(prev.x).toBeLessThan(last.x);
  });

  it('every segment is axis-aligned', () => {
    for (const [start, end, dst] of [
      [{ x: 400, y: 150 }, { x: 800, y: 140 }, dstRight],
      [{ x: 400, y: 150 }, { x: -900, y: 40 }, dstLeft],
    ] as const) {
      const pts = computeArrowPath(start, end, src, dst);
      for (let i = 1; i < pts.length; i++) {
        const horizontal = pts[i].y === pts[i - 1].y;
        const vertical = pts[i].x === pts[i - 1].x;
        expect(horizontal || vertical).toBe(true);
      }
    }
  });
});
