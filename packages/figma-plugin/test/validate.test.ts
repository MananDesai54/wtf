import { describe, it, expect } from 'vitest';
import { validateBundle } from '../src/validate.js';

const good = {
  version: 1,
  startUrl: 'https://a.com/',
  recordedAt: '2026-07-03T00:00:00Z',
  nodes: [
    { id: 'p1', url: 'https://a.com/', title: 'Home', viewport: { width: 100, height: 100 }, image: null },
    { id: 'p2', url: 'https://a.com/x', title: 'X', viewport: { width: 100, height: 100 }, image: null },
  ],
  edges: [{ from: 'p1', to: 'p2', label: 'Go', bbox: { x: 0, y: 0, w: 1, h: 1 } }],
};

describe('validateBundle', () => {
  it('accepts a valid bundle', () => {
    const r = validateBundle(good);
    expect(r.errors).toEqual([]);
    expect(r.bundle?.edges).toHaveLength(1);
  });
  it('rejects wrong version', () => {
    const r = validateBundle({ ...good, version: 3 });
    expect(r.bundle).toBeNull();
    expect(r.errors[0]).toMatch(/version/);
  });
  it('rejects missing or empty nodes', () => {
    expect(validateBundle({ ...good, nodes: [] }).bundle).toBeNull();
    expect(validateBundle({ version: 1 }).bundle).toBeNull();
  });
  it('rejects non-objects', () => {
    expect(validateBundle('nope').bundle).toBeNull();
  });
  it('drops edges with unknown node refs, with warning', () => {
    const r = validateBundle({ ...good, edges: [...good.edges, { from: 'p1', to: 'p99', label: 'Bad', bbox: { x: 0, y: 0, w: 1, h: 1 } }] });
    expect(r.bundle?.edges).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/p99/);
  });
  it('rejects bundles containing malformed nodes', () => {
    const r = validateBundle({ ...good, nodes: [...good.nodes, { id: 'p3' }] });
    expect(r.bundle).toBeNull();
    expect(r.errors[0]).toMatch(/malformed/);
  });
  it('drops malformed edges with warning', () => {
    const r = validateBundle({ ...good, edges: [...good.edges, { from: 'p1', to: 'p2' }] });
    expect(r.bundle?.edges).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/malformed/);
  });
  it('accepts version 2 bundles with dom nodes', () => {
    const r = validateBundle({
      ...good,
      version: 2,
      nodes: [
        { ...good.nodes[0], dom: { width: 900, height: 5000, elements: [], images: {} }, image: null },
        good.nodes[1],
      ],
    });
    expect(r.errors).toEqual([]);
    expect(r.bundle?.nodes[0].dom?.height).toBe(5000);
  });

  it('still accepts version 1 bundles', () => {
    expect(validateBundle(good).bundle).not.toBeNull();
  });

  it('rejects malformed dom', () => {
    const r = validateBundle({
      ...good,
      version: 2,
      nodes: [{ ...good.nodes[0], dom: { width: 'wide', elements: null } }, good.nodes[1]],
    });
    expect(r.bundle).toBeNull();
    expect(r.errors[0]).toMatch(/malformed dom/);
  });

  it('accepts v2 nodes with dom explicitly null', () => {
    const r = validateBundle({ ...good, version: 2, nodes: [{ ...good.nodes[0], dom: null }, good.nodes[1]] });
    expect(r.bundle).not.toBeNull();
    expect(r.errors).toEqual([]);
  });

  it('rejects dom with non-object images', () => {
    const r = validateBundle({ ...good, version: 2, nodes: [{ ...good.nodes[0], dom: { width: 1, height: 1, elements: [], images: 5 } }, good.nodes[1]] });
    expect(r.bundle).toBeNull();
    expect(r.errors[0]).toMatch(/malformed dom/);
  });
});
