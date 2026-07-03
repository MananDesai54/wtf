import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { startFixture } from './fixture.js';
import { Recorder } from '../src/recorder.js';
import type { GraphData } from '../src/graph.js';

let server: Server;
let baseUrl: string;
let out: string;

beforeAll(async () => {
  ({ url: baseUrl, server } = await startFixture());
  out = mkdtempSync(join(tmpdir(), 'flowrec-it-'));
});

afterAll(() => server.close());

describe('Recorder', () => {
  it('records full-load and SPA navigations with click edges and screenshots', async () => {
    const rec = new Recorder({
      url: baseUrl,
      out,
      viewport: { width: 800, height: 600 },
      headless: true,
    });
    await rec.start();
    const page = rec.page;

    await page.waitForTimeout(800); // settle debounce for the entry page
    rec.note('entry page');

    await page.click('#go');       // full page load -> /two.html
    await page.waitForTimeout(800);

    await page.click('#spa');      // SPA pushState -> /three
    await page.waitForTimeout(800);

    await rec.stop();

    const graph: GraphData = JSON.parse(readFileSync(join(out, 'graph.json'), 'utf8'));
    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodes.map((n) => new URL(n.url).pathname)).toEqual(['/', '/two.html', '/three']);
    expect(graph.nodes[0].note).toBe('entry page');

    expect(graph.edges).toHaveLength(2);
    expect(graph.edges[0]).toMatchObject({ from: 'p1', to: 'p2', label: 'Go to Two' });
    expect(graph.edges[1]).toMatchObject({ from: 'p2', to: 'p3', label: 'Open Three' });
    for (const e of graph.edges) {
      expect(e.bbox.w).toBeGreaterThan(0);
      expect(e.bbox.h).toBeGreaterThan(0);
    }

    for (const n of graph.nodes) {
      expect(n.shotFile).not.toBeNull();
      expect(existsSync(join(out, n.shotFile!))).toBe(true);
    }

    expect(existsSync(join(out, 'events.jsonl'))).toBe(true);
  }, 60_000);
});
