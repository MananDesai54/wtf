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
    const r = validateBundle({ ...good, version: 2 });
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
});
