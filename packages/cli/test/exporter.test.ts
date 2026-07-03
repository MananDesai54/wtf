import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { scaleFactor, scaleBBox, exportSession, MAX_DIM } from '../src/exporter.js';
import type { GraphData } from '../src/graph.js';

describe('scaleFactor', () => {
  it('is 1 when within limits', () => {
    expect(scaleFactor(1440, 4096)).toBe(1);
  });
  it('scales the larger dimension down to MAX_DIM', () => {
    expect(scaleFactor(1440, 8192)).toBe(0.5);
  });
});

describe('scaleBBox', () => {
  it('scales and rounds all fields', () => {
    expect(scaleBBox({ x: 100, y: 201, w: 50, h: 33 }, 0.5)).toEqual({ x: 50, y: 101, w: 25, h: 17 });
  });
});

describe('exportSession', () => {
  it('bundles nodes with base64 images, downscaling oversized shots', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wtf-exp-'));
    mkdirSync(join(dir, 'shots'));
    // 1000x100 (fits) and 8192x64 (needs 0.5x)
    await sharp({ create: { width: 1000, height: 100, channels: 3, background: 'red' } })
      .png().toFile(join(dir, 'shots', '0001.png'));
    await sharp({ create: { width: 8192, height: 64, channels: 3, background: 'blue' } })
      .png().toFile(join(dir, 'shots', '0002.png'));

    const graph: GraphData = {
      startUrl: 'https://a.com/',
      recordedAt: '2026-07-03T00:00:00Z',
      nodes: [
        { id: 'p1', url: 'https://a.com/', title: 'Home', shotFile: 'shots/0001.png', domFile: null, viewport: { width: 1000, height: 100 }, timestamp: 1 },
        { id: 'p2', url: 'https://a.com/big', title: 'Big', shotFile: 'shots/0002.png', domFile: null, viewport: { width: 8192, height: 64 }, note: 'wide page', timestamp: 2 },
      ],
      edges: [
        { from: 'p2', to: 'p1', label: 'Back', bbox: { x: 4000, y: 10, w: 200, h: 20 }, timestamp: 3 },
      ],
    };
    writeFileSync(join(dir, 'graph.json'), JSON.stringify(graph));

    const out = join(dir, 'figma-import.json');
    await exportSession(dir, out);
    const bundle = JSON.parse(readFileSync(out, 'utf8'));

    expect(bundle.version).toBe(2);
    expect(bundle.nodes).toHaveLength(2);
    expect(bundle.nodes[0].image.width).toBe(1000);
    expect(bundle.nodes[1].image.width).toBe(MAX_DIM);
    expect(bundle.nodes[1].note).toBe('wide page');
    expect(bundle.nodes[1].image.base64.length).toBeGreaterThan(100);
    // bbox on edge from p2 scaled by 0.5
    expect(bundle.edges[0].bbox).toEqual({ x: 2000, y: 5, w: 100, h: 10 });
  });

  it('emits image:null for nodes without a screenshot and leaves their edges unscaled', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wtf-exp2-'));
    mkdirSync(join(dir, 'shots'));
    const graph: GraphData = {
      startUrl: 'https://a.com/',
      recordedAt: '2026-07-03T00:00:00Z',
      nodes: [
        { id: 'p1', url: 'https://a.com/', title: 'NoShot', shotFile: null, domFile: null, viewport: { width: 800, height: 600 }, timestamp: 1 },
        { id: 'p2', url: 'https://a.com/x', title: 'X', shotFile: null, domFile: null, viewport: { width: 800, height: 600 }, timestamp: 2 },
      ],
      edges: [
        { from: 'p1', to: 'p2', label: 'Go', bbox: { x: 10, y: 20, w: 30, h: 40 }, timestamp: 3 },
      ],
    };
    writeFileSync(join(dir, 'graph.json'), JSON.stringify(graph));
    const out = join(dir, 'figma-import.json');
    await exportSession(dir, out);
    const bundle = JSON.parse(readFileSync(out, 'utf8'));
    expect(bundle.nodes[0].image).toBeNull();
    expect(bundle.edges[0].bbox).toEqual({ x: 10, y: 20, w: 30, h: 40 });
  });

  it('fails with node context when a screenshot file is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wtf-exp3-'));
    mkdirSync(join(dir, 'shots'));
    const graph: GraphData = {
      startUrl: 'https://a.com/',
      recordedAt: '2026-07-03T00:00:00Z',
      nodes: [
        { id: 'p1', url: 'https://a.com/', title: 'Gone', shotFile: 'shots/0001.png', domFile: null, viewport: { width: 800, height: 600 }, timestamp: 1 },
      ],
      edges: [],
    };
    writeFileSync(join(dir, 'graph.json'), JSON.stringify(graph));
    await expect(exportSession(dir, join(dir, 'figma-import.json'))).rejects.toThrow(/node p1/);
  });

  it('bundles dom captures verbatim without rescaling their edges', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wtf-exp4-'));
    mkdirSync(join(dir, 'shots'));
    mkdirSync(join(dir, 'dom'));
    const stored = {
      width: 900, height: 5000,
      elements: [
        { kind: 'text', x: 10, y: 20, w: 100, h: 30, text: 'Hi', fontSize: 16, fontWeight: 400, color: { r: 0, g: 0, b: 0, a: 1 }, align: 'left' },
      ],
      images: { img1: 'https://a.com/x.png' },
      imageData: { img1: { mime: 'image/png', base64: 'QUJD' } },
    };
    writeFileSync(join(dir, 'dom', '0001.json'), JSON.stringify(stored));
    const graph: GraphData = {
      startUrl: 'https://a.com/',
      recordedAt: '2026-07-03T00:00:00Z',
      nodes: [
        { id: 'p1', url: 'https://a.com/', title: 'Dom', shotFile: null, domFile: 'dom/0001.json', viewport: { width: 900, height: 600 }, timestamp: 1 },
        { id: 'p2', url: 'https://a.com/x', title: 'X', shotFile: null, domFile: null, viewport: { width: 900, height: 600 }, timestamp: 2 },
      ],
      edges: [
        { from: 'p1', to: 'p2', label: 'Go', bbox: { x: 700, y: 4500, w: 100, h: 40 }, timestamp: 3 },
      ],
    };
    writeFileSync(join(dir, 'graph.json'), JSON.stringify(graph));
    const out = join(dir, 'figma-import.json');
    await exportSession(dir, out);
    const bundle = JSON.parse(readFileSync(out, 'utf8'));
    expect(bundle.version).toBe(2);
    expect(bundle.nodes[0].image).toBeNull();
    expect(bundle.nodes[0].dom.height).toBe(5000);
    expect(bundle.nodes[0].dom.elements).toHaveLength(1);
    expect(bundle.nodes[0].dom.images.img1).toEqual({ mime: 'image/png', base64: 'QUJD' });
    // dom edges NOT rescaled even though height 5000 > 4096
    expect(bundle.edges[0].bbox).toEqual({ x: 700, y: 4500, w: 100, h: 40 });
  });
});
