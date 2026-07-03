import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionGraph } from '../src/graph.js';

const vp = { width: 1440, height: 900 };
let dir: string;
let g: SessionGraph;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wtf-'));
  g = new SessionGraph(dir, 'https://a.com/', '2026-07-03T00:00:00Z');
});

describe('SessionGraph', () => {
  it('creates shots dir and saves graph.json on mutation', () => {
    g.ensureNode('https://a.com/', 'Home', vp, 1);
    expect(existsSync(join(dir, 'shots'))).toBe(true);
    const data = JSON.parse(readFileSync(join(dir, 'graph.json'), 'utf8'));
    expect(data.nodes).toHaveLength(1);
    expect(data.nodes[0].id).toBe('p1');
  });

  it('dedupes by normalized URL', () => {
    const a = g.ensureNode('https://a.com/x/', 'X', vp, 1);
    const b = g.ensureNode('https://a.com/x', 'X', vp, 2);
    expect(a.isNew).toBe(true);
    expect(b.isNew).toBe(false);
    expect(b.node.id).toBe(a.node.id);
  });

  it('markNextDistinct forces a new node for a seen URL', () => {
    g.ensureNode('https://a.com/x', 'X', vp, 1);
    g.markNextDistinct();
    const b = g.ensureNode('https://a.com/x', 'X again', vp, 2);
    expect(b.isNew).toBe(true);
    expect(b.node.id).toBe('p2');
    // later revisits map to the newest node
    expect(g.ensureNode('https://a.com/x', 'X', vp, 3).node.id).toBe('p2');
  });

  it('records edges and notes and shots', () => {
    const a = g.ensureNode('https://a.com/', 'Home', vp, 1);
    const b = g.ensureNode('https://a.com/x', 'X', vp, 2);
    g.addEdge(a.node.id, b.node.id, 'Go', { x: 1, y: 2, w: 3, h: 4 }, 2);
    g.setNote(a.node.id, 'entry page');
    g.setShot(a.node.id, 'shots/0001.png');
    const d = g.data;
    expect(d.edges).toEqual([{ from: 'p1', to: 'p2', label: 'Go', bbox: { x: 1, y: 2, w: 3, h: 4 }, timestamp: 2 }]);
    expect(d.nodes[0].note).toBe('entry page');
    expect(d.nodes[0].shotFile).toBe('shots/0001.png');
  });

  it('creates dom dir and records domFile via setDom', () => {
    const a = g.ensureNode('https://a.com/', 'Home', vp, 1);
    expect(existsSync(join(dir, 'dom'))).toBe(true);
    expect(a.node.domFile).toBeNull();
    g.setDom(a.node.id, 'dom/0001.json');
    expect(g.data.nodes[0].domFile).toBe('dom/0001.json');
    const saved = JSON.parse(readFileSync(join(dir, 'graph.json'), 'utf8'));
    expect(saved.nodes[0].domFile).toBe('dom/0001.json');
  });
});
