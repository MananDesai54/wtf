import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import type { BBox, GraphData } from './graph.js';

export const MAX_DIM = 4096;

export function scaleFactor(width: number, height: number): number {
  const m = Math.max(width, height);
  return m > MAX_DIM ? MAX_DIM / m : 1;
}

export function scaleBBox(b: BBox, f: number): BBox {
  return { x: Math.round(b.x * f), y: Math.round(b.y * f), w: Math.round(b.w * f), h: Math.round(b.h * f) };
}

interface BundleImage { format: 'png'; base64: string; width: number; height: number }

export async function exportSession(sessionDir: string, outFile: string): Promise<void> {
  let graph: GraphData;
  try {
    graph = JSON.parse(readFileSync(join(sessionDir, 'graph.json'), 'utf8'));
  } catch (err) {
    throw new Error(`cannot read session graph at ${join(sessionDir, 'graph.json')}: ${String(err)}`, { cause: err });
  }
  const factors = new Map<string, number>();
  const nodes = [];

  for (const n of graph.nodes) {
    let image: BundleImage | null = null;
    if (n.shotFile) {
      try {
        const img = sharp(join(sessionDir, n.shotFile));
        const meta = await img.metadata();
        const w = meta.width ?? 0;
        const h = meta.height ?? 0;
        const f = scaleFactor(w, h);
        factors.set(n.id, f);
        const buf = f < 1
          ? await img.resize({ width: Math.round(w * f), height: Math.round(h * f), fit: 'inside' }).png().toBuffer()
          : await img.png().toBuffer();
        const scaled = await sharp(buf).metadata();
        image = {
          format: 'png',
          base64: buf.toString('base64'),
          width: scaled.width ?? Math.round(w * f),
          height: scaled.height ?? Math.round(h * f),
        };
      } catch (err) {
        throw new Error(`failed to process screenshot for node ${n.id} (${n.shotFile}): ${String(err)}`, { cause: err });
      }
    }
    nodes.push({
      id: n.id, url: n.url, title: n.title,
      ...(n.note ? { note: n.note } : {}),
      viewport: n.viewport, image,
    });
  }

  const edges = graph.edges.map((e) => ({
    from: e.from, to: e.to, label: e.label,
    bbox: scaleBBox(e.bbox, factors.get(e.from) ?? 1),
  }));

  const bundle = {
    version: 1,
    startUrl: graph.startUrl,
    recordedAt: graph.recordedAt,
    nodes, edges,
  };
  writeFileSync(outFile, JSON.stringify(bundle));
}
