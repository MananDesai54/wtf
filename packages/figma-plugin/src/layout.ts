export interface Size { width: number; height: number }
export interface Placement { x: number; y: number; depth: number }

export const COL_GAP = 400;
export const ROW_GAP = 200;

export function computeLayout(
  nodeIds: string[],
  edges: { from: string; to: string }[],
  sizes: Map<string, Size>,
): Map<string, Placement> {
  if (nodeIds.length === 0) return new Map();

  const out = new Map<string, { from: string; to: string }[]>();
  for (const e of edges) {
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from)!.push(e);
  }

  const depth = new Map<string, number>();
  const queue = [nodeIds[0]];
  depth.set(nodeIds[0], 0);
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const e of out.get(id) ?? []) {
      if (!depth.has(e.to)) {
        depth.set(e.to, depth.get(id)! + 1);
        queue.push(e.to);
      }
    }
  }

  const maxDepth = Math.max(...depth.values());
  for (const id of nodeIds) {
    if (!depth.has(id)) depth.set(id, maxDepth + 1);
  }

  // group by depth, preserving nodeIds order
  const columns = new Map<number, string[]>();
  for (const id of nodeIds) {
    const d = depth.get(id)!;
    if (!columns.has(d)) columns.set(d, []);
    columns.get(d)!.push(id);
  }

  const placements = new Map<string, Placement>();
  let x = 0;
  for (const d of [...columns.keys()].sort((a, b) => a - b)) {
    const col = columns.get(d)!;
    let y = 0;
    let colWidth = 0;
    for (const id of col) {
      const s = sizes.get(id) ?? { width: 0, height: 0 };
      placements.set(id, { x, y, depth: d });
      y += s.height + ROW_GAP;
      colWidth = Math.max(colWidth, s.width);
    }
    x += colWidth + COL_GAP;
  }
  return placements;
}
