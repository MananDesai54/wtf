export interface Point { x: number; y: number }
export interface Bounds { x: number; y: number; width: number; height: number }

const CLEARANCE = 60;

// Orthogonal (elbow) route from a hotspot's right edge to the target
// frame's left edge. Forward edges take a simple 4-point elbow through the
// column gutter; backward edges detour below both frames. The final
// approach is always horizontal into the target, so a single right-pointing
// arrowhead at the end is correct for every route.
export function computeArrowPath(start: Point, end: Point, src: Bounds, dst: Bounds): Point[] {
  if (end.x > start.x) {
    const midX = (start.x + end.x) / 2;
    return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
  }
  const channelY = Math.max(src.y + src.height, dst.y + dst.height) + CLEARANCE;
  const outX = start.x + CLEARANCE;
  const inX = end.x - CLEARANCE;
  return [
    start,
    { x: outX, y: start.y },
    { x: outX, y: channelY },
    { x: inX, y: channelY },
    { x: inX, y: end.y },
    end,
  ];
}
